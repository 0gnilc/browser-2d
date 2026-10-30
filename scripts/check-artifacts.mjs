import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './process.mjs';

for (const path of [
  'apps/worker/dist/entry.cjs',
  'apps/worker/dist/migrations/001-runs.sql',
  'apps/desktop/dist/main/index.cjs',
  'apps/desktop/dist/preload/index.cjs',
  'apps/desktop/dist/renderer/index.html',
]) {
  assert((await stat(join(root, path))).size > 0, `Missing artifact ${path}`);
}
for (const path of [
  'apps/worker/dist/entry.cjs',
  'apps/desktop/dist/main/index.cjs',
  'apps/desktop/dist/preload/index.cjs',
]) {
  const source = await readFile(join(root, path), 'utf8');
  assert(!/require\(["']@browser-2d\/contracts/.test(source), `Unbundled contracts in ${path}`);
}
console.log('All runtime entries, bundled contracts and migration assets are present.');
