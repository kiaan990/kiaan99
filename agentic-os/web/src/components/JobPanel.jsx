import { useEffect, useRef, useState } from 'react';
import { Activity, FileText, Search, Globe, PenLine, ShieldAlert, ShieldCheck, Bot, CircleStop, PlayCircle, Info } from 'lucide-react';
import { api, stream } from '../api.js';
import { Panel, Empty, StatusDot } from './ui.jsx';
import { duration } from '../util.js';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const TOOL_ICONS = { Read: FileText, Glob: Search, Grep: Search, WebSearch: Globe, WebFetch: Globe, Write: PenLine, Edit: PenLine };

function EventRow({ ev }) {
  const d = ev.data;
  let Icon = Info;
  let text = '';
  let tone = 'text-white/60';
  switch (ev.type) {
    case 'tool': Icon = TOOL_ICONS[d.name] ?? Activity; text = `${d.name}${d.target ? ` · ${d.target}` : ''}`; break;
    case 'text': Icon = Bot; text = d.text; tone = 'text-white/80'; break;
    case 'log': text = d.text; break;
    case 'permissions': Icon = ShieldCheck; text = `Permissions: ${d.tools.join(', ')} · write only to this run’s output · ${d.maxTurns} turns / ${d.maxMinutes} min`; tone = 'text-white/45'; break;
    case 'denied': Icon = ShieldAlert; text = `${d.tool}: ${d.text}`; tone = 'text-amber-200/80'; break;
    case 'limit': Icon = ShieldAlert; text = d.text; tone = 'text-amber-200'; break;
    case 'status': return null;
    case 'turn': return null;
    case 'done': return null;
    default: text = JSON.stringify(d);
  }
  return (
    <li className="fade-in flex gap-2.5 py-1.5">
      <Icon size={14} className="mt-[3px] shrink-0 opacity-60" />
      <span className={`min-w-0 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed ${tone}`}>{text}</span>
    </li>
  );
}

export default function JobPanel({ jobId, onOpenFile, onChanged }) {
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!jobId) return undefined;
    setEvents([]);
    setJob(null);
    setError(null);
    let finished = false;
    let alive = true;
    const refresh = () => api(`/jobs/${jobId}`).then((r) => alive && setJob(r.job)).catch(() => {});
    refresh();
    const close = stream(`/jobs/${jobId}/events`, (ev) => {
      setEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [...prev, ev]));
      if (ev.type === 'status' || ev.type === 'done' || ev.type === 'turn') refresh();
      if (ev.type === 'done' && TERMINAL.has(ev.data.status)) finished = true;
    }, { shouldStop: () => finished });
    return () => { alive = false; close(); };
  }, [jobId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  async function act(path, body) {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/jobs/${jobId}/${path}`, { method: 'POST', body });
      setJob(r.job);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!jobId) {
    return (
      <Panel title="Live run" icon={Activity} className="h-full min-h-[260px]">
        <Empty>Nothing running. Pick a skill to start a job — its progress streams here live.</Empty>
      </Panel>
    );
  }

  const pct = job ? Math.min(100, Math.round((job.turns / Math.max(1, job.maxTurns)) * 100)) : 0;
  return (
    <Panel title="Live run" icon={Activity} className="h-full min-h-[260px]" action={job && <StatusDot status={job.status} />}>
      {job && (
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[15px] font-semibold">{job.skillName}</p>
            <p className="shrink-0 text-[11.5px] text-white/40">{job.turns}/{job.maxTurns} turns{job.runSeconds ? ` · ${duration(job.runSeconds)}` : ''}</p>
          </div>
          <p className="truncate text-[12px] text-white/45">{Object.values(job.input).filter(Boolean).join(' · ') || 'No input'}</p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div className={`h-full rounded-full transition-[width] duration-500 ${job.status === 'paused_limit' ? 'bg-amber-400' : job.status === 'failed' ? 'bg-rose-400' : 'bg-gradient-to-r from-sky-400 to-violet-400'}`} style={{ width: `${job.status === 'succeeded' ? 100 : pct}%` }} />
          </div>
        </div>
      )}
      <ul ref={listRef} className="scroll-soft -mr-2 max-h-[240px] min-h-0 flex-1 overflow-y-auto pr-2">
        {events.map((ev) => <EventRow key={ev.id} ev={ev} />)}
      </ul>

      {job?.status === 'paused_limit' && (
        <div className="fade-in mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-3">
          <p className="text-[13px] text-amber-100">This run reached its {job.limitHit === 'time' ? 'time' : 'turn'} limit and is paused. Continue?</p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => act('continue', { extraTurns: 10, extraMinutes: 10 })}><PlayCircle size={14} /> Continue (+10 turns, 10 min)</button>
            <button className="btn" disabled={busy} onClick={() => act('cancel')}><CircleStop size={14} /> Stop</button>
          </div>
        </div>
      )}
      {(job?.status === 'running' || job?.status === 'queued') && (
        <div className="mt-3 flex justify-end"><button className="btn" disabled={busy} onClick={() => act('cancel')}><CircleStop size={14} /> Stop</button></div>
      )}
      {job?.status === 'succeeded' && job.outputPath && (
        <button className="btn btn-primary mt-3 self-start" onClick={() => onOpenFile(job.outputPath)}><FileText size={14} /> Open {job.outputPath.split('/').pop()}</button>
      )}
      {job?.error && job.status !== 'cancelled' && <p className="mt-3 text-[12.5px] text-rose-300">{job.error}</p>}
      {error && <p className="mt-2 text-[12.5px] text-rose-300">{error}</p>}
    </Panel>
  );
}
