import { pnpm } from './process.mjs';
import { desktopRequire, resolveNativeBinding } from './native.mjs';

await pnpm(['build']);
const nativeBinding = await resolveNativeBinding();
desktopRequire('electron');
await pnpm(['exec', 'playwright', 'test'], {
  env: { ...process.env, BROWSER2D_NATIVE_BINDING: nativeBinding },
});
