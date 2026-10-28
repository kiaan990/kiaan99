import { Inbox, BookOpen, PackageCheck, ArrowRight, CircleCheck } from 'lucide-react';

// How the memory layer works: raw → wiki → outputs, with live counts from the vault.
const STAGES = [
  { key: 'raw', icon: Inbox, name: 'raw/', text: 'Unprocessed inputs: notes, transcripts, clippings, dumps.' },
  { key: 'wiki', icon: BookOpen, name: 'wiki/', text: 'Organized, durable knowledge: decisions, concepts, context.' },
  { key: 'outputs', icon: PackageCheck, name: 'outputs/', text: 'Finished deliverables: briefs, research, reviews.' },
];

export default function MemoryFlow({ stats }) {
  return (
    <section className="glass flex h-full flex-col p-5">
      <p className="panel-title mb-4">How memory flows</p>
      <div className="grid flex-1 grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          const r = stats?.roots?.[s.key];
          return [
            <div key={s.key} className="glass-inset flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <span className="layer-accent flex items-center gap-2 font-mono text-[13px]"><Icon size={16} /> {s.name}</span>
                <span className="text-[22px] font-semibold tabular-nums">{r?.exists ? r.notes : '—'}</span>
              </div>
              <p className="text-[12.5px] leading-relaxed text-white/55">{s.text}</p>
            </div>,
            i < STAGES.length - 1 && <div key={`${s.key}-arrow`} className="layer-accent hidden items-center md:flex" aria-hidden="true"><ArrowRight size={18} /></div>,
          ];
        })}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-white/45">
        Plain markdown in your Obsidian vault, filed by the rules in the vault’s <code className="font-mono">CLAUDE.md</code>. Agents only ever add new files; nothing is moved or deleted. Raw notes get promoted to wiki when they become durable.
      </p>
      <div className="layer-strip mt-4 flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 font-display text-[15px] uppercase tracking-wide">
        <CircleCheck size={17} /> Simple. Local. Portable. Powerful.
      </div>
    </section>
  );
}
