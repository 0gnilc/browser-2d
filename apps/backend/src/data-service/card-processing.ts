import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { to, MAX_SAFE_UNITS } from '@browser-2d/amount';
import {
  claimTokenSchema,
  processingIdSchema,
  taskIdSchema,
  executionNonceSchema,
  operationResultSchema,
  privateClaimSchema,
  type CardRequest,
  type BoundExecution,
  type RecoveryTask,
  type OperationResult,
} from '@browser-2d/contracts/host';
import { cardById, canonical, reject, type RepositoryContext } from './shared';
import { requireExecution } from './task-record';
const claimRowSchema = z.strictObject({
  cardId: z.number().int().positive().safe(),
  taskId: taskIdSchema,
  claimToken: claimTokenSchema,
  processingId: processingIdSchema,
});
const receiptSchema = z.strictObject({
  input_json: z.string(),
  result_json: z.string(),
  card_id: z.number().int().positive().safe(),
});
const storedReceiptSchema = z.strictObject({
  result: operationResultSchema,
  attribution: z
    .strictObject({
      taskId: taskIdSchema,
      executionNonce: executionNonceSchema,
      claimToken: claimTokenSchema,
    })
    .optional(),
});
export function createCardProcessing(context: RepositoryContext) {
  const { db, now, processors } = context;
  function requireClaim(task: RecoveryTask, request: Exclude<CardRequest, { kind: 'next_card' }>) {
    const raw = db
      .prepare(
        'SELECT c.card_id AS cardId, c.task_id AS taskId, c.claim_token AS claimToken, card.processing_id AS processingId FROM card_claim c JOIN card ON card.id = c.card_id WHERE c.task_id = ? AND c.claim_token = ? AND card.processing_id = ? AND card.status = ?',
      )
      .get(task.id, request.claimToken, request.processingId, 'processing');
    if (!raw) reject('CONFLICT', 'This card claim is no longer authorized');
    return claimRowSchema.parse(raw);
  }
  function receipt(input: {
    task: RecoveryTask;
    execution: BoundExecution;
    request: Exclude<CardRequest, { kind: 'next_card' }>;
    key: string;
    canonicalInput: string;
  }) {
    const raw = db
      .prepare(
        'SELECT card_id, input_json, result_json FROM card_operation WHERE processing_id = ? AND operation_key = ?',
      )
      .get(input.request.processingId, input.key);
    if (!raw) return null;
    const existing = receiptSchema.parse(raw);
    const stored = storedReceiptSchema.parse(JSON.parse(existing.result_json));
    if (input.request.kind === 'apply') requireClaim(input.task, input.request);
    else if (
      !stored.attribution ||
      stored.attribution.taskId !== input.execution.taskId ||
      stored.attribution.executionNonce !== input.execution.executionNonce ||
      stored.attribution.claimToken !== input.request.claimToken
    )
      reject('CONFLICT', 'This completion belongs to another execution');
    if (existing.input_json !== input.canonicalInput)
      reject(
        'CONFLICT',
        'This operation key was already committed with different input',
        'OPERATION_CONFLICT',
      );
    return stored.result;
  }
  function nextCard(execution: BoundExecution) {
    const task = requireExecution(context, execution, true);
    const current = db
      .prepare(
        'SELECT card_id AS cardId, claim_token AS claimToken FROM card_claim WHERE task_id = ?',
      )
      .get(task.id);
    if (current) reject('CONFLICT', 'Complete the current card before claiming another');
    const row = db
      .prepare(
        "SELECT id, processing_id AS processingId FROM card WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1",
      )
      .get();
    if (!row) return { kind: 'empty' } as const;
    const next = z.strictObject({ id: z.number(), processingId: processingIdSchema }).parse(row);
    const claimToken = claimTokenSchema.parse(randomUUID());
    const stamp = now();
    db.prepare(
      'INSERT INTO card_claim (card_id, task_id, claim_token, claimed_at) VALUES (?, ?, ?, ?)',
    ).run(next.id, task.id, claimToken, stamp);
    db.prepare("UPDATE card SET status = 'processing', updated_at = ? WHERE id = ?").run(
      stamp,
      next.id,
    );
    return {
      kind: 'claimed',
      claim: privateClaimSchema.parse({
        card: cardById(context, next.id),
        processingId: next.processingId,
        claimToken,
      }),
    } as const;
  }
  function operate(execution: BoundExecution, input: Exclude<CardRequest, { kind: 'next_card' }>) {
    const task = requireExecution(context, execution, true);
    const processor = input.kind === 'apply' ? input.identity.processor : input.result.processor;
    if (!processors.has(processor)) reject('INVALID_INPUT', 'Processor is not registered');
    if (
      input.kind === 'apply' &&
      [...processors].some((registered) => input.operationKey === `${registered}.complete.v1`)
    )
      reject('INVALID_INPUT', 'Completion keys are reserved for final submission');
    const key = input.kind === 'apply' ? input.operationKey : `${processor}.complete.v1`;
    const canonicalInput = canonical(
      input.kind === 'apply'
        ? { kind: input.kind, identity: input.identity, mutation: input.mutation }
        : { kind: input.kind, identity: { processor, version: 1 }, result: input.result },
    );
    const replay = receipt({ task, execution, request: input, key, canonicalInput });
    if (replay) return replay;
    const claim = requireClaim(task, input);
    const stamp = now();
    let result: OperationResult;
    if (input.kind === 'apply') {
      if (input.mutation.kind === 'add_amount') {
        const delta = input.mutation.delta;
        const added = db
          .prepare(
            'UPDATE card SET amount = amount + @delta, updated_at = @stamp WHERE id = @id AND amount <= @remaining',
          )
          .run({ delta, stamp, id: claim.cardId, remaining: MAX_SAFE_UNITS - delta });
        if (added.changes !== 1) reject('CONFLICT', 'Card amount would exceed the supported limit');
        const amount = to(cardById(context, claim.cardId).amount);
        result = { kind: 'amount_added', amount };
      } else {
        db.prepare('UPDATE card SET extra = ?, updated_at = ? WHERE id = ?').run(
          input.mutation.values.extra,
          stamp,
          claim.cardId,
        );
        result = { kind: 'fields_saved', values: input.mutation.values };
      }
    } else {
      const added = db
        .prepare('UPDATE browser SET count = count + 1, updated_at = ? WHERE id = ? AND count < ?')
        .run(stamp, task.browserId, MAX_SAFE_UNITS);
      if (added.changes !== 1)
        reject('CONFLICT', 'Browser completion count would exceed the supported limit');
      const finalResult = { ...input.result, committedAt: stamp };
      db.prepare('UPDATE card SET status = ?, last_result = ?, updated_at = ? WHERE id = ?').run(
        input.result.outcome === 'success' ? 'processed' : 'failed',
        canonical({ ...finalResult, processingId: input.processingId, operationKey: key }),
        stamp,
        claim.cardId,
      );
      db.prepare(
        'DELETE FROM card_claim WHERE card_id = ? AND task_id = ? AND claim_token = ?',
      ).run(claim.cardId, task.id, input.claimToken);
      result = { kind: 'completed', result: finalResult };
    }
    const stored = {
      result,
      ...(input.kind === 'complete'
        ? { attribution: { ...execution, claimToken: input.claimToken } }
        : {}),
    };
    db.prepare(
      'INSERT INTO card_operation (card_id, processing_id, operation_key, input_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(claim.cardId, input.processingId, key, canonicalInput, canonical(stored), stamp);
    return result;
  }
  return { nextCard, operate };
}
