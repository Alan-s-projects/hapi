import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { refreshCatalog } from './catalog.mjs';
import { quarantinePreviousRunnerState } from './runnerState.mjs';

process.umask(0o077);
const hapiHome = process.env.HAPI_HOME;
const codexHome = process.env.CODEX_HOME;
await mkdir(hapiHome, { recursive: true, mode: 0o700 });
await mkdir(codexHome, { recursive: true, mode: 0o700 });
await chmod(hapiHome, 0o700);
await chmod(codexHome, 0o700);
const archivedRunnerFiles = await quarantinePreviousRunnerState(hapiHome);
if (archivedRunnerFiles) console.log(`Preserved ${archivedRunnerFiles} previous-container runner state files before startup.`);
try {
  await access(`${codexHome}/config.toml`);
} catch {
  await writeFile(`${codexHome}/config.toml`, await readFile('/opt/codex-web/config/codex.toml'), { flag: 'wx', mode: 0o600 });
}

let settings;
try {
  settings = JSON.parse(await readFile(`${hapiHome}/settings.json`, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  settings = { cliApiToken: randomBytes(32).toString('hex'), apiUrl: process.env.HAPI_API_URL || 'http://127.0.0.1:3006/hapi' };
  await writeFile(`${hapiHome}/settings.json`, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
await chmod(`${hapiHome}/settings.json`, 0o600);
if (!settings.cliApiToken) throw new Error('HAPI settings missing access token; refusing to start.');
const redact = text => text.replaceAll(settings.cliApiToken, '[REDACTED]');

// Bridge can start after this container following a Docker Desktop restart.
for (let attempt = 1; ; attempt++) {
  try {
    await refreshCatalog();
    break;
  } catch (error) {
    console.error(`Catalog startup attempt ${attempt}: ${redact(error.message)}`);
    if (attempt >= 12) {
      // A previously verified catalog lets the UI start during a bridge outage.
      await access(`${codexHome}/copilot-bridge-models.json`);
      console.error('Using the saved catalog; Bridge must recover before chat will work.');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

let stopping = false;
const children = new Map();
function start(name, args) {
  if (stopping) return;
  const child = spawn('hapi', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.set(name, child);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', line => console.log(`[${name}] ${redact(line)}`));
  }
  child.on('error', error => console.error(`[${name}] ${redact(error.message)}`));
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (!stopping) {
      console.error(`[${name}] exited (${code ?? signal}); restarting in 3s.`);
      setTimeout(() => start(name, args), 3000);
    }
  });
}
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill('SIGTERM');
  // Docker's init reaps children; container stop terminates remaining sessions.
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
start('hub', ['hub', '--no-relay']);
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    if ((await fetch(`${process.env.HAPI_API_URL || 'http://127.0.0.1:3006/hapi'}/health`, { signal: AbortSignal.timeout(1000) })).ok) break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
start('runner', ['runner', 'start-sync', '--workspace-root', '/workspace']);
