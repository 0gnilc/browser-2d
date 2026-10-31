import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  fsyncSync,
  openSync,
  readFileSync,
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
function syncDirectory(path: string) {
  if (process.platform === 'win32') return;
  const fd = openSync(dirname(path), 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function claimWorkerOwnership(businessPath: string) {
  mkdirSync(dirname(businessPath), { recursive: true, mode: 0o700 });
  const path = join(dirname(businessPath), 'worker-owner.json');
  const ownerNonce = randomUUID();
  const pending = { format: 1, hostPid: process.pid, pid: null, ownerNonce } as const;
  function read() {
    return workerOwnerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }
  try {
    const previous = read();
    if (!absent(previous.pid ?? previous.hostPid))
      throw new Error('Previous worker exit is not confirmed');
    if (read().ownerNonce !== previous.ownerNonce) throw new Error('Worker ownership changed');
    rmSync(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  writeFileSync(path, JSON.stringify(pending), { flag: 'wx', mode: 0o600, flush: true });
  syncDirectory(path);
  return {
    ownerNonce,
    authorize(pid: number) {
      if (read().ownerNonce !== ownerNonce) throw new Error('Worker ownership changed');
      const temporary = `${path}.${ownerNonce}.tmp`;
      writeFileSync(temporary, JSON.stringify({ ...pending, pid }), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      renameSync(temporary, path);
      syncDirectory(path);
    },
    release() {
      if (read().ownerNonce !== ownerNonce) throw new Error('Worker ownership changed');
      rmSync(path);
      syncDirectory(path);
    },
  };
}
