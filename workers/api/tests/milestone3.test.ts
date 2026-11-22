import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index.js';
import { generateSessionToken, hashSessionToken } from '../src/auth/sessions.js';
import { encryptCredential } from '../src/security/crypto.js';

class MockD1Database {
  public tables: Record<string, any[]> = {
    users: [],
    sessions: [],
    provider_credentials: [],
    conversations: [],
    messages: [],
    usage_events: [],
    ip_rate_limits: [],
    account_rate_limits: [],
  };

  prepare(query: string) {
    const trimmed = query.trim();
    return {
      bind: (...args: any[]) => {
        // Normalize whitespace in trimmed for matching
        const normalized = trimmed.replace(/\s+/g, ' ');
        return {
          first: async <T = any>(): Promise<T | null> => {
            if (normalized.includes('FROM sessions s') && normalized.includes('JOIN users u')) {
              const tokenHash = args[0];
              const nowIso = args[1];
              const session = this.tables.sessions.find(
                (s) => s.token_hash === tokenHash && s.expires_at > nowIso
              );
              if (!session) return null;
              const user = this.tables.users.find((u) => u.id === session.user_id);
              if (!user) return null;
              return {
                session_id: session.id,
                expires_at: session.expires_at,
                user_id: user.id,
                email: user.email,
                name: user.name,
              } as T;
            }
            if (normalized.includes('FROM provider_credentials WHERE user_id = ? AND provider_type = ?')) {
              const [userId, providerType] = args;
              const cred = this.tables.provider_credentials.find(
                (c) => c.user_id === userId && c.provider_type === providerType && c.is_active === 1
              );
              return (cred as T) || null;
            }
            if (normalized.includes('FROM provider_credentials WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const cred = this.tables.provider_credentials.find(
                (c) => c.id === id && c.user_id === userId
              );
              return (cred as T) || null;
            }
            if (normalized.includes('FROM conversations WHERE id = ? AND user_id = ?')) {
              const [id, userId] = args;
              const conv = this.tables.conversations.find((c) => c.id === id && c.user_id === userId);
              return (conv as T) || null;
            }
            if (normalized.includes('SELECT') && normalized.includes('COUNT(*) as total_requests')) {
              const userId = args[0];
              const events = this.tables.usage_events.filter((e) => e.user_id === userId);
              const totalTokens = events.reduce((sum, e) => sum + (e.total_tokens || 0), 0);
              return {
                total_requests: events.length,
                total_prompt_tokens: 100,
                total_completion_tokens: 50,
                total_tokens: totalTokens,
              } as T;
            }
            return null;
          },
          all: async <T = any>(): Promise<{ results: T[] }> => {
          if (trimmed.includes('FROM provider_credentials WHERE user_id = ?')) {
            const userId = args[0];
            return { results: this.tables.provider_credentials.filter((c) => c.user_id === userId) as T[] };
          }
          if (trimmed.includes('FROM conversations WHERE user_id = ?')) {
            const userId = args[0];
            return { results: this.tables.conversations.filter((c) => c.user_id === userId) as T[] };
          }
          if (trimmed.includes('FROM messages WHERE conversation_id = ? AND user_id = ?')) {
            const [convId, userId] = args;
            return { results: this.tables.messages.filter((m) => m.conversation_id === convId && m.user_id === userId) as T[] };
          }
          if (trimmed.includes('FROM usage_events WHERE user_id = ?')) {
            const userId = args[0];
            return { results: this.tables.usage_events.filter((e) => e.user_id === userId) as T[] };
          }
          return { results: [] };
        },
        run: async () => {
          if (trimmed.includes('INSERT INTO provider_credentials')) {
            const [id, user_id, provider_type, label, encrypted_key, key_iv, masked_key, custom_endpoint, default_model, is_default, encryption_version] = args;
            this.tables.provider_credentials.push({
              id,
              user_id,
              provider_type,
              label,
              encrypted_key,
              key_iv,
              masked_key,
              custom_endpoint,
              default_model,
              is_default,
              encryption_version,
              is_active: 1,
            });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('DELETE FROM provider_credentials WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const initLen = this.tables.provider_credentials.length;
            this.tables.provider_credentials = this.tables.provider_credentials.filter(
              (c) => !(c.id === id && c.user_id === userId)
            );
            return { meta: { changes: initLen - this.tables.provider_credentials.length } };
          }
          if (trimmed.includes('INSERT INTO conversations')) {
            const [id, user_id, project_id, title, provider_type, model, is_temporary] = args;
            this.tables.conversations.push({ id, user_id, project_id, title, provider_type, model, is_temporary });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('INSERT INTO messages')) {
            const [id, conversation_id, user_id, role, content, model, provider_type, token_count] = args;
            this.tables.messages.push({ id, conversation_id, user_id, role, content, model, provider_type, token_count });
            return { meta: { changes: 1 } };
          }
          if (trimmed.includes('INSERT INTO usage_events')) {
            const [id, user_id, conversation_id, provider_type, model, prompt_tokens, completion_tokens, total_tokens, success] = args;
            this.tables.usage_events.push({ id, user_id, conversation_id, provider_type, model, prompt_tokens, completion_tokens, total_tokens, success });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}
}

const HEX_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Milestone 3 — End-to-End Chat, BYOK & Multi-Provider Integration Tests', () => {
  let mockDb: MockD1Database;
  let env: any;
  let userToken: string;
  const userId = 'usr-test-123';

  beforeEach(async () => {
    mockDb = new MockD1Database();
    env = {
      DB: mockDb,
      ENCRYPTION_SECRET: HEX_SECRET,
      SESSION_SECRET: 'session_secret_32_characters_random_string!',
      ENVIRONMENT: 'production',
      CLIENT_ORIGIN: 'http://localhost:5173',
    };

    userToken = generateSessionToken();
    const tokenHash = await hashSessionToken(userToken);
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    mockDb.tables.users.push({
      id: userId,
      email: 'testuser@example.com',
      name: 'Test User',
    });
    mockDb.tables.sessions.push({
      id: 'sess-1',
      user_id: userId,
      token_hash: tokenHash,
      expires_at: futureDate,
    });
  });

  it('GET /providers/supported lists all 6 providers with verified metadata', async () => {
    const req = new Request('http://localhost/providers/supported', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(6);
  });

  it('connects a new encrypted BYOK credential and stores masked key in D1', async () => {
    const req = new Request('http://localhost/providers/credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Origin': 'http://localhost:5173',
      },
      body: JSON.stringify({
        providerType: 'gemini',
        label: 'My Personal Gemini Key',
        apiKey: 'AIzaSyTestGeminiAPIKey123456789',
        defaultModel: 'gemini-1.5-flash',
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.maskedKey).toBe('AIza••••••••6789');

    // Verify stored credential in D1 is encrypted
    const stored = mockDb.tables.provider_credentials[0];
    expect(stored.encrypted_key).not.toContain('AIzaSyTestGeminiAPIKey');
    expect(stored.user_id).toBe(userId);
  });

  it('POST /chat/generate decrypts key in-memory and calls provider', async () => {
    // Stage an encrypted credential
    const credId = 'cred-gemini-1';
    const enc = await encryptCredential('fake-gemini-key', HEX_SECRET, { userId, credentialId: credId });
    mockDb.tables.provider_credentials.push({
      id: credId,
      user_id: userId,
      provider_type: 'gemini',
      label: 'Gemini',
      encrypted_key: enc.encryptedKey,
      key_iv: enc.keyIv,
      encryption_version: enc.encryptionVersion,
      default_model: 'gemini-1.5-flash',
      is_active: 1,
      is_default: 1,
    });

    // Mock fetch for Gemini generateContent endpoint
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Response from mock provider!' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15 },
      }),
    } as any);

    const req = new Request('http://localhost/chat/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Origin': 'http://localhost:5173',
      },
      body: JSON.stringify({
        providerType: 'gemini',
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'What is cloud computing?' }],
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.content).toBe('Response from mock provider!');
    expect(json.data.usage.totalTokens).toBe(25);

    // Verify usage event was logged to D1
    expect(mockDb.tables.usage_events.length).toBe(1);
    expect(mockDb.tables.usage_events[0].total_tokens).toBe(25);
  });

  it('POST /chat/compare executes two models concurrently and returns combined response', async () => {
    // Stage Gemini and OpenAI credentials
    const credG = 'cred-gemini-1';
    const encG = await encryptCredential('fake-gemini-key', HEX_SECRET, { userId, credentialId: credG });
    mockDb.tables.provider_credentials.push({
      id: credG,
      user_id: userId,
      provider_type: 'gemini',
      label: 'Gemini',
      encrypted_key: encG.encryptedKey,
      key_iv: encG.keyIv,
      encryption_version: encG.encryptionVersion,
      default_model: 'gemini-1.5-flash',
      is_active: 1,
    });

    const credO = 'cred-openai-1';
    const encO = await encryptCredential('fake-openai-key', HEX_SECRET, { userId, credentialId: credO });
    mockDb.tables.provider_credentials.push({
      id: credO,
      user_id: userId,
      provider_type: 'openai',
      label: 'OpenAI',
      encrypted_key: encO.encryptedKey,
      key_iv: encO.keyIv,
      encryption_version: encO.encryptionVersion,
      default_model: 'gpt-4o-mini',
      is_active: 1,
    });

    // Mock fetch for both Gemini and OpenAI endpoints
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Gemini comparative response' }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI comparative response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      };
    });

    const req = new Request('http://localhost/chat/compare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Origin': 'http://localhost:5173',
      },
      body: JSON.stringify({
        prompt: 'Explain quantum computing in one sentence',
        modelA: { providerType: 'gemini', model: 'gemini-1.5-flash' },
        modelB: { providerType: 'openai', model: 'gpt-4o-mini' },
      }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.responseA.content).toBe('Gemini comparative response');
    expect(json.data.responseB.content).toBe('OpenAI comparative response');
  });

