import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindingSchema,
  secretRefSchema,
  applicationSettingsDefaults,
  dataOperations,
  type DataMethod,
  type DataInput,
  type DataResult,
  type PrivateSettingsView,
  type Binding,
} from '@browser-2d/contracts/host';
import { failure } from '@browser-2d/contracts/public';
import {
  createCredentialVault,
  type EncryptionAdapter,
  type VaultStage,
} from '../src/platform/credentials';
import { createSettingsCoordinator } from '../src/main/settings-coordinator';
import type { DataClient } from '../src/main/data-service-client';

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

describe('Main settings and credentials', () => {
  function client() {
    let settings: PrivateSettingsView = { values: { ...applicationSettingsDefaults }, revision: 0 };
    let bindings: Binding[] = [];
    const sent: { method: DataMethod; input: unknown }[] = [];
    let loseCommit = false;
    const data: DataClient = {
      available: true,
      async request<M extends DataMethod>(method: M, input: DataInput<M>): Promise<DataResult<M>> {
        sent.push({ method, input });
        let result: unknown;
        if (method === 'settings.read') result = { ok: true, value: settings };
        else if (method === 'settings.bindings') result = { ok: true, value: bindings };
        else if (method === 'tasks.list') result = { ok: true, value: [] };
        else if (method === 'settings.commit') {
          const commit = dataOperations['settings.commit'].input.parse(input);
          if (commit.expectedRevision !== settings.revision)
            result = failure('CONFLICT', 'Revision changed');
          else {
            settings = { values: commit.values, revision: settings.revision + 1 };
            if (loseCommit) throw new Error('Reply lost after commit');
            result = {
              ok: true,
              value: {
                revision: settings.revision,
                values: {
                  apiBaseUrl: commit.values['browser.apiBaseUrl'],
                  apiKeyConfigured: !!commit.values['browser.apiKeyRef'],
                  maxConcurrentTasks: commit.values['work.maxConcurrentTasks'],
                  sidebarCollapsed: commit.values['ui.sidebarCollapsed'],
                },
              },
            };
          }
        } else throw new Error('Unexpected test request');
        return dataOperations[method].result.parse(result) as DataResult<M>;
      },
    };
    return {
      data,
      sent,
      get settings() {
        return settings;
      },
      set bindings(next: Binding[]) {
        bindings = next;
      },
      set loseCommit(next: boolean) {
        loseCommit = next;
      },
    };
  }
  const values = {
    apiBaseUrl: 'http://127.0.0.1:50325',
    maxConcurrentTasks: 2,
    sidebarCollapsed: false,
  };
  it('stages encrypted immutable credentials before CAS and resolves only in Main', async () => {
    const fixture = client();
    const vault = createCredentialVault({ path, encryption: encryption() });
    const settings = createSettingsCoordinator(fixture.data, vault);
    const saved = await settings.save({
      values,
      expectedRevision: 0,
      apiKey: { kind: 'replace', value: 'main-only-key' },
    });
    expect(saved).toMatchObject({
      ok: true,
      value: { kind: 'saved', settings: { values: { apiKeyConfigured: true } } },
    });
    expect(JSON.stringify(fixture.sent)).not.toContain('main-only-key');
    expect(await readFile(path, 'utf8')).not.toContain('main-only-key');
    expect(await settings.connection()).toEqual({
      apiBaseUrl: values.apiBaseUrl,
      apiKey: 'main-only-key',
    });
    const ref = secretRefSchema.parse(fixture.settings.values['browser.apiKeyRef']);
    await expect(vault.resolve(ref)).resolves.toBe('main-only-key');
    const competing = await Promise.all(
      [true, false].map((sidebarCollapsed) =>
        settings.save({
          values: { ...values, sidebarCollapsed },
          expectedRevision: 1,
          apiKey: { kind: 'keep' },
        }),
      ),
    );
    expect(competing.filter((result) => result.ok)).toHaveLength(1);
  });
  it('binds confirmation to candidate action, revision and exact Browser bindings', async () => {
    const fixture = client();
    fixture.bindings = [bindingSchema.parse({ id: 1, provider: 'adspower', profileId: 'A' })];
    const settings = createSettingsCoordinator(
      fixture.data,
      createCredentialVault({ path, encryption: encryption() }),
    );
    const input = {
      values,
      expectedRevision: 0,
      apiKey: { kind: 'replace', value: 'candidate-key' },
    } as const;
    const prompt = await settings.save(input);
    if (!prompt.ok || prompt.value.kind !== 'binding_confirmation_required')
      throw new Error('Expected binding confirmation');
    expect(await readdir(directory)).toEqual([]);
    expect(
      await settings.save({
        ...input,
        apiKey: { kind: 'clear' },
        bindingConfirmationToken: prompt.value.token,
      }),
    ).toMatchObject({ ok: false, error: { reason: 'BINDINGS_CHANGED' } });
    fixture.bindings = [];
    expect(
      await settings.save({ ...input, bindingConfirmationToken: prompt.value.token }),
    ).toMatchObject({ ok: false, error: { reason: 'BINDINGS_CHANGED' } });
    expect(fixture.sent.filter((request) => request.method === 'settings.commit')).toHaveLength(0);
    expect(await readdir(directory)).toEqual([]);
  });
  it('retains potentially referenced encrypted records after a lost commit acknowledgment', async () => {
    const fixture = client();
    const vault = createCredentialVault({ path, encryption: encryption() });
    const old = await vault.preparePersistent('old-key');
    const settings = createSettingsCoordinator(fixture.data, vault);
    fixture.loseCommit = true;
    await expect(
      settings.save({ values, expectedRevision: 0, apiKey: { kind: 'replace', value: 'new-key' } }),
    ).rejects.toThrow('Reply lost');
    await expect(vault.resolve(old)).resolves.toBe('old-key');
    await expect(
      vault.resolve(secretRefSchema.parse(fixture.settings.values['browser.apiKeyRef'])),
    ).resolves.toBe('new-key');
    expect(JSON.stringify(fixture.sent)).not.toContain('new-key');
  });
});
