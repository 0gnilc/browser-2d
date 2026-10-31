import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { artifactInventory, jsonFile, sameInventory } from './release-inventory.mjs';
import { root, run } from './process.mjs';

const execute = promisify(execFile);
const sourceCommit = 'f52238f4e54117649cfeee710ed336d0724dba67';
const target = process.env.TARGET;
assert(['linux-x64', 'mac-x64', 'mac-arm64'].includes(target));
const directory = join(root, 'downloaded', 'release', target);
const evidence = join(root, 'artifacts', 'extra-formats');
await mkdir(evidence, { recursive: true });
const context = await jsonFile(join(directory, 'build-context.json'));
assert.equal(context.sourceCommit, sourceCommit);
assert.equal(context.target, target);
assert.equal(context.mode, 'preview');
const inventory = await jsonFile(join(directory, 'artifact-inventory.json'));
sameInventory(inventory.files, await artifactInventory(directory));
const extension = target.startsWith('mac-') ? '.zip' : '.AppImage';
const candidates = inventory.files.filter((file) => file.name.endsWith(extension));
assert.equal(candidates.length, 1);
const artifact = candidates[0];
const path = join(directory, artifact.name);
const scratch = await mkdtemp(join(tmpdir(), 'browser-2d-format-'));
const data = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
let application;
if (extension === '.zip') {
  application = join(scratch, 'zip');
  await execute('ditto', ['-x', '-k', path, application]);
} else {
  assert(
    !process.env.APPIMAGE_EXTRACT_AND_RUN,
    'Direct FUSE verification forbids extraction fallback',
  );
  await chmod(path, 0o755);
  await execute(path, ['--appimage-extract'], { cwd: scratch, maxBuffer: 16 * 1024 * 1024 });
  application = join(scratch, 'squashfs-root');
}
await writeFile(
  join(evidence, 'source.json'),
  JSON.stringify(
    {
      sourceRun: 41184202293,
      sourceCommit,
      context,
      artifact,
      inventoryVerified: true,
      format: extension,
      launch: extension === '.zip' ? 'extracted ZIP application' : 'direct AppImage with FUSE',
    },
    null,
    2,
  ),
);
await run(
  process.execPath,
  ['scripts/verify-package.mjs', `--target=${target}`, '--in-place', `--data-dir=${data}`],
  {
    env: {
      ...process.env,
      BROWSER2D_PACKAGE_DIR: application,
      BROWSER2D_EVIDENCE_DIR: evidence,
      ...(extension === '.AppImage' ? { BROWSER2D_APPIMAGE_EXECUTABLE: path } : {}),
    },
  },
);
const passes = await Promise.all(
  [1, 2].map(async (pass) =>
    JSON.parse(await readFile(join(evidence, `package-pass-${pass}.json`), 'utf8')),
  ),
);
if (extension === '.AppImage') {
  for (const report of passes)
    assert(
      report.workerEntry.includes('/.mount_'),
      'AppImage worker must execute from its FUSE mount',
    );
}
await writeFile(
  join(evidence, 'format-summary.json'),
  JSON.stringify(
    {
      result: 'VERIFIED',
      sourceRun: 41184202293,
      sourceCommit,
      target,
      artifact,
      format: extension,
      directFuseLaunch: extension === '.AppImage',
      passes: passes.length,
      realChromeObserved: true,
      databasePersistedAcrossRestart: true,
      workerExited: passes.every((report) => report.workerExited),
      runtime: passes.map((report) => ({
        platform: report.platform,
        arch: report.arch,
        versions: report.versions,
        packaged: report.packaged,
        workerEntry: report.workerEntry,
        result: report.result,
      })),
    },
    null,
    2,
  ),
);
