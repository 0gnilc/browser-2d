import { randomUUID } from 'node:crypto';
import {
  businessOperations,
  businessRequestSchema,
  type BusinessMethod,
  type BusinessRequest,
} from '@browser-2d/contracts/host';
import { failure, type SettingsSave } from '@browser-2d/contracts/public';

export function createBusinessCoordinator(options: {
  request: (message: BusinessRequest) => Promise<unknown>;
  available: () => boolean;
}) {
  let settingsTail: Promise<unknown> = Promise.resolve();
  async function save(input: SettingsSave) {
    if (!options.available()) return failure('UNAVAILABLE', 'Worker is unavailable');
    return options.request({
      type: 'business',
      requestId: randomUUID(),
      method: 'settings.commit',
      input,
    });
  }
  return {
    async invoke(method: BusinessMethod, input: unknown) {
      const operation = businessOperations[method];
      const parsed = operation.input.safeParse(input);
      if (!parsed.success) return failure('INVALID_INPUT', 'Invalid business input');
      if (!options.available()) return failure('UNAVAILABLE', 'Worker is unavailable');
      try {
        let result: unknown;
        if (method === 'settings.save') {
          const settings = businessOperations['settings.save'].input.parse(input);
          const queued = settingsTail.then(() => save(settings));
          settingsTail = queued.catch(() => undefined);
          result = await queued;
        } else
          result = await options.request(
            businessRequestSchema.parse({
              type: 'business',
              requestId: randomUUID(),
              method,
              input: parsed.data,
            }),
          );
        return operation.result.parse(result);
      } catch {
        return failure('UNAVAILABLE', 'Business operation could not be completed');
      }
    },
  };
}
