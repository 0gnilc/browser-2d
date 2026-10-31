import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
it('checks and downloads through the pinned updater against a controlled loopback feed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-updater-'));
  try {
    const executable: unknown = require('electron');
    if (typeof executable !== 'string') throw new Error('Electron executable missing');
    const result = await promisify(execFile)(
      executable,
      [resolve('tests/fixtures/update-feed.mjs')],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          UPDATE_TEST_DIRECTORY: directory,
          XDG_CACHE_HOME: directory,
        },
        timeout: 30000,
      },
    );
    expect(result.stdout).toContain('"hashRejected":true');
    expect(result.stdout).toContain('"retryDownloaded":true');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 40000);
