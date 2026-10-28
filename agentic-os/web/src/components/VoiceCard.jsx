import { lazy, Suspense, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import Orb2D from './Orb.jsx';
import { webglAvailable } from './orbSupport.js';
import { useVoice } from '../useVoice.js';

// three.js is loaded separately so the rest of the dashboard appears instantly.
const Orb3D = lazy(() => import('./Orb3D.jsx'));

const LABELS = { idle: 'Idle', connecting: 'Connecting…', listening: 'Listening', speaking: 'Speaking', error: 'Something went wrong' };

export default function VoiceCard({ status, setMessages }) {
  const [hint, setHint] = useState(null);
  const [has3D] = useState(() => webglAvailable());
  const voiceEnabled = !!status?.voice.enabled;
  const voice = useVoice({
    onAssistantText: (t) => setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', content: t, via: 'voice' }]),
    onToolResult: (request, reply) => setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'user', content: `🎙 ${request}` },
      { id: crypto.randomUUID(), role: 'assistant', content: reply.reply, tier: reply.tier, proposal: reply.proposal, usage: reply.usage },
    ]),
  });

  const toggle = () => {
    if (!voiceEnabled) { setHint('Voice needs an OpenAI key in .env — everything else works without it.'); return; }
    setHint(null);
    if (voice.active) voice.stop(); else voice.start();
  };

  const mm = Math.floor(voice.elapsed / 60);
  const ss = String(voice.elapsed % 60).padStart(2, '0');
  const fallback = <div className="grid h-[340px] place-items-center overflow-hidden"><Orb2D state={voice.state} levelRef={voice.levelRef} size={230} /></div>;

  return (
    <section className="glass relative flex h-full min-h-[480px] flex-col items-center overflow-hidden px-5 pb-5 pt-4">
      <p className="panel-title self-start">Voice</p>
      <div className="w-full flex-1">
        {has3D
          ? <Suspense fallback={fallback}><Orb3D state={voice.state} levelRef={voice.levelRef} onActivate={toggle} size={340} label={`Voice orb: ${LABELS[voice.state]}`} /></Suspense>
          : fallback}
      </div>
      <p className="text-[15px] font-medium" aria-live="polite">{LABELS[voice.state]}</p>
      <p className="mt-1 h-5 text-center text-[12.5px] tabular-nums text-white/45">
        {voice.active && voice.state !== 'connecting' ? `${mm}:${ss} · ends after ${status.voice.idleSeconds}s of quiet` : voiceEnabled ? 'Tap the orb or the button to talk. Drag to spin it.' : 'Drag to spin the orb.'}
      </p>
      <div className="mt-4">
        {!voiceEnabled ? (
          <button className="btn" onClick={toggle}><MicOff size={15} /> Voice not configured</button>
        ) : voice.active ? (
          <button className="btn" onClick={toggle}><MicOff size={15} /> End voice</button>
        ) : (
          <button className="btn btn-primary !px-5 !py-2.5" onClick={toggle}><Mic size={15} /> Start talking</button>
        )}
      </div>
      {(voice.error || hint) && <p className="mt-3 max-w-[300px] text-center text-[12.5px] text-amber-200/80">{voice.error || hint}</p>}
    </section>
  );
}
