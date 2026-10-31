import { afterEach, expect, it, vi } from 'vitest';
import {
  awaitOwnedLifetime,
  launchContract,
  observeOwnedLifetime,
  ownedLifetimeSchema,
  spawnOwned,
  stopOwnedChild,
} from '../src/browser/process';

afterEach(() => vi.restoreAllMocks());

it('observes only signal zero and treats ESRCH as the sole absence proof', async () => {
  const lifetime = ownedLifetimeSchema.parse(
    launchContract() === 'posix-group'
      ? { kind: 'posix-group', pgid: 123456 }
      : { kind: 'windows-child', pid: 123456 },
  );
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  expect(observeOwnedLifetime(lifetime)).toBe('present');
  kill.mockImplementation(() => {
    throw Object.assign(new Error('No permission'), { code: 'EPERM' });
  });
  expect(observeOwnedLifetime(lifetime)).toBe('unknown');
  kill.mockImplementation(() => {
    throw Object.assign(new Error('Not found'), { code: 'ESRCH' });
  });
  expect(observeOwnedLifetime(lifetime)).toBe('empty');
  expect(await awaitOwnedLifetime(lifetime, AbortSignal.timeout(1000))).toEqual(
    lifetime.kind === 'posix-group'
      ? { kind: 'posix-group-empty', pgid: lifetime.pgid }
      : { kind: 'windows-main-exited', pid: lifetime.pid },
  );
  expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  expect(
    kill.mock.calls.every(([id]) => id === (lifetime.kind === 'posix-group' ? -123456 : 123456)),
  ).toBe(true);
});

it('refuses an observation contract from the other operating system', () => {
  const kill = vi.spyOn(process, 'kill');
  expect(
    observeOwnedLifetime(
      launchContract() === 'posix-group'
        ? { kind: 'windows-child', pid: 123456 }
        : { kind: 'posix-group', pgid: 123456 },
    ),
  ).toBe('unknown');
  expect(kill).not.toHaveBeenCalled();
});

it('rejects invalid group identifiers and never observes the worker identity', () => {
  for (const pgid of [0, 1, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(ownedLifetimeSchema.safeParse({ kind: 'posix-group', pgid }).success).toBe(false);
  const kill = vi.spyOn(process, 'kill');
  expect(
    observeOwnedLifetime(
      launchContract() === 'posix-group'
        ? { kind: 'posix-group', pgid: process.pid }
        : { kind: 'windows-child', pid: process.pid },
    ),
  ).toBe('unknown');
  expect(kill).not.toHaveBeenCalled();
});

it('mints lifetime evidence from a successful spawn and stops only its retained child', async () => {
  const owned = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  try {
    const lifetime = await owned.started;
    expect(owned.child.pid).toBe(lifetime.kind === 'posix-group' ? lifetime.pgid : lifetime.pid);
    expect(observeOwnedLifetime(lifetime)).toBe('present');
    await stopOwnedChild(owned, AbortSignal.timeout(5000));
    expect(await awaitOwnedLifetime(lifetime, AbortSignal.timeout(5000))).toEqual(
      lifetime.kind === 'posix-group'
        ? { kind: 'posix-group-empty', pgid: lifetime.pgid }
        : { kind: 'windows-main-exited', pid: lifetime.pid },
    );
  } finally {
    await stopOwnedChild(owned, AbortSignal.timeout(5000));
  }
});

it('does not mint a lifetime when the operating system rejects spawn', async () => {
  const owned = spawnOwned('/browser-2d/nonexistent-executable', []);
  await expect(owned.started).rejects.toMatchObject({ code: 'ENOENT' });
  expect(owned.failedToSpawn).toBe(true);
  expect(owned.lifetime).toBeUndefined();
});

it.each(['empty', 'aborted'] as const)(
  'keeps unknown lifetime observations pending until %s',
  async (outcome) => {
    const owned = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const abort = new AbortController();
    try {
      const lifetime = await owned.started;
      await stopOwnedChild(owned, AbortSignal.timeout(5000));
      const id = lifetime.kind === 'posix-group' ? -lifetime.pgid : lifetime.pid;
      let probes = 0;
      const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        expect(pid).toBe(id);
        expect(signal).toBe(0);
        probes++;
        if (probes === 2 && outcome === 'aborted') abort.abort();
        throw Object.assign(new Error('Lifetime observation'), {
          code: probes === 2 && outcome === 'empty' ? 'ESRCH' : 'EPERM',
        });
      });
      const waiting = awaitOwnedLifetime(lifetime, abort.signal);
      if (outcome === 'empty') {
        await expect(waiting).resolves.toEqual(
          lifetime.kind === 'posix-group'
            ? { kind: 'posix-group-empty', pgid: lifetime.pgid }
            : { kind: 'windows-main-exited', pid: lifetime.pid },
        );
      } else {
        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      }
      expect(kill).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      await stopOwnedChild(owned, AbortSignal.timeout(5000));
    }
  },
);
