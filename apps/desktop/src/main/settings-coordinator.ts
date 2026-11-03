import { createHash, randomUUID } from 'node:crypto';
import {
  failure,
  type Result,
  type SettingsSave,
  type SettingsSaveOutcome,
  type SettingsView,
} from '@browser-2d/contracts/public';
import {
  secretRefSchema,
  type Binding,
  type PrivateSettingsView,
} from '@browser-2d/contracts/host';
import type { DataClient } from './data-service-client';
import type { CredentialVault } from '../platform/credentials';
export function settingsView(settings: PrivateSettingsView): SettingsView {
  return {
    revision: settings.revision,
    values: {
      apiBaseUrl: settings.values['browser.apiBaseUrl'],
      apiKeyConfigured: settings.values['browser.apiKeyRef'] !== '',
      maxConcurrentTasks: settings.values['work.maxConcurrentTasks'],
      sidebarCollapsed: settings.values['ui.sidebarCollapsed'],
    },
  };
}
export function createSettingsCoordinator(data: DataClient, vault: CredentialVault) {
  const confirmations = new Map<
    string,
    { identity: string; bindings: Binding[]; expires: number }
  >();
  let tail: Promise<unknown> = Promise.resolve();
  async function save(input: SettingsSave): Promise<Result<SettingsSaveOutcome>> {
    const read = await data.request('settings.read', undefined);
    if (!read.ok) return read;
    if (read.value.revision !== input.expectedRevision)
      return failure('CONFLICT', 'Settings changed. Reload them before saving');
    const connectionChanged =
      input.values.apiBaseUrl !== read.value.values['browser.apiBaseUrl'] ||
      input.apiKey.kind !== 'keep';
    let expectedBindings: Binding[] | undefined;
    if (connectionChanged) {
      const tasks = await data.request('tasks.list', undefined);
      if (!tasks.ok) return tasks;
      if (tasks.value.length)
        return failure(
          'CONFLICT',
          'Finish all active tasks before changing the connection',
          'ACTIVE_TASK',
        );
      const bindings = await data.request('settings.bindings', undefined);
      if (!bindings.ok) return bindings;
      for (const [token, confirmation] of confirmations)
        if (confirmation.expires < Date.now()) confirmations.delete(token);
      const identity = createHash('sha256')
        .update(
          JSON.stringify({
            values: input.values,
            apiKey: input.apiKey,
            expectedRevision: input.expectedRevision,
          }),
        )
        .digest('hex');
      if (input.bindingConfirmationToken) {
        const confirmation = confirmations.get(input.bindingConfirmationToken);
        if (
          !confirmation ||
          confirmation.identity !== identity ||
          JSON.stringify(confirmation.bindings) !== JSON.stringify(bindings.value)
        )
          return failure(
            'CONFLICT',
            'Browser bindings changed. Confirm the connection again',
            'BINDINGS_CHANGED',
          );
        expectedBindings = confirmation.bindings;
      } else if (bindings.value.length) {
        const token = randomUUID();
        confirmations.set(token, {
          identity,
          bindings: bindings.value,
          expires: Date.now() + 5 * 60_000,
        });
        return {
          ok: true,
          value: {
            kind: 'binding_confirmation_required',
            token,
            browserCount: bindings.value.length,
          },
        };
      } else expectedBindings = [];
    }
    let ref = read.value.values['browser.apiKeyRef'];
    if (input.apiKey.kind === 'clear') ref = '';
    else if (input.apiKey.kind === 'replace')
      ref = await vault.preparePersistent(input.apiKey.value);
    const committed = await data.request('settings.commit', {
      values: {
        'browser.apiBaseUrl': input.values.apiBaseUrl,
        'browser.apiKeyRef': ref,
        'work.maxConcurrentTasks': input.values.maxConcurrentTasks,
        'ui.sidebarCollapsed': input.values.sidebarCollapsed,
      },
      expectedRevision: input.expectedRevision,
      connectionAction: input.apiKey.kind,
      ...(expectedBindings ? { expectedBindings } : {}),
    });
    if (!committed.ok) return committed;
    if (input.bindingConfirmationToken) confirmations.delete(input.bindingConfirmationToken);
    return { ok: true, value: { kind: 'saved', settings: committed.value } };
  }
  return {
    async get(): Promise<Result<SettingsView>> {
      const result = await data.request('settings.read', undefined);
      return result.ok ? { ok: true, value: settingsView(result.value) } : result;
    },
    save(input: SettingsSave) {
      const result = tail.then(() => save(input));
      tail = result.catch(() => undefined);
      return result;
    },
    async connection() {
      const result = await data.request('settings.read', undefined);
      if (!result.ok || !result.value.values['browser.apiKeyRef'])
        throw new Error('Configure an API key before starting work');
      return {
        apiBaseUrl: result.value.values['browser.apiBaseUrl'],
        apiKey: await vault.resolve(
          secretRefSchema.parse(result.value.values['browser.apiKeyRef']),
        ),
      };
    },
  };
}
