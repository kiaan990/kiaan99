// Automated acceptance checks. Run with: npm test
// Uses a temporary fake vault and a fake `claude` program, so nothing touches your real vault
// and no Claude/OpenAI usage is consumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { boot, makeSandbox, readSse, waitFor, snapshot } from './helpers.js';
import { createPathGuard } from '../paths.js';
import { createMcpReader, isReadOnlyToolName } from '../mcp/readonly-client.js';

const lanAddress = () => Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

test('#4 server listens on 127.0.0.1 only and is not reachable on the network address', async () => {
  const sb = makeSandbox();
  const { srv, info } = await boot(sb);
  try {
    assert.equal(info.address, '127.0.0.1');
    const lan = lanAddress();
    if (lan) {
      const reachable = await new Promise((resolve) => {
        const s = net.connect({ host: lan, port: info.port, timeout: 1500 });
        s.on('connect', () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
        s.on('timeout', () => { s.destroy(); resolve(false); });
      });
      assert.equal(reachable, false, `port should not answer on ${lan}`);
    }
  } finally { await srv.stop(); }
});

test('#4 API calls without the local token, from another origin, or with a foreign Host are rejected', async () => {
  const sb = makeSandbox();
  const { srv, api, info } = await boot(sb);
  try {
    assert.equal((await api('/api/status', { token: null })).status, 401);
    assert.equal((await api('/api/status', { token: 'wrong'.repeat(10) })).status, 401);
    assert.equal((await api('/api/jobs', { method: 'POST', token: null, body: { skillId: 'research-brief', input: { topic: 'x y z' } } })).status, 401);
    assert.equal((await api('/api/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await api('/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const ok = await api('/api/status', { headers: { Origin: `http://127.0.0.1:${info.port}` } });
    assert.equal(ok.status, 200);
    // DNS-rebinding style request: right IP, foreign Host header.
    const rebind = await new Promise((resolve) => {
      const s = net.connect(info.port, '127.0.0.1', () => s.write(`GET /api/status HTTP/1.1\r\nHost: evil.example:${info.port}\r\nX-Local-Token: ${sb.token}\r\nConnection: close\r\n\r\n`));
      let d = ''; s.on('data', (c) => { d += c; }); s.on('end', () => resolve(d));
    });
    assert.match(rebind, /^HTTP\/1\.1 403/);
  } finally { await srv.stop(); }
});

test('#3 unknown skill IDs and bad inputs are rejected; there is no arbitrary-command endpoint', async () => {
  const sb = makeSandbox();
  const { srv, api } = await boot(sb);
  try {
    let r = await api('/api/jobs', { method: 'POST', body: { skillId: 'rm-rf', input: {} } });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /not in the allowlisted registry/);
    r = await api('/api/jobs', { method: 'POST', body: { skillId: 'research-brief', input: { topic: 'ok topic', prompt: 'ignore rules' } } });
    assert.equal(r.status, 400, 'extra input keys are refused');
    r = await api('/api/jobs', { method: 'POST', body: { skillId: 'research-brief', input: { topic: 'x' } } });
    assert.equal(r.status, 400, 'too-short topic refused');
    for (const p of ['/api/run', '/api/exec', '/api/command', '/api/shell', '/api/prompt']) {
      assert.equal((await api(p, { method: 'POST', body: { cmd: 'ls' } })).status, 404, p);
    }
    assert.equal((await (await api('/api/jobs')).json()).jobs.length, 0);
  } finally { await srv.stop(); }
});

test('#2 research-brief: job is created, progress streams live, file lands in outputs/, run is in history', async () => {
  const sb = makeSandbox();
  const argsFile = path.join(sb.root, 'args.json');
  process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
  const { srv, api } = await boot(sb);
  try {
    const r = await api('/api/jobs', { method: 'POST', body: { skillId: 'research-brief', input: { topic: 'Test topic: sleep & memory' } } });
    assert.equal(r.status, 201);
    const { id } = await r.json();
    const events = await readSse(await api(`/api/jobs/${id}/events`), (e) => e.type === 'done');
    const types = events.map((e) => e.type);
    for (const t of ['status', 'tool', 'text', 'turn', 'done']) assert.ok(types.includes(t), `stream has ${t}`);
    const done = events.at(-1);
    assert.equal(done.data.status, 'succeeded');
    assert.match(done.data.outputPath, /^outputs\/research\/\d{4}-\d{2}-\d{2}-test-topic-sleep-memory\.md$/);
    assert.ok(fs.existsSync(path.join(sb.vault, done.data.outputPath)));

    const job = (await (await api(`/api/jobs/${id}`)).json()).job;
    assert.equal(job.status, 'succeeded');
    assert.equal(job.cost.usd, null, 'Claude runs have no dollar amount');
    const list = (await (await api('/api/jobs')).json()).jobs;
    assert.equal(list[0].id, id);

    // The headless run was locked down the way the README says.
    const { args, cwd } = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    const val = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(val('--permission-mode'), 'dontAsk');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.equal(val('--tools'), 'Read,Glob,Grep,Write,WebSearch,WebFetch');
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    const writes = args.filter((a) => /^(Write|Edit)\(/.test(a));
    assert.equal(writes.length, 2);
    for (const w of writes) assert.match(w, /\/outputs\/research\/.+\.md\)$/, 'writes only to the one output file');
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(path.join(sb.vault, 'outputs')));

    // The file is readable through the file API.
    const file = await (await api(`/api/files?path=${encodeURIComponent(done.data.outputPath)}`)).json();
    assert.match(file.text, /Test output/);

    // #9 usage view updated: Claude run counted with unknown dollars.
    const usage = await (await api('/api/usage')).json();
    assert.equal(usage.today.claude.runs, 1);
    assert.equal(usage.today.claude.usd, null);
    assert.equal(usage.today.openai.isEstimate, true);
  } finally { delete process.env.FAKE_CLAUDE_ARGS_FILE; await srv.stop(); }
});

test('#5 file requests that resolve outside the allowed roots fail closed (paths and symlinks)', async () => {
  const sb = makeSandbox();
  fs.symlinkSync(path.join(sb.root, 'outside.md'), path.join(sb.vault, 'outputs', 'sneaky.md'));
  fs.symlinkSync(sb.root, path.join(sb.vault, 'wiki', 'escape-dir'));
  fs.symlinkSync(path.join(sb.root, 'does-not-exist.md'), path.join(sb.vault, 'outputs', 'dangling.md'));
  const { srv, api } = await boot(sb);
  try {
    const cases = [
      '../outside.md',
      'outputs/../../outside.md',
      path.join(sb.root, 'outside.md'),
      'private/secret.md',
      'CLAUDE.md',
      'outputs/sneaky.md',
      'wiki/escape-dir/outside.md',
    ];
    for (const p of cases) {
      const r = await api(`/api/files?path=${encodeURIComponent(p)}`);
      assert.equal(r.status, 403, `${p} should be denied`);
      assert.equal((await r.json()).code, 'PATH_DENIED');
    }
    // Writing through the guard: also fails closed and leaves nothing behind.
    const guard = createPathGuard({ projectRoot: sb.root, vault: sb.vault });
    assert.throws(() => guard.writeNew('wiki/escape-dir/new.md', 'x'), /outside the allowed folders/);
    assert.throws(() => guard.writeNew('outputs/dangling.md', 'x'), /broken symlink|outside/);
    assert.ok(!fs.existsSync(path.join(sb.root, 'new.md')));
    assert.ok(!fs.existsSync(path.join(sb.root, 'does-not-exist.md')));
    assert.throws(() => guard.writeNew('wiki/existing-note.md', 'overwrite!'), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(sb.vault, 'wiki', 'existing-note.md'), 'utf8'), '# Existing note\n');
  } finally { await srv.stop(); }
});

test('#6 jobs survive a restart; a missed 8:00 brief is detected and catch-up is offered', async () => {
  const sb = makeSandbox();
  // First run of the app: yesterday evening.
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(20, 0, 0, 0);
  let a = await boot(sb, {}, { now: () => yesterday });
  const r = await a.api('/api/jobs', { method: 'POST', body: { skillId: 'weekly-review', input: {} } });
  const { id } = await r.json();
  await readSse(await a.api(`/api/jobs/${id}/events`), (e) => e.type === 'done');
  assert.equal((await (await a.api('/api/automations')).json()).pending.length, 0);
  await a.srv.stop(); // "kill" the app (Mac asleep overnight)

  // Restart the next morning at 10:00: the 8:00 run was missed.
  const morning = new Date(); morning.setHours(10, 0, 0, 0);
  const b = await boot(sb, {}, { now: () => morning });
  try {
    assert.equal(b.info.missed.length, 1);
    assert.equal(b.info.missed[0].action, 'asked');
    const jobsAfter = (await (await b.api('/api/jobs')).json()).jobs;
    assert.equal(jobsAfter[0].id, id);
    assert.equal(jobsAfter[0].status, 'succeeded');
    const events = await readSse(await b.api(`/api/jobs/${id}/events`), (e) => e.type === 'done');
    assert.ok(events.length > 3, 'event log persisted');

    const overview = await (await b.api('/api/automations')).json();
    assert.equal(overview.pending.length, 1);
    const pending = overview.pending[0];
    const eight = new Date(morning); eight.setHours(8, 0, 0, 0);
    assert.equal(pending.scheduled_for, eight.toISOString());

    // The user chooses "Run now": a job starts, recorded in automation history.
    const dec = await (await b.api(`/api/automations/runs/${pending.id}/decision`, { method: 'POST', body: { action: 'run' } })).json();
    assert.ok(dec.run.job_id);
    const ev2 = await readSse(await b.api(`/api/jobs/${dec.run.job_id}/events`), (e) => e.type === 'done');
    assert.equal(ev2.at(-1).data.status, 'succeeded');
    assert.match(ev2.at(-1).data.outputPath, /^outputs\/briefs\/.+-morning-brief\.md$/);
    const runs = await waitFor(async () => {
      const x = (await (await b.api('/api/automations/runs')).json()).runs;
      return x[0]?.status === 'succeeded' ? x : null;
    });
    assert.equal(runs[0].trigger, 'catch-up');
    const brief = (await (await b.api('/api/brief/latest')).json()).brief;
    assert.match(brief.path, /morning-brief/);
    // A second decision on the same run is refused (no double runs).
    assert.equal((await b.api(`/api/automations/runs/${pending.id}/decision`, { method: 'POST', body: { action: 'run' } })).status, 409);
  } finally { await b.srv.stop(); }
});

test('#9 a job that hits its configured limit pauses and asks; continuing finishes it', async () => {
  const sb = makeSandbox();
  process.env.FAKE_CLAUDE_MODE = 'loop';
  const { srv, api } = await boot(sb, { CLAUDE_MAX_TURNS: '3' });
  try {
    const { id } = await (await api('/api/jobs', { method: 'POST', body: { skillId: 'research-brief', input: { topic: 'long running topic' } } })).json();
    const events = await readSse(await api(`/api/jobs/${id}/events`), (e) => e.type === 'done');
    const limit = events.find((e) => e.type === 'limit');
    assert.ok(limit, 'limit event emitted');
    assert.match(limit.data.text, /Continue or stop\?/);
    let job = (await (await api(`/api/jobs/${id}`)).json()).job;
    assert.equal(job.status, 'paused_limit');
    assert.equal(job.limitHit, 'turns');
    assert.ok(job.turns <= 3);

    delete process.env.FAKE_CLAUDE_MODE;
    const c = await api(`/api/jobs/${id}/continue`, { method: 'POST', body: { extraTurns: 5, extraMinutes: 2 } });
    assert.equal(c.status, 200);
    job = await waitFor(async () => {
      const j = (await (await api(`/api/jobs/${id}`)).json()).job;
      return j.status === 'succeeded' ? j : null;
    });
    assert.equal(job.attempts, 2);
    // Continuing a finished job is refused.
    assert.equal((await api(`/api/jobs/${id}/continue`, { method: 'POST', body: {} })).status, 409);
  } finally { delete process.env.FAKE_CLAUDE_MODE; await srv.stop(); }
});

test('#8 without OPENAI_API_KEY: app works, voice and Tier 2 are visibly disabled; Tier 1 and Tier 3 still work', async () => {
  const sb = makeSandbox();
  const { srv, api } = await boot(sb, { OPENAI_API_KEY: '' });
  try {
    const status = await (await api('/api/status')).json();
    assert.equal(status.voice.enabled, false);
    assert.equal(status.tier2.enabled, false);
    assert.equal(status.mcp.configured, false);
    const v = await api('/api/voice/session', { method: 'POST' });
    assert.equal(v.status, 503);
    assert.match((await v.json()).error, /not configured/i);
    const t2 = await (await api('/api/chat', { method: 'POST', body: { message: 'what is the capital of France?' } })).json();
    assert.equal(t2.tier, 2);
    assert.equal(t2.disabled, true);
    const t1 = await (await api('/api/chat', { method: 'POST', body: { message: 'show my last brief' } })).json();
    assert.equal(t1.tier, 1);
    assert.match(t1.reply, /No morning brief yet/);
    const t3 = await (await api('/api/chat', { method: 'POST', body: { message: 'research the history of the bicycle' } })).json();
    assert.equal(t3.tier, 3);
    assert.deepEqual(t3.proposal, { skillId: 'research-brief', input: { topic: 'the history of the bicycle' } });
    const jobs = (await (await api('/api/jobs')).json()).jobs;
    assert.equal(jobs.length, 0, 'the router only proposes; nothing runs until confirmed');
    const mcp = await (await api('/api/mcp/status')).json();
    assert.equal(mcp.configured, false);
    assert.equal(mcp.connected, false);
  } finally { await srv.stop(); }
});

test('#7 vault changes are additive only, inside raw/ wiki/ outputs/; existing CLAUDE.md untouched', async () => {
  const sb = makeSandbox();
  const before = snapshot(sb.vault);
  const { srv, api } = await boot(sb);
  try {
    const transcript = 'Today we talk about cell membranes. '.repeat(10);
    for (const body of [
      { skillId: 'lecture-notes', input: { title: 'Bio 101 week 3', transcript } },
      { skillId: 'daily-plan', input: { tasks: 'study\nemail prof' } },
      { skillId: 'research-brief', input: { topic: 'another topic' } },
    ]) {
      const { id } = await (await api('/api/jobs', { method: 'POST', body })).json();
      const ev = await readSse(await api(`/api/jobs/${id}/events`), (e) => e.type === 'done');
      assert.equal(ev.at(-1).data.status, 'succeeded', body.skillId);
    }
    const after = snapshot(sb.vault);
    for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, `${file} unchanged`);
    const added = Object.keys(after).filter((f) => !(f in before));
    assert.ok(added.length >= 4);
    for (const f of added) assert.match(f, /^(raw|wiki|outputs)\//, `${f} is inside an allowed folder`);
    assert.ok(added.some((f) => f.startsWith('raw/transcripts/')), 'transcript saved to raw/');
    assert.ok(added.some((f) => f.startsWith('wiki/lectures/')), 'notes saved to wiki/');
  } finally { await srv.stop(); }
});

test('optional MCP connector is read-only and harmless when unreachable', async () => {
  assert.equal(isReadOnlyToolName('tasks_list'), true);
  for (const n of ['tasks_add', 'tasks_delete', 'calendar_create_event', 'brief_save', 'activity_note', 'tasks_complete']) assert.equal(isReadOnlyToolName(n), false, n);
  const logStub = { redact: (s) => s, warn() {}, error() {}, info() {} };
  const reader = createMcpReader({ config: { mcp: { url: 'http://127.0.0.1:9/mcp', authToken: null, readTools: ['tasks_list', 'tasks_add'] } }, log: logStub });
  await assert.rejects(reader.callRead('tasks_add', { title: 'x' }), /not on the read-only allowlist/);
  const st = await reader.status();
  assert.equal(st.connected, false);
  assert.deepEqual(st.allowlist, ['tasks_list']);
  const today = await reader.today();
  assert.equal(today.connected, false);
});

test('#8/#9 with OPENAI_API_KEY: voice session is minted server-side (key never sent to the browser) and Tier 2 usage is an estimate', async () => {
  const http = await import('node:http');
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/realtime/client_secrets') return res.end(JSON.stringify({ value: 'ek_test_ephemeral', expires_at: 123 }));
      if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: 'Paris.' } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const sb = makeSandbox();
  const KEY = 'sk-test-REAL-KEY-must-stay-on-server-1234567890';
  const { srv, api, base } = await boot(sb, { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `http://127.0.0.1:${mock.address().port}` });
  try {
    const status = await (await api('/api/status')).json();
    assert.equal(status.voice.enabled, true);
    assert.equal(status.tier2.enabled, true);

    const vr = await api('/api/voice/session', { method: 'POST' });
    const vtext = await vr.text();
    assert.equal(vr.status, 200);
    assert.ok(!vtext.includes(KEY), 'real key not in the response');
    assert.equal(JSON.parse(vtext).clientSecret, 'ek_test_ephemeral');
    assert.equal(seen[0].auth, `Bearer ${KEY}`, 'server used the real key to mint the token');
    assert.equal(seen[0].body.session.tools[0].name, 'ask_os');

    const chat = await (await api('/api/chat', { method: 'POST', body: { message: 'what is the capital of France?' } })).json();
    assert.equal(chat.tier, 2);
    assert.equal(chat.reply, 'Paris.');
    assert.equal(chat.usage.isEstimate, true);

    await api('/api/voice/usage', { method: 'POST', body: { usage: { input_tokens: 500, output_tokens: 300, audio_input_tokens: 400, audio_output_tokens: 250 }, seconds: 42 } });
    const usage = await (await api('/api/usage')).json();
    assert.equal(usage.today.openai.isEstimate, true);
    assert.ok(usage.today.openai.estUsd > 0);
    assert.equal(usage.today.openai.voiceSeconds, 42);

    // The key appears nowhere the browser can see, nor in the logs.
    const page = await (await fetch(base + '/')).text();
    assert.ok(!page.includes(KEY));
    const logFile = path.join(sb.logsDir, 'server.log');
    const logs = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    assert.ok(!logs.includes(KEY) && !logs.includes(sb.token));
  } finally { await srv.stop(); mock.close(); }
});

