import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  boundExecutionSchema,
  environmentClosureSchema,
  sessionFingerprintSchema,
  type PreparedTask,
  type BoundExecution,
} from '@browser-2d/contracts/host';
const environmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('untouched') }),
  z.strictObject({ kind: z.literal('start_intent'), requestId: z.uuid() }),
  z.strictObject({ kind: z.literal('not_started'), requestId: z.uuid() }),
  z.strictObject({
    kind: z.literal('owned'),
    requestId: z.uuid(),
    session: sessionFingerprintSchema,
  }),
  z.strictObject({ kind: z.literal('closed'), proof: environmentClosureSchema }),
]);
const witnessSchema = z.strictObject({
  format: z.literal(1),
  execution: boundExecutionSchema,
  ownerNonce: z.uuid(),
  generation: z.number().int().positive().safe(),
  hostPid: z.number().int().positive(),
  pid: z.number().int().positive().nullable(),
  exitedAt: z.iso.datetime().nullable(),
  environment: environmentSchema,
});
export type ExecutionWitness = z.infer<typeof witnessSchema>;
export function processAbsent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}
export function createExecutionOwnership(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  function syncDirectory() {
    if (process.platform === 'win32') return;
    const fd = openSync(directory, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  const path = (execution: BoundExecution) => join(directory, `${execution.executionNonce}.json`);
  function read(execution: BoundExecution) {
    const value = witnessSchema.parse(JSON.parse(readFileSync(path(execution), 'utf8')));
    if (
      value.execution.taskId !== execution.taskId ||
      value.execution.executionNonce !== execution.executionNonce
    )
      throw new Error('Execution ownership changed');
    return value;
  }
  function publish(value: ExecutionWitness) {
    const validated = witnessSchema.parse(value);
    const temporary = `${path(value.execution)}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(validated), { flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, path(value.execution));
    syncDirectory();
    return validated;
  }
  function update(
    execution: BoundExecution,
    patch: Partial<Pick<ExecutionWitness, 'pid' | 'exitedAt' | 'environment'>>,
  ) {
    return publish({ ...read(execution), ...patch });
  }
  return {
    prepare(task: PreparedTask) {
      if (task.execution.kind !== 'prepared') throw new Error('Execution was already forked');
      return publish({
        format: 1,
        execution: { taskId: task.id, executionNonce: task.execution.nonce },
        ownerNonce: task.execution.ownerNonce,
        generation: task.execution.generation,
        hostPid: process.pid,
        pid: null,
        exitedAt: null,
        environment: { kind: 'untouched' },
      });
    },
    read,
    update,
    list() {
      return readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const value = witnessSchema.parse(
            JSON.parse(readFileSync(join(directory, name), 'utf8')),
          );
          if (name !== `${value.execution.executionNonce}.json`)
            throw new Error('Execution ownership filename changed');
          return value;
        });
    },
    remove(execution: BoundExecution) {
      read(execution);
      rmSync(path(execution));
      syncDirectory();
    },
  };
}
export type ExecutionOwnership = ReturnType<typeof createExecutionOwnership>;
