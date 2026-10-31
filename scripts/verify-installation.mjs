import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './process.mjs';

const execute = promisify(execFile);
const target = `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`;
assert(['mac-x64', 'mac-arm64', 'win-x64', 'linux-x64'].includes(target));
assert(
  process.platform === 'darwin' || process.env.CI === 'true',
  'Windows/Linux installation verification requires a disposable CI runner',
);
const directory = join(root, 'release', target);
const evidence = join(root, 'artifacts', 'installation', target);
await mkdir(evidence, { recursive: true });
const files = await readdir(directory);
const extension =
  process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.deb';
const installers = files.filter((name) => name.endsWith(extension));
assert.equal(installers.length, 1, 'Expected one preview installer');
const installer = join(directory, installers[0]);
const context = JSON.parse(await readFile(join(directory, 'build-context.json'), 'utf8'));
assert(
  !context.mode || context.mode === 'preview',
  'This rehearsal accepts preview artifacts only',
);
const scratch = await mkdtemp(join(tmpdir(), 'browser-2d-native-install-'));
const data = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
const commands = [];
async function command(file, args, options = {}) {
  const result = await execute(file, args, {
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  commands.push({ file, args, exitCode: 0 });
  await writeFile(join(evidence, `command-${commands.length}.log`), result.stdout + result.stderr);
  return result.stdout.trim();
}
async function hash(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
let application;
let debName;
let mounted = false;
let installed = false;
const mount = join(scratch, 'volume');
async function install() {
  if (process.platform === 'darwin') {
    await mkdir(mount, { recursive: true });
    await command('hdiutil', ['attach', installer, '-readonly', '-nobrowse', '-mountpoint', mount]);
    mounted = true;
    const apps = (await readdir(mount)).filter((name) => name.endsWith('.app'));
    assert.equal(apps.length, 1, 'DMG must contain one application');
    application = join(scratch, 'installed', apps[0]);
    installed = true;
    await cp(join(mount, apps[0]), application, { recursive: true, verbatimSymlinks: true });
    await command('hdiutil', ['detach', mount]);
    mounted = false;
  } else if (process.platform === 'win32') {
    application = join(scratch, 'installed');
    installed = true;
    await command(installer, ['/S', `/D=${application}`]);
  } else {
    debName = await command('dpkg-deb', ['--field', installer, 'Package']);
    assert(/^[a-z0-9][a-z0-9+.-]+$/.test(debName), 'Invalid Debian package name');
    installed = true;
    await command('sudo', ['dpkg', '--install', installer]);
    const listing = (await command('dpkg', ['--listfiles', debName])).split('\n');
    const executables = listing.filter(
      (path) => path.endsWith('/browser-2d-foundation') && path.startsWith('/opt/'),
    );
    assert.equal(executables.length, 1);
    application = dirname(executables[0]);
  }
}
async function uninstall() {
  if (!installed) return;
  if (process.platform === 'darwin') {
    await rm(application, { recursive: true, force: true });
  } else if (process.platform === 'win32') {
    const uninstallers = (await readdir(application)).filter((name) =>
      /^uninstall.*\.exe$/i.test(name),
    );
    assert.equal(uninstallers.length, 1, 'NSIS uninstaller missing');
    await command(join(application, uninstallers[0]), ['/S']);
    const executable = join(application, 'browser-2d-foundation.exe');
    let absent = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await readFile(executable);
      } catch (error) {
        if (error.code === 'ENOENT') {
          absent = true;
          break;
        }
        throw error;
      }
      await delay(100);
    }
    assert(absent, 'NSIS uninstall did not remove the application');
  } else {
    await command('sudo', ['dpkg', '--remove', debName]);
  }
  installed = false;
}
async function verify(initialPass) {
  const npmExecPath = process.env.npm_execpath;
  assert(npmExecPath, 'Run through pnpm');
  const args = [
    'verify:package',
    '--',
    `--target=${target}`,
    '--in-place',
    `--data-dir=${data}`,
    `--initial-pass=${initialPass}`,
  ];
  await command(
    /\.[cm]?js$/.test(npmExecPath) ? process.execPath : npmExecPath,
    /\.[cm]?js$/.test(npmExecPath) ? [npmExecPath, ...args] : args,
    {
      cwd: root,
      env: {
        ...process.env,
        BROWSER2D_PACKAGE_DIR: application,
        BROWSER2D_EVIDENCE_DIR: join(evidence, `pass-${initialPass}`),
      },
    },
  );
}
try {
  await install();
  await verify(0);
  const beforeUninstall = await hash(join(data, 'data.db'));
  await uninstall();
  assert.equal(await hash(join(data, 'data.db')), beforeUninstall, 'Uninstall changed user data');
  await install();
  await verify(2);
  const afterReinstall = await hash(join(data, 'data.db'));
  await uninstall();
  assert.equal(
    await hash(join(data, 'data.db')),
    afterReinstall,
    'Final uninstall changed user data',
  );
  await writeFile(
    join(evidence, 'installation.json'),
    JSON.stringify(
      {
        target,
        mode: 'preview',
        source: context,
        installer: { name: installers[0], sha256: await hash(installer) },
        result: 'VERIFIED',
        sameVersionReinstall: true,
        nativeUpgrade: 'NOT_VERIFIED',
        dataPreservedOnUninstall: true,
        launchCount: 4,
        commands,
      },
      null,
      2,
    ),
  );
  console.log(`Preview installation/reinstallation/uninstallation verified: ${target}`);
} finally {
  if (mounted) await command('hdiutil', ['detach', mount]);
  await uninstall();
  await rm(scratch, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
}
