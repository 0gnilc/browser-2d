import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashFile } from '../internal/build-config/release.mjs';

export function safeFilename(value) {
  assert(
    typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
      value !== '.' &&
      value !== '..',
    `Unsafe artifact filename ${value}`,
  );
  return value;
}
export function isArtifact(name) {
  return (
    /\.(dmg|zip|exe|AppImage|deb|rpm|blockmap|ya?ml)$/.test(name) && !name.startsWith('builder-')
  );
}
export async function artifactInventory(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!isArtifact(entry.name)) continue;
    safeFilename(entry.name);
    assert(entry.isFile(), `Artifact must be a regular file: ${entry.name}`);
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    assert(stat.size > 0, `Empty artifact ${entry.name}`);
    files.push({
      name: entry.name,
      size: stat.size,
      sha256: await hashFile(path),
      sha512: await hashFile(path, 'sha512', 'base64'),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
export async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
export function sameInventory(actual, expected) {
  assert.deepEqual(
    actual,
    expected,
    'Artifact inventory changed; rebuild and repeat acceptance for these exact files',
  );
}
