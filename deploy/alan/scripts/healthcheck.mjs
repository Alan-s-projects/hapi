import { readFile } from 'node:fs/promises';

try {
  const settings = JSON.parse(await readFile(`${process.env.HAPI_HOME}/settings.json`, 'utf8'));
  const auth = await fetch(`${process.env.HAPI_API_URL}/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: settings.cliApiToken }), signal: AbortSignal.timeout(3000),
  });
  if (!auth.ok) throw new Error(`Hub authentication: ${auth.status}`);
  const { token } = await auth.json();
  const response = await fetch(`${process.env.HAPI_API_URL}/api/machines`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Runner lookup: ${response.status}`);
  const { machines } = await response.json();
  if (!machines?.some(machine => machine.active)) throw new Error('No active HAPI runner');
  console.log('HAPI hub and Codex runner are healthy.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
