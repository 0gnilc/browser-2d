import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { argumentsFor, gitState, hashFile, targets } from '../internal/build-config/release.mjs';
import { artifactInventory, jsonFile, sameInventory } from './release-inventory.mjs';
import { root, run } from './process.mjs';

const execute = promisify(execFile);
const options = argumentsFor(process.argv.slice(2));
for (const key of Object.keys(options))
  assert(['target', 'directory'].includes(key), `Unsupported format verification option ${key}`);
const target =
  options.target || `${process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch}`;
assert(['linux-x64', 'mac-x64', 'mac-arm64'].includes(target), 'ZIP/AppImage target required');
assert.equal(process.platform, targets[target].platform, 'Format verification requires native OS');
assert.equal(
  process.arch,
  targets[target].arch,
  'Format verification requires native architecture',
);
const directory = resolve(options.directory || join(root, 'release', target));
const evidence = join(root, 'artifacts', 'formats', target);
await mkdir(evidence, { recursive: true });
await rm(join(evidence, 'format-summary.json'), { force: true });
const context = await jsonFile(join(directory, 'build-context.json'));
assert.equal(context.target, target);
assert.equal(context.mode, 'preview', 'This rehearsal accepts preview artifacts only');
assert.equal(context.dirty, false, 'Exact format verification requires a clean-source build');
assert.equal(context.sourceCommit, gitState(root).sourceCommit, 'Artifact source is stale');
assert.equal(context.lockSha256, await hashFile(join(root, 'pnpm-lock.yaml')), 'Lockfile mismatch');
const inventory = await jsonFile(join(directory, 'artifact-inventory.json'));
sameInventory(inventory.files, await artifactInventory(directory));
const extension = target.startsWith('mac-') ? '.zip' : '.AppImage';
const candidates = inventory.files.filter((file) => file.name.endsWith(extension));
assert.equal(candidates.length, 1, `Expected one ${extension} artifact`);
const artifact = candidates[0];
const path = join(directory, artifact.name);
const scratch = await mkdtemp(join(tmpdir(), 'browser-2d-format-'));
const data = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
try {
  let application;
  if (extension === '.zip') {
    application = join(scratch, 'zip');
    await execute('ditto', ['-x', '-k', path, application]);
  } else {
    assert(!process.env.APPIMAGE_EXTRACT_AND_RUN, 'Direct FUSE forbids extraction fallback');
    await chmod(path, 0o755);
    await execute(path, ['--appimage-extract'], { cwd: scratch, maxBuffer: 16 * 1024 * 1024 });
    application = join(scratch, 'squashfs-root');
  }
  await writeFile(
    join(evidence, 'source.json'),
    JSON.stringify({ context, artifact, inventoryVerified: true, format: extension }, null, 2),
  );
  await run(
    process.execPath,
    [
      'scripts/verify-package.mjs',
      `--target=${target}`,
      '--in-place',
      `--data-dir=${data}`,
      ...(extension === '.AppImage' ? [`--appimage=${path}`] : []),
    ],
    {
      env: {
        ...process.env,
        BROWSER2D_PACKAGE_DIR: application,
        BROWSER2D_EVIDENCE_DIR: evidence,
      },
    },
  );
  const passes = await Promise.all(
    [1, 2].map((pass) => jsonFile(join(evidence, `package-pass-${pass}.json`))),
  );
  sameInventory(inventory.files, await artifactInventory(directory));
  await writeFile(
    join(evidence, 'format-summary.json'),
    JSON.stringify(
      {
        result: 'VERIFIED',
        sourceCommit: context.sourceCommit,
        lockSha256: context.lockSha256,
        target,
        artifact,
        format: extension,
        directFuseLaunch: extension === '.AppImage',
        passes: passes.length,
        workerExited: passes.every((report) => report.workerExited),
        runtime: passes.map((report) => ({
          platform: report.platform,
          arch: report.arch,
          versions: report.versions,
          packaged: report.packaged,
          workerEntry: report.workerEntry,
        })),
      },
      null,
      2,
    ),
  );
  await rm(scratch, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
  console.log(`Exact preview ${extension} verified twice: ${target}`);
} catch (error) {
  console.error(`Format verification failed; retained diagnostics in ${scratch} and ${data}`);
  throw error;
}
