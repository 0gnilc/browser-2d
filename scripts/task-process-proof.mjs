import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export async function verifyTaskProcessExecutable(executable, options) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-process-'));
  const report = join(directory, 'report.json');
  const child = spawn(executable, [...(options.args ?? []), `--verify-task-processes=${report}`], {
    cwd: tmpdir(),
    stdio: 'inherit',
    env: { ...options.env, BROWSER2D_DATA_DIR: directory },
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Task process verification timeout'));
    }, 90_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(code, 0);
  const result = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(result.result, 'VERIFIED');
  assert.equal(result.packaged, options.packaged);
  if (options.packaged) assert(result.runtime.includes('app.asar'));
  await mkdir(dirname(options.evidence), { recursive: true });
  await copyFile(report, options.evidence);
  return result;
}
