import { ShieldCheck, Timer, Repeat2, Activity } from 'lucide-react';

// Layer 1: the Claude Code engine — real status, no invented numbers.
export default function EngineCard({ status, jobs }) {
  const c = status?.claude;
  const running = jobs.find((j) => j.status === 'running');
  const state = !c || c.installed === null ? 'Checking…' : !c.installed ? 'Not found' : c.loggedIn === false ? 'Not logged in' : 'Ready';
  const good = state === 'Ready';
  return (
    <section className="glass flex h-full flex-col p-5">
      <div className="flex items-center gap-4">
        <div className="cc-tile" aria-hidden="true">CC</div>
        <div className="min-w-0">
          <p className="font-display text-[22px] font-semibold uppercase leading-tight">Claude Code</p>
          <p className="truncate text-[12.5px] text-white/50">{c?.version ?? '—'}</p>
          <p className={`mt-1 flex items-center gap-1.5 text-[13px] ${good ? 'text-emerald-300' : 'text-amber-200'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${good ? 'bg-emerald-400' : 'bg-amber-400'}`} /> {state}{good ? ' · uses your Claude login' : ''}
          </p>
        </div>
      </div>
      <ul className="mt-5 flex flex-col gap-2.5 text-[13px] text-white/70">
        <li className="flex items-center gap-2.5"><Activity size={15} className="layer-accent" /> {running ? <>Running now: <strong className="font-medium text-white">{running.skillName}</strong> ({running.turns}/{running.maxTurns} turns)</> : 'Idle — no job running'}</li>
        <li className="flex items-center gap-2.5"><Repeat2 size={15} className="layer-accent" /> Headless <code className="font-mono text-[12px]">claude -p</code>, one job at a time</li>
        <li className="flex items-center gap-2.5"><Timer size={15} className="layer-accent" /> Limits: up to {status?.limits.maxTurns ?? '—'} turns / {status?.limits.maxMinutes ?? '—'} min per run, then it asks you</li>
        <li className="flex items-center gap-2.5"><ShieldCheck size={15} className="layer-accent" /> Scoped tools; writes only to each run’s new output; everything else denied</li>
      </ul>
    </section>
  );
}
