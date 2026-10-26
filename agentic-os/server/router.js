// The request router. Edit the RULES below to change what goes where.
//
//   Tier 1 — local/deterministic: answered from SQLite or vault files. No model call.
//   Tier 2 — quick chat: a cheap, fast model through a configurable provider (OpenAI by default).
//            Disabled (with a clear message) when no provider/key is configured.
//   Tier 3 — real work: proposes an allowlisted skill job. Nothing runs until you press "Run".
//
// Rules are checked top to bottom: Tier 3 patterns first (they are specific), then Tier 1, then Tier 2.

export const RULES = {
  tier3: [
    { skillId: 'research-brief', pattern: /^(?:please\s+)?(?:research|look\s+into|investigate|(?:write|make|do)\s+(?:me\s+)?a\s+(?:research\s+)?brief\s+(?:on|about))\s+(.{3,200}?)[.?!]*$/i, input: (m) => ({ topic: m[1].trim() }) },
    { skillId: 'daily-plan', pattern: /\b(plan\s+my\s+day|daily\s+plan|morning\s+(?:plan|brief)\s+now|make\s+(?:me\s+)?a\s+plan\s+for\s+today)\b/i, input: () => ({}) },
    { skillId: 'weekly-review', pattern: /\b(weekly\s+review|review\s+(?:my|the|this)\s+week)\b/i, input: () => ({}) },
  ],
  tier1: [
    { id: 'last-brief', pattern: /\b(last|latest|today'?s?|morning)\b.*\bbrief\b|\bshow\b.*\bbrief\b/i },
    { id: 'job-status', pattern: /\b(jobs?|running|queue|status of)\b/i },
    { id: 'list-skills', pattern: /\b(skills?|what\s+can\s+you\s+do|help)\b/i },
    { id: 'usage', pattern: /\b(usage|cost|costs|spend|spent|bill)\b/i },
    { id: 'vault-stats', pattern: /\b(vault|how\s+many\s+notes|note\s+count)\b/i },
  ],
};

const TIER2_SYSTEM = [
  "You are the quick-chat voice of the user's personal Agentic OS, running on their Mac.",
  'Answer in at most 3 short sentences.',
  'You cannot see their files. For research, writing or organizing notes, tell them to use a skill',
  '(Research brief, Lecture notes, Daily plan, Weekly review) or to ask e.g. "research <topic>".',
].join(' ');

export function createRouter({ config, jobs, vault, usage, skills, log }) {
  async function tier1(id) {
    switch (id) {
      case 'last-brief': {
        const b = vault.latestBrief();
        return b ? { reply: `Your latest brief (${b.path}):\n\n${b.text}`, data: { path: b.path } } : { reply: 'No morning brief yet. It will appear after the 8:00 automation runs, or press “Daily plan”.' };
      }
      case 'job-status': {
        const rows = jobs.list(5).map(jobs.publicJob);
        if (!rows.length) return { reply: 'No jobs yet.' };
        return { reply: `Latest jobs:\n\n${rows.map((j) => `- **${j.skillName}** — ${j.status}${j.outputPath ? ` → \`${j.outputPath}\`` : ''}`).join('\n')}` };
      }
      case 'list-skills':
        return { reply: `Skills you can run:\n\n${skills.map((s) => `- **${s.name}** — ${s.description}`).join('\n')}\n\nTry “research <topic>”, “plan my day” or “weekly review”.` };
      case 'usage': {
        const s = usage.summary().today;
        return { reply: `Today: ${s.claude.runs} Claude run(s), ${s.claude.turns} turns, cost unknown (subscription). OpenAI: about $${s.openai.estUsd.toFixed(4)} (estimate), ${s.openai.requests} request(s).` };
      }
      case 'vault-stats': {
        const v = vault.stats();
        return { reply: `Vault: ${v.totalNotes} notes — raw ${v.roots.raw.notes}, wiki ${v.roots.wiki.notes}, outputs ${v.roots.outputs.notes}. ${v.addedThisWeek} changed this week.` };
      }
      default:
        return { reply: 'Not sure.' };
    }
  }

  async function tier2(message, history) {
    if (!config.tier2.enabled) {
      return {
        disabled: true,
        reply: 'Quick chat is not configured (no OpenAI key in .env). I can still show your last brief, job status, vault stats, list skills, or start a skill — e.g. “research <topic>”.',
      };
    }
    const messages = [{ role: 'system', content: TIER2_SYSTEM }, ...history.slice(-6), { role: 'user', content: message }];
    const res = await fetch(`${config.openai.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.tier2.model, messages, max_tokens: config.tier2.maxOutputTokens }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      log.warn(`tier2 request failed: HTTP ${res.status}`);
      return { reply: `Quick chat failed (OpenAI returned HTTP ${res.status}). Check your key and model in .env.`, error: true };
    }
    const data = await res.json();
    const u = data.usage ?? {};
    const rec = usage.recordOpenAI({ kind: 'tier2', model: config.tier2.model, usage: { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens } });
    return { reply: data.choices?.[0]?.message?.content?.trim() || '(empty reply)', usage: { estUsd: rec.est_usd, isEstimate: true } };
  }

  async function route(message, history = []) {
    const text = String(message ?? '').trim().slice(0, 4000);
    if (!text) return { tier: 1, reply: 'Say or type something.' };
    for (const r of RULES.tier3) {
      const m = text.match(r.pattern);
      if (m) {
        const skill = skills.find((s) => s.id === r.skillId);
        const input = r.input(m);
        return {
          tier: 3,
          reply: `That’s real work for Claude Code. Run “${skill?.name ?? r.skillId}”${input.topic ? ` on “${input.topic}”` : ''}?`,
          proposal: { skillId: r.skillId, input },
        };
      }
    }
    for (const r of RULES.tier1) if (r.pattern.test(text)) return { tier: 1, rule: r.id, ...(await tier1(r.id)) };
    const cleanHistory = (Array.isArray(history) ? history : [])
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
      .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }));
    return { tier: 2, ...(await tier2(text, cleanHistory)) };
  }

  return { route };
}
