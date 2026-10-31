import { contextBridge, ipcRenderer } from 'electron';
import {
  businessOperations,
  businessChannel,
  channels,
  type BusinessMethod,
} from '@browser-2d/contracts/host';
import {
  cancelInputSchema,
  failure,
  startResultSchema,
  cancelResultSchema,
  commandInputSchema,
  commandLookupResultSchema,
  workStateSchema,
  type WorkState,
  startInputSchema,
  type Browser2dApi,
  type Failure,
} from '@browser-2d/contracts/public';

async function business<T>(
  method: BusinessMethod,
  input: unknown,
  parse: (value: unknown) => T,
): Promise<T | Failure> {
  const operation = businessOperations[method];
  const parsed = operation.input.safeParse(input);
  if (!parsed.success) return failure('INVALID_INPUT', 'Invalid business input');
  try {
    return parse(await ipcRenderer.invoke(businessChannel(method), parsed.data));
  } catch {
    return failure('UNAVAILABLE', 'Business storage is unavailable');
  }
}
let current: WorkState = { status: 'unavailable', generation: 0, reason: 'Worker is starting' };
const listeners = new Set<(state: WorkState) => void>();
function receive(value: unknown) {
  const parsed = workStateSchema.safeParse(value);
  if (!parsed.success) return;
  const next = parsed.data;
  if (next.generation < current.generation) return;
  if (next.generation === current.generation) {
    if (current.status === 'unavailable' && next.status === 'ready') return;
    if (
      current.status === 'ready' &&
      next.status === 'ready' &&
      (next.snapshot.epoch !== current.snapshot.epoch ||
        next.snapshot.revision < current.snapshot.revision)
    )
      return;
  }
  current = next;
  for (const listener of listeners) listener(current);
}
ipcRenderer.on(channels.changed, (_event, value: unknown) => receive(value));
async function refresh() {
  try {
    receive(await ipcRenderer.invoke(channels.subscribe));
  } catch {
    receive({
      status: 'unavailable',
      generation: current.generation,
      reason: 'Worker is unavailable',
    });
  }
}
const api: Browser2dApi = {
  devices: {
    list: () =>
      business('devices.list', undefined, businessOperations['devices.list'].result.parse),
    create: (input) =>
      business('devices.create', input, businessOperations['devices.create'].result.parse),
    update: (input) =>
      business('devices.update', input, businessOperations['devices.update'].result.parse),
    delete: (input) =>
      business('devices.delete', input, businessOperations['devices.delete'].result.parse),
  },
  materials: {
    page: (input = {}) =>
      business('materials.page', input, businessOperations['materials.page'].result.parse),
    create: (input) =>
      business('materials.create', input, businessOperations['materials.create'].result.parse),
    update: (input) =>
      business('materials.update', input, businessOperations['materials.update'].result.parse),
    delete: (input) =>
      business('materials.delete', input, businessOperations['materials.delete'].result.parse),
    clear: () =>
      business('materials.clear', undefined, businessOperations['materials.clear'].result.parse),
    reset: (input) =>
      business('materials.reset', input, businessOperations['materials.reset'].result.parse),
    importText: (input) =>
      business(
        'materials.importText',
        input,
        businessOperations['materials.importText'].result.parse,
      ),
  },
  history: {
    page: (input = {}) =>
      business('history.page', input, businessOperations['history.page'].result.parse),
    delete: (input) =>
      business('history.delete', input, businessOperations['history.delete'].result.parse),
    clear: () =>
      business('history.clear', undefined, businessOperations['history.clear'].result.parse),
    exportText: (input = {}) =>
      business('history.exportText', input, businessOperations['history.exportText'].result.parse),
  },
  settings: {
    get: () => business('settings.get', undefined, businessOperations['settings.get'].result.parse),
    save: (input) =>
      business('settings.save', input, businessOperations['settings.save'].result.parse),
  },
  work: {
    async getSnapshot() {
      await refresh();
      return current.status === 'ready'
        ? { ok: true, value: current.snapshot }
        : failure('UNAVAILABLE', current.reason);
    },
    async start(input) {
      const parsed = startInputSchema.safeParse(input);
      if (!parsed.success) return failure('INVALID_INPUT', 'Invalid task input');
      try {
        return startResultSchema.parse(await ipcRenderer.invoke(channels.start, parsed.data));
      } catch {
        return failure('UNAVAILABLE', 'Worker is unavailable');
      }
    },
    async cancel(input) {
      const parsed = cancelInputSchema.safeParse(input);
      if (!parsed.success) return failure('INVALID_INPUT', 'Invalid cancellation input');
      try {
        return cancelResultSchema.parse(await ipcRenderer.invoke(channels.cancel, parsed.data));
      } catch {
        return failure('UNAVAILABLE', 'Worker is unavailable');
      }
    },
    async getCommand(input) {
      const parsed = commandInputSchema.safeParse(input);
      if (!parsed.success) return failure('INVALID_INPUT', 'Invalid command input');
      try {
        return commandLookupResultSchema.parse(
          await ipcRenderer.invoke(channels.getCommand, parsed.data),
        );
      } catch {
        return failure('UNAVAILABLE', 'Worker is unavailable');
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      void refresh();
      return () => {
        listeners.delete(listener);
      };
    },
  },
};
contextBridge.exposeInMainWorld('browser2d', api);
