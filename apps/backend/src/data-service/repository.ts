import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  failure,
  browserIdSchema,
  cardIdSchema,
  importTextSchema,
  type Result,
} from '@browser-2d/contracts/public';
import {
  type Processor,
  type CardRequest,
  type BoundExecution,
  type CardReply,
} from '@browser-2d/contracts/host';
import { createBrowserCards } from './browser-cards';
import { createSettings } from './settings';
import { createTasks } from './tasks';
import { createImportPump, parseImport } from './import-text';
import { RepositoryFailure, type RepositoryContext } from './shared';
export interface RepositoryOptions {
  now?: () => string;
  processors?: readonly Processor[];
  yieldControl?: () => Promise<void>;
}
export function createApplicationRepository(
  db: Database.Database,
  options: RepositoryOptions = {},
) {
  const context: RepositoryContext = {
    db,
    now: options.now ?? (() => new Date().toISOString()),
    processors: new Set(options.processors ?? ['baidu-check']),
  };
  function execute<T>(body: () => T): Result<T> {
    try {
      return { ok: true, value: db.transaction(body).immediate() };
    } catch (error) {
      if (error instanceof RepositoryFailure) return error.failure;
      if (error instanceof z.ZodError)
        return failure('INVALID_INPUT', 'The supplied data is invalid');
      return failure('INTERNAL', 'The data operation could not be completed');
    }
  }
  const domain = createBrowserCards(context);
  const settings = createSettings(context);
  const tasks = createTasks(context, () => settings.read().values['work.maxConcurrentTasks']);
  const importText = createImportPump(
    (lines) => execute(() => domain.cards.importBatch(lines)),
    options.yieldControl,
  );
  return {
    browsers: {
      list: () => execute(domain.browsers.list),
      create: (input: Parameters<typeof domain.browsers.create>[0]) =>
        execute(() => domain.browsers.create(input)),
      update: (input: Parameters<typeof domain.browsers.update>[0]) =>
        execute(() => domain.browsers.update(input)),
      remove: (input: { id: number }) =>
        execute(() => domain.browsers.remove({ id: browserIdSchema.parse(input.id) })),
    },
    cards: {
      list: (input: Parameters<typeof domain.cards.list>[0]) =>
        execute(() => domain.cards.list(input)),
      importText(input: { text: string }) {
        const admitted = execute(() => parseImport(importTextSchema.parse(input).text));
        return admitted.ok ? importText(admitted.value) : Promise.resolve(admitted);
      },
      update: (input: Parameters<typeof domain.cards.update>[0]) =>
        execute(() => domain.cards.update(input)),
      remove: (input: { id: number }) =>
        execute(() => domain.cards.remove({ id: cardIdSchema.parse(input.id) })),
    },
    settings: {
      read: () => execute(settings.read),
      bindings: () => execute(settings.bindings),
      commit: (input: Parameters<typeof settings.commit>[0]) =>
        execute(() => settings.commit(input)),
    },
    tasks: {
      list: () => execute(tasks.list),
      accept: (input: Parameters<typeof tasks.accept>[0]) =>
        execute(() => tasks.accept({ browserId: browserIdSchema.parse(input.browserId) })),
      prepareNext: (input: Parameters<typeof tasks.prepareNext>[0]) =>
        execute(() => tasks.prepareNext(input)),
      authorize: (input: Parameters<typeof tasks.authorize>[0]) =>
        execute(() => tasks.authorize(input)),
      startIntent: (input: Parameters<typeof tasks.startIntent>[0]) =>
        execute(() => tasks.startIntent(input)),
      owned: (input: Parameters<typeof tasks.owned>[0]) => execute(() => tasks.owned(input)),
      running: (input: Parameters<typeof tasks.running>[0]) => execute(() => tasks.running(input)),
      fence: (input: Parameters<typeof tasks.fence>[0]) => execute(() => tasks.fence(input)),
      recovery: (input: Parameters<typeof tasks.recovery>[0]) =>
        execute(() => tasks.recovery(input)),
      cancelQueued: (input: Parameters<typeof tasks.cancelQueued>[0]) =>
        execute(() => tasks.cancelQueued(input)),
      finish: (input: Parameters<typeof tasks.finish>[0]) => execute(() => tasks.finish(input)),
      request(input: { execution: BoundExecution; request: CardRequest }): CardReply {
        const request = input.request;
        return request.kind === 'next_card'
          ? { kind: 'next_card', result: execute(() => tasks.processing.nextCard(input.execution)) }
          : {
              kind: request.kind,
              result: execute(() => tasks.processing.operate(input.execution, request)),
            };
      },
    },
    close: () => db.close(),
  };
}
export type ApplicationRepository = ReturnType<typeof createApplicationRepository>;
