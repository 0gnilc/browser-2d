import assert from 'node:assert/strict';
import { identity } from '../../internal/build-config/release.mjs';
import asar from '@electron/asar';
import { spawn } from 'node:child_process';
import {
  copyFile,
  cp,
  lstat,
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
import { root } from '../process.mjs';
import { desktopRequire } from '../testing/native.mjs';
import { runtimeArtifacts, assertBundledWorkspace } from '../checks/runtime-artifacts.mjs';
import { verifyTaskProcessExecutable } from '../testing/task-process-proof.mjs';

const { getCurrentFuseWire, FuseState, FuseV1Options } = await import(
  pathToFileURL(desktopRequire.resolve('@electron/fuses')).href
);
const processOnly = process.argv.includes('--process-only');

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
      entry.name === `${identity.executableName}.exe` ||
      entry.name === identity.executableName ||
      (entry.name === identity.productName && path.endsWith('MacOS'))
    )
      candidates.push(full);
  }
}
await scan(directory);
assert.equal(candidates.length, 1, `Expected one packaged executable, found ${candidates}`);
const sourceExecutable = candidates[0];
const appDirectory =
  process.platform === 'darwin'
    ? resolve(sourceExecutable, '../../../..')
    : dirname(sourceExecutable);
const installRoot = await mkdtemp(join(tmpdir(), 'browser-2d-install-'));
const installedApp = process.argv.includes('--in-place')
  ? appDirectory
  : join(installRoot, basename(appDirectory));
if (installedApp !== appDirectory)
  await cp(appDirectory, installedApp, { recursive: true, verbatimSymlinks: true });
directory = await realpath(installedApp);
candidates.length = 0;
await scan(directory);
const executable = join(installedApp, relative(appDirectory, sourceExecutable));
const appImage = process.argv.find((arg) => arg.startsWith('--appimage='))?.slice(11);
if (appImage) {
  assert(
    process.platform === 'linux' && isAbsolute(appImage) && appImage.endsWith('.AppImage'),
    'Direct AppImage verification requires an absolute Linux AppImage path',
  );
  assert(!process.env.APPIMAGE_EXTRACT_AND_RUN, 'AppImage verification requires direct FUSE');
  assert((await lstat(appImage)).isFile(), 'AppImage must be a regular file');
}
const launchExecutable = appImage || executable;
const archive =
  process.platform === 'darwin'
    ? join(installedApp, 'Contents/Resources/app.asar')
    : join(installedApp, 'resources/app.asar');
const backendPrefix = '/node_modules/@browser-2d/backend';
const archiveFiles = asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/'));
const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
const runtimeManifest = JSON.parse(
  asar
    .extractFile(archive, join(backendPrefix.slice(1), 'dist/.vite/manifest.json'))
    .toString('utf8'),
);
for (const file of runtimeArtifacts(runtimeManifest)) {
  assertBundledWorkspace(
    asar.extractFile(archive, `${backendPrefix.slice(1)}/dist/${file}`).toString('utf8'),
    file,
  );
  assert(
    archiveFiles.includes(`${backendPrefix}/dist/${file}`),
    `Missing packaged runtime dependency ${file}`,
  );
}
assert(
  archiveFiles.includes(`${backendPrefix}/dist/data-service.cjs`),
  'Compiled worker entry missing from archive',
);
assert(
  archiveFiles.some((entry) => entry.endsWith('/puppeteer-core/package.json')),
  'Puppeteer production dependency missing from archive',
);
const migration = `${backendPrefix.slice(1)}/dist/migrations/application/001-application.sql`;
assert.deepEqual(
  asar.extractFile(archive, migration),
  await readFile(join(root, 'apps/backend/migrations/application/001-application.sql')),
  'Packaged application migration differs from source',
);
assert(
  !archiveFiles.some((entry) => entry.includes('/migrations/business/')),
  'Retired migrations returned',
);
assert.equal(packagedManifest.name, '@browser-2d/desktop');
for (const path of ['dist/main/index.cjs', 'dist/preload/index.cjs'])
  assertBundledWorkspace(asar.extractFile(archive, path).toString('utf8'), path);
