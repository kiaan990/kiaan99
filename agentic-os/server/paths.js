// Application-level filesystem guard.
// Every path the backend reads or writes is resolved to its canonical (real) absolute path
// and must stay inside an allowed root. Symlinks that resolve outside are rejected.
// Anything that fails a check throws PathDeniedError: nothing is read or written (fail closed).
import fs from 'node:fs';
import path from 'node:path';

export class PathDeniedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PATH_DENIED';
    this.status = 403;
  }
}

export const VAULT_ROOTS = ['raw', 'wiki', 'outputs'];

export function createPathGuard({ projectRoot, vault }) {
  const declared = {
    project: projectRoot,
    raw: path.join(vault, 'raw'),
    wiki: path.join(vault, 'wiki'),
    outputs: path.join(vault, 'outputs'),
  };

  // Real paths of the roots, computed lazily so newly created vault folders are picked up.
  function rootReal(name) {
    const p = declared[name];
    if (!p) throw new PathDeniedError(`Unknown root: ${name}`);
    try {
      return fs.realpathSync(p);
    } catch {
      throw new PathDeniedError(`Allowed folder is missing: ${name}/`);
    }
  }

  // Canonical path of p, even if p (or some parent folders) does not exist yet:
  // resolve the deepest existing ancestor with realpath, then append the rest.
  function canonical(p) {
    let cur = path.resolve(p);
    const rest = [];
    for (;;) {
      try {
        const real = fs.realpathSync(cur);
        return rest.length ? path.join(real, ...rest.reverse()) : real;
      } catch (err) {
        if (err.code !== 'ENOENT') throw new PathDeniedError(`Cannot resolve path (${err.code})`);
        // A dangling symlink is not "missing": refuse it rather than write through it.
        try {
          if (fs.lstatSync(cur).isSymbolicLink()) throw new PathDeniedError('Path is a broken symlink');
        } catch (e) {
          if (e instanceof PathDeniedError) throw e;
        }
        const parent = path.dirname(cur);
        if (parent === cur) throw new PathDeniedError('Cannot resolve path');
        rest.push(path.basename(cur));
        cur = parent;
      }
    }
  }

  function isInside(child, root) {
    return child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  }

  // p: absolute, or relative to the vault (e.g. "outputs/briefs/x.md").
  // roots: which allowed roots this operation may touch.
  function resolve(p, roots = VAULT_ROOTS) {
    if (typeof p !== 'string' || !p.trim() || p.includes('\0') || p.length > 4096) {
      throw new PathDeniedError('Invalid path');
    }
    const abs = path.isAbsolute(p) ? p : path.join(vault, p);
    const real = canonical(abs);
    for (const name of roots) {
      let root;
      try { root = rootReal(name); } catch { continue; }
      if (isInside(real, root)) return real;
    }
    throw new PathDeniedError('Path is outside the allowed folders');
  }

  function readText(p, { roots = VAULT_ROOTS, maxBytes = 2 * 1024 * 1024 } = {}) {
    const real = resolve(p, roots);
    const st = fs.statSync(real, { throwIfNoEntry: false });
    if (!st || !st.isFile()) throw Object.assign(new Error('File not found'), { status: 404 });
    if (st.size > maxBytes) throw Object.assign(new Error('File is too large to show'), { status: 413 });
    return { path: real, text: fs.readFileSync(real, 'utf8'), mtime: st.mtime.toISOString() };
  }

  // Additive-only write: creates a NEW file. Never overwrites ('wx' fails if it exists).
  function writeNew(p, content, { roots = VAULT_ROOTS } = {}) {
    const real = resolve(p, roots);
    const dir = path.dirname(real);
    fs.mkdirSync(dir, { recursive: true });
    // Re-check after creating folders, in case a folder was swapped for a symlink.
    if (resolve(dir, roots) !== dir) throw new PathDeniedError('Folder changed while writing');
    fs.writeFileSync(real, content, { flag: 'wx', encoding: 'utf8' });
    return real;
  }

  // Pick a path that does not exist yet: name.md, name-2.md, name-3.md ...
  function uniquePath(p, roots = VAULT_ROOTS) {
    const real = resolve(p, roots);
    const ext = path.extname(real);
    const base = real.slice(0, real.length - ext.length);
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 ? real : `${base}-${i}${ext}`;
      if (!fs.existsSync(candidate)) return resolve(candidate, roots);
    }
    throw new Error('Could not find a free file name');
  }

  function relativeToVault(real) {
    const v = canonical(vault);
    return isInside(real, v) ? path.relative(v, real) : real;
  }

  return { resolve, readText, writeNew, uniquePath, relativeToVault, canonical, rootReal };
}
