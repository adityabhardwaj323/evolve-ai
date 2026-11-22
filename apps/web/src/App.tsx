import React, { useState, useEffect, useRef } from 'react';
import {
  Brain,
  MessageSquare,
  Sparkles,
  FolderKanban,
  Share2,
  ThumbsUp,
  FlaskConical,
  KeyRound,
  Settings,
  ChevronRight,
  ShieldCheck,
  Zap,
  Layers,
  Database,
  Send,
  Square,
  Trash2,
  Plus,
  RefreshCw,
  Columns2,
  Activity,
  LogOut,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  ProviderMetadata,
  ProviderCredentialPublic,
  ModelDescriptor,
  Conversation,
  Message,
  ProviderType,
} from '@evolve-ai/shared-types';
import {
  AuthApi,
  ProvidersApi,
  ConversationsApi,
  ChatApi,
  UsageApi,
} from './services/api';

export type ActiveTab =
  | 'dashboard'
  | 'workspace'
  | 'compare'
  | 'memory'
  | 'projects'
  | 'graph'
  | 'feedback'
  | 'evolution'
  | 'providers'
  | 'usage'
  | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Authentication State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Connected providers state
  const [credentials, setCredentials] = useState<ProviderCredentialPublic[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<ProviderMetadata[]>([]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    setAuthLoading(true);
    const res = await AuthApi.getMe();
    if (res.success && res.data?.user) {
      setCurrentUser(res.data.user);
      loadGlobalData();
    } else {
      setCurrentUser(null);
    }
    setAuthLoading(false);
  };

  const loadGlobalData = async () => {
    const [creds, supported] = await Promise.all([
      ProvidersApi.getCredentials(),
      ProvidersApi.getSupported(),
    ]);
    setCredentials(creds);
    setSupportedProviders(supported);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);

    try {
      let res;
      if (authMode === 'register') {
        res = await AuthApi.register({ email: authEmail, password: authPassword, name: authName });
      } else {
        res = await AuthApi.login({ email: authEmail, password: authPassword });
      }

      if (res.success && res.data?.user) {
        setCurrentUser(res.data.user);
        await loadGlobalData();
        setActiveTab('workspace');
      } else {
        setAuthError(res.error?.message || 'Authentication failed');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication error');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await AuthApi.logout();
    setCurrentUser(null);
    setCredentials([]);
  };

  const navigationItems = [
    { id: 'dashboard', label: 'Overview', icon: Sparkles },
    { id: 'workspace', label: 'AI Workspace', icon: MessageSquare },
    { id: 'compare', label: 'Model Comparison', icon: Columns2 },
    { id: 'providers', label: 'AI Providers (BYOK)', icon: KeyRound },
    { id: 'usage', label: 'Usage & Costs', icon: Activity },
    { id: 'memory', label: 'Memory Center', icon: Brain },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'graph', label: 'Knowledge Graph', icon: Share2 },
    { id: 'feedback', label: 'Feedback Loop', icon: ThumbsUp },
    { id: 'evolution', label: 'Evolution Lab', icon: FlaskConical },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  if (authLoading) {
    return (
      <div className="h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-lavender-400">
          <RefreshCw className="h-6 w-6 animate-spin" />
          <span className="text-sm font-medium">Initializing EvolveAI...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated view
  if (!currentUser) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 font-sans selection:bg-lavender-500 selection:text-white">
        <div className="w-full max-w-md p-8 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-lavender-600 to-indigo-500 mx-auto flex items-center justify-center shadow-lg shadow-lavender-500/20">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-lavender-200 bg-clip-text text-transparent">
              EvolveAI
            </h1>
            <p className="text-xs text-slate-400">
              Personal, Model-Agnostic, Self-Evolving Intelligence
            </p>
          </div>

          <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => { setAuthMode('login'); setAuthError(null); }}
              className={`flex-1 py-1.5 rounded-md transition-all ${authMode === 'login' ? 'bg-lavender-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setAuthMode('register'); setAuthError(null); }}
              className={`flex-1 py-1.5 rounded-md transition-all ${authMode === 'register' ? 'bg-lavender-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              Register
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Your Name</label>
                <input
                  type="text"
                  required
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="e.g. Alex Turing"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-lavender-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-lavender-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password (min. 12 characters)</label>
              <input
                type="password"
                required
                minLength={12}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-lavender-500"
              />
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-2.5 rounded-lg bg-lavender-600 hover:bg-lavender-500 text-white text-sm font-semibold transition-all shadow-md shadow-lavender-600/30 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {authSubmitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <span>{authMode === 'login' ? 'Sign In to Workspace' : 'Create Free Account'}</span>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-slate-800/80 text-center">
            <span className="text-[11px] text-slate-500">
              Zero-Spending Tier • AES-256-GCM Encrypted BYOK
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans selection:bg-lavender-500 selection:text-white">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/70 backdrop-blur-md flex flex-col shrink-0">
        <div className="h-16 border-b border-slate-800 flex items-center px-5 gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-lavender-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-lavender-500/20">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight bg-gradient-to-r from-white via-slate-200 to-lavender-200 bg-clip-text text-transparent">
              EvolveAI
            </h1>
            <p className="text-[10px] text-lavender-400 font-medium tracking-wide uppercase">
              Model Agnostic OS
            </p>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-lavender-600/15 text-lavender-300 border border-lavender-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-lavender-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto text-lavender-400" />}
              </button>
            );
          })}
        </nav>

        {/* User profile & BYOK status */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 space-y-2">
          <div className="flex items-center justify-between px-2 text-xs">
            <span className="font-medium text-slate-300 truncate max-w-[130px]">{currentUser.name}</span>
            <button
              onClick={handleLogout}
              title="Logout"
              className="text-slate-500 hover:text-rose-400 transition-colors p-1"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-semibold text-slate-200">{credentials.length} Providers</span>
              <p className="text-slate-500 text-[10px]">AES-256-GCM Secure</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-16 border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-md px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 capitalize">{activeTab}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              API Worker Online
            </span>
          </div>
        </header>

        {/* View Router */}
        <div className="flex-1 p-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              credentials={credentials}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'workspace' && (
            <WorkspaceView
              credentials={credentials}
              supportedProviders={supportedProviders}
              onNavigateToProviders={() => setActiveTab('providers')}
            />
          )}
          {activeTab === 'compare' && (
            <CompareView
              credentials={credentials}
              onNavigateToProviders={() => setActiveTab('providers')}
            />
          )}
          {activeTab === 'providers' && (
            <ProvidersView
              credentials={credentials}
              supportedProviders={supportedProviders}
              onRefresh={loadGlobalData}
            />
          )}
          {activeTab === 'usage' && <UsageView />}
          {activeTab === 'memory' && <MemoryCenterView />}
          {activeTab !== 'dashboard' &&
            activeTab !== 'workspace' &&
            activeTab !== 'compare' &&
            activeTab !== 'providers' &&
            activeTab !== 'usage' &&
            activeTab !== 'memory' && (
              <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
                <div className="h-12 w-12 rounded-2xl bg-lavender-500/10 border border-lavender-500/20 text-lavender-400 mx-auto flex items-center justify-center">
                  <Layers className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-semibold capitalize text-slate-100">{activeTab} View</h2>
                <p className="text-slate-400 text-sm max-w-md mx-auto">
                  Module framework initialized. Complete Milestone 3 unified BYOK, streaming workspace, and model comparison active.
                </p>
              </div>
            )}
        </div>
      </main>
    </div>
  );
}

