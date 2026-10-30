import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)),
    );
  });
}
export function pnpm(args, options = {}) {
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error('Run this command through pnpm');
  return /\.[cm]?js$/.test(executable)
    ? run(process.execPath, [executable, ...args], options)
    : run(executable, args, options);
}
