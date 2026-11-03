import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { to } from '@browser-2d/amount';
import { fieldTextSchema, taskIdSchema } from '@browser-2d/contracts/public';
import {
  browserSnapshotSchema,
  executionRefSchema,
  environmentStateSchema,
  cleanupProofSchema,
  type RecoveryTask,
  type BoundExecution,
  type CleanupProof,
  type EnvironmentState,
  type SessionFingerprint,
} from '@browser-2d/contracts/host';
import { browserById, canonical, reject, type RepositoryContext } from './shared';
import {
  taskById,
  requireExecution,
  taskColumns,
  readTask,
  publicTask,
  obligation,
} from './task-record';
import { createCardProcessing } from './card-processing';
export function createTasks(context: RepositoryContext, maxConcurrent: () => number) {
  const { db, now } = context;
  const get = (id: string) => taskById(context, id);
  const bound = (input: BoundExecution) => requireExecution(context, input);
  const processing = createCardProcessing(context);
  function environment(task: RecoveryTask, state: EnvironmentState) {
    db.prepare('UPDATE work_task SET environment_state = ?, updated_at = ? WHERE id = ?').run(
      canonical(state),
      now(),
      task.id,
    );
  }
  return {
    get,
    list: () =>
      db
        .prepare(`SELECT ${taskColumns} FROM work_task ORDER BY queue_order ASC`)
        .all()
        .map(readTask),
    accept(input: { browserId: number }) {
      const browser = browserById(context, input.browserId);
      const existing = db
        .prepare(`SELECT ${taskColumns} FROM work_task WHERE browser_id = ?`)
        .get(browser.id);
      if (existing) return publicTask(readTask(existing));
      const last = z
        .number()
        .int()
        .nonnegative()
        .safe()
        .parse(db.prepare('SELECT coalesce(max(queue_order), 0) FROM work_task').pluck().get());
      if (last === Number.MAX_SAFE_INTEGER) reject('CONFLICT', 'Task queue limit reached');
      const id = taskIdSchema.parse(randomUUID());
      const stamp = now();
      const snapshot = browserSnapshotSchema.parse({ ...browser, amount: to(browser.amount) });
      db.prepare(
        "INSERT INTO work_task (id, browser_id, browser_snapshot, queue_order, state, environment_state, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)",
      ).run(
        id,
        browser.id,
        canonical(snapshot),
        last + 1,
        canonical({ kind: 'untouched', provider: browser.provider, profileId: browser.profileId }),
        stamp,
        stamp,
      );
      db.prepare(
        "UPDATE browser SET status = 'queued', last_error = '', updated_at = ? WHERE id = ?",
      ).run(stamp, browser.id);
      return publicTask(get(id));
    },
    prepareNext(input: { ownerNonce: string }) {
      z.uuid().parse(input.ownerNonce);
      const reserved = z
        .number()
        .int()
        .nonnegative()
        .safe()
        .parse(db.prepare("SELECT count(*) FROM work_task WHERE state != 'queued'").pluck().get());
      if (reserved >= maxConcurrent()) return null;
      const raw = db
        .prepare(
          `SELECT ${taskColumns} FROM work_task WHERE state = 'queued' ORDER BY queue_order ASC LIMIT 1`,
        )
        .get();
      if (!raw) return null;
      const task = readTask(raw);
      const ref = executionRefSchema.parse({
        kind: 'prepared',
        nonce: randomUUID(),
        generation: 1,
        ownerNonce: input.ownerNonce,
      });
      const stamp = now();
      db.prepare(
        "UPDATE work_task SET state = 'starting', execution_ref = ?, updated_at = ? WHERE id = ?",
      ).run(canonical(ref), stamp, task.id);
      db.prepare("UPDATE browser SET status = 'starting', updated_at = ? WHERE id = ?").run(
        stamp,
        task.browserId,
      );
      return get(task.id);
    },
    authorize(input: { execution: BoundExecution; pid: number }) {
      const task = bound(input.execution);
      const ref = task.execution;
      if (!ref) reject('CONFLICT', 'Execution is not prepared');
      if (ref.kind !== 'prepared') {
        if (ref.kind === 'authorized' && ref.pid === input.pid) return null;
        reject('CONFLICT', 'Execution authorization cannot be replaced');
      }
      db.prepare('UPDATE work_task SET execution_ref = ?, updated_at = ? WHERE id = ?').run(
        canonical(executionRefSchema.parse({ ...ref, kind: 'authorized', pid: input.pid })),
        now(),
        task.id,
      );
      return null;
    },
    startIntent(input: { execution: BoundExecution; requestId: string }) {
      const task = bound(input.execution);
      if (
        task.state !== 'starting' ||
        task.stopRequestedAt ||
        task.execution?.kind !== 'authorized'
      )
        reject('CONFLICT', 'Execution cannot start an environment');
      if (
        task.environment.kind === 'start_intent' &&
        task.environment.requestId === input.requestId
      )
        return null;
      if (task.environment.kind !== 'untouched')
        reject('CONFLICT', 'Environment start is already reserved');
      environment(
        task,
        environmentStateSchema.parse({
          kind: 'start_intent',
          provider: task.browser.provider,
          profileId: task.browser.profileId,
          requestId: input.requestId,
        }),
      );
      return null;
    },
    owned(input: { execution: BoundExecution; requestId: string; session: SessionFingerprint }) {
      const task = bound(input.execution);
      if (
        task.environment.kind === 'owned' &&
        task.environment.requestId === input.requestId &&
        canonical(task.environment.session) === canonical(input.session)
      )
        return null;
      const owed = obligation(task.environment);
      if (owed?.kind !== 'start' || owed.requestId !== input.requestId)
        reject('CONFLICT', 'Environment start identity does not match');
      environment(task, {
        kind: 'owned',
        provider: task.browser.provider,
        profileId: task.browser.profileId,
        requestId: input.requestId,
        session: input.session,
        close: 'needed',
      });
      return null;
    },
    running(input: BoundExecution) {
      const task = bound(input);
      if (task.state === 'running' && !task.stopRequestedAt) return null;
      if (
        task.state !== 'starting' ||
        task.stopRequestedAt ||
        task.execution?.kind !== 'authorized' ||
        task.environment.kind !== 'owned'
      )
        reject('CONFLICT', 'Execution cannot begin processing');
      const stamp = now();
      db.prepare("UPDATE work_task SET state = 'running', updated_at = ? WHERE id = ?").run(
        stamp,
        task.id,
      );
      db.prepare("UPDATE browser SET status = 'working', updated_at = ? WHERE id = ?").run(
        stamp,
        task.browserId,
      );
      return null;
    },
    fence(input: { taskId: string; reason: string }) {
      const reason = fieldTextSchema.parse(input.reason);
      const task = get(input.taskId);
      const stamp = now();
      db.prepare(
        "UPDATE work_task SET state = CASE WHEN state = 'recovery_required' THEN state ELSE 'stopping' END, stop_requested_at = coalesce(stop_requested_at, ?), updated_at = ? WHERE id = ?",
      ).run(stamp, stamp, task.id);
      db.prepare(
        "UPDATE browser SET status = CASE WHEN status = 'recovery_required' THEN status ELSE 'stopping' END, last_error = ?, updated_at = ? WHERE id = ?",
      ).run(reason, stamp, task.browserId);
      return null;
    },
    recovery(input: { execution: BoundExecution; message: string }) {
      const message = fieldTextSchema.parse(input.message);
      const task = bound(input.execution);
      const owed = obligation(task.environment);
      if (owed)
        environment(task, {
          kind: 'recovery_required',
          provider: task.browser.provider,
          profileId: task.browser.profileId,
          obligation: owed,
          message,
        });
      const stamp = now();
      db.prepare(
        "UPDATE work_task SET state = 'recovery_required', stop_requested_at = coalesce(stop_requested_at, ?), updated_at = ? WHERE id = ?",
      ).run(stamp, stamp, task.id);
      db.prepare(
        "UPDATE browser SET status = 'recovery_required', last_error = ?, updated_at = ? WHERE id = ?",
      ).run(message, stamp, task.browserId);
      return null;
    },
    cancelQueued(input: { taskId: string }) {
      const task = get(input.taskId);
      if (
        task.execution !== null ||
        task.environment.kind !== 'untouched' ||
        !['queued', 'stopping'].includes(task.state)
      )
        reject('CONFLICT', 'Task has execution cleanup obligations', 'RECOVERY_REQUIRED');
      db.prepare('DELETE FROM work_task WHERE id = ?').run(task.id);
      db.prepare(
        "UPDATE browser SET status = 'idle', last_error = '', updated_at = ? WHERE id = ?",
      ).run(now(), task.browserId);
      return null;
    },
    finish(raw: CleanupProof) {
      const input = cleanupProofSchema.parse(raw);
      if (!db.prepare('SELECT 1 FROM work_task WHERE id = ?').get(input.execution.taskId))
        return { kind: 'already_released' } as const;
      const task = bound(input.execution);
      if (!['stopping', 'recovery_required'].includes(task.state))
        reject('CONFLICT', 'Fence the task before releasing its resources');
      if (canonical(input.exit.execution) !== canonical(input.execution))
        reject('CONFLICT', 'Exit proof belongs to another execution');
      const ref = task.execution;
      if (!ref) reject('CONFLICT', 'Execution identity is missing', 'RECOVERY_REQUIRED');
      if (input.exit.kind === 'never_forked') {
        if (ref.kind !== 'prepared' || ref.ownerNonce !== input.exit.ownerNonce)
          reject(
            'CONFLICT',
            'Exit proof does not establish execution absence',
            'RECOVERY_REQUIRED',
          );
      } else if (ref.kind === 'prepared' || ref.pid !== input.exit.pid)
        reject('CONFLICT', 'Exit proof does not match the authorized process', 'RECOVERY_REQUIRED');
      const env = input.environment;
      const owed = obligation(task.environment);
      if (task.environment.kind === 'untouched') {
        if (env.kind !== 'never_started') reject('CONFLICT', 'Environment proof does not match');
      } else if (owed?.kind === 'start') {
        if (env.kind !== 'settled_without_open' || env.requestId !== owed.requestId)
          reject('CONFLICT', 'Environment start is unresolved', 'RECOVERY_REQUIRED');
      } else if (owed?.kind === 'owned_close') {
        if (
          env.kind !== 'owned_session_closed' ||
          env.requestId !== owed.requestId ||
          canonical(env.session) !== canonical(owed.session)
        )
          reject('CONFLICT', 'Owned environment closure is unresolved', 'RECOVERY_REQUIRED');
      } else if (task.environment.kind === 'closed') {
        if (
          env.kind !== 'owned_session_closed' ||
          env.requestId !== task.environment.requestId ||
          canonical(env.session) !== canonical(task.environment.session)
        )
          reject('CONFLICT', 'Environment proof does not match');
      } else reject('CONFLICT', 'Environment cleanup is unresolved', 'RECOVERY_REQUIRED');
      const stamp = now();
      db.prepare(
        "UPDATE card SET status = 'pending', updated_at = ? WHERE id IN (SELECT card_id FROM card_claim WHERE task_id = ?) AND status = 'processing'",
      ).run(stamp, task.id);
      db.prepare('DELETE FROM card_claim WHERE task_id = ?').run(task.id);
      db.prepare('DELETE FROM work_task WHERE id = ?').run(task.id);
      db.prepare('UPDATE browser SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
        input.outcome.kind === 'failed' ? 'failed' : 'idle',
        input.outcome.kind === 'failed' ? input.outcome.message : '',
        stamp,
        task.browserId,
      );
      return { kind: 'released' } as const;
    },
    processing,
  };
}
