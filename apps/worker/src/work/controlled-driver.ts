import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ControlledFixture } from '@browser-2d/contracts/host';
import type { Acquisition, Obligation, Reconciliation } from './repository';
import type { ControlledDriver } from './service';

const markerSchema = z.strictObject({
  operationId: z.uuid(),
  ownerToken: z.uuid(),
  pages: z.number().int().positive(),
});
export function createControlledDriver({
  root,
  fixture,
}: {
  root: string;
  fixture?: ControlledFixture;
}): ControlledDriver {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fixture) mkdirSync(fixture.directory, { recursive: true, mode: 0o700 });
  function phase(operationId: string, name: 'acquire' | 'execute' | 'release') {
    if (fixture)
      writeFileSync(join(fixture.directory, `${operationId}.${name}`), '', { mode: 0o600 });
  }
  async function hold(name: 'acquire' | 'execute' | 'release') {
    if (fixture?.scenario !== `hold-${name}`) return;
    while (!existsSync(join(fixture.directory, `continue-${name}`))) await delay(25);
  }
  function locate(intent: Obligation) {
    return join(root, intent.operationId);
  }
  function inspect(intent: Obligation): Reconciliation {
    if (fixture?.scenario === 'borrowed')
      return {
        kind: 'present',
        resource: {
          ownership: 'borrowed',
          externalId: join(fixture.directory, 'borrowed-resource'),
        },
      };
    const path = locate(intent);
    if (!existsSync(path)) return { kind: 'absent-final' };
    try {
      const marker = markerSchema.parse(JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')));
      if (
        marker.operationId !== intent.operationId ||
        marker.ownerToken !== intent.ownerToken ||
        marker.pages !== intent.pages
      )
        return { kind: 'unknown' };
      return { kind: 'present', resource: { ownership: 'owned', externalId: path } };
    } catch {
      return { kind: 'unknown' };
    }
  }
  const owned = new Map<string, Obligation>();
  return {
    async acquire(intent, signal) {
      phase(intent.operationId, 'acquire');
      await hold('acquire');
      if (fixture?.scenario === 'borrowed') {
        const externalId = join(fixture.directory, 'borrowed-resource');
        writeFileSync(externalId, 'borrowed', { flag: 'a', mode: 0o600 });
        return { ownership: 'borrowed', externalId };
      }
      signal.throwIfAborted();
      const path = locate(intent);
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(
        join(path, 'owner.json'),
        JSON.stringify({
          operationId: intent.operationId,
          ownerToken: intent.ownerToken,
          pages: intent.pages,
        }),
        { mode: 0o600, flag: 'wx', flush: true },
      );
      owned.set(path, intent);
      if (fixture)
        writeFileSync(join(fixture.directory, `${intent.operationId}.created`), '', {
          mode: 0o600,
        });
      if (fixture?.scenario === 'acquire-result-lost') {
        phase(intent.operationId, 'acquire');
        await new Promise<never>(() => {});
      }
      return { ownership: 'owned', externalId: path };
    },
    async execute(resource, run, signal) {
      const operationId = owned.get(resource.externalId)?.operationId ?? run.id;
      phase(operationId, 'execute');
      if (resource.ownership === 'owned')
        writeFileSync(join(resource.externalId, 'executed'), '', { mode: 0o600 });
      await hold('execute');
      await delay(3000, undefined, { signal });
    },
    async reconcile(intent) {
      const observed = inspect(intent);
      if (observed.kind === 'present' && observed.resource.ownership === 'owned')
        owned.set(observed.resource.externalId, intent);
      return observed;
    },
    async release(resource) {
      if (resource.ownership === 'borrowed') return;
      const intent = owned.get(resource.externalId);
      if (!intent) throw new Error('Ownership not verified');
      phase(intent.operationId, 'release');
      await hold('release');
      if (
        fixture?.scenario === 'cleanup-fails' &&
        !existsSync(join(fixture.directory, 'allow-cleanup'))
      )
        throw new Error('Controlled cleanup refused');
      const observed = inspect(intent);
      if (observed.kind === 'absent-final') return;
      if (observed.kind !== 'present' || observed.resource.ownership !== 'owned')
        throw new Error('Ownership not verified');
      rmSync(resource.externalId, { recursive: true });
    },
  };
}
