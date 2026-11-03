import { pnpm } from './process.mjs';
import { createRequire } from 'node:module';
import { desktopRequire, resolveNativeBinding } from './native.mjs';

await pnpm(['build']);
const nativeBinding = await resolveNativeBinding();
desktopRequire('electron');
const backendRequire = createRequire(new URL('../apps/backend/package.json', import.meta.url));
const chromeExecutable =
  process.env.BROWSER2D_CHROME_EXECUTABLE ||
  (await backendRequire('puppeteer-core').executablePath('chrome'));
await pnpm(['exec', 'playwright', 'test'], {
  env: {
    ...process.env,
    BROWSER2D_NATIVE_BINDING: nativeBinding,
    BROWSER2D_EXECUTION: 'controlled',
    BROWSER2D_CHROME_EXECUTABLE: chromeExecutable,
  },
});
