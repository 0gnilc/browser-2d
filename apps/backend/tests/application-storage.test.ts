import { randomUUID } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { to, MAX_SAFE_UNITS } from '@browser-2d/amount';
import {
  browserCreateSchema,
  cardUpdateSchema,
  limits,
  type Result,
} from '@browser-2d/contracts/public';
import {
  operationKeySchema,
  boundExecutionSchema,
  type BoundExecution,
  type PrivateClaim,
  type CardReply,
  type SettingsCommitInput,
} from '@browser-2d/contracts/host';
import {
  openApplicationRepository,
  ApplicationStorageError,
} from '../src/data-service/database/open';
import { type ApplicationRepository } from '../src/data-service/repository';
const stamp = '2026-11-03T09:00:00.000Z';
let directory: string;
let path: string;
let repo: ApplicationRepository;
const repositories: ApplicationRepository[] = [];
function value<T>(result: Result<T>): T;
function value(result: CardReply['result']): unknown;
function value(result: Result<unknown>) {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function open(options: Partial<Parameters<typeof openApplicationRepository>[0]> = {}) {
  const opened = openApplicationRepository({
    path,
    now: () => stamp,
    processors: ['baidu-check', 'controlled-test'],
    ...options,
  });
  repositories.push(opened);
  return opened;
}
function close(opened = repo) {
  opened.close();
  repositories.splice(repositories.indexOf(opened), 1);
}
function browser(profileId: string = randomUUID()) {
  return value(
    repo.browsers.create(
      browserCreateSchema.parse({
        provider: 'adspower',
        profileId,
        name: profileId,
        account: 'raw account',
        amount: '0.29',
        notes: 'note',
      }),
    ),
  );
}
function line(number: string) {
  return `${number}| 01 | 0026 | 012 |||||||`;
}
async function importCards(...numbers: string[]) {
  return value(await repo.cards.importText({ text: numbers.map(line).join('\n') }));
}
function cards() {
  return value(repo.cards.list({ page: 1, pageSize: 200 })).items;
}
function start(target = browser()): BoundExecution {
  const task = value(repo.tasks.accept({ browserId: target.id }));
  const prepared = value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }));
  if (!prepared?.execution || prepared.id !== task.id) throw new Error('Task was not prepared');
  const execution = boundExecutionSchema.parse({
    taskId: task.id,
    executionNonce: prepared.execution.nonce,
  });
  value(repo.tasks.authorize({ execution, pid: 12345 }));
  const requestId = randomUUID();
  value(repo.tasks.startIntent({ execution, requestId }));
  value(
    repo.tasks.owned({
      execution,
      requestId,
      session: {
        endpoint: `ws://127.0.0.1:12345/devtools/browser/${requestId}`,
        browserTargetId: requestId,
      },
    }),
  );
  value(repo.tasks.running(execution));
  return execution;
}
function next(execution: BoundExecution): PrivateClaim {
  const reply = repo.tasks.request({ execution, request: { kind: 'next_card' } });
  if (reply.kind !== 'next_card') throw new Error('Wrong reply');
  const result = value(reply.result);
  if (result.kind !== 'claimed') throw new Error('No claimed card');
  return result.claim;
}
function add(
  execution: BoundExecution,
  claim: PrivateClaim,
  delta = '1.00',
  key = 'controlled.add.v1',
): CardReply {
  return repo.tasks.request({
    execution,
    request: {
      kind: 'apply',
      claimToken: claim.claimToken,
      processingId: claim.processingId,
      operationKey: operationKeySchema.parse(key),
      identity: { processor: 'controlled-test', version: 1 },
      mutation: { kind: 'add_amount', delta: to(delta) },
    },
  });
}
function complete(
  execution: BoundExecution,
  claim: PrivateClaim,
  outcome: 'success' | 'failure' = 'success',
): CardReply {
  return repo.tasks.request({
    execution,
    request: {
      kind: 'complete',
      claimToken: claim.claimToken,
      processingId: claim.processingId,
      result: {
        processor: 'controlled-test',
        kind: 'verification',
        outcome,
        message: 'fixture result',
      },
    },
  });
}
function finish(execution: BoundExecution) {
  const task = value(repo.tasks.list()).find((task) => task.id === execution.taskId);
  if (!task || task.environment.kind !== 'owned') throw new Error('Expected owned task');
  value(repo.tasks.fence({ taskId: execution.taskId, reason: 'Stopped' }));
  return repo.tasks.finish({
    execution,
    exit: { kind: 'observed_exit', execution, pid: 12345, observedAt: stamp },
    environment: {
      kind: 'owned_session_closed',
      requestId: task.environment.requestId,
      session: task.environment.session,
      observedAt: stamp,
    },
    outcome: { kind: 'stopped' },
  });
}
function settingsInput(values: Partial<SettingsCommitInput['values']> = {}): SettingsCommitInput {
  const current = value(repo.settings.read());
  return {
    values: { ...current.values, ...values },
    expectedRevision: current.revision,
    connectionAction: 'keep',
  };
}
function alter(sql: string) {
  close();
  const db = new Database(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
  repo = open();
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'browser2d-application-'));
  path = join(directory, 'app.sqlite');
  repo = open();
});
afterEach(() => {
  for (const opened of repositories.splice(0)) opened.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('raw card import and lists', () => {
  it('preserves raw text, UTF-8 BOM, CRLF and original line outcomes', async () => {
    const text =
      '\uFEFF 0001 2345-6789 | 001 | 00026 | 012 | A  B | A-B | C | R | 001 | xx | raw  extra \r\n\r\nwrong|columns\r\n0001 2345-6789|001|00026|different|||||||\r\n';
    const result = value(await repo.cards.importText({ text }));
    expect(result).toMatchObject({
      outcome: 'complete',
      inserted: 1,
      duplicates: 1,
      invalid: 1,
      blank: 2,
      unprocessedFromLine: null,
    });
    expect(result.lines.map(({ line, kind }) => ({ line, kind }))).toEqual([
      { line: 1, kind: 'inserted' },
      { line: 2, kind: 'blank' },
      { line: 3, kind: 'invalid' },
      { line: 4, kind: 'duplicate' },
      { line: 5, kind: 'blank' },
    ]);
    expect(cards()[0]).toMatchObject({
      number: '0001 2345-6789',
      expiryMonth: '001',
      expiryYear: '00026',
      securityCode: '012',
      cardholderName: 'A  B',
      billingAddress: 'A-B',
      billingPostalCode: '001',
      billingCountryCode: 'xx',
      extra: 'raw  extra',
      amount: '0.00',
      lastResult: null,
    });
  });
  it('deduplicates exact number/month/year only and preserves stable ASC order through filters and paging', async () => {
    await importCards('0001', '00 01', '00-01', '0002');
    const duplicate = value(
      await repo.cards.importText({ text: '0001|01|0026|other|||||||\n0001|1|0026|012|||||||' }),
    );
    expect(duplicate).toMatchObject({ inserted: 1, duplicates: 1 });
    expect(cards().map((card) => card.number)).toEqual(['0001', '00 01', '00-01', '0002', '0001']);
    expect(
      value(repo.cards.list({ page: 2, pageSize: 2 })).items.map((card) => card.number),
    ).toEqual(['00-01', '0002']);
    expect(
      value(repo.cards.list({ page: 1, pageSize: 20, status: 'pending', search: '000' })).items.map(
        (card) => card.number,
      ),
    ).toEqual(['0001', '0002', '0001']);
    expect(value(repo.cards.list({ page: 1, pageSize: 20, search: '%' })).total).toBe(0);
  });
  it.each([
    '|01|26|012|||||||',
    '0001||26|012|||||||',
    '0001|01||012|||||||',
    '0001|01|26||||||||',
    '0001|01|26|012||||||||',
  ])('rejects missing required and extra columns in %s', async (text) => {
    expect(value(await repo.cards.importText({ text }))).toMatchObject({ inserted: 0, invalid: 1 });
  });
  it('rejects oversized UTF-8 input, field values, line counts and unsafe page offsets', async () => {
    expect(
      await repo.cards.importText({ text: '界'.repeat(Math.floor(limits.importBytes / 3) + 1) }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await repo.cards.importText({ text: '\n'.repeat(limits.importLines) })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(
      value(await repo.cards.importText({ text: line('x'.repeat(limits.fieldLength + 1)) })),
    ).toMatchObject({ invalid: 1 });
    expect(repo.cards.list({ page: Number.MAX_SAFE_INTEGER, pageSize: 200 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
  it('queues concurrent imports FIFO and yields stop control between committed batches', async () => {
    const stop = () => {
      value(repo.tasks.fence({ taskId: execution.taskId, reason: 'stop during import' }));
    };
    let firstYield = true;
    close();
    repo = open({
      yieldControl: async () => {
        if (firstYield) {
          firstYield = false;
          stop?.();
        }
      },
    });
    const execution = start();
    const first = repo.cards.importText({
      text: Array.from({ length: 150 }, (_, index) => line(`A${index}`)).join('\n'),
    });
    const second = repo.cards.importText({ text: line('B') });
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(cards().map((card) => card.number)).toEqual([
      ...Array.from({ length: 150 }, (_, index) => `A${index}`),
      'B',
    ]);
    expect(repo.tasks.request({ execution, request: { kind: 'next_card' } }).result).toMatchObject({
      ok: false,
    });
  });
  it('returns only committed line totals when a later batch rolls back and admits a later import', async () => {
    alter(
      "CREATE TRIGGER fail_import BEFORE INSERT ON card WHEN NEW.number = 'FAIL' BEGIN SELECT RAISE(ABORT, 'injected batch failure'); END;",
    );
    const first = repo.cards.importText({
      text: [
        ...Array.from({ length: 100 }, (_, index) => line(`A${index}`)),
        line('SHOULD_ROLL_BACK'),
        line('FAIL'),
      ].join('\n'),
    });
    const second = repo.cards.importText({ text: line('B') });
    expect(value(await first)).toMatchObject({
      outcome: 'partial',
      inserted: 100,
      unprocessedFromLine: 101,
    });
    expect(value(await second)).toMatchObject({ outcome: 'complete', inserted: 1 });
    expect(cards().map((card) => card.number)).toEqual([
      ...Array.from({ length: 100 }, (_, index) => `A${index}`),
      'B',
    ]);
  });
});

describe('task claims and durable operations', () => {
  it('takes FIFO snapshots, reserves concurrency and never promotes a queued task without capacity', () => {
    const a = browser('a'),
      b = browser('b'),
      c = browser('c');
    const tasks = [a, b, c].map((browser) => value(repo.tasks.accept({ browserId: browser.id })));
    expect(value(repo.tasks.accept({ browserId: a.id }))).toEqual(tasks[0]);
    expect(value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }))?.browser).toMatchObject({
      id: a.id,
      account: 'raw account',
      amount: 29,
    });
    expect(value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }))?.browser.id).toBe(b.id);
    expect(value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }))).toBeNull();
    value(repo.settings.commit(settingsInput({ 'work.maxConcurrentTasks': 1 })));
    expect(value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }))).toBeNull();
    expect(value(repo.tasks.list()).map((task) => task.state)).toEqual([
      'starting',
      'starting',
      'queued',
    ]);
    for (const target of [a, b, c]) {
      expect(repo.browsers.update({ id: target.id, name: 'blocked' })).toMatchObject({
        ok: false,
        error: { reason: 'ACTIVE_TASK' },
      });
      expect(repo.browsers.remove({ id: target.id })).toMatchObject({ ok: false });
    }
  });
  it('claims the earliest card exclusively for each task and permits one outstanding card per task', async () => {
    await importCards('A', 'B', 'C');
    const a = start(),
      b = start();
    expect(next(a).card.number).toBe('A');
    expect(next(b).card.number).toBe('B');
    expect(
      repo.tasks.request({ execution: a, request: { kind: 'next_card' } }).result,
    ).toMatchObject({ ok: false });
    expect(cards().map((card) => card.status)).toEqual(['processing', 'processing', 'pending']);
  });
  it('commits SQL additions immediately, replays the original result across fresh claims and refuses changed input', async () => {
    await importCards('A');
    const a = start();
    const first = next(a);
    const original = add(a, first);
    expect(original.result).toMatchObject({
      ok: true,
      value: { kind: 'amount_added', amount: 100 },
    });
    expect(cards()[0]?.amount).toBe('1.00');
    expect(add(a, first)).toEqual(original);
    expect(add(a, first, '2.00')).toMatchObject({
      result: { ok: false, error: { reason: 'OPERATION_CONFLICT' } },
    });
    value(add(a, first, '0.29', 'controlled.second.v1').result);
    value(finish(a));
    const b = start();
    const renewed = next(b);
    expect(renewed.processingId).toBe(first.processingId);
    expect(renewed.claimToken).not.toBe(first.claimToken);
    expect(add(b, renewed)).toEqual(original);
    expect(cards()[0]?.amount).toBe('1.29');
    expect(add(b, first).result).toMatchObject({ ok: false });
    expect(add(a, first).result).toMatchObject({ ok: false });
  });
  it('preserves committed fields and receipts across stop and protects ordinary processor input edits', async () => {
    await importCards('A');
    const execution = start();
    const claim = next(execution);
    expect(repo.cards.update({ id: claim.card.id, notes: 'blocked' })).toMatchObject({
      ok: false,
      error: { reason: 'ACTIVE_CLAIM' },
    });
    expect(repo.cards.remove({ id: claim.card.id })).toMatchObject({ ok: false });
    value(
      repo.tasks.request({
        execution,
        request: {
          kind: 'apply',
          claimToken: claim.claimToken,
          processingId: claim.processingId,
          operationKey: operationKeySchema.parse('controlled.extra.v1'),
          identity: { processor: 'controlled-test', version: 1 },
          mutation: { kind: 'set_fields', values: { extra: 'saved raw' } },
        },
      }).result,
    );
    value(finish(execution));
    expect(cards()[0]).toMatchObject({ status: 'pending', extra: 'saved raw', amount: '0.00' });
    expect(repo.cards.update({ id: claim.card.id, number: 'changed' })).toMatchObject({
      ok: false,
      error: { reason: 'INPUT_LOCKED' },
    });
    expect(value(repo.cards.update({ id: claim.card.id, notes: 'allowed' })).notes).toBe('allowed');
    expect(cardUpdateSchema.safeParse({ id: claim.card.id, amount: '1.00' }).success).toBe(false);
  });
  it('replays a lost completion response after releasing its claim and counts explicit failure once', async () => {
    await importCards('A');
    const target = browser();
    const execution = start(target);
    const claim = next(execution);
    const result = complete(execution, claim, 'failure');
    value(result.result);
    expect(complete(execution, claim, 'failure')).toEqual(result);
    expect(cards()[0]).toMatchObject({
      status: 'failed',
      lastResult: {
        processor: 'controlled-test',
        kind: 'verification',
        outcome: 'failure',
        committedAt: stamp,
      },
    });
    expect(value(repo.browsers.list())[0]?.count).toBe(1);
    expect(repo.tasks.request({ execution, request: { kind: 'next_card' } })).toMatchObject({
      result: { ok: true, value: { kind: 'empty' } },
    });
    expect(complete(execution, claim, 'success')).toMatchObject({
      result: { ok: false, error: { reason: 'OPERATION_CONFLICT' } },
    });
    expect(
      complete(
        boundExecutionSchema.parse({ ...execution, executionNonce: randomUUID() }),
        claim,
        'failure',
      ).result,
    ).toMatchObject({ ok: false });
    value(repo.tasks.fence({ taskId: execution.taskId, reason: 'stop' }));
    expect(complete(execution, claim, 'failure').result).toMatchObject({ ok: false });
    value(finish(execution));
    expect(cards()[0]?.status).toBe('failed');
    expect(value(repo.browsers.list())[0]?.count).toBe(1);
  });
  it('refuses completion replay from a different still-running task', async () => {
    await importCards('A');
    const a = start();
    const claim = next(a);
    value(complete(a, claim).result);
    const b = start();
    expect(complete(b, claim).result).toMatchObject({ ok: false });
    expect(value(repo.browsers.list()).map((browser) => browser.count)).toEqual([1, 0]);
  });
  it('lets complete-first stay terminal while stop-first rejects the completion and returns pending', async () => {
    await importCards('A', 'B');
    const a = start();
    const first = next(a);
    value(complete(a, first).result);
    value(finish(a));
    const b = start();
    const second = next(b);
    value(repo.tasks.fence({ taskId: b.taskId, reason: 'stop first' }));
    expect(complete(b, second).result).toMatchObject({ ok: false });
    value(finish(b));
    expect(cards().map((card) => card.status)).toEqual(['processed', 'pending']);
    expect(value(repo.browsers.list()).map((browser) => browser.count)).toEqual([1, 0]);
  });
  it('allows maximum safe amount, rejects overflow without inserting a receipt, then accepts a valid smaller operation', async () => {
    await importCards('A');
    const execution = start();
    const claim = next(execution);
    value(add(execution, claim, '90071992547409.91').result);
    expect(cards()[0]?.amount).toBe('90071992547409.91');
    expect(add(execution, claim, '0.01', 'overflow.v1').result).toMatchObject({ ok: false });
    expect(add(execution, claim, '0.00', 'overflow.v1').result).toMatchObject({
      ok: true,
      value: { amount: MAX_SAFE_UNITS },
    });
  });
  it('rolls back count overflow with card, receipt and claim unchanged', async () => {
    await importCards('A');
    const execution = start();
    const claim = next(execution);
    alter(`UPDATE browser SET count = ${MAX_SAFE_UNITS};`);
    expect(complete(execution, claim).result).toMatchObject({ ok: false });
    expect(cards()[0]).toMatchObject({ status: 'processing', lastResult: null });
    expect(repo.cards.remove({ id: claim.card.id })).toMatchObject({ ok: false });
    alter('UPDATE browser SET count = 0;');
    value(complete(execution, claim).result);
    expect(value(repo.browsers.list())[0]?.count).toBe(1);
  });
  it('retains claims for unproven exit, unknown starts and wrong session closure', async () => {
    await importCards('A');
    const execution = start();
    const claim = next(execution);
    value(repo.tasks.fence({ taskId: execution.taskId, reason: 'stop' }));
    const task = value(repo.tasks.list())[0];
    if (!task || task.environment.kind !== 'owned') throw new Error('Missing owned task');
    const proof = {
      execution,
      exit: { kind: 'observed_exit', execution, pid: 12345, observedAt: stamp },
      environment: {
        kind: 'owned_session_closed',
        requestId: task.environment.requestId,
        session: task.environment.session,
        observedAt: stamp,
      },
      outcome: { kind: 'stopped' },
    } as const;
    expect(repo.tasks.finish({ ...proof, exit: { ...proof.exit, pid: 99999 } })).toMatchObject({
      ok: false,
      error: { reason: 'RECOVERY_REQUIRED' },
    });
    expect(
      repo.tasks.finish({
        ...proof,
        environment: {
          ...proof.environment,
          session: { endpoint: 'ws://127.0.0.1:4/foreign', browserTargetId: 'foreign' },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(repo.tasks.finish({ ...proof, environment: { kind: 'never_started' } })).toMatchObject({
      ok: false,
    });
    expect(cards()[0]?.status).toBe('processing');
    value(repo.tasks.finish(proof));
    const later = start();
    next(later);
    expect(value(repo.tasks.finish(proof))).toEqual({ kind: 'already_released' });
    expect(cards()[0]?.status).toBe('processing');
    expect(repo.cards.remove({ id: claim.card.id })).toMatchObject({ ok: false });
  });
  it('reserves registered completion keys and only releases a never-forked execution with matching ownership', async () => {
    await importCards('A');
    const live = start();
    const claim = next(live);
    expect(add(live, claim, '1.00', 'controlled-test.complete.v1').result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    value(complete(live, claim).result);
    expect(repo.cards.remove({ id: claim.card.id })).toMatchObject({
      ok: false,
      error: { reason: 'ACTIVE_TASK' },
    });
    value(finish(live));
    expect(value(repo.cards.remove({ id: claim.card.id }))).toEqual({ removed: true });
    const target = browser();
    value(repo.tasks.accept({ browserId: target.id }));
    const ownerNonce = randomUUID();
    const prepared = value(repo.tasks.prepareNext({ ownerNonce }));
    if (!prepared?.execution) throw new Error('Missing execution');
    const execution = boundExecutionSchema.parse({
      taskId: prepared.id,
      executionNonce: prepared.execution.nonce,
    });
    value(repo.tasks.fence({ taskId: prepared.id, reason: 'never launched' }));
    const proof = {
      execution,
      exit: { kind: 'never_forked', execution, ownerNonce },
      environment: { kind: 'never_started' },
      outcome: { kind: 'stopped' },
    } as const;
    expect(
      repo.tasks.finish({ ...proof, exit: { ...proof.exit, ownerNonce: randomUUID() } }),
    ).toMatchObject({ ok: false });
    expect(value(repo.tasks.finish(proof))).toEqual({ kind: 'released' });
  });
  it('retains an unresolved start despite process exit until the exact issued request is proven settled', () => {
    const target = browser();
    value(repo.tasks.accept({ browserId: target.id }));
    const prepared = value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }));
    if (!prepared?.execution) throw new Error('Missing prepared task');
    const execution = boundExecutionSchema.parse({
      taskId: prepared.id,
      executionNonce: prepared.execution.nonce,
    });
    value(repo.tasks.authorize({ execution, pid: 12345 }));
    const requestId = randomUUID();
    value(repo.tasks.startIntent({ execution, requestId }));
    value(repo.tasks.recovery({ execution, message: 'Start outcome is unknown' }));
    const proof = {
      execution,
      exit: { kind: 'observed_absent', execution, pid: 12345, observedAt: stamp },
      environment: { kind: 'never_started' },
      outcome: { kind: 'stopped' },
    } as const;
    expect(repo.tasks.finish(proof)).toMatchObject({
      ok: false,
      error: { reason: 'RECOVERY_REQUIRED' },
    });
    expect(
      repo.tasks.finish({
        ...proof,
        environment: { kind: 'settled_without_open', requestId: randomUUID() },
      }),
    ).toMatchObject({ ok: false });
    expect(value(repo.tasks.list())[0]).toMatchObject({
      state: 'recovery_required',
      environment: { kind: 'recovery_required', obligation: { kind: 'start', requestId } },
    });
    expect(
      value(
        repo.tasks.finish({ ...proof, environment: { kind: 'settled_without_open', requestId } }),
      ),
    ).toEqual({ kind: 'released' });
  });
  it('does not let a stopped execution start or return to running and retains a late known environment for cleanup', () => {
    const target = browser();
    const accepted = value(repo.tasks.accept({ browserId: target.id }));
    const prepared = value(repo.tasks.prepareNext({ ownerNonce: randomUUID() }));
    if (!prepared?.execution) throw new Error('No prepared task');
    const execution = boundExecutionSchema.parse({
      taskId: accepted.id,
      executionNonce: prepared.execution.nonce,
    });
    value(repo.tasks.authorize({ execution, pid: 12345 }));
    const requestId = randomUUID();
    value(repo.tasks.startIntent({ execution, requestId }));
    value(repo.tasks.fence({ taskId: accepted.id, reason: 'stop while starting' }));
    expect(repo.tasks.startIntent({ execution, requestId: randomUUID() })).toMatchObject({
      ok: false,
    });
    value(
      repo.tasks.owned({
        execution,
        requestId,
        session: { endpoint: 'ws://127.0.0.1:12345/devtools/browser/a', browserTargetId: 'a' },
      }),
    );
    expect(repo.tasks.running(execution)).toMatchObject({ ok: false });
    expect(value(repo.tasks.list())[0]).toMatchObject({
      state: 'stopping',
      environment: { kind: 'owned' },
    });
  });
});

