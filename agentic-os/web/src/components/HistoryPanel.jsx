import { useState } from 'react';
import { History, CalendarClock } from 'lucide-react';
import { Panel, Empty, StatusDot } from './ui.jsx';
import { timeAgo, duration, dayTime, humanCron } from '../util.js';

export default function HistoryPanel({ jobs, runs, automations, selectedId, onSelect, onOpenFile, mode }) {
  const [tabState, setTab] = useState('jobs');
  const tab = mode ?? tabState;
  const nameOf = (id) => automations?.find((a) => a.id === id)?.name ?? id;

  return (
    <Panel
      title={mode === 'automations' ? 'Automations' : mode === 'jobs' ? 'Job history' : 'Run history'}
      icon={mode === 'automations' ? CalendarClock : History}
      className="h-full min-h-[300px]"
      action={mode ? null : (
        <div className="flex rounded-full bg-white/[0.06] p-0.5 text-[12px]" role="tablist">
          {['jobs', 'automations'].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 capitalize transition ${tab === t ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}>{t}</button>
          ))}
        </div>
      )}
    >
      {tab === 'jobs' && (jobs.length === 0 ? <Empty>Nothing yet. Every skill run — by button, chat, voice or automation — is recorded here.</Empty> : (
        <ul className="scroll-soft -mr-2 max-h-[320px] overflow-y-auto pr-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <button onClick={() => onSelect(j.id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/[0.05] ${selectedId === j.id ? 'bg-white/[0.07]' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{j.skillName}<span className="ml-2 text-[11px] font-normal text-white/35">{j.source === 'automation' ? 'automation' : 'manual'}</span></p>
                  <p className="truncate text-[12px] text-white/40">{Object.values(j.input).filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusDot status={j.status} />
                  <p className="text-[11px] text-white/35">{timeAgo(j.createdAt)}{j.runSeconds ? ` · ${duration(j.runSeconds)}` : ''}</p>
                </div>
              </button>
              {j.status === 'succeeded' && j.outputPath && (
                <button className="mb-1 ml-3 font-mono text-[11px] text-sky-300/80 hover:underline" onClick={() => onOpenFile(j.outputPath)}>{j.outputPath}</button>
              )}
            </li>
          ))}
        </ul>
      ))}
      {tab === 'automations' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {automations?.map((a) => (
            <div key={a.id} className="glass-inset flex flex-col gap-0.5 px-3.5 py-2.5 text-[12.5px]">
              <span className="flex items-center justify-between gap-2"><strong className="font-semibold">{a.name}</strong><span className="text-[11.5px] text-white/45">{humanCron(a.schedule)}</span></span>
              <span className="text-white/45">{a.enabled ? `Next run ${a.nextRun ? dayTime(a.nextRun) : '—'}` : 'Disabled'}</span>
            </div>
          ))}
          {runs.length === 0 ? <Empty>Nothing yet. Scheduled runs (and any missed ones) will show here.</Empty> : (
            <ul className="scroll-soft -mr-2 max-h-[260px] overflow-y-auto pr-2">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-white/[0.04]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{nameOf(r.automation_id)} <span className="text-white/35">· {r.trigger}</span></p>
                    <p className="text-[11.5px] text-white/40">scheduled {dayTime(r.scheduled_for)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusDot status={r.status} />
                    {r.output_path && <button className="block font-mono text-[11px] text-sky-300/80 hover:underline" onClick={() => onOpenFile(r.output_path)}>open</button>}
                    {r.job_id && !r.output_path && <button className="block text-[11px] text-white/45 hover:underline" onClick={() => onSelect(r.job_id)}>view run</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
