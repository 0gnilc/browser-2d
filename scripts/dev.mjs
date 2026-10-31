import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'vite';
import { rendererConfig } from '../internal/build-config/index.mjs';
import { desktopRequire, resolveNativeBinding } from './native.mjs';
import { pnpm, root } from './process.mjs';

const control = await mkdtemp(join(tmpdir(), 'browser-2d-dev-'));
const dataDir = process.env.BROWSER2D_DATA_DIR || join(root, 'artifacts/dev-data');
await mkdir(dataDir, { recursive: true });
const nativeBinding = await resolveNativeBinding();
const workerOnly = process.argv.includes('--worker-only');
const inspectUi = process.argv.includes('--inspect-ui');
const server = workerOnly
  ? undefined
  : await createServer({
      ...rendererConfig(join(root, 'apps/ui')),
      server: { host: '127.0.0.1' },
    });
await server?.listen();
server?.printUrls();
let child;
let exit;
let closing = false;
let rebuilding = false;
let dirty = false;
let debounce;
const watchers = [];
const commands = inspectUi ? createInterface({ input: process.stdin }) : undefined;
commands?.on('line', (line) => {
  if (line === 'stop') void close();
});

async function stop() {
  if (!child) return;
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error(`Previous application exited ${child.exitCode}`);
    return;
  }
  await writeFile(join(control, 'stop'), 'stop');
  let timer;
  try {
    const code = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          child.kill();
          reject(new Error('Development shutdown exceeded deadline'));
        }, 17_000);
      }),
    ]);
    if (code !== 0) throw new Error(`Development shutdown exited ${code}`);
  } finally {
    clearTimeout(timer);
  }
}
async function restart() {
  dirty = true;
  if (rebuilding || closing) return;
  rebuilding = true;
  try {
    while (dirty && !closing) {
      dirty = false;
      await pnpm(['build']);
      await stop();
      await rm(join(control, 'stop'), { force: true });
      if (closing) return;
      child = spawn(
        desktopRequire('electron'),
        [
          ...(inspectUi
            ? ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']
            : []),
          join(root, 'apps/desktop'),
          ...(workerOnly ? ['--worker-only'] : []),
        ],
        {
          stdio: 'inherit',
          detached: true,
          windowsHide: true,
          env: {
            ...process.env,
            ELECTRON_RENDERER_URL: server?.resolvedUrls.local[0] || '',
            BROWSER2D_DATA_DIR: dataDir,
            BROWSER2D_NATIVE_BINDING: nativeBinding,
            BROWSER2D_DEV_CONTROL: control,
          },
        },
      );
      exit = new Promise((resolve) => child.once('exit', resolve));
      child.on('error', (error) => process.stderr.write(`${error.message}\n`));
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
  } finally {
    rebuilding = false;
  }
}
await restart();
for (const path of [
  'apps/desktop/src',
  'apps/worker/src',
  'apps/worker/migrations',
  'packages/contracts/src',
  'internal/build-config',
  'apps/desktop/electron.vite.config.ts',
  'apps/worker/vite.config.ts',
  'apps/desktop/tsconfig.json',
  'apps/worker/tsconfig.json',
  'apps/ui/tsconfig.json',
]) {
  watchers.push(
    watch(join(root, path), { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void restart(), 250);
    }),
  );
}
async function close() {
  if (closing) return;
  closing = true;
  commands?.close();
  clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  try {
    await stop();
    await server?.close();
    await rm(control, { recursive: true, force: true });
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