describe('atomic settings and binding confirmation', () => {
  it('initializes four keys with one revision and atomically rejects stale CAS', () => {
    const first = settingsInput({ 'ui.sidebarCollapsed': true, 'work.maxConcurrentTasks': 3 });
    expect(value(repo.settings.commit(first))).toMatchObject({
      revision: 1,
      values: { sidebarCollapsed: true, maxConcurrentTasks: 3, apiKeyConfigured: false },
    });
    expect(
      repo.settings.commit({ ...first, values: { ...first.values, 'ui.sidebarCollapsed': false } }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(value(repo.settings.read())).toMatchObject({
      revision: 1,
      values: { 'ui.sidebarCollapsed': true, 'work.maxConcurrentTasks': 3 },
    });
    close();
    repo = open();
    expect(value(repo.settings.read()).revision).toBe(1);
  });
  it('requires exact current browser bindings and rejects changed bindings transactionally', () => {
    const target = browser();
    const input = settingsInput({ 'browser.apiBaseUrl': 'http://127.0.0.1:50326' });
    expect(repo.settings.commit(input)).toMatchObject({
      ok: false,
      error: { reason: 'BINDINGS_CHANGED' },
    });
    const bindings = value(repo.settings.bindings());
    browser();
    expect(repo.settings.commit({ ...input, expectedBindings: bindings })).toMatchObject({
      ok: false,
      error: { reason: 'BINDINGS_CHANGED' },
    });
    expect(value(repo.settings.read()).revision).toBe(0);
    const saved = value(
      repo.settings.commit({ ...input, expectedBindings: value(repo.settings.bindings()) }),
    );
    expect(saved.values.apiBaseUrl).toBe('http://127.0.0.1:50326');
    value(repo.tasks.accept({ browserId: target.id }));
    const replacement = {
      ...settingsInput({ 'browser.apiKeyRef': randomUUID() }),
      connectionAction: 'replace',
    } as const;
    expect(
      repo.settings.commit({ ...replacement, expectedBindings: value(repo.settings.bindings()) }),
    ).toMatchObject({ ok: false, error: { reason: 'ACTIVE_TASK' } });
    expect(value(repo.settings.read()).revision).toBe(1);
  });
  it('keeps opaque references private and validates credential actions and canonical loopback URLs', () => {
    const replacement = {
      ...settingsInput({ 'browser.apiKeyRef': randomUUID() }),
      connectionAction: 'replace',
    } as const;
    const saved = value(repo.settings.commit(replacement));
    expect(saved.values.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('apiKeyRef');
    expect(repo.settings.commit(settingsInput({ 'browser.apiKeyRef': '' }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(
      repo.settings.commit(settingsInput({ 'browser.apiBaseUrl': 'http://localhost:50325' })),
    ).toMatchObject({ ok: false });
  });
});

describe('new application database migration and persistence', () => {
  it('persists raw cards, stable claims, receipts, tasks and settings across repository restart', async () => {
    await importCards('0001');
    const execution = start();
    const claim = next(execution);
    const applied = add(execution, claim);
    close();
    repo = open();
    expect(add(execution, claim)).toEqual(applied);
    expect(cards()[0]).toMatchObject({ number: '0001', amount: '1.00', status: 'processing' });
    expect(value(repo.tasks.list())[0]?.execution?.nonce).toBe(execution.executionNonce);
  });
  it('rejects changed migration content, future schema versions and preexisting legacy databases', () => {
    close();
    const migrationsDir = join(directory, 'migrations');
    cpSync(fileURLToPath(new URL('../migrations/application', import.meta.url)), migrationsDir, {
      recursive: true,
    });
    appendFileSync(join(migrationsDir, '001-application.sql'), '\n');
    expect(() => openApplicationRepository({ path, migrationsDir })).toThrowError(
      new ApplicationStorageError('MIGRATION_CHANGED'),
    );
    const db = new Database(path);
    db.pragma('user_version = 99');
    db.close();
    expect(() => openApplicationRepository({ path })).toThrowError(
      new ApplicationStorageError('DATABASE_NEWER'),
    );
    const old = new Database(join(directory, 'legacy.sqlite'));
    old.exec('CREATE TABLE device(id INTEGER PRIMARY KEY)');
    old.close();
    expect(() =>
      openApplicationRepository({ path: join(directory, 'legacy.sqlite') }),
    ).toThrowError(new ApplicationStorageError('DATABASE_UNRECOGNIZED'));
  });
  it('rejects inconsistent aggregate settings revisions and checksum ledger corruption', () => {
    close();
    const db = new Database(path);
    db.exec("UPDATE settings SET revision = 1 WHERE key = 'ui.sidebarCollapsed'");
    db.close();
    expect(() => openApplicationRepository({ path })).toThrowError(
      new ApplicationStorageError('DATABASE_UNRECOGNIZED'),
    );
  });
  it('rejects checksum ledger corruption and creates only the approved tables', () => {
    close();
    const db = new Database(path);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence' ORDER BY name",
        )
        .pluck()
        .all(),
    ).toEqual([
      'browser',
      'card',
      'card_claim',
      'card_operation',
      'schema_migrations',
      'settings',
      'work_task',
    ]);
    db.exec("UPDATE schema_migrations SET checksum = 'corrupt'");
    db.close();
    expect(() => openApplicationRepository({ path })).toThrowError(
      new ApplicationStorageError('MIGRATION_CHANGED'),
    );
  });
});
