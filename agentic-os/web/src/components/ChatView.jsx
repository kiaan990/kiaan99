import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Play } from 'lucide-react';
import { api } from '../api.js';
import { Markdown } from './ui.jsx';
import { usd } from '../util.js';

const TIER_LABEL = { 1: 'Local · no model call', 2: 'Quick chat', 3: 'Skill proposal' };

export default function ChatView({ messages, setMessages, onJob, tier2Enabled }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e) {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText('');
    const history = messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.tier === 2)).slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: message }]);
    setBusy(true);
    try {
      const r = await api('/chat', { method: 'POST', body: { message, history } });
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', content: r.reply, tier: r.tier, proposal: r.proposal, disabled: r.disabled, usage: r.usage }]);
    } catch (err) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function runProposal(msg) {
    try {
      const { id } = await api('/jobs', { method: 'POST', body: msg.proposal });
      setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, proposal: null, started: true } : x)));
      onJob?.(id);
    } catch (err) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', content: err.message, error: true }]);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div ref={listRef} className="scroll-soft min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-2">
        {messages.length === 0 && (
          <div className="py-10 text-center text-[13px] leading-relaxed text-white/45">
            Nothing yet. Try <em>“show my last brief”</em>, <em>“what skills do you have?”</em> or <em>“research spaced repetition”</em>.
            {!tier2Enabled && <><br />Open-ended quick chat is not configured (no OpenAI key).</>}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`fade-in flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-[20px] px-4 py-2.5 ${m.role === 'user' ? 'bg-sky-500/80 text-white' : m.error ? 'bg-rose-500/15 text-rose-100' : 'bg-white/[0.07]'}`}>
              {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : <p className="whitespace-pre-wrap text-[14px]">{m.content}</p>}
              {m.role === 'assistant' && (m.tier || m.via) && (
                <p className="mt-1 text-[10.5px] text-white/35">
                  {m.via === 'voice' ? 'Voice' : TIER_LABEL[m.tier]}
                  {m.tier === 2 && m.disabled && ' · not configured'}
                  {m.usage?.estUsd != null && ` · ≈ ${usd(m.usage.estUsd)} (estimate)`}
                </p>
              )}
              {m.proposal && <button className="btn btn-primary mt-2" onClick={() => runProposal(m)}><Play size={13} /> Run</button>}
              {m.started && <p className="mt-1 text-[11.5px] text-emerald-300/80">Started — watch it in Live run.</p>}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="mt-2 flex items-end gap-2 rounded-[22px] border border-white/10 bg-black/25 p-1.5 pl-4 transition-colors focus-within:border-sky-300/50">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
          placeholder="Ask, or say “research …”"
          aria-label="Message"
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] bare-input outline-none placeholder:text-white/35"
        />
        <button type="submit" disabled={busy || !text.trim()} className="grid h-9 w-9 place-items-center rounded-full bg-sky-500 text-white transition disabled:bg-white/10 disabled:text-white/30" aria-label="Send">
          <ArrowUp size={17} />
        </button>
      </form>
    </div>
  );
}
