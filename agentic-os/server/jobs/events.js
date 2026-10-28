// Job progress events: stored in SQLite (so they survive restarts) and pushed live to SSE listeners.
import { EventEmitter } from 'node:events';

export function createEventBus(db) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);
  const insert = db.prepare('INSERT INTO job_events(job_id, ts, type, data_json) VALUES (?, ?, ?, ?)');
  const select = db.prepare('SELECT id, job_id, ts, type, data_json FROM job_events WHERE job_id = ? AND id > ? ORDER BY id LIMIT 2000');

  function emit(jobId, type, data = {}) {
    const ts = new Date().toISOString();
    const info = insert.run(jobId, ts, type, JSON.stringify(data));
    const ev = { id: Number(info.lastInsertRowid), jobId, ts, type, data };
    emitter.emit(`job:${jobId}`, ev);
    emitter.emit('any', ev);
    return ev;
  }

  function since(jobId, afterId = 0) {
    return select.all(jobId, afterId).map((r) => ({ id: r.id, jobId: r.job_id, ts: r.ts, type: r.type, data: JSON.parse(r.data_json) }));
  }

  function subscribe(jobId, fn) {
    emitter.on(`job:${jobId}`, fn);
    return () => emitter.off(`job:${jobId}`, fn);
  }

  function onAny(fn) {
    emitter.on('any', fn);
    return () => emitter.off('any', fn);
  }

  return { emit, since, subscribe, onAny };
}
