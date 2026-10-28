// Optional (cloud mode): keeps the server's copy of the vault in sync with a private Git repo.
//   - pulls before every job and every few minutes
//   - after a job finishes, commits ONLY raw/, wiki/ and outputs/ and pushes
// Your Mac syncs the same repo with the Obsidian Git plugin.
// Git runs with prompts disabled; if anything fails, the error is shown in the dashboard and
// the job result stays safely on the server until the next successful sync.
import { execFile } from 'node:child_process';

const SYNC_PATHS = ['raw', 'wiki', 'outputs'];

export function createVaultSync({ config, log }) {
  const enabled = !!config.vaultGit?.enabled;
  const state = { enabled, lastPull: null, lastPush: null, error: null };
  let chain = Promise.resolve();
  let timer = null;

  function git(args) {
    return new Promise((resolve, reject) => {
      execFile('git', ['-c', 'user.name=Agentic OS', '-c', 'user.email=agentic-os@localhost', ...args], {
        cwd: config.vault,
        timeout: 90_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(log.redact(String(stderr || err.message)).trim().slice(0, 300)), { code: err.code }));
        else resolve(String(stdout));
      });
    });
  }

  // Run one git operation at a time.
  const serial = (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };

  function pull() {
    if (!enabled) return Promise.resolve();
    return serial(async () => {
      try {
        await git(['pull', '--rebase', '--autostash', '--quiet']);
        state.lastPull = new Date().toISOString();
        state.error = null;
      } catch (err) {
        state.error = `pull failed: ${err.message}`;
        log.warn(`vault sync ${state.error}`);
      }
    });
  }

  function commitAndPush(message) {
    if (!enabled) return Promise.resolve();
    return serial(async () => {
      try {
        await git(['add', '-A', '--', ...SYNC_PATHS]);
        const staged = await git(['diff', '--cached', '--name-only']);
        if (staged.trim()) await git(['commit', '--quiet', '-m', message]);
        try {
          await git(['push', '--quiet']);
        } catch {
          await git(['pull', '--rebase', '--autostash', '--quiet']);
          await git(['push', '--quiet']);
        }
        state.lastPush = new Date().toISOString();
        state.error = null;
      } catch (err) {
        state.error = `push failed: ${err.message}`;
        log.warn(`vault sync ${state.error}`);
      }
    });
  }

  function start() {
    if (!enabled) return;
    pull();
    timer = setInterval(pull, config.vaultGit.pullEveryMinutes * 60 * 1000);
    timer.unref();
  }

  function stop() {
    clearInterval(timer);
    return chain;
  }

  return { pull, commitAndPush, start, stop, status: () => ({ ...state }) };
}
