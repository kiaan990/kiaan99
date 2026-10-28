import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createServer } from '../app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..', '..');
export const FAKE_CLAUDE = path.join(here, 'fixtures', 'fake-claude.mjs');

export function makeSandbox({ automations } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-os-test-'));
  const vault = path.join(root, 'second brain');
  for (const d of ['raw', 'wiki', 'outputs', 'private']) fs.mkdirSync(path.join(vault, d), { recursive: true });
  fs.writeFileSync(path.join(vault, 'CLAUDE.md'), '# My existing vault rules\n\nKeep this text.\n');
  fs.writeFileSync(path.join(vault, 'wiki', 'existing-note.md'), '# Existing note\n');
  fs.writeFileSync(path.join(vault, 'private', 'secret.md'), 'not for the app\n');
  fs.writeFileSync(path.join(root, 'outside.md'), 'outside the allowed roots\n');
  const automationsFile = path.join(root, 'automations.config.json');
  fs.writeFileSync(automationsFile, JSON.stringify(automations ?? {
    timezone: 'local',
    automations: [{ id: 'morning-brief', name: 'Morning brief', schedule: '0 8 * * *', skillId: 'daily-plan', input: {}, enabled: true, runOnCatchUp: 'ask', catchUpWindowHours: 16 }],
  }));
  return { root, vault, automationsFile, dataDir: path.join(root, 'data'), logsDir: path.join(root, 'logs'), token: crypto.randomBytes(32).toString('hex') };
}

export function makeConfig(sb, extra = {}) {
  const config = loadConfig({
    LOCAL_TOKEN: sb.token,
    VAULT_PATH: sb.vault,
    PORT: '0',
    CLAUDE_BIN: FAKE_CLAUDE,
    DATA_DIR: sb.dataDir,
    LOGS_DIR: sb.logsDir,
    AUTOMATIONS_FILE: sb.automationsFile,
    AGENTIC_OS_PROJECT_ROOT: PROJECT_ROOT,
    ...extra,
  });
  config.quiet = true;
  return config;
}

export async function boot(sb, extra = {}, opts = {}) {
  const config = makeConfig(sb, extra);
  const srv = createServer(config, { watchAutomations: false, ...opts });
  const info = await srv.start();
  const base = `http://127.0.0.1:${info.port}`;
  const api = (p, { method = 'GET', body, token = sb.token, headers = {} } = {}) =>
    fetch(base + p, {
      method,
      headers: { ...(token ? { 'X-Local-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { srv, info, base, api, config };
}

// Reads an SSE stream until `until(event)` is true. Returns all events.
export async function readSse(res, until, timeoutMs = 15000) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), deadline - Date.now()))]);
    if (done || value === undefined) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (!data) continue;
      const ev = JSON.parse(data);
      events.push(ev);
      if (until(ev)) { reader.cancel().catch(() => {}); return events; }
    }
  }
  reader.cancel().catch(() => {});
  return events;
}

export async function waitFor(fn, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor timed out');
}

export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) out[path.relative(dir, full)] = 'symlink';
      else if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
