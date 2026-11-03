import { z } from 'zod';
import { contextBridge, ipcRenderer } from 'electron';
import {
  applicationPublicOperations,
  updateOperations,
  updateChangedChannel,
} from '@browser-2d/contracts/host';
import {
  failure,
  updateStateResultSchema,
  type Failure,
  type Browser2dApi,
} from '@browser-2d/contracts/public';
import { applicationChannel, tasksChangedChannel } from '../bridge/channels';
import { createUpdateSubscription } from './update-subscription';
const updateSubscription = createUpdateSubscription();
ipcRenderer.on(updateChangedChannel, (_event, value: unknown) => updateSubscription.receive(value));
type ApplicationResult<M extends keyof typeof applicationPublicOperations> = z.infer<
  (typeof applicationPublicOperations)[M]['result']
>;
function operation<M extends keyof typeof applicationPublicOperations>(method: M) {
  return async (input?: unknown): Promise<ApplicationResult<M> | Failure> => {
    const definition = applicationPublicOperations[method];
    const parsed = definition.input.safeParse(input);
    if (!parsed.success) return failure('INVALID_INPUT', 'Invalid application input');
    try {
      return definition.result.parse(
        await ipcRenderer.invoke(applicationChannel(method), parsed.data),
      ) as ApplicationResult<M>;
    } catch {
      return failure(
        'UNAVAILABLE',
        method === 'cards.importText'
          ? 'Import progress is unknown. Refresh the Card list before retrying'
          : 'Application data is unavailable',
      );
    }
  };
}
async function update<M extends keyof typeof updateOperations>(
  method: M,
): Promise<z.infer<(typeof updateOperations)[M]['result']> | Failure> {
  try {
    return updateOperations[method].result.parse(
      await ipcRenderer.invoke(updateOperations[method].channel),
    ) as z.infer<(typeof updateOperations)[M]['result']>;
  } catch {
    return failure('UNAVAILABLE', 'Updates are unavailable');
  }
}
const api: Browser2dApi = {
  browsers: {
    list: operation('browsers.list'),
    create: operation('browsers.create'),
    update: operation('browsers.update'),
    remove: operation('browsers.remove'),
  },
  cards: {
    list: operation('cards.list'),
    importText: operation('cards.importText'),
    update: operation('cards.update'),
    remove: operation('cards.remove'),
  },
  workTasks: {
    list: operation('workTasks.list'),
    start: operation('workTasks.start'),
    stop: operation('workTasks.stop'),
    subscribe(listener) {
      const handler = () => listener();
      ipcRenderer.on(tasksChangedChannel, handler);
      return () => ipcRenderer.removeListener(tasksChangedChannel, handler);
    },
  },
  settings: { get: operation('settings.get'), save: operation('settings.save') },
  updates: {
    getState: () => update('getState'),
    check: () => update('check'),
    download: () => update('download'),
    install: () => update('install'),
    subscribe(listener) {
      const dispose = updateSubscription.subscribe(listener);
      void update('getState').then((result) => {
        const parsed = updateStateResultSchema.safeParse(result);
        if (parsed.success && parsed.data.ok) updateSubscription.receive(parsed.data.value);
      });
      return dispose;
    },
  },
};
contextBridge.exposeInMainWorld('browser2d', api);
