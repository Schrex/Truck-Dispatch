// Starts the built app for the browser end-to-end suite (playwright.config.ts
// runs it): a fresh local D1 of its own, migrated and seeded, then the built
// Worker with its clock fixed. Usage: node scripts/e2e-serve.mjs <port> <NOW>
//
// The suite's D1 lives in .wrangler/e2e, never in .wrangler/state (the
// developer's, which db:reset wipes), and is deleted at every start.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const [port, now] = process.argv.slice(2);
if (!port || !now) {
  console.error('Usage: node scripts/e2e-serve.mjs <port> <NOW>');
  process.exit(2);
}

const config = 'dist/truck_dispatch/wrangler.json';
if (!existsSync(config)) {
  console.error(`${config} is missing: build first (bun run e2e does).`);
  process.exit(1);
}
const state = '.wrangler/e2e';
const wrangler = ['wrangler', '--config', config];

rmSync(state, { recursive: true, force: true });

/** @param {string[]} args */
function run(args) {
  const result = spawnSync('bunx', [...wrangler, ...args, '--persist-to', state], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(['d1', 'migrations', 'apply', 'truck-dispatch', '--local']);
run(['d1', 'execute', 'truck-dispatch', '--local', '--file', 'seed/fixture.sql']);

const server = spawn(
  'bunx',
  [...wrangler, 'dev', '--port', port, '--ip', '127.0.0.1', '--persist-to', state, '--var', `NOW:${now}`, '--show-interactive-dev-session=false'],
  { stdio: 'inherit' },
);
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
