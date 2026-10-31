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
  runResultSchema,
  snapshotResultSchema,
  snapshotSchema,
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
  async getSnapshot() {
    try {
      return snapshotResultSchema.parse(await ipcRenderer.invoke(channels.snapshot));
    } catch {
      return failure('UNAVAILABLE', '工作进程暂不可用');
    }
  },
  async start(input) {
    const parsed = startInputSchema.safeParse(input);
    if (!parsed.success) return failure('INVALID_INPUT', '任务参数不合法');
    try {
      return runResultSchema.parse(await ipcRenderer.invoke(channels.start, parsed.data));
    } catch {
      return failure('UNAVAILABLE', '工作进程暂不可用');
    }
  },
  async cancel(input) {
    const parsed = cancelInputSchema.safeParse(input);
    if (!parsed.success) return failure('INVALID_INPUT', '任务标识不合法');
    try {
      return runResultSchema.parse(await ipcRenderer.invoke(channels.cancel, parsed.data));
    } catch {
      return failure('UNAVAILABLE', '工作进程暂不可用');
    }
  },
  subscribe(listener) {
    let disposed = false;
    let receivedEvent = false;
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = snapshotSchema.safeParse(value);
      if (!disposed && parsed.success) {
        receivedEvent = true;
        listener(parsed.data);
      }
    };
    ipcRenderer.on(channels.changed, receive);
    void api.getSnapshot().then((result) => {
      if (!disposed && !receivedEvent && result.ok) listener(result.value);
    });
    return () => {
      disposed = true;
      ipcRenderer.removeListener(channels.changed, receive);
    };
  },
};
contextBridge.exposeInMainWorld('browser2d', api);
