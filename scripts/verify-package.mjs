import assert from 'node:assert/strict';
import asar from '@electron/asar';
import { spawn } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './process.mjs';
import { desktopRequire } from './native.mjs';
import { observeChrome } from './chrome-observer.mjs';

const { getCurrentFuseWire, FuseState, FuseV1Options } = await import(
  pathToFileURL(desktopRequire.resolve('@electron/fuses')).href
);

const target =
  process.argv.find((arg) => arg.startsWith('--target='))?.slice(9) ||
  `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
let directory = await realpath(
  resolve(process.env.BROWSER2D_PACKAGE_DIR || join(root, 'release', target)),
);
const candidates = [];
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      const destination = relative(directory, await realpath(full));
      assert(
        !isAbsolute(destination) && destination.split(/[\\/]/)[0] !== '..',
        `Escaping package link ${full}`,
      );
    } else if (entry.isDirectory()) await scan(full);
    else if (
      entry.name === 'browser-2d-foundation.exe' ||
      entry.name === 'browser-2d-foundation' ||
      (entry.name === 'Browser2DFoundation' && path.endsWith('MacOS'))
    )
      candidates.push(full);
  }
}
await scan(directory);
assert.equal(candidates.length, 1, `Expected one packaged executable, found ${candidates}`);
const sourceExecutable = candidates[0];
const appDirectory =
  process.platform === 'darwin' ? resolve(sourceExecutable, '../../..') : dirname(sourceExecutable);
const installRoot = await mkdtemp(join(tmpdir(), 'browser-2d-install-'));
const installedApp = join(installRoot, basename(appDirectory));
await cp(appDirectory, installedApp, { recursive: true, verbatimSymlinks: true });
directory = await realpath(installedApp);
candidates.length = 0;
await scan(directory);
const executable = join(installedApp, relative(appDirectory, sourceExecutable));
const archive =
  process.platform === 'darwin'
    ? join(installedApp, 'Contents/Resources/app.asar')
    : join(installedApp, 'resources/app.asar');
const workerPrefix = '/node_modules/@browser-2d/worker-runtime';
const archiveFiles = asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/'));
assert(
  archiveFiles.includes(`${workerPrefix}/dist/entry.cjs`),
  'Compiled worker entry missing from archive',
);
assert(
  archiveFiles.some((entry) => entry.endsWith('/puppeteer-core/package.json')),
  'Puppeteer production dependency missing from archive',
);
assert(
  archiveFiles.some(
    (entry) =>
      entry.startsWith(`${workerPrefix}/dist/migrations/business/`) && entry.endsWith('.sql'),
  ),
  'Business migration SQL missing from archive',
);
for (const entry of archiveFiles) {
  if (!entry.startsWith('/node_modules/@browser-2d/')) continue;
  assert(
    entry === workerPrefix ||
      entry === `${workerPrefix}/package.json` ||
      entry === `${workerPrefix}/dist` ||
      entry.startsWith(`${workerPrefix}/dist/`),
    `Unexpected workspace file in package: ${entry}`,
  );
}
function rejectArchiveLinks(files, path = '') {
  for (const [name, entry] of Object.entries(files)) {
    assert(!Object.hasOwn(entry, 'link'), `Unexpected archive link: ${path}/${name}`);
    if (entry.files) rejectArchiveLinks(entry.files, `${path}/${name}`);
  }
}
rejectArchiveLinks(asar.getRawHeader(archive).header.files);
const fuses = await getCurrentFuseWire(process.platform === 'darwin' ? installedApp : executable);
for (const option of [
  FuseV1Options.RunAsNode,
  FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  FuseV1Options.EnableNodeCliInspectArguments,
])
  assert.equal(fuses[option], FuseState.DISABLE);
assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], FuseState.ENABLE);
if (process.platform !== 'linux')
  assert.equal(fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], FuseState.ENABLE);
const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
const reportPath = join(dataDir, 'report.json');
await mkdir(join(root, 'artifacts', target), { recursive: true });
const reports = [];
for (let pass = 1; pass <= 2; pass++) {
  const readyPath = join(dataDir, 'chrome-pages-ready');
  await rm(readyPath, { force: true });
  await rm(`${readyPath}.shutdown`, { force: true });
  const observationAbort = new AbortController();
  const observation = observeChrome(
    join(dataDir, 'chrome-sessions'),
    observationAbort.signal,
    readyPath,
  );
  const child = spawn(executable, [`--verify-p1=${reportPath}`], {
    cwd: tmpdir(),
    stdio: 'inherit',
    env: {
      ...process.env,
      BROWSER2D_DATA_DIR: dataDir,
      BROWSER2D_VERIFY_CHROME: '1',
      BROWSER2D_EXECUTION: 'chrome',
      BROWSER2D_NATIVE_BINDING: join(dataDir, 'must-not-load.node'),
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/must-not-load',
    },
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged verification timed out'));
    }, 45_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  }).finally(() => observationAbort.abort());
  const chrome = await observation;
  await writeFile(
    join(root, 'artifacts', target, `chrome-pass-${pass}.json`),
    JSON.stringify(chrome, null, 2),
  );
  await copyFile(reportPath, join(root, 'artifacts', target, `package-pass-${pass}.json`));
  assert.equal(code, 0, 'Packaged process failed');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.arch, target.endsWith('-arm64') ? 'arm64' : 'x64');
  assert.equal(
    report.platform,
    target.startsWith('mac-') ? 'darwin' : target.startsWith('win-') ? 'win32' : 'linux',
  );
  assert.equal(report.versions.electron, desktopRequire('electron/package.json').version);
  assert.equal(report.packaged, true);
  assert.equal(new URL(report.rendererUrl).protocol, 'app:');
  assert.equal(new URL(report.rendererUrl).hostname, 'ui');
  assert.equal(report.exitCode, 0);
  assert.equal(report.workerExited, true);
  assert.equal(report.result.nodeIsolation, true);
  assert(
    report.workerEntry.includes('app.asar'),
    'Worker did not load from packaged dependency graph',
  );
  assert(!report.workerEntry.includes(root), 'Worker still depends on source checkout');
  assert.equal(report.result.initialCount, pass === 1 ? 0 : 4);
  assert.deepEqual(report.result.business, {
    initialDeviceCount: (pass - 1) * 3,
    initialMaterialCount: pass - 1,
    settingsRevision: pass,
  });
  const shutdown = report.finalSnapshot.runs.find((run) => run.id === report.result.shutdownId);
  assert.equal(shutdown?.state, 'cancelled', 'Close did not persist cancellation');
  assert(
    report.finalSnapshot.runs.every((run) =>
      ['completed', 'cancelled', 'failed', 'interrupted'].includes(run.state),
    ),
  );
  assert.deepEqual(report.result.capacity, { devices: 2, pages: 4, queuedObserved: true });
  assert.deepEqual(report.finalSnapshot.resources, []);
  assert.equal(report.finalSnapshot.execution, 'chrome');
  assert.equal(chrome.maximumBrowsers, 2, 'Did not observe two actual Chrome instances');
  assert.equal(chrome.maximumPages, 4, 'Did not observe four actual isolated Chrome pages');
  assert.equal(chrome.instances, 3, 'Shutdown did not exercise a third actual Chrome instance');
  assert(chrome.pids.length >= 2, 'Chrome process identities were not observed');
  for (const pid of chrome.pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.deepEqual(await readdir(join(dataDir, 'chrome-sessions')), []);
  assert.deepEqual(await readdir(join(dataDir, 'controlled-resources')), []);
  assert(Number.isSafeInteger(report.result.workerPid) && report.result.workerPid > 0);
  assert.throws(() => process.kill(report.result.workerPid, 0), { code: 'ESRCH' });
  reports.push(report);
}
console.log(
  JSON.stringify(
    { target, executable, database: dataDir, fuses, passes: reports.length, result: 'VERIFIED' },
    null,
    2,
  ),
);
