import { describe, expect, it, vi } from 'vitest';
import { createApplicationLifecycle } from '../src/main/lifecycle';
function setup() {
  const cleanup = Promise.withResolvers<void>();
  const order: string[] = [];
  const exit = vi.fn();
  const failed = vi.fn();
  const install = vi.fn(() => {
    order.push('install');
  });
  const lifecycle = createApplicationLifecycle({
    stopAcceptingWork() {
      order.push('stop');
    },
    async closeWorker() {
      order.push('close');
      await cleanup.promise;
      order.push('closed');
    },
    async report(code) {
      order.push(`report:${code}`);
    },
    exit,
    logFailure: vi.fn(),
  });
  return { lifecycle, cleanup, order, exit, failed, install };
}
describe('application exit ownership', () => {
  it('reserves install synchronously, drains worker once, then permits native quit', async () => {
    const t = setup();
    expect(t.lifecycle.request({ kind: 'update', install: t.install, failed: t.failed })).toBe(
      true,
    );
    expect(t.lifecycle.acceptingWork).toBe(false);
    expect(t.lifecycle.nativeQuitAllowed).toBe(false);
    expect(t.lifecycle.request({ kind: 'quit' })).toBe(false);
    expect(t.lifecycle.request({ kind: 'update', install: t.install, failed: t.failed })).toBe(
      true,
    );
    await new Promise(setImmediate);
    expect(t.install).not.toHaveBeenCalled();
    t.cleanup.resolve();
    await t.lifecycle.completion;
    expect(t.order).toEqual(['stop', 'close', 'closed', 'report:0', 'install']);
    expect(t.lifecycle.nativeQuitAllowed).toBe(true);
    expect(t.exit).not.toHaveBeenCalled();
  });
  it('does not accept install after normal quit wins', async () => {
    const t = setup();
    t.lifecycle.request({ kind: 'quit' });
    expect(t.lifecycle.request({ kind: 'update', install: t.install, failed: t.failed })).toBe(
      false,
    );
    t.cleanup.resolve();
    await t.lifecycle.completion;
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(t.install).not.toHaveBeenCalled();
  });
  it('retains a visible restart-required failure and never installs after failed cleanup', async () => {
    const t = setup();
    t.lifecycle.request({ kind: 'update', install: t.install, failed: t.failed });
    await new Promise(setImmediate);
    t.cleanup.reject(new Error('cleanup failed'));
    await t.lifecycle.completion;
    expect(t.install).not.toHaveBeenCalled();
    expect(t.failed).toHaveBeenCalledOnce();
    expect(t.lifecycle.acceptingWork).toBe(false);
    expect(t.lifecycle.nativeQuitAllowed).toBe(false);
    expect(t.exit).not.toHaveBeenCalled();
    t.lifecycle.request({ kind: 'quit' });
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('handles an asynchronous installer error without reviving a stopped worker', async () => {
    const t = setup();
    t.lifecycle.request({ kind: 'update', install: t.install, failed: t.failed });
    t.cleanup.resolve();
    await t.lifecycle.completion;
    t.lifecycle.installerFailed();
    expect(t.failed).toHaveBeenCalledOnce();
    expect(t.lifecycle.nativeQuitAllowed).toBe(false);
    expect(t.lifecycle.acceptingWork).toBe(false);
  });
  it('aborts a handoff when an updater error arrives during worker cleanup', async () => {
    const t = setup();
    t.lifecycle.request({ kind: 'update', install: t.install, failed: t.failed });
    await new Promise(setImmediate);
    t.lifecycle.installerFailed();
    t.lifecycle.request({ kind: 'quit' });
    expect(t.exit).not.toHaveBeenCalled();
    t.cleanup.resolve();
    await t.lifecycle.completion;
    expect(t.install).not.toHaveBeenCalled();
    expect(t.failed).toHaveBeenCalledOnce();
    expect(t.lifecycle.nativeQuitAllowed).toBe(false);
  });
  it('reports normal shutdown failure with nonzero exit', async () => {
    const t = setup();
    t.lifecycle.request({ kind: 'quit' });
    await new Promise(setImmediate);
    t.cleanup.reject(new Error('cleanup'));
    await t.lifecycle.completion;
    expect(t.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
