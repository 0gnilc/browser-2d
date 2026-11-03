import { z } from 'zod';
import { workTaskSchema, taskIdSchema, type WorkTask } from '@browser-2d/contracts/public';
import {
  recoveryTaskSchema,
  boundExecutionSchema,
  type RecoveryTask,
  type BoundExecution,
  type EnvironmentState,
} from '@browser-2d/contracts/host';
import { reject, type RepositoryContext } from './shared';
const taskRowSchema = z.strictObject({
  id: taskIdSchema,
  browserId: z.number(),
  state: z.string(),
  stopRequestedAt: z.string().nullable(),
  createdAt: z.string(),
  queueOrder: z.number(),
  browser: z.string(),
  execution: z.string().nullable(),
  environment: z.string(),
});
export const taskColumns =
  'id, browser_id AS browserId, state, stop_requested_at AS stopRequestedAt, created_at AS createdAt, queue_order AS queueOrder, browser_snapshot AS browser, execution_ref AS execution, environment_state AS environment';
export function readTask(raw: unknown): RecoveryTask {
  const row = taskRowSchema.parse(raw);
  return recoveryTaskSchema.parse({
    ...row,
    browser: JSON.parse(row.browser),
    execution: row.execution === null ? null : JSON.parse(row.execution),
    environment: JSON.parse(row.environment),
  });
}
export function publicTask(task: RecoveryTask): WorkTask {
  return workTaskSchema.parse({
    id: task.id,
    browserId: task.browserId,
    state: task.state,
    stopRequestedAt: task.stopRequestedAt,
    createdAt: task.createdAt,
  });
}
export function obligation(environment: EnvironmentState) {
  if (environment.kind === 'recovery_required') return environment.obligation;
  if (environment.kind === 'start_intent')
    return { kind: 'start', requestId: environment.requestId } as const;
  if (environment.kind === 'owned')
    return {
      kind: 'owned_close',
      requestId: environment.requestId,
      session: environment.session,
    } as const;
  return null;
}

export function taskById(context: RepositoryContext, id: string) {
  const raw = context.db.prepare(`SELECT ${taskColumns} FROM work_task WHERE id = ?`).get(id);
  if (!raw) reject('NOT_FOUND', 'Task was not found');
  return readTask(raw);
}
export function requireExecution(
  context: RepositoryContext,
  input: BoundExecution,
  running = false,
) {
  const identity = boundExecutionSchema.parse(input);
  const task = taskById(context, identity.taskId);
  if (task.execution?.nonce !== identity.executionNonce)
    reject('CONFLICT', 'This execution is no longer authorized');
  if (running && (task.state !== 'running' || task.stopRequestedAt !== null))
    reject('CONFLICT', 'This execution is no longer writable');
  return task;
}
