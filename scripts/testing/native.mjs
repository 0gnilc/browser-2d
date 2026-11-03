import { stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { root } from '../process.mjs';
export const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
export const backendRequire = createRequire(join(root, 'apps/backend/package.json'));
export async function resolveNativeBinding() {
  const metadata = backendRequire('better-sqlite3/package.json');
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
  const source = dirname(backendRequire.resolve('better-sqlite3/package.json'));
  const binding = join(source, 'prebuilds', `${process.platform}-${process.arch}.node`);
  await stat(binding);
  return binding;
}