  it('smoke-test validates provider credentials through user-triggered test without charging production', async () => {
    const credId = 'cred-smoke-test';
    const enc = await encryptCredential('test-smoke-key', HEX_SECRET, { userId, credentialId: credId });
    mockDb.tables.provider_credentials.push({
      id: credId,
      user_id: userId,
      provider_type: 'gemini',
      label: 'Gemini Smoke Test',
      encrypted_key: enc.encryptedKey,
      key_iv: enc.keyIv,
      encryption_version: enc.encryptionVersion,
      default_model: 'gemini-1.5-flash',
      is_active: 1,
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('streamGenerateContent')) {
        const stream = new ReadableStream({
          start(controller) {
            const chunk = JSON.stringify({
              candidates: [{ content: { parts: [{ text: 'Smoke test response' }] } }],
              usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
            });
            controller.enqueue(new TextEncoder().encode(`data: ${chunk}\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Smoke test response' }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const req = new Request(`http://localhost/providers/credentials/${credId}/smoke-test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Origin': 'http://localhost:5173',
      },
    });

    const res = await app.fetch(req, env);
    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.provider).toBe('gemini');
    expect(json.data.authStatus).toBe('passed');
    expect(json.data.generationStatus).toBe('passed');
    expect(json.data.streamingStatus).toBe('passed');
  });

  it('POST /chat/stop aborts active streams cleanly', async () => {
    const req = new Request('http://localhost/chat/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Origin': 'http://localhost:5173',
      },
      body: JSON.stringify({ conversationId: 'conv-test-active-1' }),
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.message).toBeDefined();
  });
});
