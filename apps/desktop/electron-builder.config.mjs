import process from 'node:process';
import { join } from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

const executableName = 'browser-2d-foundation';

export default {
  appId: 'io.github.0gnilc.browser2d.foundation',
  productName: 'Browser2DFoundation',
  executableName,
  asar: true,
  npmRebuild: false,
  asarUnpack: ['**/*.node'],
  files: [
    'dist/**',
    'package.json',
    '!node_modules/@browser-2d/worker-runtime/src/**',
    '!node_modules/@browser-2d/worker-runtime/tests/**',
  ],
  directories: { output: process.env.BROWSER2D_RELEASE_DIR || '../../release/local' },
  artifactName: 'browser-2d-foundation-${version}-${os}-${arch}.${ext}',
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.developer-tools', identity: null },
  win: { target: ['nsis'], signAndEditExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  linux: {
    target: ['AppImage', 'deb', 'rpm'],
    category: 'Development',
    maintainer: 'browser-2d contributors',
    executableName,
  },
  publish: null,
  async afterPack(context) {
    const executable =
      context.electronPlatformName === 'darwin'
        ? join(context.appOutDir, `${executableName}.app`)
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
