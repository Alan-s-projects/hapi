import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quarantinePreviousRunnerState } from '../scripts/runnerState.mjs';

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'hapi-runner-state-test-'));
    await writeFile(join(directory, 'runner.state.json'), JSON.stringify({ pid: 81 }));
    await writeFile(join(directory, 'runner.state.json.lock'), '81');
    await writeFile(join(directory, 'settings.json'), 'preserve credentials');
    await writeFile(join(directory, 'runner.state.json.resume-processes.json'), 'preserve resume state');
    return directory;
}

test('fresh container state requires no changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hapi-runner-empty-test-'));
    assert.equal(await quarantinePreviousRunnerState(directory), 0);
});

test('PID reused by a hub is not mistaken for a live runner; originals are archived', async () => {
    const directory = await fixture();
    assert.equal(await quarantinePreviousRunnerState(directory, { processCommand: async () => 'hapi\0hub\0--no-relay\0' }), 2);
    await assert.rejects(readFile(join(directory, 'runner.state.json')), { code: 'ENOENT' });
    const [archive] = await readdir(join(directory, 'runner-state-archive'));
    assert.equal(await readFile(join(directory, 'runner-state-archive', archive, 'runner.state.json.lock'), 'utf8'), '81');
    assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), 'preserve credentials');
    assert.equal(await readFile(join(directory, 'runner.state.json.resume-processes.json'), 'utf8'), 'preserve resume state');
});

test('a real running runner is never displaced', async () => {
    const directory = await fixture();
    await assert.rejects(quarantinePreviousRunnerState(directory, { processCommand: async () => 'hapi\0runner\0start-sync\0' }), /live runner/);
    assert.equal(await readFile(join(directory, 'runner.state.json.lock'), 'utf8'), '81');
});

test('malformed PID state fails safely without deleting anything', async () => {
    const directory = await fixture();
    await writeFile(join(directory, 'runner.state.json.lock'), 'not-a-pid');
    await assert.rejects(quarantinePreviousRunnerState(directory, { processCommand: async () => '' }), /Malformed/);
    assert.equal(await readFile(join(directory, 'runner.state.json.lock'), 'utf8'), 'not-a-pid');
});