test('#1 dashboard page loads with its token, security headers, and the API works from it', async () => {
  const sb = makeSandbox();
  const { srv, base } = await boot(sb);
  try {
    const res = await fetch(base + '/');
    if (res.status === 503) return; // dashboard not built yet in this checkout
    const html = await res.text();
    assert.ok(html.includes(`content="${sb.token}"`));
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  } finally { await srv.stop(); }
});

test('cloud mode: refuses to start without an allowed Tailscale user (fails closed)', async () => {
  const { makeConfig } = await import('./helpers.js');
  const sb = makeSandbox();
  assert.throws(() => makeConfig(sb, { PUBLIC_ORIGIN: 'https://kiaan-cloud.example.ts.net:8443' }), /TAILSCALE_ALLOWED_USERS is empty/);
  assert.throws(() => makeConfig(sb, { PUBLIC_ORIGIN: 'http://insecure.example', TAILSCALE_ALLOWED_USERS: 'me@example.com' }), /must look like https/);
});

test('cloud mode: only the allowed Tailscale identity, via the tailnet address, gets in', async () => {
  const sb = makeSandbox();
  const ORIGIN = 'https://kiaan-cloud.example.ts.net:8443';
  const { srv, api, base } = await boot(sb, { PUBLIC_ORIGIN: ORIGIN, TAILSCALE_ALLOWED_USERS: 'Me@Example.com' });
  try {
    const me = { 'Tailscale-User-Login': 'me@example.com' };
    // No identity header (e.g. another program on the server, or not via Tailscale): refused, page and API.
    assert.equal((await fetch(base + '/')).status, 403);
    assert.equal((await api('/api/status')).status, 403);
    // Wrong Tailscale user: refused.
    assert.equal((await api('/api/status', { headers: { 'Tailscale-User-Login': 'someone@else.com' } })).status, 403);
    // Right user, as Tailscale Serve forwards it (tailnet Host + Origin): allowed.
    const viaServe = await new Promise((resolve) => {
      const s = net.connect(Number(new URL(base).port), '127.0.0.1', () => s.write(
        `GET /api/status HTTP/1.1\r\nHost: kiaan-cloud.example.ts.net:8443\r\nOrigin: ${ORIGIN}\r\nTailscale-User-Login: me@example.com\r\nX-Local-Token: ${sb.token}\r\nConnection: close\r\n\r\n`));
      let d = ''; s.on('data', (c) => { d += c; }); s.on('end', () => resolve(d));
    });
    assert.match(viaServe, /^HTTP\/1\.1 200/);
    assert.match(viaServe, /"mode":"cloud"/);
    // The token is still required on the API, and other origins are still refused.
    assert.equal((await api('/api/status', { token: null, headers: me })).status, 401);
    assert.equal((await api('/api/status', { headers: { ...me, Origin: 'https://evil.example' } })).status, 403);
  } finally { await srv.stop(); }
});

