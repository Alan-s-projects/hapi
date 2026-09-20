import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

process.umask(0o077);
const root = '/test-state/staging';
process.env.HAPI_HOME = `${root}/hapi`;
process.env.CODEX_HOME = `${root}/codex`;
process.env.PATH = `/test-state/build/bun-linux-x64-baseline:${process.env.PATH}`;
const workspace = `${root}/workspace`;
for (const path of [process.env.HAPI_HOME, process.env.CODEX_HOME, workspace]) await mkdir(path, { recursive: true });
const config = (await readFile('/opt/codex-web/config/codex.toml', 'utf8'))
    .replaceAll('/home/node/.codex', process.env.CODEX_HOME)
    .replaceAll('/workspace', workspace);
try { await writeFile(`${process.env.CODEX_HOME}/config.toml`, config, { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
let settings;
try { settings = JSON.parse(await readFile(`${process.env.HAPI_HOME}/settings.json`, 'utf8')); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    settings = { cliApiToken: randomBytes(32).toString('hex'), apiUrl: process.env.HAPI_API_URL };
    await writeFile(`${process.env.HAPI_HOME}/settings.json`, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
}
const { refreshCatalog } = await import('/opt/codex-web/scripts/catalog.mjs');
await refreshCatalog();
const children = [];
function start(args) {
    const child = spawn('/test-state/build/bun-linux-x64-baseline/hapi', args, { env: process.env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => console.log(line.replaceAll(settings.cliApiToken, '[REDACTED]')));
    return child;
}
start(['hub', '--no-relay']);
let ready = false;
for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${process.env.HAPI_API_URL}/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('Test hub did not become ready');
start(['runner', 'start-sync', '--workspace-root', workspace]);
process.on('SIGTERM', () => { for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(0), 2000); });
