import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretRefSchema, type BusinessRequest } from '@browser-2d/contracts/host';
import { failure, settingsValuesSchema, type SettingsView } from '@browser-2d/contracts/public';
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
  it('keeps explicit session credentials in memory only', async () => {
    const vault = createCredentialVault({ path, encryption: encryption() });
    const ref = vault.prepareSession('session-only');
    expect(await readdir(directory)).toEqual([]);
    await expect(
      createCredentialVault({ path, encryption: encryption() }).verify(ref),
    ).rejects.toThrow('Credential storage is unavailable');
  });
});
describe('settings credential coordination', () => {
  const values = { adsPowerUrl: '', viewportWidth: 1280, viewportHeight: 900, pageCount: 1 };
  it('serializes whole saves, strips plaintext and allows only one expected revision commit', async () => {
    const requests: BusinessRequest[] = [];
    let state: SettingsView = {
      ...values,
      revision: 0,
      keyConfigured: false,
      credentialMode: 'none',
    };
    const vault = createCredentialVault({ path, encryption: encryption() });
    const coordinator = createBusinessCoordinator({
      vault,
      available: () => true,
      async request(request) {
        requests.push(request);
        if (request.method !== 'settings.commit')
          return failure('INVALID_INPUT', 'Unexpected request');
        if (state.revision !== request.input.expectedRevision)
          return failure('CONFLICT', 'Settings changed');
        state = {
          ...request.input.values,
          revision: state.revision + 1,
          keyConfigured: request.input.credential.action === 'persistent',
          credentialMode: request.input.credential.action === 'persistent' ? 'persistent' : 'none',
        };
        return { ok: true, value: state };
      },
    });
    const results = await Promise.all(
      ['first-key', 'second-key'].map((value) =>
        coordinator.invoke('settings.save', {
          values,
          expectedRevision: 0,
          secret: { action: 'replace', value, persistence: 'persistent' },
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toMatch(/first-key|second-key/);
    for (const request of requests)
      if (request.method === 'settings.commit' && request.input.credential.action === 'persistent')
        await vault.verify(request.input.credential.secretRef);
    expect(state.revision).toBe(1);
  });
  it('does not contact the worker after it exits during encrypted preparation', async () => {
    let available = true;
    const requests: BusinessRequest[] = [];
    const coordinator = createBusinessCoordinator({
      vault: createCredentialVault({
        path,
        encryption: encryption(),
        onStage(stage) {
          if (stage === 'verified') available = false;
        },
      }),
      available: () => available,
      async request(request) {
        requests.push(request);
        return failure('UNAVAILABLE', 'Worker exited');
      },
    });
    expect(
      await coordinator.invoke('settings.save', {
        values,
        expectedRevision: 0,
        secret: { action: 'replace', value: 'will-be-orphan', persistence: 'persistent' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(requests).toEqual([]);
  });
  it('requires explicit session persistence and leaves old ciphertext readable on SQL failure', async () => {
    const vault = createCredentialVault({ path, encryption: encryption() });
    const oldRef = await vault.preparePersistent('previous');
    const coordinator = createBusinessCoordinator({
      vault,
      available: () => true,
      async request() {
        return failure('INTERNAL', 'Commit failed');
      },
    });
    expect(
      await coordinator.invoke('settings.save', {
        values,
        expectedRevision: 0,
        secret: { action: 'replace', value: 'replacement', persistence: 'persistent' },
      }),
    ).toMatchObject({ ok: false });
    await vault.verify(oldRef);
    expect(
      await coordinator.invoke('settings.save', {
        values,
        expectedRevision: 0,
        secret: { action: 'replace', value: 'missing-mode' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(
      settingsValuesSchema.safeParse({
        ...values,
        adsPowerUrl: 'https://user:password@example.com',
      }).success,
    ).toBe(false);
  });
});
