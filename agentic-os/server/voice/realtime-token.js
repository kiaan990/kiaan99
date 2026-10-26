// Voice: mints a short-lived OpenAI Realtime client secret for the browser.
// OPENAI_API_KEY stays on the server. The browser only ever sees the ephemeral key (valid ~10 minutes)
// and uses it to open a WebRTC call directly with OpenAI.

export const VOICE_INSTRUCTIONS = [
  "You are the voice of the user's personal Agentic OS. Speak naturally and keep every answer to one or two short sentences.",
  'For anything about their briefs, jobs, notes, skills or usage, call the ask_os tool with their request and summarize its reply in one sentence.',
  'If ask_os says the full answer was posted to the chat panel, just say that it is in the chat.',
  'Never read long lists or documents aloud.',
].join(' ');

export function createVoice({ config, log }) {
  async function createSession() {
    if (!config.voice.enabled) {
      throw Object.assign(new Error('Voice is not configured: add OPENAI_API_KEY to .env and restart.'), { status: 503, code: 'not_configured' });
    }
    const body = {
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: {
        type: 'realtime',
        model: config.openai.realtimeModel,
        instructions: VOICE_INSTRUCTIONS,
        audio: { output: { voice: config.openai.realtimeVoice } },
        tools: [
          {
            type: 'function',
            name: 'ask_os',
            description: "Ask the user's Agentic OS (briefs, jobs, skills, vault stats, usage, or starting a skill).",
            parameters: { type: 'object', properties: { request: { type: 'string', description: "The user's request in plain words" } }, required: ['request'] },
          },
        ],
        tool_choice: 'auto',
      },
    };
    const res = await fetch(`${config.openai.baseUrl}/v1/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const detail = log.redact((await res.text().catch(() => '')).slice(0, 300));
      log.warn(`voice session failed: HTTP ${res.status} ${detail}`);
      throw Object.assign(new Error(`OpenAI refused the voice session (HTTP ${res.status}). Check your key, billing and OPENAI_REALTIME_MODEL.`), { status: 502 });
    }
    const data = await res.json();
    const secret = data.value ?? data.client_secret?.value;
    if (!secret) throw Object.assign(new Error('OpenAI returned no client secret'), { status: 502 });
    return {
      clientSecret: secret,
      expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? null,
      model: config.openai.realtimeModel,
      callsUrl: `${config.openai.baseUrl}/v1/realtime/calls`,
      idleSeconds: config.voice.idleSeconds,
      maxMinutes: config.voice.maxMinutes,
    };
  }

  return { createSession };
}
