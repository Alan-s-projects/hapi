import { execFileSync } from 'node:child_process';
import { writeFile, rename } from 'node:fs/promises';

// Adapted from Alan-s-projects/copilot-bridge/scripts/export-codex-catalog.mjs.
// Preserve the installed official Codex binary's complete model instructions.
export async function refreshCatalog() {
  const bundled = JSON.parse(execFileSync('codex', ['debug', 'models', '--bundled'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
  }));
  const astra = bundled.models?.find(model => model.slug === 'gpt-6-astra');
  if (!astra?.model_messages?.instructions_template) {
    throw new Error('Official Codex has no complete GPT-6 Astra catalog entry.');
  }
  const base = process.env.BRIDGE_BASE_URL || 'http://bridge:4142/v1';
  const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Bridge model lookup: HTTP ${response.status}`);
  const upstream = (await response.json()).data?.find(model => model.id === astra.slug);
  const limit = upstream?.capabilities?.limits?.max_prompt_tokens;
  if (upstream?.policy?.state === 'disabled' || !Number.isFinite(limit) || limit <= 0) {
    throw new Error('Bridge does not advertise an enabled Astra input limit.');
  }
  astra.context_window = Math.min(1050000, Math.trunc(limit));
  astra.max_context_window = astra.context_window;
  astra.service_tiers = [];
  astra.additional_speed_tiers = [];
  // This dedicated UI only offers the requested Astra model, not unavailable models.
  bundled.models = [astra];
  const output = `${process.env.CODEX_HOME}/copilot-bridge-models.json`;
  await writeFile(`${output}.tmp`, JSON.stringify(bundled, null, 2) + '\n', { mode: 0o600 });
  await rename(`${output}.tmp`, output);
  console.log(`Official GPT-6 Astra metadata loaded; configured context ${astra.context_window}.`);
}
