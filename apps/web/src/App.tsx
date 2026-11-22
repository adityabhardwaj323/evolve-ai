import { useState } from 'react';
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
  Database
} from 'lucide-react';

export type ActiveTab =
  | 'dashboard'
  | 'workspace'
  | 'memory'
  | 'projects'
  | 'graph'
  | 'feedback'
  | 'evolution'
  | 'providers'
  | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');

  const navigationItems = [
    { id: 'dashboard', label: 'Overview', icon: Sparkles },
    { id: 'workspace', label: 'AI Workspace', icon: MessageSquare },
    { id: 'memory', label: 'Memory Center', icon: Brain },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'graph', label: 'Knowledge Graph', icon: Share2 },
    { id: 'feedback', label: 'Feedback Loop', icon: ThumbsUp },
    { id: 'evolution', label: 'Evolution Lab', icon: FlaskConical },
    { id: 'providers', label: 'AI Providers (BYOK)', icon: KeyRound },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
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

        {/* User & BYOK Security Badge */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-semibold text-slate-200">Zero-Spending Tier</span>
              <p className="text-slate-500 text-[10px]">Cloudflare D1 & BYOK</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Navbar */}
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
          {activeTab === 'dashboard' && <DashboardView onNavigate={setActiveTab} />}
          {activeTab === 'workspace' && <WorkspaceView />}
          {activeTab === 'memory' && <MemoryCenterView />}
          {activeTab === 'providers' && <ProvidersView />}
          {activeTab !== 'dashboard' && activeTab !== 'workspace' && activeTab !== 'memory' && activeTab !== 'providers' && (
            <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-lavender-500/10 border border-lavender-500/20 text-lavender-400 mx-auto flex items-center justify-center">
                <Layers className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold capitalize text-slate-100">{activeTab} View</h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Milestone 1 shell initialized. Module routes, state containers and D1 schemas prepared for incremental implementation.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function DashboardView({ onNavigate }: { onNavigate: (tab: ActiveTab) => void }) {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Hero Welcome */}
      <div className="relative overflow-hidden rounded-2xl border border-lavender-500/20 bg-gradient-to-b from-slate-900 to-slate-950 p-8">
        <div className="relative z-10 space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-lavender-500/10 text-lavender-300 border border-lavender-500/30">
            <Sparkles className="h-3.5 w-3.5" />
            V1.0 Milestone 1 Foundation
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">
            Bring your own model. Build your own intelligence.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            EvolveAI preserves your private memory, project decisions, and knowledge relations across Google Gemini, OpenAI, Claude, Grok, and open models without vendor lock-in.
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
              onClick={() => onNavigate('providers')}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all border border-slate-700 flex items-center gap-2"
            >
              <KeyRound className="h-4 w-4" />
              Configure BYOK
            </button>
          </div>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Active Providers</span>
            <Zap className="h-4 w-4 text-lavender-400" />
          </div>
          <div className="text-2xl font-bold text-white">0 Connected</div>
          <p className="text-[12px] text-slate-500">Encrypted with AES-GCM-256</p>
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

function WorkspaceView() {
  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col justify-between border border-slate-800 rounded-xl bg-slate-900/40 p-6 min-h-[500px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="font-semibold text-slate-200">New Conversation</h3>
            <p className="text-xs text-slate-400">Select a provider and model to initiate context-aware chat</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            No Provider Connected
          </span>
        </div>

        <div className="p-8 text-center text-slate-500 space-y-2">
          <MessageSquare className="h-8 w-8 mx-auto text-slate-600" />
          <p className="text-sm">Connect an API key in the BYOK tab to chat with Gemini, Claude or OpenAI.</p>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800">
        <input
          type="text"
          disabled
          placeholder="Connect an AI provider to begin chatting..."
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
        />
      </div>
    </div>
  );
}

function MemoryCenterView() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-100">Personal Memory Center</h3>
          <p className="text-xs text-slate-400">Review candidate, approved, and archived facts extracted with user consent.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
        <Brain className="h-10 w-10 text-slate-600 mx-auto" />
        <h4 className="text-sm font-semibold text-slate-300">No Memories Recorded Yet</h4>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          EvolveAI only extracts memories when permitted, verifies them for contradictions, and requires approval.
        </p>
      </div>
    </div>
  );
}

function ProvidersView() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-100">AI Provider Connections (BYOK)</h3>
        <p className="text-xs text-slate-400">
          Connect your personal API keys. Credentials are encrypted on the server with AES-GCM-256 and never logged or exposed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {['Google Gemini', 'OpenAI', 'Anthropic Claude', 'xAI Grok', 'Mistral', 'OpenRouter'].map((name) => (
          <div key={name} className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex flex-col justify-between h-36">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-slate-200">{name}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">Not configured</span>
            </div>
            <button className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 border border-slate-700 transition-all">
              Connect Key
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
