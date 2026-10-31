import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { failure } from '@browser-2d/contracts/public';
import {
  businessRequestSchema,
  credentialReceiptSchema,
  initializeSchema,
  heartbeatSchema,
  requestSchema,
  workerEventSchema,
  type BusinessRequest,
  type CredentialChallenge,
  type CredentialReceipt,
  type WorkerEvent,
} from '@browser-2d/contracts/host';
import { createWorkService } from './work/service';
import { createControlledDriver } from './work/controlled-driver';
import { openBusinessStore, StorageError } from './storage/open-business-store';
import type { BusinessStore } from './storage/business-store';

const port = process.parentPort;
if (!port) throw new Error('Worker requires an Electron utilityProcess parent');
let phase: 'new' | 'opening' | 'ready' | 'closing' | 'closed' = 'new';
let service: ReturnType<typeof createWorkService> | undefined;
let business: BusinessStore | undefined;
let opening: Promise<void> = Promise.resolve();
const cancellation = new AbortController();
let ownerNonce: string | undefined;
let lease = Date.now() + 5000;
const watchdog = setInterval(() => {
  if (Date.now() < lease || phase === 'closing' || phase === 'closed') return;
  void shutdown().catch(() => process.exit(1));
}, 250);
let challenge:
  | {
      request: CredentialChallenge;
      resolve: (receipt: CredentialReceipt) => void;
      reject: () => void;
    }
  | undefined;
