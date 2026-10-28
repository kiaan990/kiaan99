// Builds the whole backend. index.js starts it; tests start their own copies.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { securityMiddleware } from './auth.js';
import { openDb } from './db.js';
import { createLogger } from './log.js';
import { createPathGuard, PathDeniedError, VAULT_ROOTS } from './paths.js';
import { createEventBus } from './jobs/events.js';
import { createJobRunner, TERMINAL } from './jobs/runner.js';
import { publicSkills } from './jobs/registry.js';
import { createScheduler } from './automations/scheduler.js';
import { createUsage } from './usage.js';
import { createVaultReader } from './vault.js';
import { createRouter } from './router.js';
import { createVoice } from './voice/realtime-token.js';
import { createMcpReader } from './mcp/readonly-client.js';
import { createVaultSync } from './vaultSync.js';

export function createServer(config, { now, watchAutomations = true } = {}) {
  const log = createLogger(config);
  const db = openDb(config.dataDir);
  const guard = createPathGuard({ projectRoot: config.projectRoot, vault: config.vault });
  const bus = createEventBus(db);
  const usage = createUsage({ db, config, log });
  const vault = createVaultReader({ guard });
  const mcp = createMcpReader({ config, log });
  const voice = createVoice({ config, log });
  const skills = publicSkills(config);
  const vaultSync = createVaultSync({ config, log });
  let scheduler = null;

  async function getContext(skill) {
    const ctx = {};
    if (skill.id === 'daily-plan' || skill.id === 'weekly-review') {
      const files = vault.recentFiles(skill.id === 'daily-plan' ? 2 : 7);
      ctx.recentFiles = files.map((f) => `- ${f.rel} (${new Date(f.mtime).toISOString().slice(0, 10)})`).join('\n');
    }
    if (skill.id === 'daily-plan' && config.mcp.url) {
      const t = await mcp.today().catch(() => null);
      if (t?.connected) ctx.serverContext = [t.calendar && `Calendar:\n${t.calendar}`, t.tasks && `Tasks:\n${t.tasks}`].filter(Boolean).join('\n\n').slice(0, 6000);
    }
    return ctx;
  }

  const jobs = createJobRunner({
    db, config, guard, bus, usage, log, getContext,
    beforeRun: config.vaultGit.enabled ? () => vaultSync.pull() : undefined,
    onJobSettled: (job) => {
      vault.invalidate();
      scheduler?.onJobSettled(job);
      if (job.status === 'succeeded') {
        const rel = job.output_path ? guard.relativeToVault(job.output_path) : job.skill_id;
        vaultSync.commitAndPush(`agentic-os: ${job.skill_id} → ${rel}`).then(() => vault.invalidate());
      }
    },
  });
  scheduler = createScheduler({ db, config, jobs, log, now });
  const router = createRouter({ config, jobs, vault, usage, skills, log });

  // Claude Code availability (checked once at start, refreshable).
  let claudeStatus = { installed: null, loggedIn: null, version: null, checkedAt: null };
  function checkClaude() {
    return new Promise((resolve) => {
      const env = { ...process.env, ...(config.claude.oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: config.claude.oauthToken } : {}) };
      execFile(config.claude.bin, ['--version'], { timeout: 10000, env }, (err, out) => {
        if (err) { claudeStatus = { installed: false, loggedIn: false, version: null, checkedAt: new Date().toISOString() }; return resolve(claudeStatus); }
        const version = String(out).trim().split('\n')[0];
        execFile(config.claude.bin, ['auth', 'status', '--json'], { timeout: 10000, env }, (err2, out2) => {
          let loggedIn = null;
          try { loggedIn = JSON.parse(out2).loggedIn === true; } catch { loggedIn = err2 ? null : null; }
          claudeStatus = { installed: true, loggedIn, version, checkedAt: new Date().toISOString() };
          resolve(claudeStatus);
        });
      });
    });
  }

  let port = config.port;
  const sec = securityMiddleware({ config, getPort: () => port });
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(sec.hostCheck, sec.identityCheck, sec.securityHeaders);

  // ---------- API (every route below requires the local token) ----------
  const api = express.Router();
  api.use(sec.apiGuard);
  api.use(express.json({ limit: '2mb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  api.get('/status', wrap(async (req, res) => {
    res.json({
      version: '1.0.0',
      host: config.host,
      port,
      access: { mode: config.access.mode, origin: config.access.publicOrigin ?? `http://127.0.0.1:${port}` },
      vaultSync: vaultSync.status(),
      vault: { path: config.vault, name: path.basename(config.vault) },
      claude: claudeStatus,
      openai: { configured: !!config.openai.apiKey },
      tier2: { enabled: config.tier2.enabled, provider: config.tier2.provider, model: config.tier2.enabled ? config.tier2.model : null },
      voice: { enabled: config.voice.enabled, idleSeconds: config.voice.idleSeconds, maxMinutes: config.voice.maxMinutes },
      mcp: { configured: !!config.mcp.url },
      limits: { maxTurns: config.claude.maxTurns, maxMinutes: config.claude.maxMinutes },
      busy: jobs.isBusy(),
    });
  }));
  api.post('/status/recheck', wrap(async (req, res) => res.json({ claude: await checkClaude() })));

  api.get('/skills', (req, res) => res.json({ skills }));

  // Job API
  api.post('/jobs', (req, res) => {
    const { skillId, input } = req.body ?? {};
    if (typeof skillId !== 'string') return res.status(400).json({ error: 'skillId is required' });
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) return res.status(400).json({ error: 'input must be an object' });
    const job = jobs.createJob(skillId, input ?? {}, { source: 'manual' });
    res.status(201).json({ id: job.id, job: jobs.publicJob(job) });
  });
  api.get('/jobs', (req, res) => res.json({ jobs: jobs.list(Number(req.query.limit) || 50).map(jobs.publicJob) }));
  api.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: jobs.publicJob(job) });
  });
  api.post('/jobs/:id/continue', (req, res) => res.json({ job: jobs.publicJob(jobs.continueJob(req.params.id, req.body ?? {})) }));
  api.post('/jobs/:id/cancel', (req, res) => res.json({ job: jobs.publicJob(jobs.cancelJob(req.params.id)) }));

  // Live progress for one job (Server-Sent Events). Replays stored events first, so it survives reloads.
  api.get('/jobs/:id/events', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const after = Number.parseInt(req.headers['last-event-id'] ?? req.query.after ?? '0', 10) || 0;
    openSse(res);
    const send = (ev) => res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
    for (const ev of bus.since(job.id, after)) send(ev);
    if (TERMINAL.has(jobs.get(job.id).status)) return res.end();
    const unsubscribe = bus.subscribe(job.id, (ev) => {
      send(ev);
      if (ev.type === 'done' && TERMINAL.has(ev.data.status)) { cleanup(); res.end(); }
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    const cleanup = () => { clearInterval(ping); unsubscribe(); };
    req.on('close', cleanup);
  });

  // Dashboard-wide stream: status changes of all jobs, so panels refresh live.
  api.get('/events', (req, res) => {
    openSse(res);
    const off = bus.onAny((ev) => {
      if (ev.type === 'status' || ev.type === 'done' || ev.type === 'turn') res.write(`data: ${JSON.stringify(ev)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); off(); });
  });

  // Automations
  api.get('/automations', (req, res) => res.json(scheduler.overview()));
  api.get('/automations/runs', (req, res) => res.json({ runs: scheduler.listRuns(Number(req.query.limit) || 50).map((r) => ({ ...r, output_path: r.output_path ? guard.relativeToVault(r.output_path) : null })) }));
  api.post('/automations/runs/:id/decision', (req, res) => res.json({ run: scheduler.decide(Number(req.params.id), req.body?.action) }));
  api.post('/automations/:id/run-now', (req, res) => res.json({ run: scheduler.runNow(req.params.id) }));

  // Vault (read-only views)
  api.get('/brief/latest', (req, res) => res.json({ brief: vault.latestBrief() }));
  api.get('/vault/stats', (req, res) => res.json(vault.stats()));
  api.get('/files', (req, res) => {
    const p = req.query.path;
    if (typeof p !== 'string' || !/\.(md|txt)$/i.test(p)) return res.status(400).json({ error: 'Only .md and .txt files can be opened' });
    const file = guard.readText(p, { roots: VAULT_ROOTS });
    res.json({ path: guard.relativeToVault(file.path), absPath: file.path, modified: file.mtime, text: file.text });
  });

  // Chat (router: Tier 1 local / Tier 2 quick model / Tier 3 skill proposal)
  api.post('/chat', wrap(async (req, res) => {
    const { message, history } = req.body ?? {};
    res.json(await router.route(message, history));
  }));

  // Voice
  api.post('/voice/session', wrap(async (req, res) => res.json(await voice.createSession())));
  api.post('/voice/usage', (req, res) => {
    if (!config.voice.enabled) return res.status(503).json({ error: 'Voice not configured' });
    const { usage: u = {}, seconds = 0 } = req.body ?? {};
    const row = usage.recordOpenAI({ kind: 'voice', model: config.openai.realtimeModel, usage: u, seconds });
    res.json({ estUsd: row.est_usd, isEstimate: true });
  });

  // Usage
  api.get('/usage', (req, res) => res.json(usage.summary()));

  // Optional personal-server connector (read-only)
  api.get('/mcp/status', wrap(async (req, res) => res.json(await mcp.status())));
  api.get('/mcp/today', wrap(async (req, res) => res.json(await mcp.today())));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  api.use((err, req, res, _next) => {
    if (err instanceof PathDeniedError) {
      log.warn(`path denied: ${err.message}`);
      return res.status(403).json({ error: `Denied: ${err.message}`, code: 'PATH_DENIED' });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    const status = Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) log.error(`${req.method} ${req.path}`, err);
    res.status(status).json({ error: status >= 500 && !err.status ? 'Internal error (see logs/server.log)' : err.message, code: err.code });
  });
  app.use('/api', api);

  // ---------- Dashboard (built web app) ----------
  const dist = path.join(config.projectRoot, 'web', 'dist');
  function getIndex() {
    const file = path.join(dist, 'index.html');
    if (!fs.existsSync(file)) return null;
    // The token is put into the page itself. Other websites cannot read this page (same-origin policy),
    // and the Host check above blocks DNS-rebinding tricks.
    return fs.readFileSync(file, 'utf8').replace('__AGENTIC_OS_TOKEN__', config.token);
  }
  app.use('/assets', express.static(path.join(dist, 'assets'), { index: false, fallthrough: false, maxAge: '1h' }));
  app.get(['/', '/index.html'], (req, res) => {
    const html = getIndex();
    if (!html) return res.status(503).type('text/plain').send('Dashboard not built yet. Run: npm run build');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  });
  app.get('/favicon.svg', (req, res) => res.sendFile(path.join(dist, 'favicon.svg'), (e) => e && res.status(404).end()));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  let server = null;
  async function start() {
    await new Promise((resolve, reject) => {
      server = app.listen(config.port, config.host, resolve);
      server.once('error', reject);
    });
    port = server.address().port;
    jobs.recover();
    vaultSync.start();
    const missed = scheduler.start({ watch: watchAutomations });
    checkClaude().catch(() => {});
    return { port, address: server.address().address, missed };
  }

  async function stop() {
    scheduler.stop();
    await jobs.stopAll();
    await vaultSync.stop();
    await mcp.close();
    if (server) {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
    db.close();
  }

  return { app, start, stop, jobs, scheduler, db, log, getPort: () => port };
}

function openSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
}
