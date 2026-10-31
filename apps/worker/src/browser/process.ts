import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { z } from 'zod';

const exec = promisify(execFile);
export async function executablePath(configured: string): Promise<string> {
  if (configured) {
    await access(configured, constants.X_OK);
    return configured;
  }
  const installed = await puppeteer.executablePath('chrome').catch(() => undefined);
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ];
  if (installed) candidates.unshift(installed);
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  throw new Error('Chrome executable unavailable');
}
const processId = z.number().int().safe().min(2);
export const launchContractSchema = z.enum(['posix-group', 'windows-child']);
export const ownedLifetimeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('posix-group'), pgid: processId }),
  z.strictObject({ kind: z.literal('windows-child'), pid: processId }),
]);
export const stoppedProofSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('never-spawned') }),
  z.strictObject({ kind: z.literal('posix-group-empty'), pgid: processId }),
  z.strictObject({ kind: z.literal('windows-main-exited'), pid: processId }),
]);
export type OwnedLifetime = z.infer<typeof ownedLifetimeSchema>;
export type StoppedProof = z.infer<typeof stoppedProofSchema>;
export function launchContract(): z.infer<typeof launchContractSchema> {
  return process.platform === 'win32' ? 'windows-child' : 'posix-group';
}
export type OwnedChild = {
  child: ChildProcess;
  exited: boolean;
  failedToSpawn: boolean;
  lifetime: OwnedLifetime | undefined;
  started: Promise<OwnedLifetime>;
};
export function spawnOwned(executable: string, args: string[]): OwnedChild {
  const child = spawn(executable, args, {
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    detached: true,
  });
  const started = new Promise<OwnedLifetime>((resolve, reject) => {
    child.once('spawn', () => {
      try {
        const lifetime = ownedLifetimeSchema.parse(
          launchContract() === 'posix-group'
            ? { kind: 'posix-group', pgid: child.pid }
            : { kind: 'windows-child', pid: child.pid },
        );
        if (child.pid === process.pid) throw new Error('Owned process identity is not private');
        owned.lifetime = lifetime;
        resolve(lifetime);
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', reject);
  });
  const owned: OwnedChild = {
    child,
    exited: false,
    failedToSpawn: false,
    lifetime: undefined,
    started,
  };
  child.once('exit', () => {
    owned.exited = true;
  });
  child.once('error', () => {
    if (child.pid === undefined) owned.failedToSpawn = true;
  });
  return owned;
}
export function observeOwnedLifetime(lifetime: OwnedLifetime): 'present' | 'empty' | 'unknown' {
  if (lifetime.kind !== launchContract()) return 'unknown';
  const id = lifetime.kind === 'posix-group' ? lifetime.pgid : lifetime.pid;
  if (!Number.isSafeInteger(id) || id <= 1 || id === process.pid) return 'unknown';
  try {
    process.kill(lifetime.kind === 'posix-group' ? -id : id, 0);
    return 'present';
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'unclassified';
    if (code !== 'ESRCH' && process.env.BROWSER2D_ARM_DIAGNOSTIC === '1') {
      let mainProbe: unknown = 'present';
      try {
        process.kill(id, 0);
      } catch (mainError) {
        mainProbe =
          mainError instanceof Error && 'code' in mainError ? mainError.code : 'unclassified';
      }
      process.stderr.write(
        JSON.stringify({
          diagnostic: 'owned-lifetime-unknown',
          time: Date.now(),
          code,
          lifetime,
          platform: process.platform,
          arch: process.arch,
          workerPid: process.pid,
          mainProbe,
        }) + '\n',
      );
      for (const milliseconds of [5, 25, 100, 300]) {
        setTimeout(() => {
          let result: unknown = 'present';
          try {
            process.kill(lifetime.kind === 'posix-group' ? -id : id, 0);
          } catch (sampleError) {
            result =
              sampleError instanceof Error && 'code' in sampleError
                ? sampleError.code
                : 'unclassified';
          }
          process.stderr.write(
            JSON.stringify({
              diagnostic: 'owned-lifetime-followup',
              time: Date.now(),
              milliseconds,
              lifetime,
              workerPid: process.pid,
              result,
            }) + '\n',
          );
        }, milliseconds).unref();
      }
    }
    return code === 'ESRCH' ? 'empty' : 'unknown';
  }
}
export async function awaitOwnedLifetime(
  lifetime: OwnedLifetime,
  signal: AbortSignal,
): Promise<StoppedProof | undefined> {
  for (;;) {
    signal.throwIfAborted();
    const observation = observeOwnedLifetime(lifetime);
    switch (observation) {
      case 'unknown':
        return undefined;
      case 'empty':
        return lifetime.kind === 'posix-group'
          ? { kind: 'posix-group-empty', pgid: lifetime.pgid }
          : { kind: 'windows-main-exited', pid: lifetime.pid };
      case 'present':
        await delay(25, undefined, { signal });
        break;
      default: {
        const unreachable: never = observation;
        throw new Error(`Unknown owned lifetime observation ${unreachable}`);
      }
    }
  }
}
export async function processIdentity(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const result =
      process.platform === 'win32'
        ? await exec(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
            ],
            { timeout: 3000, windowsHide: true },
          )
        : await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 1000 });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}
export function processAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}
export async function awaitChildExit(owned: OwnedChild, signal: AbortSignal): Promise<void> {
  while (!owned.exited && !owned.failedToSpawn) await delay(25, undefined, { signal });
}
export async function stopOwnedChild(owned: OwnedChild, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (owned.exited || owned.failedToSpawn) return;
  owned.child.kill('SIGTERM');
  const escalation = setTimeout(() => {
    if (!owned.exited && !owned.failedToSpawn) owned.child.kill('SIGKILL');
  }, 300);
  try {
    await awaitChildExit(owned, signal);
  } finally {
    clearTimeout(escalation);
  }
}
