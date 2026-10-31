import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  argumentsFor,
  buildEnvironment,
  digest,
  feedUrl,
  hashFile,
  identity,
  releaseConfiguration,
  validateProductionInputs,
} from '../internal/build-config/release.mjs';
import { finalizeMacUpdateMetadata } from './release-finalize-mac.mjs';
import { artifactInventory, sameInventory } from './release-inventory.mjs';
import {
  containedFile,
  verifyAcceptance,
  verifyMetadata,
  verifyRelease,
} from './release-verify.mjs';
import { prepareRelease, recheckReceipt } from './release-prepare.mjs';
import builderConfiguration from '../apps/desktop/electron-builder.config.mjs';

test('builder receives the installed updater version instead of the pnpm catalog protocol', async () => {
  const installed = JSON.parse(
    await readFile(
      new URL('../apps/desktop/node_modules/electron-updater/package.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    builderConfiguration.extraMetadata.dependencies['electron-updater'],
    installed.version,
  );
  assert.match(
    builderConfiguration.extraMetadata.dependencies['electron-updater'],
    /^\d+\.\d+\.\d+$/,
  );
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const context = {
    schemaVersion: 1,
    mode: 'production',
    dirty: false,
    target: 'linux-x64',
    version: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    lockSha256: 'b'.repeat(64),
    identity,
    configuration: releaseConfiguration({
      mode: 'production',
      channel: 'test',
      feedBaseUrl: 'https://updates.example.invalid/browser',
      target: 'linux-x64',
    }),
  };
  const payload = 'synthetic-not-installable';
  for (const extension of ['AppImage', 'deb', 'rpm'])
    await writeFile(join(directory, `browser-${context.version}.${extension}`), payload);
  const metadata = `version: ${context.version}\nfiles:\n  - url: browser-${context.version}.AppImage\n    sha512: ${digest(payload, 'sha512', 'base64')}\n    size: ${Buffer.byteLength(payload)}\npath: browser-${context.version}.AppImage\nsha512: ${digest(payload, 'sha512', 'base64')}\n`;
  await writeFile(join(directory, 'latest-linux.yml'), metadata);
  await writeFile(join(directory, 'build-context.json'), JSON.stringify(context));
  const files = await artifactInventory(directory);
  await writeFile(
    join(directory, 'artifact-inventory.json'),
    JSON.stringify({ schemaVersion: 1, files }),
  );
  return { directory, context, files, metadata };
}

test('staging rejects a descendant whose name only begins with two dots', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-stage-containment-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    prepareRelease(directory, join(directory, '..staging')),
    /outside the candidate directory/,
  );
});
async function acceptanceFixture(directory, context, files) {
  const log = 'Synthetic schema test. This file is not native acceptance evidence.\n';
  await writeFile(join(directory, 'test.log'), log);
  const scenarios = {};
  for (const scenario of [
    'install',
    'upgrade',
    'controlledFeed',
    'dataRetention',
    'uninstall',
    'shutdown',
    'packageIsolation',
  ])
    scenarios[scenario] = {
      command: ['synthetic-schema-fixture', scenario],
      exitCode: 0,
      log: { name: 'test.log', sha256: digest(log) },
      observations: {},
    };
  scenarios.install.observations = { installedVersion: context.version };
  scenarios.upgrade.observations = { fromVersion: '1.2.2', toVersion: context.version };
  scenarios.controlledFeed.observations = {
    fromVersion: '1.2.2',
    toVersion: context.version,
    failureCases: ['offline', 'http-404', 'checksum'],
    downloadedFile: 'browser-1.2.3.AppImage',
    downloadedSha512: files.find((file) => file.name.endsWith('.AppImage')).sha512,
  };
  scenarios.dataRetention.observations = {
    beforeSha256: 'c'.repeat(64),
    afterSha256: 'c'.repeat(64),
  };
  scenarios.uninstall.observations = { remainingInstallationPaths: [] };
  scenarios.shutdown.observations = {
    ownedPidsBefore: [12345],
    ownedPidsAfter: [],
    workerExitCode: 0,
  };
  scenarios.packageIsolation.observations = {
    installedVersion: context.version,
    sourcePathsAccessed: [],
  };
  const report = {
    schemaVersion: 1,
    target: context.target,
    version: context.version,
    sourceCommit: context.sourceCommit,
    lockSha256: context.lockSha256,
    files,
    runner: { platform: 'linux', arch: 'x64' },
    scenarios,
    legacySquirrel: {
      status: 'none-attested',
      author: 'Synthetic test author',
      evidence: { name: 'test.log', sha256: digest(log) },
    },
  };
  await writeFile(join(directory, 'release-acceptance.json'), JSON.stringify(report));
  return report;
}

test('preview configuration is independent of feed and signing secrets', () => {
  const config = releaseConfiguration({
    target: 'mac-x64',
    channel: 'invalid',
    feedBaseUrl: 'http://secret:password@localhost',
  });
  assert.deepEqual(config, { mode: 'preview' });
  const environment = buildEnvironment(
    config,
    {
      CSC_LINK: 'secret',
      CSC_NAME: 'secret',
      CSC_KEY_PASSWORD: 'secret',
      WIN_CSC_LINK: 'secret',
      APPLE_ID: 'secret',
      BROWSER2D_WINDOWS_PUBLISHER: 'secret',
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
      PATH: '/bin',
    },
    '/output',
    '/immutable/config',
  );
  assert.deepEqual(environment, {
    PATH: '/bin',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    BROWSER2D_RELEASE_DIR: '/output',
    BROWSER2D_RELEASE_CONFIG: '/immutable/config',
  });
});
test('production configuration needs explicit mode, channel, target and trustworthy feed URL', () => {
  const valid = {
    mode: 'production',
    channel: 'stable',
    feedBaseUrl: 'https://updates.example.invalid/base/',
    target: 'win-x64',
  };
  assert.equal(
    feedUrl(releaseConfiguration(valid)),
    'https://updates.example.invalid/base/stable/win-x64/',
  );
  for (const feedBaseUrl of [
    undefined,
    'http://example.invalid',
    'https://u:p@example.invalid',
    'https://example.invalid/?token=secret',
    'https://example.invalid/#fragment',
  ])
    assert.throws(() => releaseConfiguration({ ...valid, feedBaseUrl }));
  assert.throws(() => releaseConfiguration({ ...valid, channel: undefined }));
  assert.throws(() => releaseConfiguration({ ...valid, target: 'win-arm64' }));
  assert.throws(() => releaseConfiguration({ ...valid, mode: 'release' }));
});
test('production signing inputs and clean source fail closed before build', () => {
  const mac = releaseConfiguration({
    mode: 'production',
    channel: 'test',
    feedBaseUrl: 'https://example.invalid',
    target: 'mac-arm64',
  });
  const environment = {
    CSC_LINK: '/cert.p12',
    CSC_KEY_PASSWORD: 'test',
    CSC_NAME: 'Developer ID Application: Test',
    APPLE_ID: 'test',
    APPLE_APP_SPECIFIC_PASSWORD: 'test',
    APPLE_TEAM_ID: 'test',
  };
  assert.doesNotThrow(() => validateProductionInputs(mac, environment, false));
  for (const key of Object.keys(environment))
    assert.throws(() => validateProductionInputs(mac, { ...environment, [key]: '' }, false));
  assert.throws(() => validateProductionInputs(mac, environment, true), /clean source/);
  const win = { ...mac, target: 'win-x64' };
  assert.throws(() => validateProductionInputs(win, environment, false), /WINDOWS_PUBLISHER/);
  assert.equal(
    buildEnvironment(mac, { CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...environment }, '/out', '/cfg')
      .CSC_IDENTITY_AUTO_DISCOVERY,
    undefined,
  );
});
test('unknown CLI arguments and missing values fail instead of selecting preview accidentally', () => {
  assert.throws(() => argumentsFor(['--mode', 'production']));
  assert.throws(() => argumentsFor(['--production']));
  assert.deepEqual(argumentsFor(['--', '--mode=preview', '--feed-base-url=', '--dist']), {
    mode: 'preview',
    'feed-base-url': '',
    dist: true,
  });
});
test('production CLI refuses a missing feed before invoking pnpm', () => {
  const target =
    process.platform === 'darwin'
      ? `mac-${process.arch}`
      : process.platform === 'win32'
        ? 'win-x64'
        : 'linux-x64';
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'scripts/package.mjs',
          '--dist',
          '--mode=production',
          `--target=${target}`,
          '--channel=test',
        ],
        {
          env: {
            ...process.env,
            npm_execpath: '/definitely-not-a-pnpm-executable',
            CSC_LINK: '',
            CSC_KEY_PASSWORD: '',
          },
          stdio: 'pipe',
        },
      ),
    (error) => {
      assert.match(error.stderr.toString(), /Production requires --feed-base-url/);
      assert.doesNotMatch(error.stderr.toString(), /definitely-not-a-pnpm/);
      return true;
    },
  );
});
test('metadata checks final file size and SHA512 using real file bytes', async (t) => {
  const { directory, context, files } = await fixture(t);
  await verifyMetadata(directory, context, files);
  await writeFile(join(directory, 'browser-1.2.3.AppImage'), 'corrupted after packaging');
  const changed = await artifactInventory(directory);
  assert.throws(() => sameInventory(changed, files));
  await assert.rejects(
    verifyMetadata(directory, context, changed),
    /size mismatch|SHA512 mismatch/,
  );
});
test('same-size payload corruption fails the SHA512 check', async (t) => {
  const { directory, context } = await fixture(t);
  await writeFile(join(directory, 'browser-1.2.3.AppImage'), 'Synthetic-not-installable');
  await assert.rejects(
    verifyMetadata(directory, context, await artifactInventory(directory)),
    /SHA512 mismatch/,
  );
});
test('missing final metadata blocks production verification', async (t) => {
  const { directory, context } = await fixture(t);
  await rm(join(directory, 'latest-linux.yml'));
  await assert.rejects(
    verifyMetadata(directory, context, await artifactInventory(directory)),
    /metadata/,
  );
});
test('metadata rejects traversal, remote URLs, version mismatch and duplicate YAML keys', async (t) => {
  const { directory, context, metadata } = await fixture(t);
  for (const altered of [
    metadata.replace('url: browser', 'url: ../browser'),
    metadata.replace('url: browser', 'url: https://example.invalid/browser'),
    metadata.replace('version: 1.2.3', 'version: 2.0.0'),
    `${metadata}version: 1.2.3\n`,
  ]) {
    await writeFile(join(directory, 'latest-linux.yml'), altered);
    await assert.rejects(verifyMetadata(directory, context, await artifactInventory(directory)));
  }
});
test('preview build never mints a receipt and removes stale receipt', async (t) => {
  const { directory, context } = await fixture(t);
  await writeFile(
    join(directory, 'build-context.json'),
    JSON.stringify({ ...context, mode: 'preview' }),
  );
  await writeFile(join(directory, 'release-receipt.json'), '{"verified":true}');
  await assert.rejects(verifyRelease(directory, directory), /Preview builds/);
  await assert.rejects(readFile(join(directory, 'release-receipt.json')), { code: 'ENOENT' });
});
test('valid metadata and hashes without real acceptance reports cannot mint a release receipt', async (t) => {
  const { directory } = await fixture(t);
  await assert.rejects(verifyRelease(directory, directory), /ENOENT/);
  await assert.rejects(readFile(join(directory, 'release-receipt.json')), { code: 'ENOENT' });
});
test('acceptance schema requires observations and hashed logs, never a passed flag', async (t) => {
  const { directory, context, files } = await fixture(t);
  const report = await acceptanceFixture(directory, context, files);
  assert.equal((await verifyAcceptance(directory, context, files)).length, 2);
  report.scenarios.upgrade = { passed: true };
  await writeFile(join(directory, 'release-acceptance.json'), JSON.stringify(report));
  await assert.rejects(
    verifyAcceptance(directory, context, files),
    /Missing executable acceptance/,
  );
});
test('modified evidence logs and reports for a different artifact fail', async (t) => {
  const { directory, context, files } = await fixture(t);
  const report = await acceptanceFixture(directory, context, files);
  await writeFile(join(directory, 'test.log'), 'changed evidence');
  await assert.rejects(verifyAcceptance(directory, context, files), /log changed/);
  await acceptanceFixture(directory, context, files);
  report.files[0].sha256 = '0'.repeat(64);
  await writeFile(join(directory, 'release-acceptance.json'), JSON.stringify(report));
  await assert.rejects(
    verifyAcceptance(directory, context, await artifactInventory(directory)),
    /inventory changed/,
  );
});
test('unknown Squirrel distribution is an explicit failed gate', async (t) => {
  const { directory, context, files } = await fixture(t);
  const report = await acceptanceFixture(directory, context, files);
  report.legacySquirrel = { status: 'unknown' };
  await writeFile(join(directory, 'release-acceptance.json'), JSON.stringify(report));
  await assert.rejects(
    verifyAcceptance(directory, context, files),
    /Squirrel distribution remains unknown/,
  );
});
test('evidence traversal and symbolic links are rejected', async (t) => {
  const { directory } = await fixture(t);
  await assert.rejects(containedFile(directory, '../build-context.json'), /Unsafe/);
  if (process.platform !== 'win32') {
    await symlink(join(directory, 'build-context.json'), join(directory, 'linked.json'));
    await assert.rejects(containedFile(directory, 'linked.json'), /regular file/);
  }
});
test('artifact links cannot smuggle outside bytes into an inventory', async (t) => {
  const { directory } = await fixture(t);
  if (process.platform === 'win32') return;
  await symlink(join(directory, 'build-context.json'), join(directory, 'linked.zip'));
  await assert.rejects(artifactInventory(directory), /regular file/);
});
test('staging rejects fabricated preview receipt and never builds or publishes', async (t) => {
  const { directory } = await fixture(t);
  await writeFile(
    join(directory, 'release-receipt.json'),
    JSON.stringify({ schemaVersion: 1, configuration: { mode: 'preview' }, verified: true }),
  );
  await assert.rejects(recheckReceipt(directory), /Preview builds/);
  await assert.rejects(prepareRelease(directory, join(directory, 'staging')), /outside/);
});
test('remote release command always refuses publication without destination and authorization', () => {
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/release-publish.mjs'], { stdio: 'pipe' }),
    (error) => {
      assert.match(error.stderr.toString(), /Remote publication is disabled/);
      return true;
    },
  );
});
test('receipt rejects changed artifact bytes even if a previous check succeeded', async (t) => {
  const { directory, context, files } = await fixture(t);
  await writeFile(
    join(directory, 'release-receipt.json'),
    JSON.stringify({
      schemaVersion: 1,
      target: context.target,
      configuration: context.configuration,
      identity,
      files,
    }),
  );
  await writeFile(join(directory, 'browser-1.2.3.deb'), 'different final deb');
  await assert.rejects(recheckReceipt(directory), /inventory changed/);
});

