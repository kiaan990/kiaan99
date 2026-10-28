#!/usr/bin/env node
// A stand-in for the `claude` CLI used ONLY by the automated tests (no subscription use).
// It prints Claude Code's stream-json format and writes the job's output file.
//   FAKE_CLAUDE_MODE=success (default) | loop (keeps taking turns) | fail
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('0.0.0 (Fake Claude for tests)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
if (process.env.FAKE_CLAUDE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify({ args, cwd: process.cwd() }));

const prompt = args[args.indexOf('-p') + 1] ?? '';
const maxTurns = Number(args[args.indexOf('--max-turns') + 1] || 50);
const resume = args.includes('--resume');
const mode = resume ? 'success' : (process.env.FAKE_CLAUDE_MODE || 'success');
const m = prompt.match(/must exist at:?\s+(\S+?\.md)/i);
const vault = path.resolve(process.cwd(), '..');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

out({ type: 'system', subtype: 'init', session_id: 'fake-session-1', cwd: process.cwd() });
let turn = 0;
const assistant = (content) => { turn += 1; out({ type: 'assistant', message: { id: `msg_${turn}`, content } }); };

if (mode === 'fail') {
  assistant([{ type: 'text', text: 'Something went wrong.' }]);
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Simulated failure' });
  process.exit(1);
}

if (mode === 'loop') {
  while (turn < maxTurns) {
    assistant([{ type: 'tool_use', name: 'WebSearch', input: { query: `search ${turn}` } }]);
    await sleep(40);
  }
  out({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: turn });
  process.exit(0);
}

assistant([{ type: 'text', text: 'Reading the vault and gathering sources.' }, { type: 'tool_use', name: 'Glob', input: { pattern: 'wiki/**/*.md' } }]);
await sleep(60);
if (m) {
  const target = path.resolve(vault, m[1]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `# Test output\n\nWritten by the fake Claude for: ${m[1]}\n`);
  assistant([{ type: 'tool_use', name: 'Write', input: { file_path: target, content: '...' } }]);
}
await sleep(60);
assistant([{ type: 'text', text: 'Done. The brief is saved.' }]);
out({ type: 'result', subtype: 'success', is_error: false, result: 'Wrote the file. Two-sentence summary here.', num_turns: turn, session_id: 'fake-session-1' });
