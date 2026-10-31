import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { credentialVaultSchema, secretRefSchema, type SecretRef } from '@browser-2d/contracts/host';

export interface EncryptionAdapter {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}
export class CredentialError extends Error {
  constructor() {
    super('Credential storage is unavailable');
  }
}
export type VaultStage = 'encrypted' | 'written' | 'flushed' | 'renamed' | 'verified';
export function createCredentialVault(options: {
  path: string;
  encryption: EncryptionAdapter;
  onStage?: (stage: VaultStage) => void;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  const sessions = new Map<SecretRef, string>();
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action).catch(() => {
      throw new CredentialError();
    });
    tail = result.catch(() => undefined);
    return result;
  }
  async function load() {
    let text: string;
    try {
      text = await readFile(options.path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return credentialVaultSchema.parse({ version: 1, records: {} });
      throw error;
    }
    return credentialVaultSchema.parse(JSON.parse(text));
  }
  async function read(ref: SecretRef) {
    if (!(await options.encryption.available())) throw new CredentialError();
    const vault = await load();
    const encrypted = vault.records[ref];
    if (!encrypted) throw new CredentialError();
    const result = await options.encryption.decrypt(Buffer.from(encrypted, 'base64'));
    if (!result) throw new CredentialError();
    return result;
  }
  return {
    preparePersistent(value: string): Promise<SecretRef> {
      return serialized(async () => {
        if (!(await options.encryption.available())) throw new CredentialError();
        const encrypted = await options.encryption.encrypt(value);
        if ((await options.encryption.decrypt(encrypted)) !== value) throw new CredentialError();
        options.onStage?.('encrypted');
        const vault = await load();
        const ref = secretRefSchema.parse(randomUUID());
        vault.records[ref] = encrypted.toString('base64');
        const parent = dirname(options.path);
        await mkdir(parent, { recursive: true, mode: 0o700 });
        const temporary = `${options.path}.${randomUUID()}.tmp`;
        try {
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(JSON.stringify(vault));
            options.onStage?.('written');
            await file.sync();
            options.onStage?.('flushed');
          } finally {
            await file.close();
          }
          await rename(temporary, options.path);
          options.onStage?.('renamed');
          if (process.platform !== 'win32') {
            const directory = await open(parent, 'r');
            try {
              await directory.sync();
            } finally {
              await directory.close();
            }
          }
          if ((await read(ref)) !== value) throw new CredentialError();
          options.onStage?.('verified');
          return ref;
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      });
    },
    verify(ref: SecretRef): Promise<void> {
      return serialized(async () => {
        await read(ref);
      });
    },
    prepareSession(value: string): SecretRef {
      const ref = secretRefSchema.parse(randomUUID());
      sessions.set(ref, value);
      return ref;
    },
  };
}
export type CredentialVault = ReturnType<typeof createCredentialVault>;
