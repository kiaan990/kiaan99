// Sets one KEY in .env without printing its value. The value is read from stdin
// (so secrets never appear in the process list or terminal history).
// Usage: printf '%s' "$VALUE" | node scripts/set-env.js KEY
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, '.env');
const key = process.argv[2];
if (!/^[A-Z][A-Z0-9_]*$/.test(key || '')) { console.error('usage: set-env.js KEY  (value on stdin)'); process.exit(2); }

const value = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (/[\r\n"]/.test(value)) { console.error(`${key}: value cannot contain quotes or line breaks`); process.exit(2); }

const line = `${key}="${value.replace(/\\/g, '\\\\')}"`;
let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const re = new RegExp(`^${key}=.*$`, 'm');
text = re.test(text) ? text.replace(re, () => line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
fs.writeFileSync(file, text, { mode: 0o600 });
fs.chmodSync(file, 0o600);
