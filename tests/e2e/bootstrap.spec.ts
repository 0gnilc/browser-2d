import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const desktop = resolve('apps/desktop');
const desktopRequire = createRequire(join(desktop, 'package.json'));
const workerRequire = createRequire(resolve('apps/worker/package.json'));

test('initialization rejects stale receipts and cooperatively shuts down while awaiting consent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'browser-2d-bootstrap-'));
  const application = await electron.launch({
    executablePath: desktopRequire('electron'),
    args: [desktop],
    env: { ...process.env, BROWSER2D_DATA_DIR: join(root, 'host') },
  });
  try {
    await application.firstWindow();
    for (const mode of ['shutdown', 'stale-receipt']) {
      const dataDir = join(root, mode);
      await mkdir(dataDir);
      const path = join(dataDir, 'data.db');
      const Database = workerRequire('better-sqlite3');
      const legacy = new Database(path);
      legacy.exec(await readFile('tests/fixtures/legacy-schema.sql', 'utf8'));
      legacy.prepare('INSERT INTO device(symbol) VALUES (?)').run('unchanged');
      legacy.close();
      const result = await application.evaluate(
        async ({ utilityProcess }, input) => {
          const child = utilityProcess.fork(input.entry, [], {
            serviceName: 'p2-bootstrap-fixture',
          });
          let challenged = false;
          let acknowledged = false;
          let becameReady = false;
          return new Promise<{
            code: number;
            challenged: boolean;
            acknowledged: boolean;
            becameReady: boolean;
          }>((resolve, reject) => {
            const timer = setTimeout(() => {
              child.kill();
              reject(new Error('Bootstrap fixture timed out'));
            }, 12_000);
            child.on('spawn', () =>
              child.postMessage({
                type: 'initialize',
                dataDir: input.dataDir,
                businessPath: input.path,
              }),
            );
            child.on('message', (event: unknown) => {
              if (!event || typeof event !== 'object' || !('type' in event)) return;
              if (event.type === 'ready') becameReady = true;
              if (
                event.type === 'response' &&
                'requestId' in event &&
                event.requestId === input.requestId
              )
                acknowledged = true;
              if (
                event.type !== 'credential-challenge' ||
                !('kind' in event) ||
                event.kind !== 'confirm'
              )
                return;
              challenged = true;
              child.postMessage(
                input.mode === 'shutdown'
                  ? { type: 'request', method: 'shutdown', requestId: input.requestId }
                  : { type: 'credential-receipt', kind: 'confirmed', bootNonce: input.requestId },
              );
            });
            child.on('exit', (code: number) => {
              clearTimeout(timer);
              resolve({ code, challenged, acknowledged, becameReady });
            });
          });
        },
        {
          entry: desktopRequire.resolve('@browser-2d/worker-runtime/entry'),
          path,
          dataDir,
          mode,
          requestId: randomUUID(),
        },
      );
      expect(result).toEqual({
        code: mode === 'shutdown' ? 0 : 1,
        challenged: true,
        acknowledged: mode === 'shutdown',
        becameReady: false,
      });
      const after = new Database(path, { readonly: true });
      try {
        expect(after.pragma('user_version', { simple: true })).toBe(0);
        expect(after.prepare('SELECT symbol FROM device').pluck().get()).toBe('unchanged');
      } finally {
        after.close();
      }
    }
  } finally {
    await application.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
