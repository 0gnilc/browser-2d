import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pnpm, root } from './process.mjs';
import {
  argumentsFor,
  buildEnvironment,
  gitState,
  hashFile,
  identity,
  releaseConfiguration,
  targets,
  validateProductionInputs,
} from '../internal/build-config/release.mjs';
import { artifactInventory } from './release-inventory.mjs';

const options = argumentsFor(process.argv.slice(2));
const target =
  options.target ||
  `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
const config = releaseConfiguration({
  mode: options.mode,
  target,
  channel: options.channel,
  feedBaseUrl: options['feed-base-url'],
});
const selected = targets[target];
if (selected.platform !== process.platform || selected.arch !== process.arch)
  throw new Error('Use a native OS/architecture runner for this target');
const source = gitState(root);
validateProductionInputs(config, process.env, source.dirty);
if (config.mode === 'production' && !options.dist)
  throw new Error('Production requires dist, including final installers and update metadata');
const version = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8')).version;
if (config.mode === 'production' && !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(
    'Production requires an ordinary semver version; channel selects stable or test metadata',
  );
const lockSha256 = await hashFile(join(root, 'pnpm-lock.yaml'));
const output =
  config.mode === 'preview'
    ? join(root, 'release', target)
    : join(root, 'release', 'production', config.channel, target);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'browser-2d-build-'));
try {
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
          .some((part) =>
            ['node_modules', 'dist', 'artifacts', 'release-resources'].includes(part),
          ),
    });
  }
  const resources = join(work, 'apps/desktop/release-resources');
  await mkdir(resources, { recursive: true });
  const configurationPath = join(resources, 'release-config.json');
  await writeFile(configurationPath, JSON.stringify(config, null, 2));
  const context = {
    schemaVersion: 1,
    ...source,
    lockSha256,
    version,
    target,
    mode: config.mode,
    configuration: config,
    identity,
    ...(target === 'win-x64' && config.mode === 'production'
      ? { windowsPublisher: process.env.BROWSER2D_WINDOWS_PUBLISHER }
      : {}),
    ...(target.startsWith('mac-') && config.mode === 'production'
      ? { macTeamId: process.env.APPLE_TEAM_ID }
      : {}),
    node: process.version,
    packageManager: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).packageManager,
    createdAt: new Date().toISOString(),
  };
  if (config.mode === 'production') {
    const currentSource = gitState(root);
    if (
      currentSource.dirty ||
      currentSource.sourceCommit !== source.sourceCommit ||
      (await hashFile(join(work, 'pnpm-lock.yaml'))) !== lockSha256
    )
      throw new Error('Source or lockfile changed during isolated copy');
  }
  const environment = buildEnvironment(config, process.env, output, configurationPath);
  await pnpm(['install', '--frozen-lockfile'], { cwd: work, env: environment });
  context.tools = {};
  for (const name of ['electron', 'electron-builder', 'electron-updater']) {
    const manifest = join(work, 'apps/desktop/node_modules', name, 'package.json');
    try {
      context.tools[name] = JSON.parse(await readFile(manifest, 'utf8')).version;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await pnpm(['build'], { cwd: work, env: environment });
  const args = [
    '--filter',
    '@browser-2d/desktop',
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.config.mjs',
    selected.flag,
    `--${selected.arch}`,
    '--publish',
    'never',
  ];
  if (!options.dist) args.push('--dir');
  await pnpm(args, { cwd: work, env: environment });
  if (config.mode === 'production' && target.startsWith('mac-')) {
    const { finalizeMacInstaller } = await import('./release-finalize-mac.mjs');
    await finalizeMacInstaller(output, environment);
  }
  await writeFile(join(output, 'build-context.json'), JSON.stringify(context, null, 2));
  await writeFile(
    join(output, 'artifact-inventory.json'),
    JSON.stringify({ schemaVersion: 1, files: await artifactInventory(output) }, null, 2),
  );
  console.log(`${config.mode} packaged target ready: ${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
