// Usage tracking.
//  - OpenAI (metered): token counts from the API + a dollar ESTIMATE from pricing.config.json.
//  - Claude Code runs: go through your Claude login/subscription. There is no dollar meter, so
//    cost is recorded as unknown (null). We track runs, turns and minutes instead.
import fs from 'node:fs';

export function createUsage({ db, config, log }) {
  const insert = db.prepare(`INSERT INTO usage (ts, provider, kind, model, input_tokens, output_tokens, audio_input_tokens, audio_output_tokens, seconds, est_usd, job_id, turns)
    VALUES (@ts, @provider, @kind, @model, @input_tokens, @output_tokens, @audio_input_tokens, @audio_output_tokens, @seconds, @est_usd, @job_id, @turns)`);

  function pricing() {
    try {
      return JSON.parse(fs.readFileSync(config.pricingFile, 'utf8')).models ?? {};
    } catch (e) {
      log?.warn('pricing.config.json unreadable; OpenAI estimates unavailable');
      return {};
    }
  }

  // Returns an estimate in USD, or null when no price is configured for the model.
  function estimate(model, u) {
    const p = pricing()[model];
    if (!p) return null;
    const M = 1_000_000;
    if (p.audioInput !== undefined) {
      const textIn = Math.max(0, (u.input_tokens || 0) - (u.audio_input_tokens || 0) - (u.cached_tokens || 0));
      const textOut = Math.max(0, (u.output_tokens || 0) - (u.audio_output_tokens || 0));
      return ((textIn * (p.textInput || 0)) + ((u.cached_tokens || 0) * (p.cachedInput || 0)) + ((u.audio_input_tokens || 0) * p.audioInput)
        + (textOut * (p.textOutput || 0)) + ((u.audio_output_tokens || 0) * (p.audioOutput || 0))) / M;
    }
    return (((u.input_tokens || 0) * (p.input || 0)) + ((u.output_tokens || 0) * (p.output || 0))) / M;
  }

  function recordOpenAI({ kind, model, usage = {}, seconds = 0 }) {
    const row = {
      ts: new Date().toISOString(),
      provider: 'openai',
      kind,
      model,
      input_tokens: n(usage.input_tokens),
      output_tokens: n(usage.output_tokens),
      audio_input_tokens: n(usage.audio_input_tokens),
      audio_output_tokens: n(usage.audio_output_tokens),
      seconds: Math.max(0, Math.min(86400, Number(seconds) || 0)),
      est_usd: null,
      job_id: null,
      turns: null,
    };
    row.est_usd = row.input_tokens || row.output_tokens ? estimate(model, { ...row, cached_tokens: n(usage.cached_tokens) }) : 0;
    insert.run(row);
    return row;
  }

  function recordClaudeRun({ jobId, turns, seconds }) {
    insert.run({
      ts: new Date().toISOString(), provider: 'claude', kind: 'job', model: config.claude.model || 'default',
      input_tokens: 0, output_tokens: 0, audio_input_tokens: 0, audio_output_tokens: 0,
      seconds, est_usd: null, job_id: jobId, turns,
    });
  }

  function period(sinceIso) {
    const openai = db.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens,
        COALESCE(SUM(CASE WHEN kind='voice' THEN seconds ELSE 0 END),0) AS voiceSeconds, COALESCE(SUM(est_usd),0) AS estUsd,
        COALESCE(SUM(CASE WHEN est_usd IS NULL THEN 1 ELSE 0 END),0) AS unpriced
      FROM usage WHERE provider='openai' AND ts >= ?`).get(sinceIso);
    const claude = db.prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(turns),0) AS turns, COALESCE(SUM(seconds),0) AS seconds
      FROM usage WHERE provider='claude' AND ts >= ?`).get(sinceIso);
    return {
      openai: { ...openai, estUsd: Math.round(openai.estUsd * 10000) / 10000, isEstimate: true },
      claude: { ...claude, seconds: Math.round(claude.seconds), usd: null, label: 'Unknown — Claude subscription (no dollar meter)' },
    };
  }

  function summary() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const thirty = new Date(Date.now() - 30 * 86400 * 1000);
    const recent = db.prepare('SELECT ts, provider, kind, model, input_tokens, output_tokens, seconds, est_usd, job_id, turns FROM usage ORDER BY id DESC LIMIT 15').all();
    return {
      today: period(startOfDay.toISOString()),
      last30Days: period(thirty.toISOString()),
      recent,
      notes: {
        openai: 'Estimates from pricing.config.json. Your real bill is on platform.openai.com.',
        claude: 'Claude Code runs use your Claude login. The app shows no dollar amount for them; it enforces turn and time limits per run instead.',
      },
    };
  }

  return { recordOpenAI, recordClaudeRun, summary, estimate };
}

function n(v) {
  const x = Number.parseInt(v, 10);
  return Number.isFinite(x) && x > 0 ? Math.min(x, 50_000_000) : 0;
}
