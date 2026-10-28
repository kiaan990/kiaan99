import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { STATUS, obsidianLink } from '../util.js';

export function Panel({ title, icon: Icon, action, className = '', children }) {
  return (
    <section className={`glass flex min-h-0 flex-col p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="panel-title flex items-center gap-2">
            {Icon && <Icon size={15} strokeWidth={2} className="opacity-70" />}
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[13px] leading-relaxed text-white/45">{children}</div>;
}

export function StatusDot({ status }) {
  const s = STATUS[status] ?? { label: status, color: 'bg-white/30' };
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-white/70">
      <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
      {s.label}
    </span>
  );
}

// Markdown is rendered WITHOUT raw HTML (react-markdown's safe default), and links open in a new tab.
export function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown
        components={{
          a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer noopener">{c}</a>,
          img: ({ alt }) => <span className="text-white/40">[image: {alt}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// File viewer: a modal <dialog>. Light-dismiss via closedby="any", with a click-outside fallback
// for browsers (Safari) that don't support closedby yet.
export function FileViewer({ path, onClose }) {
  const ref = useRef(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const d = ref.current;
    if (!path || !d) return undefined;
    setFile(null);
    setError(null);
    if (!d.open) d.showModal();
    api(`/files?path=${encodeURIComponent(path)}`).then(setFile).catch((e) => setError(e.message));
    const onClick = (e) => {
      if ('closedBy' in HTMLDialogElement.prototype || e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) d.close();
    };
    d.addEventListener('click', onClick);
    return () => d.removeEventListener('click', onClick);
  }, [path]);

  return (
    <dialog ref={ref} className="viewer" closedby="any" aria-labelledby="viewer-title" onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
        <h2 id="viewer-title" className="truncate font-mono text-[12.5px] text-white/70">{file?.path ?? path}</h2>
        <div className="flex items-center gap-1">
          {file?.absPath && (
            <a className="btn btn-ghost" href={obsidianLink(file.absPath)} title="Open this note in Obsidian">
              <ExternalLink size={14} /> Obsidian
            </a>
          )}
          <button className="btn btn-ghost" onClick={() => ref.current?.close()} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="scroll-soft max-h-[72vh] overflow-y-auto px-7 py-6">
        {error && <p className="text-rose-300">{error}</p>}
        {!error && !file && <p className="text-white/40">Loading…</p>}
        {file && <Markdown>{file.text}</Markdown>}
      </div>
    </dialog>
  );
}
