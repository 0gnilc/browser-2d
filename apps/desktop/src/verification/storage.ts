import assert from 'node:assert/strict';
import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export async function verificationDirectory(path: string, prefix: string) {
  const directory = resolve(path);
  const temporary = await realpath(tmpdir());
  assert.equal(await realpath(dirname(directory)), temporary);
  assert(basename(directory).startsWith(prefix));
  await verificationEntries(directory, [['.', 'directory']]);
  assert.equal(await realpath(directory), join(temporary, basename(directory)));
  return directory;
}

export async function verificationEntries(
  directory: string,
  entries: ReadonlyArray<readonly [string, 'directory' | 'file']>,
) {
  for (const [path, kind] of entries) {
    const entry = await lstat(join(directory, path)).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    });
    if (entry)
      assert(kind === 'directory' ? entry.isDirectory() : entry.isFile() && entry.nlink === 1);
  }
}

export async function verificationDatabase(directory: string, name = 'app.sqlite') {
  await verificationEntries(directory, [
    ['.', 'directory'],
    ...['', '-wal', '-shm', '-journal'].map((suffix) => [name + suffix, 'file'] as const),
  ]);
}

export async function verificationApplicationStorage(directory: string) {
  await verificationDatabase(directory);
  await verificationEntries(directory, [
    ['data-service-owners', 'directory'],
    ['execution-owners', 'directory'],
  ]);
}
