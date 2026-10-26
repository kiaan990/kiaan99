// Loads settings from .env (project root). Everything secret stays server-side.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(v, fallback, min, max) {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export class ConfigError extends Error {}

// env: a plain object (defaults to .env merged over process.env). Tests pass their own.
export function loadConfig(env) {
  if (!env) {
    const file = path.join(PROJECT_ROOT, '.env');
    const fromFile = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
    env = { ...process.env, ...fromFile };
  }
  const projectRoot = env.AGENTIC_OS_PROJECT_ROOT || PROJECT_ROOT;
  const token = (env.LOCAL_TOKEN || '').trim();
  if (token.length < 32) {
    throw new ConfigError('LOCAL_TOKEN is missing or too short in .env. Run ./install.sh to generate it.');
  }
  const vault = (env.VAULT_PATH || '').trim();
  if (!vault) throw new ConfigError('VAULT_PATH is not set in .env. Run ./install.sh to pick your vault.');
  if (!path.isAbsolute(vault)) throw new ConfigError('VAULT_PATH must be an absolute path.');
  if (!fs.existsSync(vault)) throw new ConfigError(`VAULT_PATH does not exist: ${vault}`);

  const openaiKey = (env.OPENAI_API_KEY || '').trim();

  // Cloud mode (e.g. your own server behind Tailscale). The app still listens on 127.0.0.1 only;
  // Tailscale Serve publishes it to your private tailnet over HTTPS.
  const publicOrigin = (env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '') || null;
  if (publicOrigin && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(publicOrigin)) {
    throw new ConfigError('PUBLIC_ORIGIN must look like https://your-server.your-tailnet.ts.net:8443');
  }
  const tailscaleUsers = (env.TAILSCALE_ALLOWED_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (publicOrigin && tailscaleUsers.length === 0) {
    // Fail closed: never publish the app beyond this machine without an identity check.
    throw new ConfigError('PUBLIC_ORIGIN is set but TAILSCALE_ALLOWED_USERS is empty. Add your Tailscale login email(s) to .env.');
  }
  const oauthToken = (env.CLAUDE_CODE_OAUTH_TOKEN || '').trim();
  const tier2Provider = (env.TIER2_PROVIDER || 'openai').trim().toLowerCase();

  return {
    projectRoot,
    host: '127.0.0.1', // fixed on purpose: never listen on the network
    port: int(env.PORT, 4777, 0, 65535),
    token,
    vault: path.resolve(vault),
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(projectRoot, 'data'),
    logsDir: env.LOGS_DIR ? path.resolve(env.LOGS_DIR) : path.join(projectRoot, 'logs'),
    automationsFile: env.AUTOMATIONS_FILE ? path.resolve(env.AUTOMATIONS_FILE) : path.join(projectRoot, 'automations.config.json'),
    pricingFile: path.join(projectRoot, 'pricing.config.json'),
    access: {
      mode: publicOrigin ? 'cloud' : 'local',
      publicOrigin,
      tailscaleUsers,
    },
    vaultGit: {
      enabled: env.VAULT_GIT_SYNC === 'true',
      pullEveryMinutes: int(env.VAULT_GIT_PULL_MINUTES, 5, 1, 120),
    },
    claude: {
      bin: (env.CLAUDE_BIN || 'claude').trim(),
      oauthToken: oauthToken || null,
      maxTurns: int(env.CLAUDE_MAX_TURNS, 40, 1, 500),
      maxMinutes: int(env.CLAUDE_MAX_MINUTES, 20, 1, 240),
      model: (env.CLAUDE_MODEL || '').trim() || null,
      allowApiKey: env.CLAUDE_ALLOW_API_KEY === 'true',
    },
    openai: {
      apiKey: openaiKey || null,
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, ''),
      realtimeModel: (env.OPENAI_REALTIME_MODEL || 'gpt-realtime').trim(),
      realtimeVoice: (env.OPENAI_REALTIME_VOICE || 'marin').trim(),
    },
    tier2: {
      enabled: tier2Provider === 'openai' && !!openaiKey,
      provider: tier2Provider,
      model: (env.TIER2_MODEL || 'gpt-4o-mini').trim(),
      maxOutputTokens: int(env.TIER2_MAX_TOKENS, 300, 16, 2000),
    },
    voice: {
      enabled: !!openaiKey,
      idleSeconds: int(env.VOICE_IDLE_SECONDS, 60, 10, 900),
      maxMinutes: int(env.VOICE_MAX_MINUTES, 15, 1, 120),
    },
    mcp: {
      url: (env.MCP_SERVER_URL || '').trim() || null,
      authToken: (env.MCP_AUTH_TOKEN || '').trim() || null,
      readTools: (env.MCP_READ_TOOLS || '').split(',').map((s) => s.trim()).filter(Boolean),
    },
    // Secrets the app must never print or pass to child processes.
    secrets: [token, openaiKey, oauthToken, (env.MCP_AUTH_TOKEN || '').trim()].filter((s) => s && s.length >= 8),
  };
}
