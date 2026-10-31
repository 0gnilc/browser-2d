import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import {
  argumentsFor,
  digest,
  feedUrl,
  hashFile,
  identity,
  releaseConfiguration,
  targets,
} from '../internal/build-config/release.mjs';
import { artifactInventory, jsonFile, safeFilename, sameInventory } from './release-inventory.mjs';

export async function containedFile(directory, name) {
  safeFilename(name);
  const path = join(directory, name);
  assert((await lstat(path)).isFile(), `Expected regular file ${name}`);
  const destination = relative(await realpath(directory), await realpath(path));
  assert(
    !isAbsolute(destination) && !destination.startsWith('..'),
    `Escaping evidence path ${name}`,
  );
  return path;
}
export async function verifyMetadata(directory, context, files) {
  const selected = targets[context.target];
  const names = files.map((file) => file.name);
  for (const extension of selected.extensions)
    assert.equal(
      names.filter((name) => name.endsWith(extension)).length,
      1,
      `Expected exactly one final ${extension} artifact`,
    );
  for (const file of files.filter((file) =>
    selected.extensions.some((ext) => file.name.endsWith(ext)),
  ))
    assert(file.name.includes(context.version), `Artifact filename version mismatch ${file.name}`);
  const metadataFiles = files.filter((file) => /\.ya?ml$/.test(file.name));
  assert.deepEqual(
    metadataFiles.map((file) => file.name),
    [selected.metadata],
    'Unexpected or missing update metadata',
  );
  const document = parseDocument(
    await readFile(await containedFile(directory, selected.metadata), 'utf8'),
    { uniqueKeys: true },
  );
  assert.equal(document.errors.length, 0, 'Invalid update YAML');
  const metadata = document.toJS({ maxAliasCount: 0 });
  assert.equal(metadata.version, context.version, 'Update metadata version mismatch');
  assert(
    Array.isArray(metadata.files) && metadata.files.length > 0,
    'Update file inventory missing',
  );
  const seen = new Set();
  for (const reference of metadata.files) {
    safeFilename(reference.url);
    assert(!seen.has(reference.url), 'Duplicate update artifact');
    seen.add(reference.url);
    const file = files.find((file) => file.name === reference.url);
    assert(
      file && selected.extensions.some((ext) => file.name.endsWith(ext)),
      `Missing or unsupported update artifact ${reference.url}`,
    );
    assert.equal(reference.size, file.size, `Update size mismatch for ${file.name}`);
    assert.equal(reference.sha512, file.sha512, `Update SHA512 mismatch for ${file.name}`);
    assert(file.name.includes(context.version), `Artifact filename version mismatch ${file.name}`);
  }
  const updateExtension = context.target.startsWith('mac-')
    ? '.zip'
    : context.target.startsWith('win-')
      ? '.exe'
      : '.AppImage';
  assert(
    [...seen].some((name) => name.endsWith(updateExtension)),
    `Missing ${updateExtension} update payload`,
  );
  safeFilename(metadata.path);
  assert(seen.has(metadata.path), 'Legacy metadata path does not match files');
  assert.equal(
    metadata.sha512,
    files.find((file) => file.name === metadata.path).sha512,
    'Legacy metadata SHA512 mismatch',
  );
  for (const file of files.filter((file) => file.name.endsWith('.blockmap')))
    assert(
      files.some((payload) => payload.name === file.name.slice(0, -9)),
      `Orphan blockmap ${file.name}`,
    );
  return metadata;
}

