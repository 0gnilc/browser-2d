import Database from 'better-sqlite3';
import { z } from 'zod';
const port = process.parentPort;
if (!port) throw new Error('DataService fixture requires Electron');
const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open'), path: z.string(), binding: z.string().optional() }),
  z.strictObject({ kind: z.literal('write'), id: z.number().int() }),
  z.strictObject({ kind: z.literal('read'), id: z.number().int() }),
  z.strictObject({ kind: z.literal('busy'), id: z.number().int() }),
  z.strictObject({ kind: z.literal('close'), id: z.number().int() }),
]);
let db: Database.Database | undefined;
port.on('message', ({ data }: { data: unknown }) => {
  const command = commandSchema.parse(data);
  if (command.kind === 'open') {
    db = new Database(command.path, command.binding ? { nativeBinding: command.binding } : {});
    db.exec('CREATE TABLE proof (value INTEGER NOT NULL); INSERT INTO proof VALUES (0)');
    port.postMessage({ kind: 'ready' });
    return;
  }
  if (!db) throw new Error('Database not initialized');
  if (command.kind === 'write') db.prepare('UPDATE proof SET value = value + 1').run();
  if (command.kind === 'busy') {
    port.postMessage({ kind: 'busy-started' });
    db.prepare(
      'WITH RECURSIVE busy(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM busy WHERE n < 3000000) SELECT sum(n) FROM busy',
    ).get();
  }
  if (command.kind === 'close') {
    db.close();
    process.exit(0);
  }
  port.postMessage({
    kind: 'response',
    id: command.id,
    row: db.prepare('SELECT value FROM proof').get(),
  });
});
