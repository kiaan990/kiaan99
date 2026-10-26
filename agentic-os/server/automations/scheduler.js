// Automations: node-cron fires jobs on schedule, driven by automations.config.json.
//
// Sleep semantics: a sleeping (or switched-off) Mac cannot fire scheduled jobs. So on every app
// start, and every few minutes while running (to catch wake-from-sleep), we look for scheduled
// times that passed without a run. Each automation's runOnCatchUp decides what happens:
//   "ask"  -> recorded as missed; the dashboard asks you Run now / Skip
//   true   -> run it now automatically
//   false  -> recorded as skipped
// Only misses inside catchUpWindowHours, and after the app was first installed, count.
import fs from 'node:fs';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { getSkill, validateInput } from '../jobs/registry.js';

const GRACE_MS = 3 * 60 * 1000; // a run this recent is still node-cron's to fire
const CHECK_EVERY_MS = 5 * 60 * 1000;

const AutomationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/, 'id must be lowercase-kebab'),
  name: z.string().min(1).max(80),
  schedule: z.string().min(9).max(100),
  skillId: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
  runOnCatchUp: z.union([z.literal('ask'), z.boolean()]).default('ask'),
  catchUpWindowHours: z.number().min(0).max(24 * 14).default(16),
});
const FileSchema = z.object({
  timezone: z.string().default('local'),
  automations: z.array(AutomationSchema).max(50),
}).passthrough();

