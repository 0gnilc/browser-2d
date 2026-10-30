import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'browser-2d-test-'));
  return { path, dispose: () => rm(path, { recursive: true, force: true }) };
}
