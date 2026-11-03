import { createServer } from 'vite';
import { rendererConfig } from '../../internal/build-config/index.mjs';
import { root } from '../process.mjs';
const server = await createServer({
  ...rendererConfig(`${root}/apps/ui`),
  configFile: false,
  server: { host: '127.0.0.1' },
});
await server.listen();
server.printUrls();
