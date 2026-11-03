import { z } from 'zod';
import {
  applicationSettingsSchema,
  applicationSettingsRegistry,
  bindingSchema,
  settingsCommitInputSchema,
  type PrivateSettingsView,
  type SettingsCommitInput,
} from '@browser-2d/contracts/host';
import { type RepositoryContext, canonical, reject } from './shared';
const settingRowsSchema = z.array(
  z.strictObject({
    key: z.string(),
    value_json: z.string(),
    revision: z.number().int().nonnegative().safe(),
  }),
);
export function settingsProjection(settings: PrivateSettingsView) {
  return {
    values: {
      apiBaseUrl: settings.values['browser.apiBaseUrl'],
      apiKeyConfigured: settings.values['browser.apiKeyRef'] !== '',
      maxConcurrentTasks: settings.values['work.maxConcurrentTasks'],
      sidebarCollapsed: settings.values['ui.sidebarCollapsed'],
    },
    revision: settings.revision,
  };
}
export function createSettings(context: RepositoryContext) {
  const { db, now } = context;
  function read(): PrivateSettingsView {
    const rows = settingRowsSchema.parse(
      db.prepare('SELECT key, value_json, revision FROM settings ORDER BY key').all(),
    );
    const revision = rows[0]?.revision;
    if (
      rows.length !== Object.keys(applicationSettingsRegistry).length ||
      revision === undefined ||
      rows.some((row) => row.revision !== revision)
    )
      reject('INTERNAL', 'Settings are unavailable');
    return {
      values: applicationSettingsSchema.parse(
        Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)])),
      ),
      revision,
    };
  }
  function bindings() {
    return z
      .array(bindingSchema)
      .parse(
        db
          .prepare('SELECT id, provider, profile_id AS profileId FROM browser ORDER BY id ASC')
          .all(),
      );
  }
  return {
    read,
    bindings,
    commit(raw: SettingsCommitInput) {
      const input = settingsCommitInputSchema.parse(raw);
      const current = read();
      if (current.revision !== input.expectedRevision)
        reject('CONFLICT', 'Settings changed. Reload them before saving');
      const next = input.values;
      if (
        (input.connectionAction === 'keep' &&
          next['browser.apiKeyRef'] !== current.values['browser.apiKeyRef']) ||
        (input.connectionAction === 'clear' && next['browser.apiKeyRef'] !== '') ||
        (input.connectionAction === 'replace' && !next['browser.apiKeyRef'])
      )
        reject('INVALID_INPUT', 'Invalid credential action');
      const connectionChanged =
        next['browser.apiBaseUrl'] !== current.values['browser.apiBaseUrl'] ||
        input.connectionAction !== 'keep';
      if (connectionChanged) {
        if (db.prepare('SELECT 1 FROM work_task LIMIT 1').get())
          reject(
            'CONFLICT',
            'Stop and finish all active tasks before changing the connection',
            'ACTIVE_TASK',
          );
        const actualBindings = bindings();
        if (
          actualBindings.length > 0 &&
          (!input.expectedBindings ||
            canonical(input.expectedBindings) !== canonical(actualBindings))
        )
          reject(
            'CONFLICT',
            'Browser bindings changed. Confirm the connection change again',
            'BINDINGS_CHANGED',
          );
        if (
          input.expectedBindings &&
          canonical(input.expectedBindings) !== canonical(actualBindings)
        )
          reject(
            'CONFLICT',
            'Browser bindings changed. Confirm the connection change again',
            'BINDINGS_CHANGED',
          );
      }
      if (current.revision === Number.MAX_SAFE_INTEGER)
        reject('CONFLICT', 'Settings revision limit reached');
      const update = db.prepare(
        'UPDATE settings SET value_json = ?, revision = ?, updated_at = ? WHERE key = ?',
      );
      const stamp = now();
      for (const [key, value] of Object.entries(next))
        update.run(JSON.stringify(value), current.revision + 1, stamp, key);
      return settingsProjection({ values: next, revision: current.revision + 1 });
    },
  };
}
