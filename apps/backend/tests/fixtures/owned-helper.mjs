import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

const [socket, ...args] = process.argv.slice(2);
const profile = args.find((arg) => arg.startsWith('--user-data-dir='))?.slice(16);
if (!socket || !profile) throw new Error('Missing helper fixture arguments');
const server = createServer((connection) => {
  connection.once('data', async (data) => {
    switch (data.toString().trim()) {
      case 'ready':
        connection.end(String(process.pid));
        break;
      case 'write':
        await mkdir(profile, { recursive: true });
        await writeFile(join(profile, 'late-helper-write'), 'acknowledged');
        connection.end('written');
        break;
      case 'exit':
        connection.end('exiting');
        server.close();
        break;
      default:
        throw new Error('Unknown helper fixture command');
    }
  });
});
server.listen(socket);
