// Run inside the reusable Linux development container after bun install.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const nativeBuildRoot = process.env.HAPI_BUILD_DIR || '/test-state/build';
const out = `${nativeBuildRoot}/bun-linux-x64-baseline`;
const env = { ...process.env, VITE_BASE_URL: '/hapi/', VITE_GATEWAY_SESSION_PATH: '/hapi/.gateway/session' };
function run(args, cwd = repo) {
    const result = spawnSync('bun', args, { cwd, env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Build step failed: bun ${args.join(' ')}`);
}
// Linux runtime asset, pinned instead of the upstream helper's moving latest URL.
const tunwgPath = `${repo}/shared/tools/tunwg/tunwg-x64-linux`;
const tunwgHash = 'c1a7e08d956d9ee1087b8bf3b651d5dc32aee80eee1052c11218189fd5635768';
let tunwg;
try { tunwg = await readFile(tunwgPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!tunwg) {
    const response = await fetch('https://github.com/tiann/tunwg/releases/download/v26.08.03%2B122a6d0/tunwg');
    if (!response.ok) throw new Error(`tunwg download failed: ${response.status}`);
    tunwg = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(tunwg).digest('hex') !== tunwgHash) throw new Error('tunwg checksum mismatch');
await mkdir(`${repo}/shared/tools/tunwg`, { recursive: true });
await writeFile(tunwgPath, tunwg, { mode: 0o755 });
await mkdir(out, { recursive: true });
run(['run', 'build:web']);
run(['run', 'generate:embedded-web-assets'], `${repo}/hub`);
// Bun 1.4.0 creates a mode-000 temporary ELF in cwd. A Windows/9p bind mount
// rejects its ftruncate (oven-sh/bun#40111); compile on the native Linux volume.
run(['build', '--compile', '--no-compile-autoload-dotenv', '--feature=HAPI_TARGET_LINUX_X64',
    '--target=bun-linux-x64-baseline', `--outfile=${out}/hapi`, `${repo}/cli/src/bootstrap.ts`], nativeBuildRoot);
const sha256 = createHash('sha256').update(await readFile(`${out}/hapi`)).digest('hex');
await writeFile(`${out}/build.json`, JSON.stringify({ upstream: 'v0.30.7', basePath: '/hapi', bun: '1.4.0', sha256, tunwgSha256: tunwgHash }, null, 2));
console.log(`Built HAPI /hapi/ executable: ${sha256}`);
