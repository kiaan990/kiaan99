import { useEffect, useState } from 'react';
import { Asterisk } from 'lucide-react';

function Pill({ ok, warn, label, value, title }) {
  const dot = ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-white/30';
  return (
    <span title={title} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/70">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-white/45">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function greeting(h) {
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function TopBar({ status, mcp }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const c = status?.claude;
  const claudeValue = !c || c.installed === null ? 'checking…' : !c.installed ? 'not found' : c.loggedIn === false ? 'not logged in' : 'ready';
  const mcpValue = !status?.mcp.configured ? 'off' : mcp?.connected ? 'connected' : 'not connected';

  return (
    <header className="flex flex-col items-center gap-6">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-white/50">
          <span className="font-medium text-white/80">{greeting(now.getHours())}.</span>{' '}
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label="Claude" value={claudeValue} ok={claudeValue === 'ready'} warn={claudeValue !== 'ready' && claudeValue !== 'checking…'} title={c?.version ?? ''} />
          <Pill label="Voice" value={status?.voice.enabled ? 'on' : 'not configured'} ok={status?.voice.enabled} title="Needs OPENAI_API_KEY in .env" />
          <Pill label="Quick chat" value={status?.tier2.enabled ? status.tier2.model : 'not configured'} ok={status?.tier2.enabled} />
          {status?.vaultSync?.enabled && (
            <Pill label="Vault sync" value={status.vaultSync.error ? 'error' : 'on'} ok={!status.vaultSync.error} warn={!!status.vaultSync.error} title={status.vaultSync.error ?? `Last pull ${status.vaultSync.lastPull ?? '—'} · last push ${status.vaultSync.lastPush ?? '—'}`} />
          )}
          <Pill label="Server" value={mcpValue} ok={mcpValue === 'connected'} warn={mcpValue === 'not connected'} title="Optional read-only connection to your personal server (MCP_SERVER_URL)" />
        </div>
      </div>
      <div className="text-center">
        <p className="flex items-center justify-center gap-3 font-display text-[30px] font-semibold uppercase tracking-wide text-white sm:text-[44px]">
          <Asterisk className="text-orange-500" size={44} strokeWidth={2.6} aria-hidden="true" /> Claude Code
        </p>
        <h1 className="hero-title text-[48px] uppercase sm:text-[78px] lg:text-[96px]">Powered Agentic OS</h1>
        <p className="mt-3 text-[13px] font-medium uppercase tracking-[0.18em] text-white/70 sm:text-[15px]">4 layers. One system that thinks, remembers &amp; executes.</p>
      </div>
    </header>
  );
}
