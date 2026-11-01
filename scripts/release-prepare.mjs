import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  argumentsFor,
  digest,
  hashFile,
  identity,
  targets,
} from '../internal/build-config/release.mjs';
import { artifactInventory, jsonFile, sameInventory } from './release-inventory.mjs';
import { containedFile, verifyAcceptance, verifyMetadata } from './release-verify.mjs';

export async function recheckReceipt(directory) {
  const receipt = await jsonFile(await containedFile(directory, 'release-receipt.json'));
  assert.equal(receipt.schemaVersion, 1, 'Unsupported release receipt');
  assert.equal(
    receipt.configuration?.mode,
    'production',
    'Preview builds cannot be staged as production',
  );
  assert.deepEqual(receipt.identity, identity, 'Release identity mismatch');
  assert(Object.hasOwn(targets, receipt.target), 'Unknown receipt target');
  assert.equal(receipt.configuration.target, receipt.target, 'Receipt target mismatch');
  const files = await artifactInventory(directory);
  sameInventory(files, receipt.files);
  assert.equal(
    receipt.inventorySha256Digest,
    digest(JSON.stringify(files)),
    'Receipt inventory digest mismatch',
  );
  for (const [name, expected] of [
    ['build-context.json', receipt.buildContextSha256],
    ['artifact-inventory.json', receipt.inventorySha256],
    ['native-verification.json', receipt.nativeReportSha256],
  ]) {
    assert.equal(
      await hashFile(await containedFile(directory, name)),
      expected,
      `Verified ${name} changed`,
    );
  }
  sameInventory((await jsonFile(join(directory, 'artifact-inventory.json'))).files, files);
  const context = await jsonFile(join(directory, 'build-context.json'));
  assert.equal(context.dirty, false, 'Dirty source is not releasable');
  assert.equal(context.mode, 'production', 'Build context is not production');
  assert.deepEqual(context.configuration, receipt.configuration, 'Receipt configuration mismatch');
  for (const field of ['target', 'sourceCommit', 'lockSha256', 'version'])
    assert.equal(receipt[field], context[field], `Receipt ${field} mismatch`);
  await verifyMetadata(directory, context, files);
  sameInventory(
    await verifyAcceptance(receipt.evidenceDirectory, context, files),
    receipt.evidence,
  );
  const native = await jsonFile(join(directory, 'native-verification.json'));
  for (const field of ['target', 'sourceCommit', 'version'])
    assert.equal(native[field], context[field], `Native evidence ${field} mismatch`);
  assert.equal(native.schemaVersion, 1, 'Unsupported native evidence');
  assert(
    Array.isArray(native.records) &&
      native.records.length > 0 &&
      native.records.every(
        (record) =>
          record.exitCode === 0 &&
          Array.isArray(record.command) &&
          record.command.length > 1 &&
          typeof record.stdout === 'string' &&
          typeof record.stderr === 'string',
      ),
    'Missing native verification command records',
  );
  return receipt;
}
async function canonicalDestination(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonicalDestination(dirname(path)), basename(path));
  }
}
export async function prepareRelease(directory, staging) {
  directory = await realpath(directory);
  const requestedStaging = staging;
  staging = await canonicalDestination(resolve(staging));
  try {
    assert(!(await lstat(requestedStaging)).isSymbolicLink(), 'Staging cannot be a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const relationship = relative(resolve(directory), resolve(staging));
  assert(
    isAbsolute(relationship) || relationship.split(/[\\/]/)[0] === '..',
    'Staging must be outside the candidate directory',
  );
  const reverse = relative(resolve(staging), resolve(directory));
  assert(
    isAbsolute(reverse) || reverse.split(/[\\/]/)[0] === '..',
    'Staging cannot contain the candidate directory',
  );
  const receipts = [];
  for (const target of Object.keys(targets).sort()) {
    assert(
      (await lstat(join(directory, target))).isDirectory(),
      'Target candidate must be a directory, not a symlink',
    );
    const receipt = await recheckReceipt(join(directory, target));
    assert.equal(receipt.target, target, 'Candidate directory and receipt target mismatch');
    receipts.push(receipt);
  }
  const baseline = receipts[0];
  for (const receipt of receipts) {
    for (const field of ['sourceCommit', 'lockSha256', 'version'])
      assert.equal(receipt[field], baseline[field], `Four-target ${field} mismatch`);
    for (const field of ['channel', 'feedBaseUrl'])
      assert.equal(
        receipt.configuration[field],
        baseline.configuration[field],
        `Four-target ${field} mismatch`,
      );
  }
  try {
    assert(!(await lstat(staging)).isSymbolicLink(), 'Staging cannot be a symlink');
    assert.equal((await readdir(staging)).length, 0, 'Staging must be empty');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(staging, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    sourceCommit: baseline.sourceCommit,
    lockSha256: baseline.lockSha256,
    version: baseline.version,
    channel: baseline.configuration.channel,
    feedBaseUrl: baseline.configuration.feedBaseUrl,
    files: [],
  };
  try {
    for (const receipt of receipts) {
      const source = join(directory, receipt.target);
      const destination = join(staging, receipt.target);
      await mkdir(destination);
      const files = [
        ...receipt.files.map((file) => ({
          ...file,
          publication: /\.yml$/.test(file.name) ? 'metadata-last' : 'payload-first',
        })),
        ...(await Promise.all(
          [
            'release-receipt.json',
            'build-context.json',
            'artifact-inventory.json',
            'native-verification.json',
          ].map(async (name) => ({
            name,
            sha256: await hashFile(await containedFile(source, name)),
            publication: 'provenance-only',
          })),
        )),
      ];
      for (const file of files) {
        const from = await containedFile(source, file.name);
        assert.equal(await hashFile(from), file.sha256, `File changed before staging ${file.name}`);
        const to = join(destination, file.name);
        await copyFile(from, to);
        assert.equal(await hashFile(to), file.sha256, `File changed during staging ${file.name}`);
        manifest.files.push({ target: receipt.target, ...file });
      }
      const evidenceDestination = join(destination, 'evidence');
      await mkdir(evidenceDestination);
      for (const file of receipt.evidence) {
        const from = await containedFile(receipt.evidenceDirectory, file.name);
        assert.equal(
          await hashFile(from),
          file.sha256,
          `Evidence changed before staging ${file.name}`,
        );
        const to = join(evidenceDestination, file.name);
        await copyFile(from, to);
        assert.equal(
          await hashFile(to),
          file.sha256,
          `Evidence changed during staging ${file.name}`,
        );
        manifest.files.push({
          target: receipt.target,
          name: `evidence/${file.name}`,
          sha256: file.sha256,
          publication: 'provenance-only',
        });
      }
      await recheckReceipt(source);
    }
    await writeFile(join(staging, 'upload-manifest.json'), JSON.stringify(manifest, null, 2));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = argumentsFor(process.argv.slice(2));
  assert(
    options.directory && options.staging,
    'Use --directory=<production-channel-root> --staging=<empty-directory>',
  );
  const manifest = await prepareRelease(resolve(options.directory), resolve(options.staging));
  console.log(`Staged ${manifest.files.length} verified files; no files uploaded`);
}
