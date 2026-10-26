// Entry point: `npm start`
import { loadConfig, ConfigError } from './config.js';
import { createServer } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`\n  Cannot start: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const app = createServer(config);
try {
  const { port, missed } = await app.start();
  const url = `http://127.0.0.1:${port}`;
  console.log('');
  if (config.access.mode === 'cloud') {
    console.log(`  Agentic OS is running on 127.0.0.1:${port} (published to your tailnet by Tailscale Serve).`);
    console.log(`  Open:  ${config.access.publicOrigin}  (from a device signed in to Tailscale)`);
  } else {
    console.log('  Agentic OS is running (only on this Mac).');
    console.log(`  Open:  ${url}`);
    console.log('  Stop:  press Control + C in this window.');
  }
  if (missed.length) console.log(`  Note:  ${missed.length} missed scheduled run(s) found — see the dashboard.`);
  console.log('');
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${config.port} is already in use. Is Agentic OS already running in another window?`);
    console.error('  If not, change PORT in .env to another number (e.g. 4778) and try again.\n');
  } else {
    console.error(`\n  Could not start: ${err.message}\n`);
  }
  process.exit(1);
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\n  Stopping Agentic OS…');
    await app.stop().catch(() => {});
    process.exit(0);
  });
}
