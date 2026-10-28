import { useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { api } from '../api.js';
import { dayTime } from '../util.js';

export default function CatchUpBanner({ pending, automations, onChanged, onJob }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!pending?.length) return null;
  const nameOf = (id) => automations?.find((a) => a.id === id)?.name ?? id;

  async function decide(run, action) {
    setBusy(run.id);
    setError(null);
    try {
      const r = await api(`/automations/runs/${run.id}/decision`, { method: 'POST', body: { action } });
      if (r.run?.job_id) onJob?.(r.run.job_id);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass fade-in flex flex-col gap-3 border-amber-300/20 px-5 py-4">
      {pending.map((run) => (
        <div key={run.id} className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-3 text-[14px]">
            <AlarmClock size={18} className="text-amber-300" />
            <span>
              <strong className="font-semibold">{nameOf(run.automation_id)}</strong> didn’t run at {dayTime(run.scheduled_for)}
              <span className="text-white/50"> (your Mac was asleep or the app was off).</span> Run it now?
            </span>
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy === run.id} onClick={() => decide(run, 'run')}>Run now</button>
            <button className="btn" disabled={busy === run.id} onClick={() => decide(run, 'skip')}>Skip</button>
          </div>
        </div>
      ))}
      {error && <p className="text-[13px] text-rose-300">{error}</p>}
    </div>
  );
}
