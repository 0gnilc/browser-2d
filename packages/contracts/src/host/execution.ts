import { z } from 'zod';
import { browserSchema } from '../public/browsers';
import { isAmountUnits, type AmountUnits } from '@browser-2d/amount';
export { taskIdSchema } from '../public/work-tasks';
export type { TaskId } from '../public/work-tasks';
export const executionNonceSchema = z.uuid().brand<'ExecutionNonce'>();
export type ExecutionNonce = z.infer<typeof executionNonceSchema>;
export const browserSnapshotSchema = browserSchema
  .extend({
    amount: z.custom<AmountUnits>((value) => typeof value === 'number' && isAmountUnits(value)),
  })
  .readonly();
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;