function send(event: WorkerEvent) {
  port?.postMessage(workerEventSchema.parse(event));
}
function fail() {
  if (phase === 'closing' || phase === 'closed') return;
  phase = 'closed';
  send({ type: 'fatal', message: 'Worker failed' });
  setImmediate(() => process.exit(1));
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
function ask(request: CredentialChallenge) {
  return new Promise<CredentialReceipt>((resolve, reject) => {
    challenge = {
      request,
      resolve,
      reject: () => reject(new StorageError('CREDENTIAL_UNAVAILABLE')),
    };
    send(request);
  });
}
async function initialize(data: unknown) {
  const input = initializeSchema.parse(data);
  ownerNonce = input.ownerNonce;
  lease = Date.now() + 5000;
  phase = 'opening';
  try {
    const result = await openBusinessStore({
      path: input.businessPath,
      nativeBinding: input.nativeBinding,
      signal: cancellation.signal,
      async confirmLegacy() {
        const receipt = await ask({
          type: 'credential-challenge',
          kind: 'confirm',
          bootNonce: randomUUID(),
        });
        return receipt.kind === 'confirmed';
      },
      async prepareLegacy(value) {
        const receipt = await ask({
          type: 'credential-challenge',
          kind: 'legacy',
          bootNonce: randomUUID(),
          value,
        });
        if (receipt.kind !== 'saved') throw new StorageError('CREDENTIAL_UNAVAILABLE');
        return receipt.secretRef;
      },
      async verifyCredential(secretRef) {
        const receipt = await ask({
          type: 'credential-challenge',
          kind: 'verify',
          bootNonce: randomUUID(),
          secretRef,
        });
        if (receipt.kind !== 'verified') throw new StorageError('CREDENTIAL_UNAVAILABLE');
      },
    });
    business = result.store;
    if (cancellation.signal.aborted) {
      business.close();
      return;
    }
    service = createWorkService({
      repository: result.work,
      driver: createControlledDriver({
        root: join(dirname(input.businessPath), 'controlled-resources'),
        fixture: input.fixture,
      }),
      publish: (snapshot) => send({ type: 'snapshot', snapshot }),
    });
    phase = 'ready';
    send({ type: 'ready', snapshot: service.snapshot() });
  } catch (error) {
    if (cancellation.signal.aborted) return;
    phase = 'closed';
    send({
      type: 'blocked',
      code: error instanceof StorageError ? error.code : 'INITIALIZATION_FAILED',
    });
    setImmediate(() => process.exit(1));
  }
}
function dispatch(request: BusinessRequest) {
  if (!business || phase !== 'ready')
    return failure('UNAVAILABLE', 'Business storage is unavailable');
  switch (request.method) {
    case 'devices.list':
      return business.devices.list();
    case 'devices.create':
      return business.devices.create(request.input);
    case 'devices.update':
      return business.devices.update(request.input);
    case 'devices.delete':
      return business.devices.delete(request.input);
    case 'materials.page':
      return business.materials.page(request.input);
    case 'materials.create':
      return business.materials.create(request.input);
    case 'materials.update':
      return business.materials.update(request.input);
    case 'materials.delete':
      return business.materials.delete(request.input);
    case 'materials.clear':
      return business.materials.clear();
    case 'materials.reset':
      return business.materials.reset(request.input);
    case 'materials.importText':
      return business.materials.importText(request.input);
    case 'history.page':
      return business.history.page(request.input);
    case 'history.delete':
      return business.history.delete(request.input);
    case 'history.clear':
      return business.history.clear();
    case 'history.exportText':
      return business.history.exportText(request.input);
    case 'settings.get':
      return business.settings.get();
    case 'settings.commit':
      return business.settings.commit(request.input);
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}
async function shutdown(requestId?: string) {
  const deadline = setTimeout(() => process.exit(1), 10_000);
  clearInterval(watchdog);
  phase = 'closing';
  cancellation.abort();
  challenge?.reject();
  challenge = undefined;
  await opening;
  try {
    await service?.stop();
    business?.close();
    if (requestId) send({ type: 'response', requestId, result: { ok: true, value: null } });
    phase = 'closed';
    clearTimeout(deadline);
    setImmediate(() => process.exit(requestId ? 0 : 1));
  } catch {
    business?.close();
    if (requestId)
      send({
        type: 'response',
        requestId,
        result: failure('INTERNAL', 'Resource cleanup is incomplete'),
      });
    phase = 'closed';
    clearTimeout(deadline);
    setImmediate(() => process.exit(1));
  }
}
port.on('message', ({ data }: { data: unknown }) => {
  if (phase === 'closed' || phase === 'closing') return;
  try {
    const heartbeat = heartbeatSchema.safeParse(data);
    if (heartbeat.success) {
      if (heartbeat.data.ownerNonce === ownerNonce) lease = Date.now() + 5000;
      else fail();
      return;
    }
    const task = requestSchema.safeParse(data);
    if (task.success && task.data.method === 'shutdown') {
      void shutdown(task.data.requestId).catch(fail);
      return;
    }
    if (phase === 'new') {
      opening = initialize(data);
      return;
    }
    const receipt = credentialReceiptSchema.safeParse(data);
    if (receipt.success) {
      const waiting = challenge;
      if (phase !== 'opening' || !waiting || waiting.request.bootNonce !== receipt.data.bootNonce) {
        fail();
        return;
      }
      const valid =
        receipt.data.kind === 'refused' ||
        (waiting.request.kind === 'confirm' && receipt.data.kind === 'confirmed') ||
        (waiting.request.kind === 'legacy' && receipt.data.kind === 'saved') ||
        (waiting.request.kind === 'verify' && receipt.data.kind === 'verified');
      if (!valid) {
        fail();
        return;
      }
      challenge = undefined;
      waiting.resolve(receipt.data);
      return;
    }
    const request = businessRequestSchema.safeParse(data);
    if (request.success) {
      let result;
      try {
        result = dispatch(request.data);
      } catch {
        result = failure('INTERNAL', 'Business operation failed');
      }
      send({ type: 'business-response', requestId: request.data.requestId, result });
      return;
    }
    if (phase !== 'ready' || !service || !task.success) {
      fail();
      return;
    }
    switch (task.data.method) {
      case 'shutdown':
        return;
      case 'snapshot':
        send({
          type: 'response',
          requestId: task.data.requestId,
          result: { ok: true, value: service.snapshot() },
        });
        break;
      case 'start':
        send({
          type: 'response',
          requestId: task.data.requestId,
          result: service.start(task.data.input),
        });
        break;
      case 'getCommand':
        send({
          type: 'response',
          requestId: task.data.requestId,
          result: service.getCommand(task.data.input),
        });
        break;
      case 'cancel':
        send({
          type: 'response',
          requestId: task.data.requestId,
          result: service.cancel(task.data.input),
        });
        break;
      default: {
        const exhaustive: never = task.data;
        throw new Error(String(exhaustive));
      }
    }
  } catch {
    fail();
  }
});
