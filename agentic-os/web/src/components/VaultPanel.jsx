import { Library } from 'lucide-react';
import { Panel, Empty } from './ui.jsx';
import { timeAgo } from '../util.js';

export default function VaultPanel({ stats, vaultName, onOpenFile }) {
  return (
    <Panel title={`Vault · ${vaultName ?? ''}`} icon={Library} className="min-h-[300px]">
      {!stats ? <Empty>Loading…</Empty> : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {['raw', 'wiki', 'outputs'].map((r) => (
              <div key={r} className="glass-inset px-3 py-3">
                <p className="text-[22px] font-semibold tracking-tight tabular-nums">{stats.roots[r]?.exists ? stats.roots[r].notes : '—'}</p>
                <p className="text-[11.5px] text-white/45">{r}/</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-white/45">{stats.totalNotes} notes · {stats.addedThisWeek} changed this week</p>
          <p className="mb-1.5 mt-4 text-[11.5px] font-medium text-white/40">Recently changed</p>
          {stats.recent.length === 0 ? <p className="text-[12.5px] text-white/40">Nothing yet.</p> : (
            <ul className="flex flex-col">
              {stats.recent.map((f) => (
                <li key={f.path}>
                  <button className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-white/[0.05]" onClick={() => onOpenFile(f.path)}>
                    <span className="truncate font-mono text-[11.5px] text-white/70">{f.path}</span>
                    <span className="shrink-0 text-[11px] text-white/35">{timeAgo(f.modified)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
