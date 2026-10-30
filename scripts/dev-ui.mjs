import { createServer } from 'vite';
import { rendererConfig } from '../internal/build-config/index.mjs';
import { root } from './process.mjs';
process.env.VITE_FIXTURE_MODE = '1';
const server = await createServer(rendererConfig(`${root}/apps/ui`));
await server.listen();
server.printUrls();
