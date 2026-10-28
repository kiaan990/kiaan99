import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Speech-to-speech with the OpenAI Realtime API over WebRTC.
// The backend mints a short-lived client secret; the real OPENAI_API_KEY never reaches the browser.
// Ends automatically after a period of silence, and after the configured max session length.
export function useVoice({ onAssistantText, onToolResult } = {}) {
  const [state, setState] = useState('idle'); // idle | connecting | listening | speaking | error
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const levelRef = useRef(0);
  const s = useRef({});
  const cb = useRef({ onAssistantText, onToolResult });
  cb.current = { onAssistantText, onToolResult };

  const stop = useCallback(async (reason) => {
    const x = s.current;
    if (!x.pc && !x.mic) { setState('idle'); return; }
    s.current = {};
    cancelAnimationFrame(x.raf);
    clearInterval(x.tick);
    try { x.dc?.close(); } catch { /* ignore */ }
    try { x.pc?.close(); } catch { /* ignore */ }
    x.mic?.getTracks().forEach((t) => t.stop());
    try { await x.audioCtx?.close(); } catch { /* ignore */ }
    if (x.audioEl) x.audioEl.srcObject = null;
    levelRef.current = 0;
    setState('idle');
    if (reason === 'idle') setError('Voice ended after a quiet period.');
    else if (reason === 'max') setError('Voice ended: reached the maximum session length.');
    if (x.startedAt) {
      const seconds = (Date.now() - x.startedAt) / 1000;
      api('/voice/usage', { method: 'POST', body: { seconds, usage: {} } }).catch(() => {});
    }
  }, []);

  const start = useCallback(async () => {
    if (s.current.pc) return;
    setError(null);
    setElapsed(0);
    setState('connecting');
    const x = {};
    s.current = x;
    try {
      const session = await api('/voice/session', { method: 'POST' });
      x.idleMs = session.idleSeconds * 1000;
      x.maxMs = session.maxMinutes * 60 * 1000;

      x.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      x.audioCtx = new AudioContext();
      const micAnalyser = x.audioCtx.createAnalyser();
      micAnalyser.fftSize = 512;
      x.audioCtx.createMediaStreamSource(x.mic).connect(micAnalyser);

      const pc = new RTCPeerConnection();
      x.pc = pc;
      x.audioEl = new Audio();
      x.audioEl.autoplay = true;
      let outAnalyser = null;
      pc.ontrack = (e) => {
        x.audioEl.srcObject = e.streams[0];
        outAnalyser = x.audioCtx.createAnalyser();
        outAnalyser.fftSize = 512;
        x.audioCtx.createMediaStreamSource(e.streams[0]).connect(outAnalyser);
      };
      pc.addTrack(x.mic.getAudioTracks()[0], x.mic);
      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(pc.connectionState) && s.current === x) {
          setError('Voice connection dropped.');
          stop();
        }
      };

      const dc = pc.createDataChannel('oai-events');
      x.dc = dc;
      dc.onmessage = (m) => handleEvent(JSON.parse(m.data));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch(session.callsUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
      });
      if (!res.ok) throw new Error(`OpenAI did not accept the voice call (HTTP ${res.status}).`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

      x.startedAt = Date.now();
      x.lastActivity = Date.now();
      x.speaking = false;
      setState('listening');

      // Live audio level → orb
      const buf = new Uint8Array(256);
      const rms = (an) => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        return Math.sqrt(sum / buf.length);
      };
      const loop = () => {
        if (s.current !== x) return;
        const out = outAnalyser ? rms(outAnalyser) : 0;
        const inp = rms(micAnalyser);
        const speaking = x.speaking || out > 0.02;
        if (speaking) x.lastActivity = Date.now();
        levelRef.current = Math.min(1, (speaking ? out : inp) * 4.5);
        setState((prev) => {
          const next = speaking ? 'speaking' : 'listening';
          return prev === next ? prev : next;
        });
        x.raf = requestAnimationFrame(loop);
      };
      x.raf = requestAnimationFrame(loop);

      x.tick = setInterval(() => {
        if (s.current !== x) return;
        setElapsed(Math.round((Date.now() - x.startedAt) / 1000));
        if (Date.now() - x.lastActivity > x.idleMs) stop('idle');
        else if (Date.now() - x.startedAt > x.maxMs) stop('max');
      }, 1000);
    } catch (err) {
      const msg = err.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser settings.' : err.message;
      setError(msg);
      await stop();
      setState('error');
      setTimeout(() => setState((p) => (p === 'error' ? 'idle' : p)), 2500);
    }

    function send(obj) {
      if (x.dc?.readyState === 'open') x.dc.send(JSON.stringify(obj));
    }

    async function handleEvent(ev) {
      switch (ev.type) {
        case 'input_audio_buffer.speech_started':
          x.lastActivity = Date.now();
          break;
        case 'output_audio_buffer.started':
          x.speaking = true;
          x.lastActivity = Date.now();
          break;
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared':
          x.speaking = false;
          x.lastActivity = Date.now();
          break;
        case 'response.output_audio_transcript.done':
          if (ev.transcript) cb.current.onAssistantText?.(ev.transcript);
          break;
        case 'response.function_call_arguments.done': {
          if (ev.name !== 'ask_os') break;
          x.lastActivity = Date.now();
          let request = '';
          try { request = JSON.parse(ev.arguments || '{}').request || ''; } catch { /* ignore */ }
          let output;
          try {
            const reply = await api('/chat', { method: 'POST', body: { message: request } });
            cb.current.onToolResult?.(request, reply);
            const long = (reply.reply || '').length > 280;
            output = {
              reply: long ? reply.reply.slice(0, 280) : reply.reply,
              note: long ? 'The full answer was posted to the chat panel. Say so; do not read it out.' : undefined,
              proposal: reply.proposal ? 'A skill run was proposed in the chat panel; the user must press Run to start it.' : undefined,
            };
          } catch (e) {
            output = { error: e.message };
          }
          send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(output) } });
          send({ type: 'response.create' });
          break;
        }
        case 'response.done': {
          const u = ev.response?.usage;
          if (u) {
            api('/voice/usage', {
              method: 'POST',
              body: {
                usage: {
                  input_tokens: u.input_tokens,
                  output_tokens: u.output_tokens,
                  audio_input_tokens: u.input_token_details?.audio_tokens,
                  audio_output_tokens: u.output_token_details?.audio_tokens,
                  cached_tokens: u.input_token_details?.cached_tokens,
                },
              },
            }).catch(() => {});
          }
          break;
        }
        case 'error':
          setError(ev.error?.message || 'Voice error');
          break;
        default:
      }
    }
  }, [stop]);

  useEffect(() => () => { stop(); }, [stop]);

  return { state, error, elapsed, levelRef, start, stop, active: ['connecting', 'listening', 'speaking'].includes(state) };
}
