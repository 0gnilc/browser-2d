import process from 'node:process';
import { URL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  feedUrl,
  identity,
  releaseConfiguration,
  validateProductionInputs,
} from '@browser-2d/build-config/release';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

const { executableName } = identity;
const resourcePath =
  process.env.BROWSER2D_RELEASE_CONFIG ||
  fileURLToPath(new URL('./resources/release-config.json', import.meta.url));
const raw = JSON.parse(readFileSync(resourcePath, 'utf8'));
const configuration = releaseConfiguration({ ...raw, target: raw.target || 'linux-x64' });
const production = configuration.mode === 'production';
validateProductionInputs(configuration, process.env, false);

export default {
  ...identity,
  extraResources: [{ from: resourcePath, to: 'release-config.json' }],
  forceCodeSigning: production && configuration.target !== 'linux-x64',
  asar: true,
  npmRebuild: false,
  asarUnpack: ['**/*.node'],
  files: [
    'dist/**',
    'package.json',
    '!node_modules/@browser-2d/worker-runtime/!(dist|package.json){,/**}',
  ],
  directories: { output: process.env.BROWSER2D_RELEASE_DIR || '../../release/local' },
  artifactName: 'browser-2d-foundation-${version}-${os}-${arch}.${ext}',
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    identity: production ? process.env.CSC_NAME : null,
    hardenedRuntime: production,
    notarize: production,
  },
  dmg: { sign: production },
  win: {
    target: ['nsis'],
    signAndEditExecutable: production,
    verifyUpdateCodeSignature: production,
    signExecutable: production,
    ...(production
      ? {
          signtoolOptions: {
            publisherName: process.env.BROWSER2D_WINDOWS_PUBLISHER,
            signingHashAlgorithms: ['sha256'],
          },
        }
      : {}),
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  linux: {
    target: ['AppImage', 'deb', 'rpm'],
    category: 'Development',
    maintainer: 'browser-2d contributors',
    executableName,
  },
  publish: production ? { provider: 'generic', url: feedUrl(configuration) } : null,
  async afterPack(context) {
    const executable =
      context.electronPlatformName === 'darwin'
        ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
        : join(
            context.appOutDir,
            `${executableName}${context.electronPlatformName === 'win32' ? '.exe' : ''}`,
          );
    await flipFuses(executable, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature:
        context.electronPlatformName === 'darwin' && process.arch === 'arm64',
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
        context.electronPlatformName !== 'linux',
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
  },
};
