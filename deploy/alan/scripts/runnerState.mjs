import { mkdir, mkdtemp, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

async function optionalRead(path) {
    try { return await readFile(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/**
 * Dedicated single-runner container bootstrap only, before any HAPI child starts.
 * Persisted PIDs belong to the previous container's PID namespace. Reusing them
 * can mistake the new hub for the old runner. Preserve, rather than delete, the
 * two volatile state files; never touch chats, credentials or resume records.
 */
export async function quarantinePreviousRunnerState(directory, {
    processCommand = async pid => (await optionalRead(`/proc/${pid}/cmdline`))?.toString() ?? '',
} = {}) {
    const names = ['runner.state.json', 'runner.state.json.lock'];
    const snapshots = await Promise.all(names.map(name => optionalRead(join(directory, name))));
    if (snapshots.every(value => value === null)) return 0;
    const pids = [
        snapshots[0] === null ? null : JSON.parse(snapshots[0].toString()).pid,
        snapshots[1] === null ? null : Number(snapshots[1].toString().trim()),
    ].filter(value => value !== null);
    for (const pid of new Set(pids)) {
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Malformed runner PID state; refusing automatic cleanup.');
        const command = (await processCommand(pid)).replaceAll('\0', ' ');
        if (/\brunner\s+start-sync\b/.test(command)) {
            throw new Error('A live runner already exists before supervisor startup; refusing to replace its state.');
        }
    }
    for (let i = 0; i < names.length; i++) {
        const current = await optionalRead(join(directory, names[i]));
        if ((current === null) !== (snapshots[i] === null) || (current && !current.equals(snapshots[i]))) {
            throw new Error('Runner state changed concurrently; refusing startup cleanup.');
        }
    }
    const archiveRoot = join(directory, 'runner-state-archive');
    await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
    const archive = await mkdtemp(join(archiveRoot, 'startup-'));
    let moved = 0;
    for (let i = 0; i < names.length; i++) {
        if (snapshots[i] !== null) {
            await rename(join(directory, names[i]), join(archive, names[i]));
            moved++;
        }
    }
    return moved;
}
