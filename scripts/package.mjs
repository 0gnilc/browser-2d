import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pnpm, root } from './process.mjs';

const defaultTarget = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice(9) || defaultTarget;
const targets = {
  'mac-x64': ['darwin', 'x64', '--mac'],
  'mac-arm64': ['darwin', 'arm64', '--mac'],
  'win-x64': ['win32', 'x64', '--win'],
  'linux-x64': ['linux', 'x64', '--linux'],
};
const selected = targets[target];
if (!selected) throw new Error(`Unsupported target ${target}`);
if (selected[0] !== process.platform || selected[1] !== process.arch)
  throw new Error('Use a native OS/architecture runner for this verification target');
const work = await mkdtemp(join(tmpdir(), 'browser-2d-build-'));
const output = join(root, 'release', target);
await mkdir(output, { recursive: true });
for (const name of [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.npmrc',
  'apps',
  'packages',
  'internal',
  'scripts',
]) {
  await cp(join(root, name), join(work, name), {
    recursive: true,
    filter: (source) =>
      !source
        .slice(root.length + 1)
        .split(/[\\/]/)
        .some((part) => ['node_modules', 'dist', 'artifacts'].includes(part)),
  });
}
await writeFile(
  join(output, 'build-context.json'),
  JSON.stringify(
    { target, work, node: process.version, createdAt: new Date().toISOString() },
    null,
    2,
  ),
);
await pnpm(['install', '--frozen-lockfile'], { cwd: work });
await pnpm(['build'], { cwd: work });
const args = [
  '--filter',
  '@browser-2d/desktop',
  'exec',
  'electron-builder',
  '--config',
  'electron-builder.config.mjs',
  selected[2],
  `--${selected[1]}`,
  '--publish',
  'never',
];
if (!process.argv.includes('--dist')) args.push('--dir');
await pnpm(args, {
  cwd: work,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', BROWSER2D_RELEASE_DIR: output },
});
console.log(`Native packaged target ready: ${output}`);
