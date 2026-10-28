import { useState } from 'react';
import { Sunrise, ExternalLink, Play } from 'lucide-react';
import { api } from '../api.js';
import { Panel, Empty, Markdown } from './ui.jsx';
import { timeAgo, clock, obsidianLink, humanCron } from '../util.js';

export default function BriefPanel({ brief, automations, mcpToday, onJob }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const morning = automations?.find((a) => a.id === 'morning-brief');

  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/automations/morning-brief/run-now', { method: 'POST' });
      if (r.run?.job_id) onJob?.(r.run.job_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Today’s brief"
      icon={Sunrise}
      className="min-h-[420px] lg:max-h-[calc(100vh-180px)]"
      action={brief && <a className="btn btn-ghost !px-2 text-white/60" href={obsidianLink(brief.absPath)} title="Open in Obsidian"><ExternalLink size={14} /></a>}
    >
      {brief ? (
        <>
          <p className="mb-3 font-mono text-[11.5px] text-white/40">{brief.path} · {timeAgo(brief.modified)}</p>
          <div className="scroll-soft -mr-2 min-h-0 flex-1 overflow-y-auto pr-2"><Markdown>{brief.text}</Markdown></div>
        </>
      ) : (
        <Empty>
          <span>
            Nothing yet.
            <br />
            {morning?.nextRun ? <>Your morning brief will appear here after the next run at {clock(morning.nextRun)}.</> : 'Your morning brief will appear here.'}
          </span>
        </Empty>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
        <p className="text-[12px] text-white/40">
          {morning ? <>Automation: {morning.enabled ? humanCron(morning.schedule).toLowerCase() : 'off'}</> : 'No morning automation'}
          {mcpToday && <> · Server: {mcpToday.connected ? 'calendar & tasks included' : mcpToday.configured ? 'not connected' : 'off'}</>}
        </p>
        {morning && <button className="btn" onClick={runNow} disabled={busy}><Play size={13} /> Run now</button>}
      </div>
      {error && <p className="mt-2 text-[12px] text-rose-300">{error}</p>}
    </Panel>
  );
}
