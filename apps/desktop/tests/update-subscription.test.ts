import { expect, it, vi } from 'vitest';
import { createUpdateSubscription } from '../src/preload/update-subscription';
it('ignores a late initial snapshot, malformed payloads and disposed subscribers', () => {
  const subscription = createUpdateSubscription();
  const listener = vi.fn();
  const dispose = subscription.subscribe(listener);
  const common = { currentVersion: '0.1.0', channel: 'stable' };
  subscription.receive({ ...common, status: 'checking', revision: 2 });
  subscription.receive({ ...common, status: 'idle', revision: 1 });
  subscription.receive({ ...common, status: 'idle', revision: 3, rawPath: '/secret' });
  expect(listener).toHaveBeenCalledTimes(1);
  dispose();
  subscription.receive({ ...common, status: 'idle', revision: 4 });
  expect(listener).toHaveBeenCalledTimes(1);
});
