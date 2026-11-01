import { updateStateSchema, type UpdateState } from '@browser-2d/contracts/public';

export function createUpdateSubscription() {
  let current: UpdateState | undefined;
  const listeners = new Set<(state: UpdateState) => void>();
  return {
    receive(raw: unknown) {
      const parsed = updateStateSchema.safeParse(raw);
      if (!parsed.success || (current && parsed.data.revision <= current.revision)) return;
      current = parsed.data;
      for (const listener of listeners) listener(current);
    },
    subscribe(listener: (state: UpdateState) => void) {
      listeners.add(listener);
      if (current) listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
