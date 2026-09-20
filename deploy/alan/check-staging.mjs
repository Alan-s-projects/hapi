import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:3006';
const base = `${origin}/hapi`;
for (const path of ['/api/machines', '/socket.io/', '/hapix/api/auth', '/%68api/api/auth', '/hapi%2fapi/auth']) {
    const r = await fetch(origin + path, { redirect: 'manual' });
    assert.equal(r.status, 404, path);
}
assert.equal((await fetch(`${base}/api/machines`)).status, 401);
const { cliApiToken } = JSON.parse(await readFile('/test-state/staging/hapi/settings.json', 'utf8'));
const auth = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: cliApiToken }) });
assert.equal(auth.status, 200);
const { token } = await auth.json();
async function api(path, body) {
    const r = await fetch(`${base}/api${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, 200, `${path}: ${r.status}`);
    return r.json();
}
const { machines } = await api('/machines');
assert.ok(machines.some(m => m.active));
const { models } = await api(`/machines/${machines[0].id}/codex-models`);
assert.deepEqual(models.map(m => m.id), ['gpt-6-astra']);
const { sessions } = await api('/sessions');
const smoke = sessions.find(s => s.id === process.argv[2]);
assert.ok(smoke, 'Pass the isolated smoke-test session ID');
assert.equal(smoke.modelReasoningEffort, 'max');
const { session } = await api(`/sessions/${smoke.id}`);
assert.equal(session.permissionMode, 'default');
const upload = await api(`/sessions/${smoke.id}/upload`, {
    filename: 'prefix-upload-test.txt', content: Buffer.from('PREFIX_UPLOAD_OK').toString('base64'), mimeType: 'text/plain',
});
assert.equal(upload.success, true, JSON.stringify(upload));
const controller = new AbortController();
const stream = await fetch(`${base}/api/events?token=${encodeURIComponent(token)}&all=true`, { signal: controller.signal });
assert.equal(stream.status, 200);
assert.match(stream.headers.get('content-type'), /text\/event-stream/);
assert.ok((await stream.body.getReader().read()).value.length > 0);
controller.abort();
const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
assert.equal(manifest.scope, '/hapi/');
assert.equal(manifest.start_url, '/hapi/');
console.log('PASS: prefix boundary, authentication, runner, Astra/max, upload, SSE and PWA scope.');
