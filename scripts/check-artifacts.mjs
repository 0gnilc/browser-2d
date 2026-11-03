import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './process.mjs';
import { resolveNativeBinding } from './native.mjs';
import { runtimeArtifacts } from './runtime-artifacts.mjs';

await resolveNativeBinding();
const runtime = join(root, 'apps/worker/dist');
const manifest = JSON.parse(await readFile(join(runtime, '.vite/manifest.json'), 'utf8'));
for (const file of runtimeArtifacts(manifest))
  assert((await stat(join(runtime, file))).size > 0, `Missing runtime dependency ${file}`);

const migrationSource = join(root, 'apps/worker/migrations');
for (const path of await readdir(migrationSource, { recursive: true })) {
  if (!(await stat(join(migrationSource, path))).isFile()) continue;
  assert.deepEqual(
    await readFile(join(root, 'apps/worker/dist/migrations', path)),
    await readFile(join(migrationSource, path)),
    `Missing or changed migration artifact ${path}`,
  );
}

for (const path of [
  'apps/worker/dist/entry.cjs',
  'apps/worker/dist/browser-worker.cjs',
  'apps/worker/dist/migrations/business/003-work.sql',
  'apps/desktop/dist/main/index.cjs',
  'apps/desktop/dist/preload/index.cjs',
  'apps/desktop/dist/renderer/index.html',
]) {
  assert((await stat(join(root, path))).size > 0, `Missing artifact ${path}`);
}
for (const path of [
  'apps/worker/dist/entry.cjs',
  'apps/worker/dist/browser-worker.cjs',
  'apps/desktop/dist/main/index.cjs',
  'apps/desktop/dist/preload/index.cjs',
]) {
  const source = await readFile(join(root, path), 'utf8');
  assert(!/require\(["']@browser-2d\/contracts/.test(source), `Unbundled contracts in ${path}`);
}
console.log('All runtime entries, bundled contracts and migration assets are present.');
