import { constants } from 'node:fs';
import { access, appendFile, mkdtemp, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const { CHROME_PATH, GITHUB_ENV, RUNNER_TEMP } = process.env;
if (!CHROME_PATH || !GITHUB_ENV || !RUNNER_TEMP) {
  throw new Error('Chrome setup requires CHROME_PATH, GITHUB_ENV and RUNNER_TEMP');
}

let executable = CHROME_PATH;
await access(executable, constants.X_OK);
if (process.platform === 'darwin') {
  const bundle = dirname(dirname(dirname(executable)));
  if (!basename(bundle).endsWith('.app')) {
    const directory = await mkdtemp(join(RUNNER_TEMP, 'browser-2d-chrome-'));
    const app = join(directory, 'Google Chrome for Testing.app');
    // setup-chrome's channel cache drops .app, breaking Chrome's sandboxed helper IPC.
    await rename(bundle, app);
    executable = join(app, 'Contents', 'MacOS', basename(executable));
  }
}
await access(executable, constants.X_OK);
await appendFile(GITHUB_ENV, `BROWSER2D_CHROME_EXECUTABLE=${executable}\n`);
