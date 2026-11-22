# EvolveAI Architecture Overview

EvolveAI is a model-agnostic, personal, self-evolving AI platform designed around zero-cost cloud services (Cloudflare Pages, Cloudflare Workers, Cloudflare D1) and user-supplied API keys (BYOK).

## Monorepo Layout
- **`apps/web`**: Single-page application built with React, Vite, TypeScript, and Tailwind CSS.
- **`workers/api`**: Cloudflare Workers API built with Hono, interfacing with Cloudflare D1 database and external AI providers.
- **`packages/shared-types`**: Common TypeScript contracts across web, workers, and packages.
- **`packages/provider-sdk`**: Unified adapter interfaces for Gemini, OpenAI, Claude, Grok, Mistral, OpenRouter, and custom endpoints.
- **`packages/memory-engine`**: Personal memory scoring, retrieval, and candidate categorization logic.

## Security Guarantees
- Zero plaintext API key storage.
- Native AES-GCM (256-bit) credential encryption via Web Crypto.
- Strict tenant isolation enforced on every D1 query using verified session tokens.
- SSRF prevention on custom provider endpoints.
