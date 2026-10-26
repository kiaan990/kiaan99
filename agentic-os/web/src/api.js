// All calls to the local backend. The local token comes from the page itself (injected by the server).
const TOKEN = document.querySelector('meta[name="agentic-os-token"]')?.content ?? '';

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: { 'X-Local-Token': TOKEN, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

// Server-Sent Events over fetch (so the token can be sent as a header).
// Reconnects automatically, resuming after the last event it saw.
export function stream(path, onEvent, { onOpen, shouldStop } = {}) {
  const ctrl = new AbortController();
  let lastId = 0;
  let stopped = false;

  (async () => {
    let delay = 1000;
    while (!stopped) {
      try {
        const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}after=${lastId}`, {
          headers: { 'X-Local-Token': TOKEN, Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onOpen?.();
        delay = 1000;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
            if (!data) continue;
            const ev = JSON.parse(data);
            if (ev.id) lastId = Math.max(lastId, ev.id);
            onEvent(ev);
          }
        }
        if (shouldStop?.()) return;
      } catch (err) {
        if (stopped || err.name === 'AbortError') return;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
    }
  })();

  return () => { stopped = true; ctrl.abort(); };
}