test('macOS finalization keeps ZIP bytes and removes stale DMG differential metadata after stapling', async (t) => {
  const { directory, context } = await fixture(t);
  const zipName = 'browser-1.2.3.zip';
  const dmgName = 'browser-1.2.3.dmg';
  await writeFile(join(directory, zipName), 'unchanged ZIP update payload');
  await writeFile(join(directory, dmgName), 'DMG bytes after stapling');
  await writeFile(join(directory, `${dmgName}.blockmap`), 'obsolete pre-staple blockmap');
  const zipSha512 = await hashFile(join(directory, zipName), 'sha512', 'base64');
  await writeFile(
    join(directory, 'latest-mac.yml'),
    `version: 1.2.3\nfiles:\n  - url: ${zipName}\n    sha512: ${zipSha512}\n    size: 28\n  - url: ${dmgName}\n    sha512: old-dmg-digest\n    size: 10\npath: ${dmgName}\nsha512: old-dmg-digest\n`,
  );
  await finalizeMacUpdateMetadata(directory, dmgName);
  const output = await readFile(join(directory, 'latest-mac.yml'), 'utf8');
  assert(!output.includes(dmgName));
  assert(output.includes(zipName));
  assert.equal(await hashFile(join(directory, zipName), 'sha512', 'base64'), zipSha512);
  await assert.rejects(readFile(join(directory, `${dmgName}.blockmap`)), { code: 'ENOENT' });
  const files = (await artifactInventory(directory)).filter(
    (file) =>
      !file.name.endsWith('.AppImage') &&
      !file.name.endsWith('.deb') &&
      !file.name.endsWith('.rpm') &&
      file.name !== 'latest-linux.yml',
  );
  await verifyMetadata(directory, { ...context, target: 'mac-x64' }, files);
});
