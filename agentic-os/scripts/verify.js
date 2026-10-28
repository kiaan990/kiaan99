// Checks the live connections without printing any secret. Run: npm run verify
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createMcpReader } from '../server/mcp/readonly-client.js';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
let runEnv = process.env;
const run = (cmd, args) => new Promise((r) => execFile(cmd, args, { timeout: 20000, env: runEnv }, (err, out, errOut) => r({ err, out: String(out), errOut: String(errOut) })));

let failed = false;
let config;
try {
  config = loadConfig();
  ok(`.env loaded (port ${config.port}, local token present)`);
} catch (e) {
  bad(e.message);
  process.exit(1);
}

if (config.claude.oauthToken) runEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: config.claude.oauthToken };
if (config.access.mode === 'cloud') ok(`Cloud mode: ${config.access.publicOrigin} for ${config.access.tailscaleUsers.join(', ')}`);

// Vault folders
for (const d of ['raw', 'wiki', 'outputs']) {
  if (fs.existsSync(path.join(config.vault, d))) ok(`vault ${d}/ exists`);
  else { bad(`vault ${d}/ is missing — run ./install.sh again`); failed = true; }
}

// Vault Git sync (cloud mode)
if (config.vaultGit.enabled) {
  const g = await run('git', ['-C', config.vault, 'ls-remote', '--heads', 'origin']);
  if (g.err) { bad(`Vault Git sync: can't reach the vault repo (${g.errOut.trim().split('\n')[0]}). Check the vault deploy key has write access.`); failed = true; }
  else ok('Vault Git sync: repo reachable');
}

// Claude Code
const v = await run(config.claude.bin, ['--version']);
if (v.err) { bad('Claude Code not found. Install it: https://docs.claude.com/en/docs/claude-code/setup'); failed = true; }
else {
  ok(`Claude Code ${v.out.trim()}`);
  const a = await run(config.claude.bin, ['auth', 'status', '--json']);
  let logged = null;
  try { logged = JSON.parse(a.out).loggedIn; } catch { /* older versions */ }
  if (logged === true) ok('Claude Code is logged in');
  else if (logged === false) { bad(config.claude.oauthToken ? 'Claude Code rejected CLAUDE_CODE_OAUTH_TOKEN. Run `claude setup-token` again and update .env.' : 'Claude Code is not logged in. Run: claude   then type /login'); failed = true; }
  else warn('Could not confirm the Claude login (older Claude Code?). Run `claude` once and make sure you are logged in.');
}

// OpenAI (optional)
if (!config.openai.apiKey) warn('OPENAI_API_KEY not set — voice and quick chat will show "not configured" (that is fine).');
else {
  try {
    const res = await fetch(`${config.openai.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${config.openai.apiKey}` }, signal: AbortSignal.timeout(15000) });
    if (res.ok) ok('OpenAI key works (voice + quick chat enabled)');
    else { bad(`OpenAI rejected the key (HTTP ${res.status}). Check OPENAI_API_KEY in .env.`); failed = true; }
  } catch (e) { warn(`Could not reach OpenAI: ${e.message}`); }
}

// Personal server (optional, read-only)
if (!config.mcp.url) warn('MCP_SERVER_URL not set — personal server connector is off (that is fine).');
else {
  const log = { redact: (s) => s, warn() {}, error() {}, info() {} };
  const r = createMcpReader({ config, log });
  const s = await r.status();
  if (s.connected) ok(`Personal server connected (read-only tools: ${s.tools.join(', ') || 'none matched'})`);
  else warn(`Personal server not reachable: ${s.error}. The app still works; it will show "not connected".`);
  await r.close();
}

process.exit(failed ? 1 : 0);
