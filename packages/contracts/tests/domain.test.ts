import { expect, it } from 'vitest';
import {
  browserSchema,
  browserUpdateSchema,
  cardSchema,
  cardUpdateSchema,
  applicationSettingsSchema,
  applicationSettingsDefaults,
  taskIdSchema,
} from '../src/public';
import { browserSnapshotSchema } from '../src/host/task-process';
const timestamp = '2026-11-03T00:00:00.000Z';
const browser = {
  id: 1,
  provider: 'adspower',
  profileId: 'profile',
  name: '',
  account: 'input account',
  amount: '0.29',
  count: 0,
  status: 'idle',
  notes: '',
  lastError: '',
  createdAt: timestamp,
  updatedAt: timestamp,
};
it('derives the complete immutable snapshot with only integer amount override', () => {
  const dto = browserSchema.parse(browser);
  const snapshot = browserSnapshotSchema.parse({ ...dto, amount: 29 });
  expect(snapshot).toEqual({ ...dto, amount: 29 });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(browserSchema.safeParse(snapshot).success).toBe(false);
  expect(browserSnapshotSchema.safeParse(dto).success).toBe(false);
  expect(browserSnapshotSchema.safeParse({ ...snapshot, account: undefined }).success).toBe(false);
});
it.each(['count', 'status', 'lastError'])('ordinary browser edits reject %s', (field) =>
  expect(browserUpdateSchema.safeParse({ id: 1, [field]: 'forbidden' }).success).toBe(false),
);
it('keeps card text raw and does not expose processing identity', () => {
  const card = {
    id: 1,
    number: '00 12-34',
    expiryMonth: '01',
    expiryYear: '0026',
    securityCode: '00x',
    cardholderName: '',
    billingAddress: '',
    billingCity: '',
    billingRegion: '',
    billingPostalCode: '',
    billingCountryCode: '',
    amount: '0.00',
    status: 'pending',
    extra: '',
    notes: '',
    lastResult: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  expect(cardSchema.parse(card)).toEqual(card);
  for (const key of ['processingId', 'claimToken', 'operationKey'])
    expect(cardSchema.safeParse({ ...card, [key]: 'private' }).success).toBe(false);
});
it.each(['amount', 'status', 'processingId', 'lastResult'])(
  'ordinary card edits reject %s',
  (field) =>
    expect(cardUpdateSchema.safeParse({ id: 1, [field]: 'forbidden' }).success).toBe(false),
);
it('settings registry supplies validated defaults and rejects arbitrary keys', () => {
  expect(applicationSettingsSchema.parse(applicationSettingsDefaults)).toEqual(
    applicationSettingsDefaults,
  );
  expect(
    applicationSettingsSchema.safeParse({ ...applicationSettingsDefaults, arbitrary: true })
      .success,
  ).toBe(false);
  expect(
    applicationSettingsSchema.safeParse({
      ...applicationSettingsDefaults,
      'work.maxConcurrentTasks': 0,
    }).success,
  ).toBe(false);
  expect(taskIdSchema.safeParse('not-a-task').success).toBe(false);
});

it.each(['', 'invalid', 'https://remote.test', 'http://user:secret@127.0.0.1:50325'])(
  'rejects invalid platform API URL %s',
  (url) => {
    expect(
      applicationSettingsSchema.safeParse({
        ...applicationSettingsDefaults,
        'browser.apiBaseUrl': url,
      }).success,
    ).toBe(false);
  },
);
