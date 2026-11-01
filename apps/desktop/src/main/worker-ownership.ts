import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { workerOwnerSchema } from '@browser-2d/contracts/host';

function absent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}
function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function claimWorkerOwnership(businessPath: string) {
  const directory = join(dirname(businessPath), 'worker-owners');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ownerNonce = randomUUID();
  const path = join(directory, `${ownerNonce}.json`);
  const pending = { format: 1, hostPid: process.pid, pid: null, ownerNonce } as const;
  function read(file: string) {
    const record = workerOwnerSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (file !== join(directory, `${record.ownerNonce}.json`))
      throw new Error('Worker ownership changed');
    return record;
  }
  function publish(record: typeof pending | (Omit<typeof pending, 'pid'> & { pid: number })) {
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, path);
    syncDirectory(directory);
  }
  publish(pending);
  try {
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json') || name === `${ownerNonce}.json`) continue;
      const other = join(directory, name);
      try {
        const previous = read(other);
        if (!absent(previous.pid ?? previous.hostPid))
          throw new Error('Previous worker exit is not confirmed');
        const current = read(other);
        if (!absent(current.pid ?? current.hostPid))
          throw new Error('Previous worker exit is not confirmed');
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  } catch (error) {
    rmSync(path);
    syncDirectory(directory);
    throw error;
  }
  return {
    ownerNonce,
    authorize(pid: number) {
      const current = read(path);
      if (current.ownerNonce !== ownerNonce) throw new Error('Worker ownership changed');
      if (current.pid !== null) throw new Error('Worker was already authorized');
      publish({ ...pending, pid });
    },
    release() {
      if (read(path).ownerNonce !== ownerNonce) throw new Error('Worker ownership changed');
      rmSync(path);
      syncDirectory(directory);
    },
  };
}
