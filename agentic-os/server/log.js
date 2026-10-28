// Tiny logger: console + logs/server.log, with secrets redacted.
import fs from 'node:fs';
import path from 'node:path';

export function createLogger(config) {
  fs.mkdirSync(config.logsDir, { recursive: true });
  const file = path.join(config.logsDir, 'server.log');
  const redact = (s) => {
    let out = String(s);
    for (const secret of config.secrets) out = out.split(secret).join('[redacted]');
    return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|ek_[A-Za-z0-9_-]{8,})/g, '[redacted]');
  };
  const write = (level, args) => {
    const line = `${new Date().toISOString()} ${level} ${redact(args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '))}`;
    if (!config.quiet) (level === 'ERROR' ? console.error : console.log)(line);
    try { fs.appendFileSync(file, line + '\n'); } catch { /* logging must never crash the app */ }
  };
  return {
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
    redact,
  };
}
