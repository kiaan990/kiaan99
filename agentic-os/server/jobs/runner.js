// Runs allowlisted skills as headless Claude Code jobs (`claude -p`), one at a time.
//
// Subprocess safety (Claude Code's own permission system does the enforcing):
//   --tools            only the built-in tools the skill needs (no Bash, no code execution)
//   --allowedTools     pre-approves reads in raw/ wiki/ outputs/ and writes ONLY to the job's new output path
//   --permission-mode dontAsk   anything not pre-approved is denied, never auto-approved
//   --strict-mcp-config         no MCP servers from your personal config
// The working directory (vault/outputs, plus raw/ and wiki/ via --add-dir) is a convenience
// for Claude, not an isolation boundary.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getSkill, validateInput } from './registry.js';

export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const MAX_CONCURRENT = 1;

export function createJobRunner({ db, config, guard, bus, usage, log, getContext, onJobSettled, beforeRun }) {
  const running = new Map(); // jobId -> { child, killReason }
  let stopping = false;
  const q = {
    insert: db.prepare(`INSERT INTO jobs (id, skill_id, input_json, plan_json, status, source, automation_run_id, created_at, output_path, max_turns, max_minutes)
                        VALUES (@id, @skill_id, @input_json, @plan_json, 'queued', @source, @automation_run_id, @created_at, @output_path, @max_turns, @max_minutes)`),
    get: db.prepare('SELECT * FROM jobs WHERE id = ?'),
    list: db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?'),
    nextQueued: db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1"),
    update: (id, fields) => {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
    },
  };

  function setStatus(id, status, extra = {}) {
    const fields = { status, ...extra };
    if (TERMINAL.has(status) || status === 'paused_limit') fields.finished_at = new Date().toISOString();
    q.update(id, fields);
    bus.emit(id, 'status', { status, ...pick(extra, ['error', 'limit_hit', 'output_path']) });
    const job = q.get.get(id);
    if (TERMINAL.has(status) || status === 'paused_limit') {
      bus.emit(id, 'done', { status, outputPath: job.output_path ? guard.relativeToVault(job.output_path) : null, error: job.error, limitHit: job.limit_hit });
      try { onJobSettled?.(job); } catch (e) { log.error('onJobSettled failed', e); }
    }
    return job;
  }

  function createJob(skillId, rawInput, { source = 'manual', automationRunId = null } = {}) {
    const skill = getSkill(skillId);
    if (!skill) {
      const err = new Error('Unknown skill: not in the allowlisted registry');
      err.status = 400;
      throw err;
    }
    const input = validateInput(skill, rawInput);
    const now = new Date();
    const plan = skill.plan(input, { now, guard });
    // Output must be a NEW file inside outputs/ or wiki/ (checked again right before running).
    guard.resolve(plan.output, ['outputs', 'wiki']);
    for (const f of plan.rawFiles ?? []) guard.writeNew(f.path, f.content, { roots: ['raw'] });

    const id = crypto.randomUUID();
    q.insert.run({
      id,
      skill_id: skill.id,
      input_json: JSON.stringify(input),
      plan_json: JSON.stringify({ writeScope: plan.writeScope, extra: plan.extra ?? {} }),
      source,
      automation_run_id: automationRunId,
      created_at: now.toISOString(),
      output_path: plan.output,
      max_turns: Math.min(skill.limits.maxTurns, config.claude.maxTurns),
      max_minutes: Math.min(skill.limits.maxMinutes, config.claude.maxMinutes),
    });
    bus.emit(id, 'status', { status: 'queued' });
    log.info(`job ${id} queued (${skill.id}, ${source})`);
    setImmediate(pump);
    return q.get.get(id);
  }

  function pump() {
    if (stopping) return;
    while (running.size < MAX_CONCURRENT) {
      const job = q.nextQueued.get();
      if (!job) return;
      start(job).catch((err) => {
        log.error(`job ${job.id} failed to start`, err);
        running.delete(job.id);
        setStatus(job.id, 'failed', { error: String(err.message || err) });
        setImmediate(pump);
      });
    }
  }

  function childEnv() {
    const env = { ...process.env };
    for (const k of ['LOCAL_TOKEN', 'OPENAI_API_KEY', 'MCP_AUTH_TOKEN']) delete env[k];
    // Use the Claude Code login (subscription), not a metered API key, unless explicitly allowed.
    if (!config.claude.allowApiKey) delete env.ANTHROPIC_API_KEY;
    // On a server, Claude Code logs in with a long-lived subscription token (from `claude setup-token`).
    if (config.claude.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = config.claude.oauthToken;
    return env;
  }

  function permissionArgs(skill, plan) {
    const abs = (p) => `/${p}`; // Claude Code permission rules use //absolute/path
    const raw = guard.rootReal('raw');
    const wiki = guard.rootReal('wiki');
    const outputs = guard.rootReal('outputs');
    const allow = [raw, wiki, outputs].map((d) => `Read(${abs(d)}/**)`);
    // Glob/Grep are covered by the Read rules and the working folders; they are not approved for other paths.
    if (skill.web) allow.push('WebSearch', 'WebFetch');
    for (const scope of plan.writeScope) {
      allow.push(`Write(${abs(scope)})`, `Edit(${abs(scope)})`);
    }
    return { allow, cwd: outputs, addDirs: [raw, wiki] };
  }

  async function start(job) {
    const skill = getSkill(job.skill_id);
    if (!skill) throw new Error('Skill no longer in registry');
    running.set(job.id, { child: null, killReason: null });
    if (beforeRun) {
      bus.emit(job.id, 'log', { text: 'Syncing the vault…' });
      await beforeRun(job);
    }

    const input = JSON.parse(job.input_json);
    const plan = JSON.parse(job.plan_json);
    // Fail closed if the output path no longer resolves inside the allowed roots.
    const outputReal = guard.resolve(job.output_path, ['outputs', 'wiki']);
    const isResume = !!job.session_id && job.attempts > 0;
    const remaining = Math.max(1, job.max_turns - job.turns);
    const ctx = {
      now: new Date(job.created_at),
      outputRel: guard.relativeToVault(outputReal),
      extra: plan.extra ?? {},
      ...(isResume ? {} : await getContext(skill)),
    };
    const prompt = isResume
      ? `Continue the task from where you stopped. The final deliverable must exist at ${ctx.outputRel}. Do not edit any other existing file.`
      : skill.prompt(input, ctx);

    // The skill's SKILL.md and template.md are passed in directly (Claude cannot read the project folder).
    let skillDoc = '';
    for (const name of ['SKILL.md', 'template.md']) {
      try {
        const { text } = guard.readText(path.join(config.projectRoot, 'skills', skill.id, name), { roots: ['project'], maxBytes: 200000 });
        skillDoc += `${skillDoc ? '\n\n--- template.md ---\n' : ''}${text}`;
      } catch { /* the registry prompt is enough on its own */ }
    }

    const perms = permissionArgs(skill, plan);
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', String(remaining),
      '--permission-mode', 'dontAsk',
      '--strict-mcp-config',
      '--tools', skill.tools.join(','),
      '--add-dir', ...perms.addDirs,
      '--allowedTools', ...perms.allow,
    ];
    if (skillDoc) args.push('--append-system-prompt', `You are running the "${skill.id}" skill. Its instructions:\n\n${skillDoc}`);
    if (config.claude.model) args.push('--model', config.claude.model);
    if (isResume) args.push('--resume', job.session_id);

    q.update(job.id, { status: 'running', started_at: job.started_at ?? new Date().toISOString(), attempts: job.attempts + 1, limit_hit: null, error: null, finished_at: null });
    bus.emit(job.id, 'status', { status: 'running', attempt: job.attempts + 1, resume: isResume });
    bus.emit(job.id, 'log', { text: isResume ? 'Resuming Claude Code…' : `Starting Claude Code for “${skill.name}”…` });
    bus.emit(job.id, 'permissions', { tools: skill.tools, allow: perms.allow.map((r) => r.replace(config.vault, '<vault>')), maxTurns: job.max_turns, maxMinutes: job.max_minutes });

    const startedAt = Date.now();
    const state = running.get(job.id);
    let turns = job.turns;
    const turnsAtStart = job.turns;
    const seenMessages = new Set();
    let result = null;
    let stderrTail = '';

    const child = spawn(config.claude.bin, args, { cwd: perms.cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    state.child = child;

    const kill = (reason) => {
      if (state.killReason) return;
      state.killReason = reason;
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000).unref();
    };
    state.kill = kill;
    const timer = setTimeout(() => kill('limit:time'), job.max_minutes * 60 * 1000);

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      handleMessage(msg);
    });
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-4000); });

    function rel(p) {
      if (typeof p !== 'string') return undefined;
      try { return guard.relativeToVault(path.resolve(perms.cwd, p)); } catch { return path.basename(p); }
    }

    function handleMessage(msg) {
      if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        q.update(job.id, { session_id: msg.session_id });
      } else if (msg.type === 'system' && msg.subtype === 'permission_denied') {
        bus.emit(job.id, 'denied', { tool: msg.tool_name, text: 'Blocked by permissions (not pre-approved for this skill).' });
      } else if (msg.type === 'assistant' && msg.message) {
        const mid = msg.message.id || msg.uuid;
        if (mid && !seenMessages.has(mid)) {
          seenMessages.add(mid);
          turns += 1;
          q.update(job.id, { turns });
          bus.emit(job.id, 'turn', { turns, maxTurns: job.max_turns });
          if (turns >= job.max_turns) kill('limit:turns');
        }
        for (const block of msg.message.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) {
            bus.emit(job.id, 'text', { text: block.text.trim().slice(0, 800) });
          } else if (block.type === 'tool_use') {
            const i = block.input ?? {};
            bus.emit(job.id, 'tool', { name: block.name, target: rel(i.file_path) ?? i.pattern ?? i.query ?? i.url ?? undefined });
          }
        }
      } else if (msg.type === 'result') {
        result = msg;
      }
    }

    await new Promise((resolve) => {
      child.on('error', (err) => {
        stderrTail += err.code === 'ENOENT'
          ? `Claude Code was not found (tried "${config.claude.bin}"). Run ./install.sh to check your setup.`
          : String(err.message);
        resolve();
      });
      child.on('close', resolve);
    });
    clearTimeout(timer);
    running.delete(job.id);

    const seconds = (Date.now() - startedAt) / 1000;
    const fresh = q.get.get(job.id);
    q.update(job.id, { run_seconds: (fresh.run_seconds || 0) + seconds });
    usage.recordClaudeRun({ jobId: job.id, turns: turns - turnsAtStart, seconds });

    const reason = state.killReason;
    if (reason === 'shutdown') {
      setStatus(job.id, 'interrupted', { error: 'The app was stopped while this job was running.' });
    } else if (reason === 'cancel') {
      setStatus(job.id, 'cancelled', { error: 'Cancelled by you.' });
    } else if (reason?.startsWith('limit:') || result?.subtype === 'error_max_turns') {
      const which = reason === 'limit:time' ? 'time' : 'turns';
      bus.emit(job.id, 'limit', {
        reason: which,
        text: which === 'time'
          ? `Paused: reached the ${job.max_minutes}-minute limit for this run. Continue or stop?`
          : `Paused: reached the ${job.max_turns}-turn limit. Continue or stop?`,
        turns,
        maxTurns: job.max_turns,
      });
      setStatus(job.id, 'paused_limit', { limit_hit: which });
    } else if (result && !result.is_error && result.subtype === 'success') {
      if (fs.existsSync(outputReal)) {
        setStatus(job.id, 'succeeded', { result_text: String(result.result ?? '').slice(0, 4000), output_path: outputReal });
      } else {
        setStatus(job.id, 'failed', { result_text: String(result.result ?? '').slice(0, 4000), error: `Claude finished but did not create ${ctx.outputRel}.` });
      }
    } else {
      const error = log.redact(String(result?.result || result?.subtype || stderrTail.trim() || `Claude Code exited with code ${child.exitCode}`)).slice(0, 2000);
      setStatus(job.id, 'failed', { error });
    }
    setImmediate(pump);
  }

  function continueJob(id, { extraTurns, extraMinutes } = {}) {
    const job = q.get.get(id);
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    if (job.status !== 'paused_limit') throw Object.assign(new Error('Only a paused job can be continued'), { status: 409 });
    if (!job.session_id) throw Object.assign(new Error('This job cannot be resumed (no session). Start a new run instead.'), { status: 409 });
    const turns = clampInt(extraTurns, 10, 1, 100);
    const minutes = clampInt(extraMinutes, 10, 1, 120);
    q.update(id, { status: 'queued', max_turns: Math.max(job.turns, job.max_turns) + turns, max_minutes: minutes, limit_hit: null, finished_at: null });
    bus.emit(id, 'status', { status: 'queued' });
    bus.emit(id, 'log', { text: `You approved +${turns} turns / ${minutes} minutes. Resuming…` });
    setImmediate(pump);
    return q.get.get(id);
  }

  function cancelJob(id) {
    const job = q.get.get(id);
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    const r = running.get(id);
    if (r?.kill) { r.kill('cancel'); return job; }
    if (TERMINAL.has(job.status)) throw Object.assign(new Error('Job already finished'), { status: 409 });
    return setStatus(id, 'cancelled', { error: 'Cancelled by you.' });
  }

  // After a restart: anything that was mid-run is marked interrupted; queued jobs start again.
  function recover() {
    const stuck = db.prepare("SELECT id FROM jobs WHERE status = 'running'").all();
    for (const { id } of stuck) setStatus(id, 'interrupted', { error: 'The app stopped while this job was running.' });
    setImmediate(pump);
  }

  // Used when the app shuts down: stop running jobs and wait (briefly) for them to be recorded.
  async function stopAll() {
    stopping = true;
    const waits = [...running.values()].map((r) => new Promise((resolve) => {
      if (!r.child || r.child.exitCode !== null) return resolve();
      r.child.once('close', () => setImmediate(resolve));
      r.kill?.('shutdown');
      setTimeout(resolve, 7000).unref();
    }));
    await Promise.all(waits);
    await new Promise((r) => setImmediate(r));
  }

  function publicJob(row) {
    if (!row) return null;
    const skill = getSkill(row.skill_id);
    const input = JSON.parse(row.input_json);
    const inputSummary = {};
    for (const [k, v] of Object.entries(input)) {
      inputSummary[k] = typeof v === 'string' && v.length > 160 ? `${v.length.toLocaleString()} characters` : v;
    }
    let outputRel = null;
    try { outputRel = row.output_path ? guard.relativeToVault(row.output_path) : null; } catch { /* ignore */ }
    return {
      id: row.id,
      skillId: row.skill_id,
      skillName: skill?.name ?? row.skill_id,
      status: row.status,
      source: row.source,
      automationRunId: row.automation_run_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      outputPath: outputRel,
      outputAbs: row.status === 'succeeded' ? row.output_path : null,
      resultText: row.result_text,
      error: row.error,
      turns: row.turns,
      maxTurns: row.max_turns,
      maxMinutes: row.max_minutes,
      runSeconds: Math.round(row.run_seconds || 0),
      limitHit: row.limit_hit,
      attempts: row.attempts,
      input: inputSummary,
      cost: { usd: null, label: 'Unknown — runs on your Claude subscription' },
    };
  }

  return {
    createJob,
    continueJob,
    cancelJob,
    recover,
    stopAll,
    get: (id) => q.get.get(id),
    list: (limit = 50) => q.list.all(Math.min(200, Math.max(1, limit))),
    publicJob,
    isBusy: () => running.size > 0,
  };
}

function clampInt(v, fallback, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}
