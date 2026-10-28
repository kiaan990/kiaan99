// Read-only views over the vault: quick stats, recent files, latest brief.
// Walks only raw/, wiki/, outputs/, never follows symlinks, skips dot-folders.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT_ROOTS } from './paths.js';

export function createVaultReader({ guard }) {
  function walk(rootName, { maxFiles = 5000 } = {}) {
    let root;
    try { root = guard.rootReal(rootName); } catch { return { exists: false, files: [] }; }
    const files = [];
    const stack = [root];
    while (stack.length && files.length < maxFiles) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue; // never follow symlinks
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) {
          try {
            const st = fs.statSync(full);
            files.push({ path: full, rel: guard.relativeToVault(full), mtime: st.mtimeMs, size: st.size });
          } catch { /* vanished */ }
        }
      }
    }
    return { exists: true, files };
  }

  let cache = null;
  function stats() {
    if (cache && Date.now() - cache.at < 15000) return cache.value;
    const value = { roots: {}, totalNotes: 0, recent: [] };
    let all = [];
    for (const name of VAULT_ROOTS) {
      const { exists, files } = walk(name);
      const notes = files.filter((f) => f.rel.endsWith('.md'));
      value.roots[name] = { exists, notes: notes.length, files: files.length };
      value.totalNotes += notes.length;
      all = all.concat(notes);
    }
    const weekAgo = Date.now() - 7 * 86400 * 1000;
    value.addedThisWeek = all.filter((f) => f.mtime >= weekAgo).length;
    value.recent = all.sort((a, b) => b.mtime - a.mtime).slice(0, 6).map((f) => ({ path: f.rel, modified: new Date(f.mtime).toISOString() }));
    cache = { at: Date.now(), value };
    return value;
  }

  function recentFiles(days = 7, limit = 150) {
    const since = Date.now() - days * 86400 * 1000;
    const out = [];
    for (const name of VAULT_ROOTS) for (const f of walk(name).files) if (f.mtime >= since && f.rel.endsWith('.md')) out.push(f);
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  }

  function latestBrief() {
    const { files } = walk('outputs');
    const briefs = files.filter((f) => /^outputs\/briefs\/.+\.md$/.test(f.rel.split(path.sep).join('/'))).sort((a, b) => b.mtime - a.mtime);
    if (!briefs.length) return null;
    const { text, mtime, path: real } = guard.readText(briefs[0].path, { roots: ['outputs'] });
    return { path: briefs[0].rel, absPath: real, modified: mtime, text };
  }

  return { stats, recentFiles, latestBrief, invalidate: () => { cache = null; } };
}
