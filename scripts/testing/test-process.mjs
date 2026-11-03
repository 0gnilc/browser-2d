import { join } from 'node:path';
import { pnpm, root } from '../process.mjs';
import { desktopRequire, resolveNativeBinding } from './native.mjs';
import { verifyTaskProcessExecutable } from './task-process-proof.mjs';

if (!process.argv.includes('--built')) await pnpm(['build']);
const result = await verifyTaskProcessExecutable(desktopRequire('electron'), {
  args: [join(root, 'apps/desktop')],
  env: { ...process.env, BROWSER2D_NATIVE_BINDING: await resolveNativeBinding() },
  packaged: false,
  evidence: join(root, 'artifacts/process', `${process.platform}-${process.arch}.json`),
});
console.log(JSON.stringify(result, null, 2));