const requiredScenarios = [
  'install',
  'upgrade',
  'controlledFeed',
  'dataRetention',
  'uninstall',
  'shutdown',
  'packageIsolation',
];
export async function verifyAcceptance(evidenceDirectory, context, files) {
  const path = await containedFile(evidenceDirectory, 'release-acceptance.json');
  const report = await jsonFile(path);
  assert.equal(report.schemaVersion, 1, 'Unsupported acceptance schema');
  for (const field of ['target', 'sourceCommit', 'lockSha256', 'version'])
    assert.equal(report[field], context[field], `Acceptance ${field} mismatch`);
  sameInventory(files, report.files);
  assert.equal(
    report.runner?.platform,
    targets[context.target].platform,
    'Acceptance requires the native platform',
  );
  assert.equal(
    report.runner?.arch,
    targets[context.target].arch,
    'Acceptance requires the native architecture',
  );
  const evidenceFiles = [{ name: 'release-acceptance.json', sha256: await hashFile(path) }];
  for (const scenario of requiredScenarios) {
    const result = report.scenarios?.[scenario];
    assert(
      result &&
        Array.isArray(result.command) &&
        result.command.length > 0 &&
        result.command.every((part) => typeof part === 'string' && part),
      `Missing executable acceptance evidence ${scenario}`,
    );
    assert.equal(result.exitCode, 0, `Acceptance failed ${scenario}`);
    assert(typeof result.log?.sha256 === 'string', `Missing acceptance log digest ${scenario}`);
    const log = await containedFile(evidenceDirectory, result.log.name);
    assert((await lstat(log)).size > 0, `Empty acceptance log ${scenario}`);
    assert.equal(await hashFile(log), result.log.sha256, `Acceptance log changed ${scenario}`);
    evidenceFiles.push({ name: result.log.name, sha256: result.log.sha256 });
  }
  const observations = Object.fromEntries(
    requiredScenarios.map((name) => [name, report.scenarios[name].observations]),
  );
  assert.equal(
    observations.install?.installedVersion,
    context.version,
    'Installed version missing',
  );
  assert.equal(observations.upgrade?.toVersion, context.version, 'Upgrade destination missing');
  assert(
    typeof observations.upgrade?.fromVersion === 'string' &&
      observations.upgrade.fromVersion !== context.version,
    'Distinct previous installed version required',
  );
  assert.equal(
    observations.controlledFeed?.toVersion,
    context.version,
    'Controlled update destination missing',
  );
  assert.equal(
    observations.controlledFeed?.fromVersion,
    observations.upgrade.fromVersion,
    'Controlled update origin mismatch',
  );
  assert.deepEqual(
    [...observations.controlledFeed.failureCases].sort(),
    ['checksum', 'http-404', 'offline'],
    'Controlled update failure evidence missing',
  );
  const updated = files.find((file) => file.name === observations.controlledFeed.downloadedFile);
  assert(
    updated &&
      updated.name.endsWith(
        context.target.startsWith('mac-')
          ? '.zip'
          : context.target.startsWith('win-')
            ? '.exe'
            : '.AppImage',
      ) &&
      observations.controlledFeed.downloadedSha512 === updated.sha512,
    'Controlled update payload mismatch',
  );
  assert.match(
    observations.dataRetention?.beforeSha256 || '',
    /^[a-f0-9]{64}$/,
    'Data fixture digest missing',
  );
  assert.equal(
    observations.dataRetention.afterSha256,
    observations.dataRetention.beforeSha256,
    'User data retention failed',
  );
  assert.deepEqual(
    observations.uninstall?.remainingInstallationPaths,
    [],
    'Uninstall evidence missing',
  );
  assert(
    Array.isArray(observations.shutdown?.ownedPidsBefore) &&
      observations.shutdown.ownedPidsBefore.length > 0,
    'Owned process shutdown was not exercised',
  );
  assert.deepEqual(
    observations.shutdown.ownedPidsAfter,
    [],
    'Owned processes remain after shutdown',
  );
  assert.equal(observations.shutdown.workerExitCode, 0, 'Worker shutdown did not complete');
  assert.equal(
    observations.packageIsolation?.installedVersion,
    context.version,
    'Outside-checkout execution missing',
  );
  assert.deepEqual(
    observations.packageIsolation?.sourcePathsAccessed,
    [],
    'Package depends on source checkout',
  );
  const legacy = report.legacySquirrel;
  assert(
    legacy?.status === 'none-attested' || legacy?.status === 'migration-verified',
    'Legacy Squirrel distribution remains unknown',
  );
  const legacyPath = await containedFile(evidenceDirectory, legacy.evidence?.name);
  assert(
    (await lstat(legacyPath)).size > 0 && (await hashFile(legacyPath)) === legacy.evidence.sha256,
    'Legacy Squirrel evidence missing or changed',
  );
  assert(
    typeof legacy.author === 'string' && legacy.author.trim(),
    'Legacy distribution evidence needs an accountable author',
  );
  if (legacy.status === 'migration-verified') {
    assert.equal(legacy.target, 'win-x64', 'Squirrel migration must be verified on Windows');
    assert.deepEqual(
      legacy.checked?.sort(),
      ['data-retention', 'registration', 'shortcuts', 'uninstall'],
      'Incomplete Squirrel migration exercise',
    );
  }
  evidenceFiles.push({ name: legacy.evidence.name, sha256: legacy.evidence.sha256 });
  return [...new Map(evidenceFiles.map((file) => [file.name, file])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function nativeCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert(
    !result.error && result.status === 0,
    `${command} failed: ${result.error?.message || result.stderr || result.stdout}`,
  );
  return {
    command: [command, ...args],
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
async function findNamed(directory, name) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === name) found.push(join(directory, name));
    else if (entry.isDirectory())
      found.push(...(await findNamed(join(directory, entry.name), name)));
  }
  return found;
}
export async function verifyNative(directory, context, files) {
  const selected = targets[context.target];
  assert(
    process.platform === selected.platform && process.arch === selected.arch,
    'Signature verification requires its native OS/architecture runner',
  );
  const records = [];
  const run = (command, args, options) => {
    const record = nativeCommand(command, args, options);
    records.push(record);
    return record.stdout;
  };
  if (selected.platform === 'win32') {
    const executables = files
      .filter((file) => file.name.endsWith('.exe'))
      .map((file) => join(directory, file.name));
    const application = await findNamed(directory, `${identity.executableName}.exe`);
    assert.equal(application.length, 1, 'Expected exactly one packaged Windows executable');
    assert(context.windowsPublisher, 'Windows publisher identity missing');
    for (const executable of [...executables, ...application]) {
      const script =
        '$s=Get-AuthenticodeSignature -LiteralPath $env:BROWSER2D_VERIFY_FILE; if ($s.Status -ne "Valid") { throw "Invalid Authenticode signature" }; [pscustomobject]@{Publisher=$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false); Version=(Get-Item -LiteralPath $env:BROWSER2D_VERIFY_FILE).VersionInfo.ProductVersion} | ConvertTo-Json -Compress';
      const info = JSON.parse(
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          env: { ...process.env, BROWSER2D_VERIFY_FILE: executable },
        }),
      );
      assert.equal(info.Publisher, context.windowsPublisher, 'Windows signer publisher mismatch');
      assert.equal(info.Version, context.version, 'Windows signed product version mismatch');
    }
    const resources = join(application[0], '..', 'resources');
    assert.deepEqual(
      await jsonFile(join(resources, 'release-config.json')),
      context.configuration,
      'Windows packaged update configuration mismatch',
    );
    const updaterDocument = parseDocument(
      await readFile(join(resources, 'app-update.yml'), 'utf8'),
      { uniqueKeys: true },
    );
    assert.equal(updaterDocument.errors.length, 0, 'Invalid Windows updater configuration');
    const updaterConfig = updaterDocument.toJS({ maxAliasCount: 0 });
    assert.equal(updaterConfig.provider, 'generic', 'Windows update provider mismatch');
    assert.equal(
      updaterConfig.url,
      feedUrl(context.configuration),
      'Windows embedded feed mismatch',
    );
    const publishers = Array.isArray(updaterConfig.publisherName)
      ? updaterConfig.publisherName
      : [updaterConfig.publisherName];
    assert.deepEqual(
      publishers,
      [context.windowsPublisher],
      'Windows updater publisher verification identity missing',
    );
  } else if (selected.platform === 'darwin') {
    const work = await mkdtemp(join(tmpdir(), 'browser-2d-signature-'));
    try {
      const zip = files.find((file) => file.name.endsWith('.zip'));
      run('ditto', ['-x', '-k', join(directory, zip.name), work]);
      const applications = await findNamed(work, `${identity.executableName}.app`);
      assert.equal(applications.length, 1, 'Expected one application in update ZIP');
      const app = applications[0];
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
      const signature = nativeCommand('codesign', ['-d', '--verbose=4', app]);
      records.push(signature);
      assert(
        signature.stderr.includes('Authority=Developer ID Application:'),
        'Developer ID signature required',
      );
      assert(
        signature.stderr.includes(`Identifier=${identity.appId}`),
        'Signed application identity mismatch',
      );
      assert(
        context.macTeamId && signature.stderr.includes(`TeamIdentifier=${context.macTeamId}`),
        'Apple signing team mismatch',
      );
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
      run('xcrun', ['stapler', 'validate', app]);
      const version = run('/usr/libexec/PlistBuddy', [
        '-c',
        'Print :CFBundleShortVersionString',
        join(app, 'Contents/Info.plist'),
      ]).trim();
      assert.equal(version, context.version, 'macOS application version mismatch');
      const appConfig = await jsonFile(join(app, 'Contents/Resources/release-config.json'));
      assert.deepEqual(appConfig, context.configuration, 'Packaged update configuration mismatch');
      const dmg = files.find((file) => file.name.endsWith('.dmg'));
      run('codesign', ['--verify', '--strict', join(directory, dmg.name)]);
      run('xcrun', ['stapler', 'validate', join(directory, dmg.name)]);
      run('spctl', [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        join(directory, dmg.name),
      ]);
      const mount = join(work, 'mounted');
      run('hdiutil', [
        'attach',
        '-readonly',
        '-nobrowse',
        '-mountpoint',
        mount,
        join(directory, dmg.name),
      ]);
      try {
        const mountedApp = join(mount, `${identity.executableName}.app`);
        run('codesign', ['--verify', '--deep', '--strict', mountedApp]);
        assert.equal(
          await hashFile(join(mountedApp, 'Contents/Resources/app.asar')),
          await hashFile(join(app, 'Contents/Resources/app.asar')),
          'DMG and update ZIP application payloads differ',
        );
        assert.deepEqual(
          await jsonFile(join(mountedApp, 'Contents/Resources/release-config.json')),
          appConfig,
          'DMG and ZIP update configurations differ',
        );
      } finally {
        run('hdiutil', ['detach', mount]);
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } else {
    const deb = files.find((file) => file.name.endsWith('.deb'));
    const rpm = files.find((file) => file.name.endsWith('.rpm'));
    assert.equal(
      run('dpkg-deb', ['--field', join(directory, deb.name), 'Version']).trim(),
      context.version,
      'DEB version mismatch',
    );
    assert.equal(
      run('dpkg-deb', ['--field', join(directory, deb.name), 'Architecture']).trim(),
      'amd64',
      'DEB architecture mismatch',
    );
    assert.equal(
      run('rpm', ['-qp', '--queryformat', '%{VERSION}', join(directory, rpm.name)]).trim(),
      context.version,
      'RPM version mismatch',
    );
    assert.equal(
      run('rpm', ['-qp', '--queryformat', '%{ARCH}', join(directory, rpm.name)]).trim(),
      'x86_64',
      'RPM architecture mismatch',
    );
  }
  return records;
}

export async function verifyRelease(directory, evidenceDirectory) {
  await rm(join(directory, 'release-receipt.json'), { force: true });
  const context = await jsonFile(await containedFile(directory, 'build-context.json'));
  assert.equal(context.schemaVersion, 1, 'Unsupported build context');
  assert.equal(context.mode, 'production', 'Preview builds cannot become production releases');
  assert.equal(context.dirty, false, 'Production source must be clean');
  assert.match(context.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(context.lockSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(context.identity, identity, 'Frozen application identity mismatch');
  assert.match(context.version, /^\d+\.\d+\.\d+$/);
  assert(Object.hasOwn(targets, context.target), 'Unknown production target');
  assert.deepEqual(
    releaseConfiguration(context.configuration),
    context.configuration,
    'Invalid packaged release configuration',
  );
  assert.equal(context.configuration.target, context.target, 'Configuration target mismatch');
  assert.equal(context.configuration.mode, context.mode, 'Configuration mode mismatch');
  const files = await artifactInventory(directory);
  sameInventory(
    files,
    (await jsonFile(await containedFile(directory, 'artifact-inventory.json'))).files,
  );
  await verifyMetadata(directory, context, files);
  const evidence = await verifyAcceptance(evidenceDirectory, context, files);
  const native = await verifyNative(directory, context, files);
  sameInventory(await artifactInventory(directory), files);
  sameInventory((await jsonFile(join(directory, 'artifact-inventory.json'))).files, files);
  assert.deepEqual(
    await jsonFile(join(directory, 'build-context.json')),
    context,
    'Build context changed during verification',
  );
  sameInventory(await verifyAcceptance(evidenceDirectory, context, files), evidence);
  const nativeReport = {
    schemaVersion: 1,
    target: context.target,
    sourceCommit: context.sourceCommit,
    version: context.version,
    records: native,
  };
  await writeFile(
    join(directory, 'native-verification.json'),
    JSON.stringify(nativeReport, null, 2),
  );
  const receipt = {
    schemaVersion: 1,
    sourceCommit: context.sourceCommit,
    lockSha256: context.lockSha256,
    version: context.version,
    target: context.target,
    configuration: context.configuration,
    identity,
    files,
    buildContextSha256: await hashFile(join(directory, 'build-context.json')),
    inventorySha256: await hashFile(join(directory, 'artifact-inventory.json')),
    nativeReportSha256: await hashFile(join(directory, 'native-verification.json')),
    evidence,
    evidenceDirectory: await realpath(evidenceDirectory),
    inventorySha256Digest: digest(JSON.stringify(files)),
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(join(directory, 'release-receipt.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = argumentsFor(process.argv.slice(2));
  assert(
    options.directory && options.evidence,
    'Use --directory=<candidate> --evidence=<external-native-evidence>',
  );
  const receipt = await verifyRelease(resolve(options.directory), resolve(options.evidence));
  console.log(`Verified exact production inventory for ${receipt.target} ${receipt.version}`);
}
