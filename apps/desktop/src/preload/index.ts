import { contextBridge, ipcRenderer } from 'electron';
import { channels } from '@browser-2d/contracts/host';
import {
  cancelInputSchema,
  failure,
  runResultSchema,
  snapshotResultSchema,
  snapshotSchema,
  startInputSchema,
  type Browser2dApi,
} from '@browser-2d/contracts/public';

const api: Browser2dApi = {
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
