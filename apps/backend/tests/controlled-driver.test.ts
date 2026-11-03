import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createControlledDriver } from '../src/work/controlled-driver';
import type { Obligation } from '../src/work/repository';
import type { Run } from '@browser-2d/contracts/public';

it('records both runs when concurrent operations borrow the same external resource', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-2d-borrowed-'));
  try {
    const fixture = join(directory, 'fixture');
    const driver = createControlledDriver({
      root: join(directory, 'resources'),
      fixture: { directory: fixture, scenario: 'borrowed' },
    });
    const intents: Obligation[] = [1, 2].map((deviceId) => ({
      operationId: randomUUID(),
      runId: randomUUID(),
      ownerToken: randomUUID(),
      deviceId,
      pages: 1,
      state: 'intent',
      ownership: 'unknown',
      externalId: null,
      failure: null,
    }));
    const acquired = await Promise.all(
      intents.map((intent) => driver.acquire(intent, new AbortController().signal)),
    );
    const signal = AbortSignal.abort();
    await Promise.all(
      intents.map(async (intent, index) => {
        const resource = acquired[index];
        if (!resource) throw new Error('Acquisition missing');
        const run: Run = {
          id: intent.runId,
          deviceId: intent.deviceId,
          state: 'running',
          config: { revision: 0, pageCount: 1, viewportWidth: 1280, viewportHeight: 800 },
          outcome: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await expect(driver.execute(resource, run, signal)).rejects.toThrow();
        await driver.release(resource, signal);
      }),
    );
    expect(
      readdirSync(fixture)
        .filter((name) => name.endsWith('.execute'))
        .sort(),
    ).toEqual(intents.map((intent) => `${intent.operationId}.execute`).sort());
    expect(existsSync(join(fixture, 'borrowed-resource'))).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
