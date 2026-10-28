import { useState } from 'react';
import { BookOpenText, Globe, Search, CalendarCheck, CalendarRange, Sparkles, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { Panel } from './ui.jsx';

const ICONS = { 'research-brief': Search, 'lecture-notes': BookOpenText, 'daily-plan': CalendarCheck, 'weekly-review': CalendarRange };

export default function SkillsPanel({ skills, claudeReady, onJob }) {
  const [open, setOpen] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(skill) {
    setBusy(true);
    setError(null);
    try {
      const input = {};
      for (const f of skill.fields) {
        const v = (values[`${skill.id}.${f.name}`] ?? '').trim();
        if (v || f.required) input[f.name] = v;
      }
      const { id } = await api('/jobs', { method: 'POST', body: { skillId: skill.id, input } });
      setValues((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${skill.id}.`))));
      setOpen(null);
      onJob?.(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Skills" icon={Sparkles} className="h-full">
      {!claudeReady && <p className="mb-3 rounded-2xl bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-200/90">Claude Code isn’t ready (not found or not logged in). Run <code className="font-mono">./install.sh</code> to fix it.</p>}
      <div className="grid grid-cols-2 gap-2.5">
        {skills.map((s) => {
          const Icon = ICONS[s.id] ?? Sparkles;
          const active = open === s.id;
          return (
            <button
              key={s.id}
              onClick={() => { setError(null); if (s.fields.length === 0) run(s); else setOpen(active ? null : s.id); }}
              disabled={busy}
              className={`group glass-inset flex flex-col items-start gap-2 p-3.5 text-left transition hover:bg-white/[0.08] ${active ? 'ring-1 ring-sky-300/40' : ''}`}
            >
              <span className="flex w-full items-center justify-between">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/[0.08]"><Icon size={16} /></span>
                {s.web && <span title="Uses the web"><Globe size={13} className="text-white/35" /></span>}
              </span>
              <span className="text-[13.5px] font-semibold text-white/90">{s.name}</span>
              <span className="text-[11.5px] leading-snug text-white/45">{s.description}</span>
            </button>
          );
        })}
      </div>

      {open && (() => {
        const s = skills.find((x) => x.id === open);
        return (
          <form className="fade-in mt-3 flex flex-col gap-2.5" onSubmit={(e) => { e.preventDefault(); run(s); }}>
            {s.fields.map((f) => {
              const key = `${s.id}.${f.name}`;
              const common = {
                className: 'field', placeholder: f.placeholder, 'aria-label': f.label, required: f.required,
                value: values[key] ?? '', onChange: (e) => setValues((v) => ({ ...v, [key]: e.target.value })),
              };
              return (
                <label key={key} className="flex flex-col gap-1 text-[12px] text-white/55">
                  {f.label}
                  {f.type === 'textarea' ? <textarea rows={f.name === 'transcript' ? 6 : 3} {...common} /> : <input autoFocus {...common} />}
                </label>
              );
            })}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-white/40">Limit: {s.limits.maxTurns} turns · {s.limits.maxMinutes} min · cost unknown (subscription)</span>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Run</button>
            </div>
          </form>
        );
      })()}
      {error && <p className="mt-2 text-[12.5px] text-rose-300">{error}</p>}
    </Panel>
  );
}
