export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return inFuture(-s);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function inFuture(s) {
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} days`;
}

export function clock(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayTime(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function duration(sec) {
  if (!sec && sec !== 0) return '';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function usd(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '$0.00';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export const STATUS = {
  queued: { label: 'Queued', color: 'bg-white/40' },
  running: { label: 'Running', color: 'bg-sky-400 animate-pulse' },
  paused_limit: { label: 'Needs you', color: 'bg-amber-400' },
  paused: { label: 'Needs you', color: 'bg-amber-400' },
  succeeded: { label: 'Done', color: 'bg-emerald-400' },
  failed: { label: 'Failed', color: 'bg-rose-400' },
  cancelled: { label: 'Stopped', color: 'bg-white/30' },
  interrupted: { label: 'Interrupted', color: 'bg-orange-400' },
  missed_pending: { label: 'Missed — waiting', color: 'bg-amber-400' },
  skipped: { label: 'Skipped', color: 'bg-white/30' },
};

export function obsidianLink(absPath) {
  return absPath ? `obsidian://open?path=${encodeURIComponent(absPath)}` : null;
}

// "0 8 * * *" -> "Daily 8:00" for the common shapes; anything else is shown as-is.
export function humanCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return expr;
  const [mi, h, dom, mon, dow] = f;
  if (!/^\d+$/.test(mi) || !/^\d+$/.test(h) || dom !== '*' || mon !== '*') return expr;
  const t = `${h}:${mi.padStart(2, '0')}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (dow === '*') return `Daily ${t}`;
  if (dow === '1-5') return `Weekdays ${t}`;
  if (/^\d$/.test(dow)) return `${days[Number(dow) % 7]}s ${t}`;
  return expr;
}
