// Prints whether a KEY in .env is set ("set" / "empty"), or its value for non-secret keys.
// Usage: node scripts/get-env.js KEY [--value]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, '.env');
const env = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
const key = process.argv[2];
const SECRET = /TOKEN|KEY|SECRET/;
const v = (env[key] || '').trim();
if (process.argv[3] === '--value') {
  if (SECRET.test(key)) { console.error('refusing to print a secret'); process.exit(2); }
  process.stdout.write(v);
} else {
  process.stdout.write(v ? 'set' : 'empty');
}
