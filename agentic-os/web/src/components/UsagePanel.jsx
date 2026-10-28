import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { Panel, Empty } from './ui.jsx';
import { usd, duration } from '../util.js';

export default function UsagePanel({ usage }) {
  const [range, setRange] = useState('today');
  if (!usage) return <Panel title="Usage" icon={Gauge} className="min-h-[300px]"><Empty>Loading…</Empty></Panel>;
  const u = range === 'today' ? usage.today : usage.last30Days;
  return (
    <Panel
      title="Usage"
      icon={Gauge}
      className="min-h-[300px]"
      action={
        <div className="flex rounded-full bg-white/[0.06] p-0.5 text-[12px]">
          {[['today', 'Today'], ['30d', '30 days']].map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} className={`rounded-full px-3 py-1 transition ${range === k ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}>{label}</button>
          ))}
        </div>
      }
    >
      <div className="glass-inset px-3.5 py-3">
        <p className="text-[11.5px] text-white/45">Claude Code runs</p>
        <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular-nums">{u.claude.runs} <span className="text-[13px] font-normal text-white/45">runs · {u.claude.turns} turns · {duration(u.claude.seconds)}</span></p>
        <p className="mt-1 text-[12px] text-white/50">Cost: <strong className="font-medium text-white/75">unknown</strong> — uses your Claude subscription (no dollar meter)</p>
      </div>
      <div className="glass-inset mt-2.5 px-3.5 py-3">
        <p className="text-[11.5px] text-white/45">OpenAI (voice + quick chat)</p>
        <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular-nums">≈ {usd(u.openai.estUsd)} <span className="text-[12px] font-medium text-amber-200/80">estimate</span></p>
        <p className="mt-1 text-[12px] text-white/50">{(u.openai.inputTokens + u.openai.outputTokens).toLocaleString()} tokens · {duration(u.openai.voiceSeconds) || '0s'} voice{u.openai.unpriced ? ` · ${u.openai.unpriced} unpriced` : ''}</p>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-white/35">Estimates use pricing.config.json; your real bill is on platform.openai.com. No spend cap is guaranteed — Claude runs are held to turn/time limits instead.</p>
    </Panel>
  );
}