// -------------------------------------------------------------
// 1. DASHBOARD VIEW
// -------------------------------------------------------------
function DashboardView({
  credentials,
  onNavigate,
}: {
  credentials: ProviderCredentialPublic[];
  onNavigate: (tab: ActiveTab) => void;
}) {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-lavender-500/20 bg-gradient-to-b from-slate-900 to-slate-950 p-8">
        <div className="relative z-10 space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-lavender-500/10 text-lavender-300 border border-lavender-500/30">
            <Sparkles className="h-3.5 w-3.5" />
            V1.0 Milestone 3 Complete
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">
            Bring your own model. Build your own intelligence.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            EvolveAI preserves your private memory, project decisions, and knowledge relations across Google Gemini, OpenAI, Claude, Grok, Mistral, and OpenRouter without vendor lock-in.
          </p>
          <div className="pt-2 flex items-center gap-3">
            <button
              onClick={() => onNavigate('workspace')}
              className="px-4 py-2 rounded-lg bg-lavender-600 hover:bg-lavender-500 text-white text-sm font-semibold transition-all shadow-md shadow-lavender-600/30 flex items-center gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Open AI Workspace
            </button>
            <button
              onClick={() => onNavigate('compare')}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all border border-slate-700 flex items-center gap-2"
            >
              <Columns2 className="h-4 w-4" />
              Model Comparison
            </button>
            <button
              onClick={() => onNavigate('providers')}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all border border-slate-700 flex items-center gap-2"
            >
              <KeyRound className="h-4 w-4" />
              Manage BYOK ({credentials.length})
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Active Providers</span>
            <Zap className="h-4 w-4 text-lavender-400" />
          </div>
          <div className="text-2xl font-bold text-white">{credentials.length} Connected</div>
          <p className="text-[12px] text-slate-500">Encrypted with AES-256-GCM</p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Saved Memories</span>
            <Brain className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">0 Approved</div>
          <p className="text-[12px] text-slate-500">12 Structured Categories</p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Projects</span>
            <FolderKanban className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">0 Workspaces</div>
          <p className="text-[12px] text-slate-500">Strict Context Isolation</p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Database Storage</span>
            <Database className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">D1 Free</div>
          <p className="text-[12px] text-slate-500">5GB SQLite Tenant Bound</p>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. AI WORKSPACE VIEW (Streaming, Persistence, History)
// -------------------------------------------------------------
function WorkspaceView({
  credentials,
  supportedProviders,
  onNavigateToProviders,
}: {
  credentials: ProviderCredentialPublic[];
  supportedProviders: ProviderMetadata[];
  onNavigateToProviders: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Model Selection
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>('gemini');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-1.5-flash');
  const [availableModels, setAvailableModels] = useState<ModelDescriptor[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    }
  }, [activeConvId]);

  useEffect(() => {
    loadModelsForProvider(selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async () => {
    const list = await ConversationsApi.list();
    setConversations(list);
    if (list.length > 0 && !activeConvId) {
      setActiveConvId(list[0].id);
    }
  };

  const loadMessages = async (id: string) => {
    const data = await ConversationsApi.get(id);
    if (data) {
      setMessages(data.messages);
      setSelectedProvider(data.conversation.providerType);
      setSelectedModel(data.conversation.model);
    }
  };

  const loadModelsForProvider = async (pType: ProviderType) => {
    const models = await ProvidersApi.getSupportedModels(pType);
    setAvailableModels(models);
    if (models.length > 0) {
      const defaultM = models.find((m) => m.isDefault)?.id || models[0].id;
      setSelectedModel(defaultM);
    }
  };

  const handleNewConversation = async () => {
    const newConv = await ConversationsApi.create({
      title: 'New Conversation',
      providerType: selectedProvider,
      model: selectedModel,
    });
    if (newConv) {
      setConversations([newConv, ...conversations]);
      setActiveConvId(newConv.id);
      setMessages([]);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    await ConversationsApi.delete(id);
    const updated = conversations.filter((c) => c.id !== id);
    setConversations(updated);
    if (activeConvId === id) {
      setActiveConvId(updated[0]?.id || null);
      setMessages([]);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPrompt.trim() || isStreaming) return;

    // Check if provider is connected
    const hasCred = credentials.some((c) => c.providerType === selectedProvider);
    if (!hasCred) {
      alert(`Please connect an API key for ${selectedProvider} in the AI Providers tab before chatting.`);
      return;
    }

    let convId = activeConvId;
    if (!convId) {
      const newConv = await ConversationsApi.create({
        title: inputPrompt.slice(0, 30) || 'New Conversation',
        providerType: selectedProvider,
        model: selectedModel,
      });
      if (newConv) {
        setConversations([newConv, ...conversations]);
        setActiveConvId(newConv.id);
        convId = newConv.id;
      }
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversationId: convId || '',
      userId: '',
      role: 'user',
      content: inputPrompt,
      createdAt: new Date().toISOString(),
    };

    const assistantMsgPlaceholder: Message = {
      id: crypto.randomUUID(),
      conversationId: convId || '',
      userId: '',
      role: 'assistant',
      content: '',
      model: selectedModel,
      providerType: selectedProvider,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsgPlaceholder]);
    setInputPrompt('');
    setIsStreaming(true);

    const controller = new AbortController();
    setAbortController(controller);

    const chatHistory = [...messages, userMsg].map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    await ChatApi.stream(
      {
        conversationId: convId || undefined,
        providerType: selectedProvider,
        model: selectedModel,
        messages: chatHistory,
      },
      (delta) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: updated[lastIdx].content + delta,
            };
          }
          return updated;
        });
      },
      () => {
        setIsStreaming(false);
        setAbortController(null);
      },
      (errorMsg) => {
        setIsStreaming(false);
        setAbortController(null);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: updated[lastIdx].content + `\n\n[Generation Error: ${errorMsg}]`,
            };
          }
          return updated;
        });
      },
      controller.signal
    );
  };

  const handleStopStream = () => {
    if (abortController) {
      abortController.abort();
      setIsStreaming(false);
      setAbortController(null);
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] flex border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
      {/* Conversation Sidebar */}
      <div className="w-64 border-r border-slate-800 bg-slate-950/60 flex flex-col shrink-0">
        <div className="p-3 border-b border-slate-800">
          <button
            onClick={handleNewConversation}
            className="w-full py-2 px-3 rounded-lg bg-lavender-600 hover:bg-lavender-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New Conversation
          </button>
        </div>

        <div className="flex-1 p-2 space-y-1 overflow-y-auto">
          {conversations.map((conv) => {
            const isActive = activeConvId === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`group flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-all ${
                  isActive
                    ? 'bg-slate-800 text-white font-medium border border-slate-700'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-lavender-400" />
                  <span className="truncate">{conv.title}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConversation(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {conversations.length === 0 && (
            <p className="text-[11px] text-slate-500 text-center py-6">No conversations yet.</p>
          )}
        </div>
      </div>

      {/* Main Chat Interface */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-900/30">
        {/* Model Bar */}
        <div className="h-14 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 bg-slate-950/40">
          <div className="flex items-center gap-3">
            {/* Provider Select */}
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as ProviderType)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-lavender-500"
            >
              {supportedProviders.map((p) => {
                const isConnected = credentials.some((c) => c.providerType === p.id);
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} {isConnected ? '✓' : '(Not Connected)'}
                  </option>
                );
              })}
            </select>

            {/* Model Select */}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-lavender-500"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {!credentials.some((c) => c.providerType === selectedProvider) && (
            <button
              onClick={onNavigateToProviders}
              className="text-xs text-lavender-400 hover:text-lavender-300 flex items-center gap-1.5 font-medium"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Connect {selectedProvider} Key
            </button>
          )}
        </div>

        {/* Message Stream Display */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-3xl ${
                msg.role === 'user' ? 'ml-auto justify-end' : 'mr-auto justify-start'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="h-8 w-8 rounded-lg bg-lavender-600/20 border border-lavender-500/30 flex items-center justify-center shrink-0 text-lavender-300">
                  <Brain className="h-4 w-4" />
                </div>
              )}

              <div
                className={`p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-lavender-600 text-white rounded-br-none shadow-sm'
                    : 'bg-slate-950/80 border border-slate-800 text-slate-200 rounded-bl-none shadow-sm'
                }`}
              >
                {msg.content || (isStreaming ? <span className="animate-pulse">Thinking...</span> : '')}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <textarea
              rows={2}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={`Message ${selectedModel}... (Press Enter to send, Shift+Enter for new line)`}
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-lavender-500 resize-none"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopStream}
                className="px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <Square className="h-4 w-4 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputPrompt.trim()}
                className="px-5 rounded-xl bg-lavender-600 hover:bg-lavender-500 text-white font-semibold flex items-center justify-center disabled:opacity-40 transition-all shadow-md shadow-lavender-600/30"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. TWO-MODEL COMPARISON VIEW
// -------------------------------------------------------------
function CompareView({
  credentials,
  onNavigateToProviders,
}: {
  credentials: ProviderCredentialPublic[];
  onNavigateToProviders: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [isComparing, setIsComparing] = useState(false);

  const [providerA, setProviderA] = useState<ProviderType>('gemini');
  const [modelA, setModelA] = useState('gemini-1.5-flash');

  const [providerB, setProviderB] = useState<ProviderType>('openai');
  const [modelB, setModelB] = useState('gpt-4o-mini');

  const [resultA, setResultA] = useState<any>(null);
  const [resultB, setResultB] = useState<any>(null);

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isComparing) return;

    setIsComparing(true);
    setResultA(null);
    setResultB(null);

    const res = await ChatApi.compare({
      prompt,
      modelA: { providerType: providerA, model: modelA },
      modelB: { providerType: providerB, model: modelB },
    });

    if (res) {
      setResultA(res.responseA);
      setResultB(res.responseB);
    }
    setIsComparing(false);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Dual-Model Comparison</h3>
        <p className="text-xs text-slate-400">
          Send the identical prompt simultaneously to two independent AI providers. Compare nuances, latency, and tokens.
        </p>
      </div>

      {credentials.length < 2 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-between">
          <span>You need at least 2 connected AI providers to execute multi-model comparisons.</span>
          <button
            onClick={onNavigateToProviders}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold"
          >
            Connect Providers
          </button>
        </div>
      )}

      {/* Prompt Form */}
      <form onSubmit={handleCompare} className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Model A</label>
            <div className="flex gap-2">
              <select
                value={providerA}
                onChange={(e) => setProviderA(e.target.value as ProviderType)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
              >
                {credentials.map((c) => (
                  <option key={c.id} value={c.providerType}>
                    {c.label} ({c.providerType})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={modelA}
                onChange={(e) => setModelA(e.target.value)}
                placeholder="Model ID"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Model B</label>
            <div className="flex gap-2">
              <select
                value={providerB}
                onChange={(e) => setProviderB(e.target.value as ProviderType)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
              >
                {credentials.map((c) => (
                  <option key={c.id} value={c.providerType}>
                    {c.label} ({c.providerType})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={modelB}
                onChange={(e) => setModelB(e.target.value)}
                placeholder="Model ID"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
              />
            </div>
          </div>
        </div>

        <div>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to test both models simultaneously..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-lavender-500"
          />
        </div>

        <button
          type="submit"
          disabled={isComparing || !prompt.trim()}
          className="px-6 py-2.5 rounded-xl bg-lavender-600 hover:bg-lavender-500 text-white font-semibold text-sm transition-all shadow-md shadow-lavender-600/30 flex items-center gap-2 disabled:opacity-40"
        >
          {isComparing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Querying Models in Parallel...</span>
            </>
          ) : (
            <span>Run Comparison</span>
          )}
        </button>
      </form>

      {/* Side-by-Side Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Model A Result */}
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3 min-h-[300px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-xs font-bold text-lavender-400 uppercase tracking-wider">Model A</span>
              <h4 className="text-sm font-semibold text-slate-200">{modelA}</h4>
            </div>
            {resultA?.latencyMs && (
              <span className="text-[11px] text-slate-500 font-mono">{resultA.latencyMs} ms</span>
            )}
          </div>
          {resultA ? (
            <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {resultA.error ? <span className="text-rose-400">Error: {resultA.error}</span> : resultA.content}
            </div>
          ) : (
            <p className="text-xs text-slate-600 italic">Response will appear here...</p>
          )}
        </div>

        {/* Model B Result */}
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3 min-h-[300px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Model B</span>
              <h4 className="text-sm font-semibold text-slate-200">{modelB}</h4>
            </div>
            {resultB?.latencyMs && (
              <span className="text-[11px] text-slate-500 font-mono">{resultB.latencyMs} ms</span>
            )}
          </div>
          {resultB ? (
            <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {resultB.error ? <span className="text-rose-400">Error: {resultB.error}</span> : resultB.content}
            </div>
          ) : (
            <p className="text-xs text-slate-600 italic">Response will appear here...</p>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 4. PROVIDER BYOK MANAGEMENT VIEW
// -------------------------------------------------------------
function ProvidersView({
  credentials,
  supportedProviders,
  onRefresh,
}: {
  credentials: ProviderCredentialPublic[];
  supportedProviders: ProviderMetadata[];
  onRefresh: () => void;
}) {
  const [modalProvider, setModalProvider] = useState<ProviderMetadata | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [defaultModelInput, setDefaultModelInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});

  const handleOpenConnect = (provider: ProviderMetadata) => {
    setModalProvider(provider);
    setApiKeyInput('');
    setDefaultModelInput(provider.defaultModel);
    setLabelInput(`${provider.name} Key`);
  };

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalProvider || !apiKeyInput.trim()) return;

    setIsSubmitting(true);
    const res = await ProvidersApi.connectCredential({
      providerType: modalProvider.id,
      label: labelInput,
      apiKey: apiKeyInput,
      defaultModel: defaultModelInput,
      isDefault: credentials.length === 0,
    });

    if (res.success) {
      setModalProvider(null);
      onRefresh();
    } else {
      alert(res.error?.message || 'Failed to save credential');
    }
    setIsSubmitting(false);
  };

  const handleTestKey = async (credId: string) => {
    setTestStatus((prev) => ({ ...prev, [credId]: 'testing' }));
    const res = await ProvidersApi.testCredential(credId);
    if (res.success) {
      setTestStatus((prev) => ({ ...prev, [credId]: 'valid' }));
    } else {
      setTestStatus((prev) => ({ ...prev, [credId]: `error: ${res.error?.message}` }));
    }
  };

  const handleDelete = async (credId: string) => {
    if (!confirm('Are you sure you want to disconnect this API key?')) return;
    await ProvidersApi.deleteCredential(credId);
    onRefresh();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h3 className="text-xl font-bold text-slate-100">AI Provider Connections (BYOK)</h3>
        <p className="text-xs text-slate-400">
          Connect your personal API keys. Plaintext keys are encrypted via Web Crypto AES-256-GCM and never logged or exposed.
        </p>
      </div>

      {/* Connected Credentials */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Your Connected Credentials</h4>
        {credentials.length === 0 ? (
          <div className="p-8 rounded-xl border border-slate-800 bg-slate-900/40 text-center text-slate-500 text-xs">
            No API keys connected yet. Select a provider below to connect your key.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {credentials.map((cred) => (
              <div
                key={cred.id}
                className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-semibold text-sm text-slate-200">{cred.label}</h5>
                    <span className="text-[10px] text-lavender-400 uppercase font-mono">{cred.providerType}</span>
                  </div>
                  <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    {cred.maskedKey}
                  </span>
                </div>

                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>Default Model: {cred.defaultModel}</span>
                  {testStatus[cred.id] && (
                    <span
                      className={`text-[11px] ${
                        testStatus[cred.id] === 'valid'
                          ? 'text-emerald-400'
                          : testStatus[cred.id] === 'testing'
                          ? 'text-lavender-400 animate-pulse'
                          : 'text-rose-400'
                      }`}
                    >
                      {testStatus[cred.id] === 'valid'
                        ? '✓ Verified'
                        : testStatus[cred.id] === 'testing'
                        ? 'Testing...'
                        : testStatus[cred.id]}
                    </span>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-800">
                  <button
                    onClick={() => handleTestKey(cred.id)}
                    className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-all"
                  >
                    Test Connection
                  </button>
                  <button
                    onClick={() => handleDelete(cred.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 text-xs border border-slate-800 transition-all"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supported Providers List */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Available Supported Providers</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {supportedProviders.map((provider) => {
            const isConnected = credentials.some((c) => c.providerType === provider.id);
            return (
              <div
                key={provider.id}
                className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h5 className="font-semibold text-sm text-slate-100">{provider.name}</h5>
                    <a
                      href={provider.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-lavender-400"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">{provider.description}</p>
                </div>

                <button
                  onClick={() => handleOpenConnect(provider)}
                  className={`w-full py-2 rounded-lg text-xs font-semibold transition-all ${
                    isConnected
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      : 'bg-lavender-600 hover:bg-lavender-500 text-white shadow-md shadow-lavender-600/20'
                  }`}
                >
                  {isConnected ? 'Add Another Key' : 'Connect API Key'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Connect Modal */}
      {modalProvider && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <h4 className="text-lg font-bold text-white">Connect {modalProvider.name}</h4>
            <p className="text-xs text-slate-400">
              Provide your API key. EvolveAI stores it encrypted on the server with AES-256-GCM.
            </p>

            <form onSubmit={handleSaveCredential} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Connection Label</label>
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">API Key</label>
                <input
                  type="password"
                  required
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your key here..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Default Model</label>
                <input
                  type="text"
                  required
                  value={defaultModelInput}
                  onChange={(e) => setDefaultModelInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalProvider(null)}
                  className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 rounded-lg bg-lavender-600 hover:bg-lavender-500 text-xs font-semibold text-white flex items-center justify-center gap-2"
                >
                  {isSubmitting ? 'Encrypting & Saving...' : 'Save Encrypted Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 5. USAGE & OBSERVABILITY VIEW
// -------------------------------------------------------------
function UsageView() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadUsage();
  }, []);

  const loadUsage = async () => {
    const res = await UsageApi.getStats();
    if (res.success) {
      setStats(res.data);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Usage & Token Tracking</h3>
        <p className="text-xs text-slate-400">
          Transparent metrics on prompt and completion tokens across your connected AI models.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-xs text-slate-400 uppercase font-medium">Total Requests</span>
          <div className="text-2xl font-bold text-white mt-1">{stats?.summary?.totalRequests || 0}</div>
        </div>
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-xs text-slate-400 uppercase font-medium">Prompt Tokens</span>
          <div className="text-2xl font-bold text-white mt-1">
            {stats?.summary?.totalPromptTokens?.toLocaleString() || 0}
          </div>
        </div>
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-xs text-slate-400 uppercase font-medium">Completion Tokens</span>
          <div className="text-2xl font-bold text-white mt-1">
            {stats?.summary?.totalCompletionTokens?.toLocaleString() || 0}
          </div>
        </div>
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-xs text-slate-400 uppercase font-medium">Total Tokens</span>
          <div className="text-2xl font-bold text-lavender-400 mt-1">
            {stats?.summary?.totalTokens?.toLocaleString() || 0}
          </div>
        </div>
      </div>

      {/* Recent Events Table */}
      <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-4">
        <h4 className="text-sm font-semibold text-slate-200">Recent Generation Events</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="text-slate-500 uppercase border-b border-slate-800 text-[10px]">
              <tr>
                <th className="py-2.5">Provider</th>
                <th className="py-2.5">Model</th>
                <th className="py-2.5">Prompt Tokens</th>
                <th className="py-2.5">Completion Tokens</th>
                <th className="py-2.5">Total Tokens</th>
                <th className="py-2.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {stats?.recentEvents?.map((evt: any) => (
                <tr key={evt.id} className="hover:bg-slate-800/20">
                  <td className="py-2 text-lavender-400">{evt.provider_type}</td>
                  <td className="py-2 text-slate-200">{evt.model}</td>
                  <td className="py-2">{evt.prompt_tokens}</td>
                  <td className="py-2">{evt.completion_tokens}</td>
                  <td className="py-2 font-semibold text-white">{evt.total_tokens}</td>
                  <td className="py-2 text-slate-500 text-[11px]">{new Date(evt.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {(!stats?.recentEvents || stats.recentEvents.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500 font-sans">
                    No generation activity recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Placeholder Memory View
function MemoryCenterView() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Personal Memory Center</h3>
        <p className="text-xs text-slate-400">Review candidate, approved, and archived facts extracted with user consent.</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
        <Brain className="h-10 w-10 text-slate-600 mx-auto" />
        <h4 className="text-sm font-semibold text-slate-300">No Memories Recorded Yet</h4>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          EvolveAI only extracts memories when permitted, verifies them for contradictions, and requires user approval.
        </p>
      </div>
    </div>
  );
}
