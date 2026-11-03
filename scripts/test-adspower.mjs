import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, copyFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, pnpm } from './process.mjs';
import { desktopRequire, resolveNativeBinding } from './native.mjs';

const argument = (name) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const profiles = [argument('profile-a'), argument('profile-b')];
assert(
  profiles.every((profile) => typeof profile === 'string' && /^[a-zA-Z0-9_-]+$/.test(profile)) &&
    profiles[0] !== profiles[1],
  'Pass --profile-a and --profile-b for two dedicated inactive test profiles',
);
const packaged = argument('executable');
if (packaged) assert(isAbsolute(packaged), 'Packaged executable must be an absolute path');
if (!packaged && !process.argv.includes('--built')) await pnpm(['build']);
const directory = await mkdtemp(join(tmpdir(), 'browser-2d-adspower-'));
const reportPath = join(directory, 'report.json');
const options = {
  reportPath,
  profiles,
  ...(argument('client-version') ? { clientVersion: argument('client-version') } : {}),
  apiBaseUrl: 'http://127.0.0.1:50325',
  credentialService: 'io.github.0gnilc.browser2d.development.adspower',
  credentialAccount: 'browser-2d-development',
};
const child = spawn(
  packaged || desktopRequire('electron'),
  [
    ...(packaged ? [] : [join(root, 'apps/desktop')]),
    `--verify-adspower=${JSON.stringify(options)}`,
  ],
  {
    cwd: tmpdir(),
    stdio: 'inherit',
    env: {
      ...process.env,
      BROWSER2D_DATA_DIR: directory,
      ...(packaged ? {} : { BROWSER2D_NATIVE_BINDING: await resolveNativeBinding() }),
    },
  },
);
const code = await new Promise((resolve, reject) => {
  child.once('exit', resolve);
  child.once('error', reject);
});
await mkdir(join(root, 'artifacts/adspower'), { recursive: true });
try {
  await copyFile(reportPath, join(root, 'artifacts/adspower/report.json'));
  console.log(await readFile(reportPath, 'utf8'));
} catch {
  throw new Error('No report was produced; verify the development Keychain reference');
}
assert.equal(
  code,
  0,
  'Real AdsPower verification failed; retain the report and reconcile only its dedicated profiles',
);
