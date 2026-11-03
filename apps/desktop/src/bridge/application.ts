import { applicationPublicOperations } from '@browser-2d/contracts/host';
import { failure } from '@browser-2d/contracts/public';
import type { DataClient } from '../main/data-service-client';
import type { TaskCoordinator } from '../main/task-coordinator';
import type { createSettingsCoordinator } from '../main/settings-coordinator';
export type ApplicationMethod = keyof typeof applicationPublicOperations;
export function createApplicationBridge(options: {
  data: DataClient;
  tasks: TaskCoordinator;
  settings: ReturnType<typeof createSettingsCoordinator>;
}) {
  return {
    async invoke(method: ApplicationMethod, input: unknown) {
      const operation = applicationPublicOperations[method];
      const parsed = operation.input.safeParse(input);
      if (!parsed.success) return failure('INVALID_INPUT', 'Invalid application input');
      if (!options.data.available) return failure('UNAVAILABLE', 'Application data is unavailable');
      try {
        let result: unknown;
        switch (method) {
          case 'workTasks.list':
            result = await options.tasks.list();
            break;
          case 'workTasks.start':
            result = await options.tasks.start(
              applicationPublicOperations[method].input.parse(input),
            );
            break;
          case 'workTasks.stop':
            result = await options.tasks.stop(
              applicationPublicOperations[method].input.parse(input),
            );
            break;
          case 'settings.get':
            result = await options.settings.get();
            break;
          case 'settings.save':
            result = await options.settings.save(
              applicationPublicOperations[method].input.parse(input),
            );
            break;
          case 'browsers.list': {
            const browsers = await options.data.request('browsers.list', undefined);
            result = browsers.ok
              ? { ok: true, value: options.tasks.projectBrowsers(browsers.value) }
              : browsers;
            break;
          }
          case 'browsers.create':
            result = await options.data.request(
              'browsers.create',
              applicationPublicOperations['browsers.create'].input.parse(input),
            );
            break;
          case 'browsers.update':
            result = await options.data.request(
              'browsers.update',
              applicationPublicOperations['browsers.update'].input.parse(input),
            );
            break;
          case 'browsers.remove':
            result = await options.data.request(
              'browsers.remove',
              applicationPublicOperations['browsers.remove'].input.parse(input),
            );
            break;
          case 'cards.list':
            result = await options.data.request(
              'cards.list',
              applicationPublicOperations['cards.list'].input.parse(input),
            );
            break;
          case 'cards.importText':
            result = await options.data.request(
              'cards.importText',
              applicationPublicOperations['cards.importText'].input.parse(input),
            );
            break;
          case 'cards.update':
            result = await options.data.request(
              'cards.update',
              applicationPublicOperations['cards.update'].input.parse(input),
            );
            break;
          case 'cards.remove':
            result = await options.data.request(
              'cards.remove',
              applicationPublicOperations['cards.remove'].input.parse(input),
            );
            break;
        }
        return operation.result.parse(result);
      } catch {
        return failure(
          'UNAVAILABLE',
          method === 'cards.importText'
            ? 'Import progress is unknown. Refresh the Card list before retrying'
            : 'The application operation could not be completed',
        );
      }
    },
  };
}
