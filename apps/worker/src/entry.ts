import { failure } from '@browser-2d/contracts/public';
import {
  initializeSchema,
  requestSchema,
  workerEventSchema,
  type WorkerEvent,
} from '@browser-2d/contracts/host';
import { createRunService } from './service';

const port = process.parentPort;
if (!port) throw new Error('Worker requires an Electron utilityProcess parent');
let service: ReturnType<typeof createRunService> | undefined;
let shuttingDown = false;

function send(event: WorkerEvent) {
  port?.postMessage(workerEventSchema.parse(event));
}
function fatal(error: unknown) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    send({ type: 'fatal', message: error instanceof Error ? error.message : 'Worker failed' });
  } finally {
    setImmediate(() => process.exit(1));
  }
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

port.on('message', ({ data }: { data: unknown }) => {
  if (shuttingDown) return;
  try {
    if (!service) {
      const input = initializeSchema.parse(data);
      service = createRunService({
        ...input,
        onSnapshot: (snapshot) => send({ type: 'snapshot', snapshot }),
      });
      send({ type: 'ready', snapshot: service.snapshot() });
      return;
    }
    const parsed = requestSchema.safeParse(data);
    if (!parsed.success) {
      const envelope = requestSchema.options[0]
        .pick({ type: true, requestId: true })
        .safeParse(data);
      if (!envelope.success) throw new Error('Invalid worker request envelope');
      send({
        type: 'response',
        requestId: envelope.data.requestId,
        result: failure('INVALID_INPUT', 'Invalid task request'),
      });
      return;
    }
    const request = parsed.data;
    switch (request.method) {
      case 'snapshot':
        send({
          type: 'response',
          requestId: request.requestId,
          result: { ok: true, value: service.snapshot() },
        });
        break;
      case 'start':
        send({
          type: 'response',
          requestId: request.requestId,
          result: service.start(request.input),
        });
        break;
      case 'cancel':
        send({
          type: 'response',
          requestId: request.requestId,
          result: service.cancel(request.input),
        });
        break;
      case 'shutdown':
        service.close();
        send({ type: 'response', requestId: request.requestId, result: { ok: true, value: null } });
        shuttingDown = true;
        setImmediate(() => process.exit(0));
        break;
      default: {
        const exhaustive: never = request;
        throw new Error(`Unsupported worker request ${String(exhaustive)}`);
      }
    }
  } catch (error) {
    fatal(error);
  }
});
