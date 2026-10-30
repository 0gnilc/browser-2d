import { stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { root } from './process.mjs';
export const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
export const workerRequire = createRequire(join(root, 'apps/worker/package.json'));
export async function resolveNativeBinding() {
  const metadata = workerRequire('better-sqlite3/package.json');
  assert.equal(
    metadata.gypfile,
    false,
    'Revisit native build policy before changing the SQLite driver',
  );
  assert.equal(
    metadata.version,
    '13.0.3',
    'SQLite binary changes require an explicit native verification update',
  );
  const source = dirname(workerRequire.resolve('better-sqlite3/package.json'));
  const binding = join(source, 'prebuilds', `${process.platform}-${process.arch}.node`);
  await stat(binding);
  return binding;
}