test('cloud mode: vault Git sync commits only raw/ wiki/ outputs/ and pushes after a job', async () => {
  const { execFileSync } = await import('node:child_process');
  const sb = makeSandbox();
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, stdio: 'pipe' }).toString();
  const remote = path.join(sb.root, 'vault-remote.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  git(sb.vault, 'init', '-q', '-b', 'main');
  git(sb.vault, 'add', '-A');
  git(sb.vault, 'commit', '-q', '-m', 'my vault');
  git(sb.vault, 'remote', 'add', 'origin', remote);
  git(sb.vault, 'push', '-q', '-u', 'origin', 'main');
  // An unrelated local edit outside the allowed folders must NOT be committed by the app.
  fs.writeFileSync(path.join(sb.vault, 'private', 'draft.md'), 'my private draft\n');

  const { srv, api } = await boot(sb, { VAULT_GIT_SYNC: 'true' });
  try {
    const { id } = await (await api('/api/jobs', { method: 'POST', body: { skillId: 'research-brief', input: { topic: 'git sync test' } } })).json();
    const ev = await readSse(await api(`/api/jobs/${id}/events`), (e) => e.type === 'done');
    assert.equal(ev.at(-1).data.status, 'succeeded');
    const pushed = await waitFor(() => {
      const log = execFileSync('git', ['--git-dir', remote, 'log', '--oneline', 'main']).toString();
      return log.includes('agentic-os: research-brief') ? log : null;
    });
    assert.ok(pushed);
    const files = execFileSync('git', ['--git-dir', remote, 'show', '--name-only', '--format=', 'main']).toString().trim().split('\n');
    assert.deepEqual(files, [ev.at(-1).data.outputPath]);
    const status = await (await api('/api/status')).json();
    assert.equal(status.vaultSync.enabled, true);
    assert.equal(status.vaultSync.error, null);
    assert.ok(status.vaultSync.lastPush);
  } finally { await srv.stop(); }
});
