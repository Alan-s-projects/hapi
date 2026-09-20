// Run in the reusable preview/production container. Never prints credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.HAPI_API_URL || 'http://127.0.0.1:3006/hapi';
const home = process.env.HAPI_HOME;
const { cliApiToken } = JSON.parse(await readFile(`${home}/settings.json`, 'utf8'));
const auth = await fetch(`${base}/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: cliApiToken }), signal: AbortSignal.timeout(5000),
});
assert.equal(auth.status, 200);
const { token } = await auth.json();
const started = Date.now();
const response = await fetch(`${base}/api/events?token=${encodeURIComponent(token)}&all=true`, {
    signal: AbortSignal.timeout(75000),
});
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /text\/event-stream/);
let bytes = 0;
for await (const chunk of response.body) bytes += chunk.length;
const elapsed = Date.now() - started;
assert.ok(bytes > 0);
assert.ok(elapsed >= 55000 && elapsed <= 72000, `Unexpected SSE lifetime: ${elapsed}ms`);
console.log(`PASS: live SSE ended after ${(elapsed / 1000).toFixed(1)} seconds; reconnect requires a fresh gateway check.`);
