import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as publicApi from '../src/public';
import {
  applicationPublicOperations,
  dataOperations,
  dataRequestSchema,
  dataResponseSchema,
  cardRequestSchema,
  taskProcessEventSchema,
  taskProcessCommandSchema,
  privateClaimSchema,
  applicationSettingsDefaults,
  privateSettingsViewSchema,
} from '../src/host';
const execution = { taskId: randomUUID(), executionNonce: randomUUID() };
it('exposes exactly the five approved application groups and no retired domain exports', () => {
  expect(Object.keys(applicationPublicOperations)).toEqual([
    'browsers.list',
    'browsers.create',
    'browsers.update',
    'browsers.remove',
    'cards.list',
    'cards.importText',
    'cards.update',
    'cards.remove',
    'workTasks.list',
    'workTasks.start',
    'workTasks.stop',
    'settings.get',
    'settings.save',
  ]);
  for (const key of [
    'deviceSchema',
    'materialSchema',
    'historyQuerySchema',
    'runSchema',
    'applicationSettingsSchema',
    'secretRefSchema',
  ])
    expect(key in publicApi).toBe(false);
});
it('keeps the public failure codes stable and supplies typed conflict reasons', () => {
  expect(
    publicApi.failureSchema.parse(publicApi.failure('CONFLICT', 'A claim exists', 'ACTIVE_CLAIM')),
  ).toEqual({
    ok: false,
    error: { code: 'CONFLICT', message: 'A claim exists', reason: 'ACTIVE_CLAIM' },
  });
  expect(
    publicApi.failureSchema.safeParse({
      ok: false,
      error: { code: 'ACTIVE_CLAIM', message: 'invalid top-level code' },
    }).success,
  ).toBe(false);
});
it('keeps settings references private and accepts the explicit public credential action', () => {
  const input = {
    values: {
      apiBaseUrl: 'http://127.0.0.1:50325',
      maxConcurrentTasks: 2,
      sidebarCollapsed: false,
    },
    apiKey: { kind: 'keep' },
    expectedRevision: 0,
  };
  expect(publicApi.settingsSaveSchema.parse(input)).toEqual(input);
  expect(
    publicApi.settingsSaveSchema.safeParse({
      ...input,
      values: { ...input.values, apiKeyRef: randomUUID() },
    }).success,
  ).toBe(false);
  expect(
    publicApi.settingsViewSchema.safeParse({ values: applicationSettingsDefaults, revision: 0 })
      .success,
  ).toBe(false);
  expect(
    privateSettingsViewSchema.parse({ values: applicationSettingsDefaults, revision: 0 }).values[
      'browser.apiKeyRef'
    ],
  ).toBe('');
});
it.each([
  'http://localhost:50325',
  'http://[::1]:50325',
  'http://127.0.0.1:50325/',
  'http://127.0.0.1:50325?key=secret',
  'http://127.0.0.1:50325/#x',
  'http://u:p@127.0.0.1:50325',
])('rejects unsupported or noncanonical connection %s', (apiBaseUrl) => {
  expect(
    publicApi.settingsValuesSchema.safeParse({
      apiBaseUrl,
      apiKeyConfigured: false,
      maxConcurrentTasks: 2,
      sidebarCollapsed: false,
    }).success,
  ).toBe(false);
});
it('derives and validates correlated private requests and results from the operation registry', () => {
  const request = {
    type: 'data-request',
    requestId: randomUUID(),
    method: 'cards.list',
    input: { page: 1, pageSize: 20 },
  };
  expect(dataRequestSchema.parse(request)).toEqual(request);
  expect(dataRequestSchema.safeParse({ ...request, input: { arbitrary: true } }).success).toBe(
    false,
  );
  expect(dataRequestSchema.safeParse({ ...request, method: 'toString' }).success).toBe(false);
  expect(dataRequestSchema.safeParse({ ...request, method: 'settings.save' }).success).toBe(false);
  expect(
    dataResponseSchema.safeParse({
      type: 'data-response',
      requestId: request.requestId,
      method: request.method,
      result: { ok: true, value: [] },
    }).success,
  ).toBe(false);
  expect(
    dataOperations['cards.list'].result.safeParse({
      ok: true,
      value: { items: [], total: 0, page: 1, pageSize: 20 },
    }).success,
  ).toBe(true);
});
it('makes completion keys a registered processor choice and refuses child-supplied completion identity', () => {
  const request = {
    kind: 'complete',
    claimToken: randomUUID(),
    processingId: randomUUID(),
    result: {
      processor: 'baidu-check',
      kind: 'verification',
      outcome: 'success',
      message: 'verified',
    },
  };
  expect(cardRequestSchema.safeParse(request).success).toBe(true);
  expect(cardRequestSchema.safeParse({ ...request, operationKey: 'fresh-key' }).success).toBe(
    false,
  );
  expect(cardRequestSchema.safeParse({ ...request, taskId: execution.taskId }).success).toBe(false);
  expect(
    cardRequestSchema.safeParse({
      ...request,
      result: { ...request.result, processor: 'unregistered' },
    }).success,
  ).toBe(false);
});
it('requires actual typed card payloads and matched safe sequence receipts in the worker protocol', () => {
  const request = { kind: 'request', ...execution, sequence: 1, request: { kind: 'next_card' } };
  expect(taskProcessEventSchema.parse(request)).toEqual(request);
  expect(
    taskProcessEventSchema.safeParse({ kind: 'request', ...execution, sequence: 1 }).success,
  ).toBe(false);
  expect(
    taskProcessEventSchema.safeParse({ ...request, sequence: Number.MAX_SAFE_INTEGER + 1 }).success,
  ).toBe(false);
  expect(taskProcessCommandSchema.safeParse({ kind: 'receipt', sequence: 1 }).success).toBe(false);
  expect(
    taskProcessCommandSchema.safeParse({
      kind: 'receipt',
      sequence: 1,
      reply: { kind: 'next_card', result: { ok: true, value: { kind: 'empty' } } },
    }).success,
  ).toBe(true);
});
it('does not allow a public Card to substitute for its private claim capability', () => {
  expect(privateClaimSchema.safeParse({ card: {}, processingId: randomUUID() }).success).toBe(
    false,
  );
});
it.each([0, publicApi.limits.fieldLength, publicApi.limits.fieldLength + 1])(
  'bounds lifecycle messages of length %i to the persisted browser field',
  (length) => {
    const message = 'x'.repeat(length);
    const expected = length <= publicApi.limits.fieldLength;
    const requests = [
      { method: 'tasks.fence', input: { taskId: execution.taskId, reason: message } },
      { method: 'tasks.recovery', input: { execution, message } },
      {
        method: 'tasks.finish',
        input: {
          execution,
          exit: { kind: 'never_forked', execution, ownerNonce: randomUUID() },
          environment: { kind: 'never_started' },
          outcome: { kind: 'failed', message },
        },
      },
    ];
    for (const request of requests)
      expect(
        dataRequestSchema.safeParse({
          type: 'data-request',
          requestId: randomUUID(),
          ...request,
        }).success,
        request.method,
      ).toBe(expected);
  },
);
