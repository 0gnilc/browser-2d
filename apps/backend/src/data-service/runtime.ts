import type {} from 'electron';
import {
  dataRequestSchema,
  dataServiceControlSchema,
  dataServiceEventSchema,
  type Processor,
  type DataRequest,
} from '@browser-2d/contracts/host';
import { openApplicationRepository } from './database/open';
import { dispatch } from './dispatch';

export function runDataService(processors: readonly Processor[] = ['baidu-check']) {
  const port = process.parentPort;
  if (!port) throw new Error('DataService requires an Electron parent');
  let repository: ReturnType<typeof openApplicationRepository> | undefined;
  let ownerNonce: string | undefined;
  let closing = false;
  let lease = Date.now() + 10_000;
  const controls: DataRequest[] = [];
  const requests: DataRequest[] = [];
  let draining = false;
  const send = (event: unknown) => port.postMessage(dataServiceEventSchema.parse(event));
  function fail() {
    closing = true;
    clearInterval(watchdog);
    repository?.close();
    process.exit(1);
  }
  const watchdog = setInterval(() => {
    if (Date.now() > lease) fail();
  }, 250);
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  function drain() {
    if (draining || closing || !repository) return;
    draining = true;
    try {
      let request: DataRequest | undefined;
      while ((request = controls.shift() ?? requests.shift())) {
        const current = request;
        const result = dispatch(repository, current);
        if (result instanceof Promise) {
          void result
            .then((value) => {
              if (!closing) {
                send({
                  type: 'data-response',
                  requestId: current.requestId,
                  method: current.method,
                  result: value,
                });
                send({ type: 'changed' });
              }
            })
            .catch(fail);
        } else {
          send({
            type: 'data-response',
            requestId: current.requestId,
            method: current.method,
            result,
          });
          if (
            ![
              'browsers.list',
              'cards.list',
              'settings.read',
              'settings.bindings',
              'tasks.list',
            ].includes(current.method)
          )
            send({ type: 'changed' });
        }
      }
    } finally {
      draining = false;
    }
  }
  port.on('message', ({ data }: { data: unknown }) => {
    if (closing) return;
    const control = dataServiceControlSchema.safeParse(data);
    if (control.success) {
      const message = control.data;
      if (message.type === 'initialize') {
        if (repository || ownerNonce) return fail();
        ownerNonce = message.ownerNonce;
        try {
          repository = openApplicationRepository({
            path: message.dataPath,
            nativeBinding: message.nativeBinding,
            processors,
            yieldControl: () =>
              new Promise((resolve) =>
                setImmediate(() => {
                  drain();
                  resolve();
                }),
              ),
          });
          send({ type: 'ready', ownerNonce });
        } catch {
          send({ type: 'blocked', message: 'Application storage could not be opened' });
          fail();
        }
      } else if (message.type === 'heartbeat') {
        if (message.ownerNonce !== ownerNonce) return fail();
        lease = Date.now() + 10_000;
      } else {
        closing = true;
        clearInterval(watchdog);
        repository?.close();
        send({ type: 'shutdown-complete', requestId: message.requestId });
        setImmediate(() => process.exit(0));
      }
      return;
    }
    const request = dataRequestSchema.parse(data);
    if (!repository) return fail();
    (['tasks.fence', 'tasks.recovery', 'tasks.finish', 'tasks.cancelQueued'].includes(
      request.method,
    )
      ? controls
      : requests
    ).push(request);
    setImmediate(drain);
  });
}
