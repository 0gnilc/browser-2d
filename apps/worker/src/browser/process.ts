import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

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
export type OwnedChild = { child: ChildProcess; exited: boolean; failedToSpawn: boolean };
export function spawnOwned(executable: string, args: string[]): OwnedChild {
  const child = spawn(executable, args, {
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    detached: process.platform === 'win32',
  });
  const owned: OwnedChild = { child, exited: false, failedToSpawn: false };
  child.once('exit', () => {
    owned.exited = true;
  });
  child.once('error', () => {
    if (child.pid === undefined) owned.failedToSpawn = true;
  });
  return owned;
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