for (const entry of archiveFiles) {
  if (!entry.startsWith('/node_modules/@browser-2d/')) continue;
  assert(
    entry === backendPrefix ||
      entry === `${backendPrefix}/package.json` ||
      entry === `${backendPrefix}/dist` ||
      entry.startsWith(`${backendPrefix}/dist/`),
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
const dataArgument = process.argv.find((arg) => arg.startsWith('--data-dir='))?.slice(11);
const dataDir = dataArgument
  ? resolve(dataArgument)
  : await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
const tempData = relative(await realpath(tmpdir()), await realpath(dataDir));
assert(
  !isAbsolute(tempData) &&
    tempData.split(/[\\/]/).length === 1 &&
    tempData.startsWith('browser-2d-release-'),
  'Verification data must be a dedicated temporary directory',
);
const initialPass = Number(
  process.argv.find((arg) => arg.startsWith('--initial-pass='))?.slice(15) ?? 0,
);
assert(
  Number.isSafeInteger(initialPass) && initialPass >= 0 && initialPass <= 10,
  'Invalid verification pass offset',
);
const reportPath = join(dataDir, 'report.json');
const evidenceDir = resolve(process.env.BROWSER2D_EVIDENCE_DIR || join(root, 'artifacts', target));
await mkdir(evidenceDir, { recursive: true });
const taskProcessReport = join(evidenceDir, 'task-processes.json');
const taskProcesses = await verifyTaskProcessExecutable(launchExecutable, {
  packaged: true,
  env: process.env,
  evidence: taskProcessReport,
});
if (processOnly) {
  const summary = {
    scope: 'task-process',
    target,
    executable: launchExecutable,
    staticExecutable: executable,
    fuses,
    taskProcessReport,
    runtime: taskProcesses.runtime,
    scenarios: taskProcesses.reports.length,
    result: 'VERIFIED',
  };
  await writeFile(
    join(evidenceDir, 'process-package-summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
const reports = [];
async function verifyWorkbench(directory, pass, defaultBase) {
  const reportPath = join(directory, 'report.json');
  await mkdir(directory, { recursive: true });
  await rm(reportPath, { force: true });
  const environment = {
    ...process.env,
    BROWSER2D_NATIVE_BINDING: join(directory, 'must-not-load.node'),
    ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/must-not-load',
  };
  if (defaultBase) delete environment.BROWSER2D_DATA_DIR;
  else environment.BROWSER2D_DATA_DIR = directory;
  const child = spawn(
    launchExecutable,
    [
      `--verify-workbench=${reportPath}`,
      ...(defaultBase ? [`--verify-app-data=${defaultBase}`] : []),
    ],
    { cwd: tmpdir(), stdio: 'inherit', env: environment },
  );
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged workbench verification timed out'));
    }, 60_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(code, 0, 'Packaged workbench process failed');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.result, 'VERIFIED');
  assert.equal(report.appVersion, packagedManifest.version);
  assert.equal(report.appName, identity.productName);
  assert.equal(report.arch, target.endsWith('-arm64') ? 'arm64' : 'x64');
  assert.equal(
    report.platform,
    target.startsWith('mac-') ? 'darwin' : target.startsWith('win-') ? 'win32' : 'linux',
  );
  assert.equal(report.versions.electron, desktopRequire('electron/package.json').version);
  assert.equal(report.packaged, true);
  assert.equal(report.workerExited, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.dataPath, join(directory, 'data', 'app.sqlite'));
  assert.equal(report.dataOverride, !defaultBase);
  assert.equal(report.userData, directory);
  assert(report.workerEntry.includes('app.asar') && !report.workerEntry.includes(root));
  if (appImage)
    assert(report.workerEntry.includes('/.mount_'), 'AppImage worker must execute from FUSE');
  if (defaultBase) {
    assert.equal(report.appData, defaultBase);
    assert.equal(report.checks.initialBrowsers, 0);
    assert.equal(report.checks.initialCards, 0);
  } else {
    assert.equal(report.checks.initialBrowsers, (initialPass + pass - 1) * 2);
    assert.equal(report.checks.initialCards, initialPass + pass === 1 ? 0 : 1);
  }
  await copyFile(
    reportPath,
    join(evidenceDir, defaultBase ? 'default-path.json' : `package-pass-${pass}.json`),
  );
  return report;
}
for (let pass = 1; pass <= 2; pass++) reports.push(await verifyWorkbench(dataDir, pass));
const defaultBase = await mkdtemp(join(tmpdir(), 'browser-2d-default-'));
const defaultReport = await verifyWorkbench(
  join(defaultBase, identity.productName),
  1,
  defaultBase,
);
await writeFile(
  join(evidenceDir, 'package-summary.json'),
  JSON.stringify(
    {
      target,
      executable: launchExecutable,
      staticExecutable: executable,
      database: dataDir,
      fuses,
      initialPass,
      passes: reports.length,
      defaultPath: defaultReport.dataPath,
      taskProcessReport,
      result: 'VERIFIED',
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      target,
      executable,
      database: dataDir,
      fuses,
      passes: reports.length,
      defaultPath: defaultReport.dataPath,
      result: 'VERIFIED',
    },
    null,
    2,
  ),
);
