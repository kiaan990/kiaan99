// SQLite storage for jobs, job events, automation runs, settings and usage.
// The vault is NOT stored here: it stays plain markdown on disk.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  automation_run_id INTEGER,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  output_path TEXT,
  result_text TEXT,
  error TEXT,
  session_id TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL,
  max_minutes INTEGER NOT NULL,
  run_seconds REAL NOT NULL DEFAULT 0,
  limit_hit TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id);
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  job_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  output_path TEXT,
  UNIQUE(automation_id, scheduled_for)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  audio_input_tokens INTEGER NOT NULL DEFAULT 0,
  audio_output_tokens INTEGER NOT NULL DEFAULT 0,
  seconds REAL NOT NULL DEFAULT 0,
  est_usd REAL,
  job_id TEXT,
  turns INTEGER
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'agentic-os.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.getSetting = (key) => getSetting.get(key)?.value ?? null;
  db.setSetting = (key, value) => setSetting.run(key, String(value));
  return db;
}
