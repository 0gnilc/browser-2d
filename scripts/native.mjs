import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { root } from './process.mjs';
export const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
export const workerRequire = createRequire(join(root, 'apps/worker/package.json'));
export async function resolveNativeBinding() {
  const source = dirname(workerRequire.resolve('better-sqlite3/package.json'));
  const binding = join(source, 'prebuilds', `${process.platform}-${process.arch}.node`);
  await stat(binding);
  return binding;
}
