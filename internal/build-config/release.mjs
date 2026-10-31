import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const targets = {
  'mac-x64': {
    platform: 'darwin',
    arch: 'x64',
    flag: '--mac',
    extensions: ['.dmg', '.zip'],
    metadata: 'latest-mac.yml',
  },
  'mac-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    flag: '--mac',
    extensions: ['.dmg', '.zip'],
    metadata: 'latest-mac.yml',
  },
  'win-x64': {
    platform: 'win32',
    arch: 'x64',
    flag: '--win',
    extensions: ['.exe'],
    metadata: 'latest.yml',
  },
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    flag: '--linux',
    extensions: ['.AppImage', '.deb', '.rpm'],
    metadata: 'latest-linux.yml',
  },
};
export const identity = Object.freeze({
  appId: 'io.github.0gnilc.browser2d.foundation',
  productName: 'Browser2DFoundation',
  executableName: 'browser-2d-foundation',
});
export const digest = (value, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(value).digest(encoding);
export async function hashFile(path, algorithm = 'sha256', encoding = 'hex') {
  return digest(await readFile(path), algorithm, encoding);
}
export function releaseConfiguration({ mode = 'preview', target, channel, feedBaseUrl }) {
  assert(mode === 'preview' || mode === 'production', 'mode must be preview or production');
  assert(Object.hasOwn(targets, target), `Unsupported target ${target}`);
  if (mode === 'preview') return { mode };
  assert(
    channel === 'stable' || channel === 'test',
    'Production requires an explicit stable or test channel',
  );
  assert(
    typeof feedBaseUrl === 'string' && feedBaseUrl.trim(),
    'Production requires --feed-base-url=HTTPS-base',
  );
  const url = new URL(feedBaseUrl);
  assert(
    url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'Feed requires HTTPS without credentials, query or fragment',
  );
  return { mode, channel, feedBaseUrl: url.href.replace(/\/+$/, ''), target };
}
export function feedUrl(config) {
  return `${config.feedBaseUrl}/${config.channel}/${config.target}/`;
}
export function validateProductionInputs(config, environment, dirty) {
  if (config.mode !== 'production') return;
  assert(!dirty, 'Production requires a clean source revision');
  const required = config.target.startsWith('mac-')
    ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
    : config.target.startsWith('win-')
      ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'BROWSER2D_WINDOWS_PUBLISHER']
      : [];
  for (const name of required) assert(environment[name]?.trim(), `Production requires ${name}`);
  if (config.target.startsWith('mac-'))
    assert(
      environment.CSC_NAME?.trim(),
      'Production requires CSC_NAME identifying the Developer ID Application certificate',
    );
}
export function buildEnvironment(config, environment, output, configurationPath) {
  const result = {
    ...environment,
    BROWSER2D_RELEASE_DIR: output,
    BROWSER2D_RELEASE_CONFIG: configurationPath,
  };
  if (config.mode === 'preview') {
    for (const key of Object.keys(result))
      if (
        /^(CSC_|WIN_CSC_|APPLE_|BROWSER2D_WINDOWS_PUBLISHER$|BROWSER2D_FEED|BROWSER2D_CHANNEL)/.test(
          key,
        )
      )
        delete result[key];
    result.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  } else {
    delete result.CSC_IDENTITY_AUTO_DISCOVERY;
  }
  return result;
}
export function gitState(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  return {
    sourceCommit: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain', '--untracked-files=all')),
  };
}
export function argumentsFor(argv) {
  const options = {};
  for (const arg of argv.filter((arg) => arg !== '--')) {
    if (arg === '--dist') {
      options.dist = true;
      continue;
    }
    const match = /^--(mode|target|channel|feed-base-url|directory|evidence|staging)=(.*)$/.exec(
      arg,
    );
    assert(match, `Unknown or incomplete option ${arg}; use --name=value`);
    options[match[1]] = match[2];
  }
  return options;
}
