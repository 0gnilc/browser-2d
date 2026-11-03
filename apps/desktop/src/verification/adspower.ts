import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { app } from 'electron';
import { createCredentialVault } from '../platform/credentials';
import { createSettingsCoordinator } from '../main/settings-coordinator';
import { launchDataService } from '../main/data-service-client';
import { createTaskCoordinator } from '../main/task-coordinator';
import { safeStorage } from 'electron';
const optionsSchema = z.strictObject({
  reportPath: z.string(),
  apiBaseUrl: z.literal('http://127.0.0.1:50325'),
  profiles: z.tuple([z.literal('k1in0s2l'), z.literal('k1in0s46')]),
  credentialService: z.literal('io.github.0gnilc.browser2d.development.adspower'),
  credentialAccount: z.literal('browser-2d-development'),
});
export async function verifyAdsPower(raw: unknown) {
  const options = optionsSchema.parse(raw);
  const directory = dirname(resolve(options.reportPath));
  const suffix = relative(tmpdir(), directory);
  assert(
    !isAbsolute(suffix) && !suffix.startsWith('..') && suffix.startsWith('browser-2d-adspower-'),
  );
  assert.equal(resolve(options.reportPath), join(directory, 'report.json'));
  if (process.platform !== 'darwin') throw new Error('The configured credential requires Keychain');
  const result = await promisify(execFile)(
    '/usr/bin/security',
    [
      'find-generic-password',
      '-s',
      options.credentialService,
      '-a',
      options.credentialAccount,
      '-w',
    ],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, maxBuffer: 8192 },
  );
  const vault = createCredentialVault({
    path: join(directory, 'credentials.enc'),
    encryption: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
    },
  });
  const data = launchDataService({
    dataPath: join(directory, 'data', 'app.sqlite'),
    nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
    onChanged() {},
    onUnavailable() {
      tasks?.unavailable();
    },
  });
  let tasks: ReturnType<typeof createTaskCoordinator> | undefined;
  try {
    await data.ready;
    const settings = createSettingsCoordinator(data, vault);
    const saved = await settings.save({
      values: { apiBaseUrl: options.apiBaseUrl, maxConcurrentTasks: 2, sidebarCollapsed: false },
      apiKey: { kind: 'replace', value: result.stdout.trim() },
      expectedRevision: 0,
    });
    assert(saved.ok && saved.value.kind === 'saved');
    tasks = createTaskCoordinator({
      data,
      ownershipDirectory: join(directory, 'execution-owners'),
      connection: settings.connection,
      changed() {},
    });
    await tasks.recover();
    const browser = await data.request('browsers.create', {
      provider: 'adspower',
      profileId: options.profiles[0],
      name: 'Dedicated verification',
      account: 'synthetic-only',
      amount: '0.29',
      notes: '',
    });
    assert(browser.ok);
    const imported = await data.request('cards.importText', {
      text: ['A', 'B', 'C'].map((id) => `${id}|01|2030|000|||||||`).join('\n'),
    });
    assert(imported.ok && imported.value.inserted === 3);
    const started = await tasks.start({ browserId: browser.value.id });
    assert(started.ok);
    const deadline = Date.now() + 90_000;
    let cards;
    for (;;) {
      cards = await data.request('cards.list', { page: 1, pageSize: 20 });
      assert(cards.ok);
      const active = await tasks.list();
      assert(active.ok);
      if (
        cards.value.items.every((card) => card.status === 'processed') &&
        active.value.length === 0
      )
        break;
      if (Date.now() > deadline) throw new Error('Production coordinator verification timed out');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(
      cards.value.items.every(
        (card) => card.amount === '0.00' && card.lastResult?.kind === 'verification',
      ),
    );
    await tasks.shutdown();
    await writeFile(
      options.reportPath,
      JSON.stringify(
        {
          result: 'VERIFIED',
          packaged: app.isPackaged,
          electron: process.versions.electron,
          productionCoordinator: true,
          sequentialCards: cards.value.items.map((card) => card.number),
          noImplicitAmount: true,
          cleanupConfirmed: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await tasks?.shutdown();
    await data.close();
  }
}