export function createScheduler({ db, config, jobs, log, now = () => new Date() }) {
  let current = { timezone: 'local', automations: [] };
  let loadError = null;
  let tasks = [];
  let interval = null;
  let watcher = null;

  if (!db.getSetting('first_started_at')) db.setSetting('first_started_at', now().toISOString());

  const q = {
    insertRun: db.prepare(`INSERT OR IGNORE INTO automation_runs (automation_id, scheduled_for, trigger, status, created_at)
                           VALUES (?, ?, ?, ?, ?)`),
    getRunByKey: db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? AND scheduled_for = ?'),
    getRun: db.prepare('SELECT * FROM automation_runs WHERE id = ?'),
    setRun: db.prepare('UPDATE automation_runs SET status = ?, job_id = COALESCE(?, job_id), finished_at = ?, output_path = COALESCE(?, output_path), trigger = COALESCE(?, trigger) WHERE id = ?'),
    listRuns: db.prepare('SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?'),
    pending: db.prepare("SELECT * FROM automation_runs WHERE status = 'missed_pending' ORDER BY scheduled_for"),
    lastRun: db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_for DESC LIMIT 1'),
  };

  const tzOpt = () => (current.timezone && current.timezone !== 'local' ? current.timezone : undefined);

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(config.automationsFile, 'utf8'));
      const parsed = FileSchema.parse(raw);
      const seen = new Set();
      for (const a of parsed.automations) {
        if (seen.has(a.id)) throw new Error(`Duplicate automation id: ${a.id}`);
        seen.add(a.id);
        if (!cron.validate(a.schedule)) throw new Error(`Invalid schedule for ${a.id}: "${a.schedule}"`);
        const skill = getSkill(a.skillId);
        if (!skill) throw new Error(`Automation ${a.id} uses unknown skill "${a.skillId}" (not in the registry)`);
        a.input = validateInput(skill, a.input);
      }
      current = parsed;
      loadError = null;
      return true;
    } catch (err) {
      loadError = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err.message || err);
      log.error(`automations.config.json not loaded: ${loadError}`);
      return false;
    }
  }

  function minuteIso(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    return x.toISOString();
  }

  function fire(a, scheduledFor, trigger) {
    const key = minuteIso(scheduledFor);
    const info = q.insertRun.run(a.id, key, trigger, 'running', now().toISOString());
    let run = q.getRunByKey.get(a.id, key);
    if (info.changes === 0) {
      // Already recorded. Only a pending "missed" decision may be turned into a run.
      if (run.status !== 'missed_pending') return run;
      q.setRun.run('running', null, null, null, trigger, run.id);
    }
    try {
      const job = jobs.createJob(a.skillId, a.input, { source: 'automation', automationRunId: run.id });
      q.setRun.run('running', job.id, null, null, null, run.id);
      log.info(`automation ${a.id} started job ${job.id} (${trigger})`);
    } catch (err) {
      q.setRun.run('failed', null, now().toISOString(), null, null, run.id);
      log.error(`automation ${a.id} could not start: ${err.message}`);
    }
    return q.getRun.get(run.id);
  }

  function prevScheduled(a, at) {
    const it = CronExpressionParser.parse(a.schedule, { currentDate: at, tz: tzOpt() });
    return it.prev().toDate();
  }

  function nextScheduled(a) {
    try {
      return CronExpressionParser.parse(a.schedule, { currentDate: now(), tz: tzOpt() }).next().toDate().toISOString();
    } catch { return null; }
  }

  // Finds missed runs. Returns the list of what it found and did.
  function checkMissed() {
    const found = [];
    const firstStarted = new Date(db.getSetting('first_started_at'));
    const t = now();
    for (const a of current.automations) {
      if (!a.enabled) continue;
      let prev;
      try { prev = prevScheduled(a, new Date(t.getTime() - GRACE_MS)); } catch { continue; }
      if (prev < firstStarted) continue;
      if (t - prev > a.catchUpWindowHours * 3600 * 1000) continue;
      const key = minuteIso(prev);
      if (q.getRunByKey.get(a.id, key)) continue;
      if (a.runOnCatchUp === true) {
        found.push({ automation: a.id, scheduledFor: key, action: 'ran' });
        fire(a, prev, 'catch-up');
      } else if (a.runOnCatchUp === false) {
        q.insertRun.run(a.id, key, 'catch-up', 'skipped', t.toISOString());
        found.push({ automation: a.id, scheduledFor: key, action: 'skipped' });
      } else {
        q.insertRun.run(a.id, key, 'catch-up', 'missed_pending', t.toISOString());
        found.push({ automation: a.id, scheduledFor: key, action: 'asked' });
      }
      log.info(`missed run detected: ${a.id} at ${key}`);
    }
    return found;
  }

  function schedule() {
    for (const t of tasks) t.stop();
    tasks = [];
    for (const a of current.automations) {
      if (!a.enabled) continue;
      const task = cron.schedule(a.schedule, () => {
        const scheduled = new Date();
        scheduled.setSeconds(0, 0);
        fire(a, scheduled, 'schedule');
      }, { timezone: tzOpt(), name: `automation-${a.id}` });
      tasks.push(task);
    }
  }

  function start({ watch = true } = {}) {
    load();
    schedule();
    const found = checkMissed();
    interval = setInterval(() => { try { checkMissed(); } catch (e) { log.error('missed-run check failed', e); } }, CHECK_EVERY_MS);
    interval.unref();
    if (watch) {
      let debounce = null;
      fs.watchFile(config.automationsFile, { interval: 2000 }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (load()) { schedule(); log.info('automations.config.json reloaded'); }
        }, 500);
      });
      watcher = true;
    }
    return found;
  }

  function stop() {
    for (const t of tasks) t.stop();
    tasks = [];
    clearInterval(interval);
    if (watcher) fs.unwatchFile(config.automationsFile);
  }

  // Called by the job runner when a job reaches an end state (or pauses at a limit).
  function onJobSettled(job) {
    if (!job.automation_run_id) return;
    const status = job.status === 'succeeded' ? 'succeeded' : job.status === 'paused_limit' ? 'paused' : 'failed';
    q.setRun.run(status, job.id, status === 'paused' ? null : now().toISOString(), job.status === 'succeeded' ? job.output_path : null, null, job.automation_run_id);
  }

  function decide(runId, action) {
    const run = q.getRun.get(runId);
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
    if (run.status !== 'missed_pending') throw Object.assign(new Error('This run is not waiting for a decision'), { status: 409 });
    if (action === 'skip') {
      q.setRun.run('skipped', null, now().toISOString(), null, null, run.id);
      return q.getRun.get(run.id);
    }
    if (action !== 'run') throw Object.assign(new Error('action must be "run" or "skip"'), { status: 400 });
    const a = current.automations.find((x) => x.id === run.automation_id);
    if (!a) throw Object.assign(new Error('That automation no longer exists in automations.config.json'), { status: 409 });
    return fire(a, new Date(run.scheduled_for), 'catch-up');
  }

  function runNow(id) {
    const a = current.automations.find((x) => x.id === id);
    if (!a) throw Object.assign(new Error('Unknown automation'), { status: 404 });
    return fire(a, now(), 'manual');
  }

  function overview() {
    return {
      loadError,
      timezone: current.timezone,
      automations: current.automations.map((a) => ({
        id: a.id, name: a.name, schedule: a.schedule, skillId: a.skillId, enabled: a.enabled,
        runOnCatchUp: a.runOnCatchUp, nextRun: a.enabled ? nextScheduled(a) : null, lastRun: q.lastRun.get(a.id) ?? null,
      })),
      pending: q.pending.all(),
    };
  }

  return { start, stop, load, checkMissed, onJobSettled, decide, runNow, overview, listRuns: (n = 50) => q.listRuns.all(Math.min(200, n)) };
}
