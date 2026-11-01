import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretRefSchema, type BusinessRequest } from '@browser-2d/contracts/host';
import {
  failure,
  settingsValuesSchema,
  type SettingsValues,
  type SettingsView,
} from '@browser-2d/contracts/public';
import {
  createCredentialVault,
  type EncryptionAdapter,
  type VaultStage,
} from '../src/platform/credentials';
import { createBusinessCoordinator } from '../src/bridge/business';

const key = randomBytes(32);
function encryption(): EncryptionAdapter {
  return {
    available: async () => true,
    async encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    async decrypt(bytes) {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-2d-vault-'));
  path = join(directory, 'credentials.enc');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('credential persistence with an injected encryption adapter', () => {
  it('atomically retains every immutable reference across restart without writing plaintext', async () => {
    const vault = createCredentialVault({ path, encryption: encryption() });
    const refs = await Promise.all(
      Array.from({ length: 8 }, (_, index) => vault.preparePersistent(`secret-value-${index}`)),
    );
    const restarted = createCredentialVault({ path, encryption: encryption() });
    for (const ref of refs) await expect(restarted.verify(ref)).resolves.toBeUndefined();
    const bytes = await readFile(path, 'utf8');
    expect(bytes).not.toContain('secret-value');
    expect(new Set(refs).size).toBe(8);
    expect(await readdir(directory)).toEqual(['credentials.enc']);
  });
  it.each<VaultStage>(['encrypted', 'written', 'flushed', 'renamed', 'verified'])(
    'preserves the previous durable reference when failure occurs after %s',
    async (stage) => {
      const first = createCredentialVault({ path, encryption: encryption() });
      const oldRef = await first.preparePersistent('old-key');
      const failing = createCredentialVault({
        path,
        encryption: encryption(),
        onStage(current) {
          if (current === stage) throw new Error('do-not-leak-secret');
        },
      });
      await expect(failing.preparePersistent('new-key')).rejects.toThrow(
        'Credential storage is unavailable',
      );
      await expect(
        createCredentialVault({ path, encryption: encryption() }).verify(oldRef),
      ).resolves.toBeUndefined();
      const text = await readFile(path, 'utf8');
      expect(text).not.toContain('old-key');
      expect(text).not.toContain('new-key');
      expect(await readdir(directory)).toEqual(['credentials.enc']);
    },
  );
  it('refuses insecure/unavailable persistence, missing refs and failed decrypt readback', async () => {
    const unavailable = createCredentialVault({
      path,
      encryption: { ...encryption(), available: async () => false },
    });
    await expect(unavailable.preparePersistent('plaintext')).rejects.toThrow(
      'Credential storage is unavailable',
    );
    expect(await readdir(directory)).toEqual([]);
    const vault = createCredentialVault({ path, encryption: encryption() });
    await expect(vault.verify(secretRefSchema.parse(randomUUID()))).rejects.toThrow(
      'Credential storage is unavailable',
    );
    let decrypts = 0;
    const adapter = encryption();
    const failing = createCredentialVault({
      path,
      encryption: {
        ...adapter,
        async decrypt(value) {
          decrypts += 1;
          if (decrypts === 2) throw new Error('readback secret error');
          return adapter.decrypt(value);
        },
      },
    });
    await expect(failing.preparePersistent('readback-key')).rejects.toThrow(
      'Credential storage is unavailable',
    );
    expect(decrypts).toBe(2);
  });
});
describe('Chrome settings coordination', () => {
  const values: SettingsValues = {
    browser: { mode: 'launch', executablePath: '', headless: false },
    viewportWidth: 1280,
    viewportHeight: 900,
    pageCount: 1,
  };
  it('serializes saves and allows only one commit for an expected revision', async () => {
    const requests: BusinessRequest[] = [];
    let state: SettingsView = { ...values, revision: 0 };
    let active = 0;
    let maxActive = 0;
    const coordinator = createBusinessCoordinator({
      available: () => true,
      async request(request) {
        requests.push(request);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        if (request.method !== 'settings.commit')
          return failure('INVALID_INPUT', 'Unexpected request');
        if (state.revision !== request.input.expectedRevision)
          return failure('CONFLICT', 'Settings changed');
        state = { ...request.input.values, revision: state.revision + 1 };
        return { ok: true, value: state };
      },
    });
    const results = await Promise.all(
      [1440, 1920].map((viewportWidth) =>
        coordinator.invoke('settings.save', {
          values: { ...values, viewportWidth },
          expectedRevision: 0,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'CONFLICT' }) }),
    );
    expect(state.revision).toBe(1);
    expect(maxActive).toBe(1);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toMatch(/credential|secret/);
    expect(await readdir(directory)).toEqual([]);
  });
  it('does not contact the worker if it exits while a save is queued', async () => {
    let available = true;
    const requests: BusinessRequest[] = [];
    const coordinator = createBusinessCoordinator({
      available: () => available,
      async request(request) {
        requests.push(request);
        available = false;
        return failure('UNAVAILABLE', 'Worker exited');
      },
    });
    const results = await Promise.all(
      [0, 1].map((expectedRevision) =>
        coordinator.invoke('settings.save', { values, expectedRevision }),
      ),
    );
    expect(results).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'UNAVAILABLE' }),
      }),
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'UNAVAILABLE' }),
      }),
    ]);
    expect(requests).toHaveLength(1);
  });
  it('preserves dormant vault data on failed settings saves and rejects the removed secret API', async () => {
    const vault = createCredentialVault({ path, encryption: encryption() });
    const oldRef = await vault.preparePersistent('previous');
    const bytes = await readFile(path);
    const coordinator = createBusinessCoordinator({
      available: () => true,
      async request() {
        return failure('INTERNAL', 'Commit failed');
      },
    });
    expect(
      await coordinator.invoke('settings.save', { values, expectedRevision: 0 }),
    ).toMatchObject({ ok: false });
    expect(
      await coordinator.invoke('settings.save', {
        values,
        expectedRevision: 0,
        secret: { action: 'clear' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await readFile(path)).toEqual(bytes);
    await vault.verify(oldRef);
  });
  it.each(['http://127.0.0.1:9222', 'http://localhost:80', 'http://[::1]:9333'])(
    'accepts a local Chrome endpoint %s',
    (endpoint) => {
      expect(
        settingsValuesSchema.safeParse({ ...values, browser: { mode: 'connect', endpoint } })
          .success,
      ).toBe(true);
    },
  );
  it.each([
    'https://127.0.0.1:9222',
    'http://example.com:9222',
    'http://127.0.0.2:9222',
    'http://localhost',
    'http://localhost:0',
    'http://localhost:65536',
    'http://user:pass@localhost:9222',
    'http://localhost:9222/json',
    'http://localhost:9222/',
    'http://localhost:9222?query',
    'http://localhost:9222#hash',
  ])('rejects an unsafe or ambiguous Chrome endpoint %s', (endpoint) => {
    expect(
      settingsValuesSchema.safeParse({ ...values, browser: { mode: 'connect', endpoint } }).success,
    ).toBe(false);
  });
  it('rejects mixed browser variants and legacy AdsPower fields', () => {
    expect(
      settingsValuesSchema.safeParse({
        ...values,
        browser: { ...values.browser, endpoint: 'http://localhost:9222' },
      }).success,
    ).toBe(false);
    expect(
      settingsValuesSchema.safeParse({ ...values, adsPowerUrl: 'http://localhost:50325' }).success,
    ).toBe(false);
  });
});
