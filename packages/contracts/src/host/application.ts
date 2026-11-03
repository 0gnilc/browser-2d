import { z } from 'zod';
import { isAmountUnits, type AmountUnits } from '@browser-2d/amount';
import {
  browserSchema,
  browserCreateSchema,
  browserUpdateSchema,
  browserIdSchema,
  cardSchema,
  cardUpdateSchema,
  cardIdSchema,
  cardQuerySchema,
  cardPageSchema,
  importTextSchema,
  cardImportReportSchema,
  cardResultSchema,
  fieldTextSchema,
  workTaskSchema,
  taskIdSchema,
  browserIdInputSchema,
  stopViewSchema,
  settingsViewSchema,
  settingsSaveSchema,
  settingsSaveOutcomeSchema,
  resultSchema,
} from '../public/index';
import { browserSnapshotSchema, executionNonceSchema } from './execution';
import { applicationSettingsSchema } from '../settings-registry';
export {
  applicationSettingsRegistry,
  applicationSettingsDefaults,
  applicationSettingsSchema,
} from '../settings-registry';
export type { ApplicationSettings, SettingsKey } from '../settings-registry';
export const processingIdSchema = z.uuid().brand<'ProcessingId'>();
export const claimTokenSchema = z.uuid().brand<'ClaimToken'>();
export const operationKeySchema = z.string().min(1).max(200).brand<'OperationKey'>();
export const amountUnitsSchema = z.custom<AmountUnits>(
  (value) => typeof value === 'number' && isAmountUnits(value),
);
export const processorSchema = z.enum(['baidu-check', 'controlled-test']);
export const processorIdentitySchema = z.strictObject({
  processor: processorSchema,
  version: z.literal(1),
});
export const boundExecutionSchema = z.strictObject({
  taskId: taskIdSchema,
  executionNonce: executionNonceSchema,
});
export const sessionFingerprintSchema = z.strictObject({
  endpoint: z.url(),
  browserTargetId: z.string().min(1).max(500),
});
const executionIdentity = {
  nonce: executionNonceSchema,
  generation: z.number().int().positive().safe(),
  ownerNonce: z.uuid(),
};
export const executionRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prepared'), ...executionIdentity }),
  z.strictObject({
    kind: z.literal('authorized'),
    ...executionIdentity,
    pid: z.number().int().positive().safe(),
  }),
  z.strictObject({
    kind: z.literal('exited'),
    ...executionIdentity,
    pid: z.number().int().positive().safe(),
    observedAt: z.iso.datetime(),
  }),
]);
export const unresolvedEnvironmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), requestId: z.uuid() }),
  z.strictObject({
    kind: z.literal('owned_close'),
    requestId: z.uuid(),
    session: sessionFingerprintSchema,
  }),
]);
const profile = { provider: z.literal('adspower'), profileId: z.string().min(1) };
export const environmentStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('untouched'), ...profile }),
  z.strictObject({ kind: z.literal('start_intent'), ...profile, requestId: z.uuid() }),
  z.strictObject({
    kind: z.literal('owned'),
    ...profile,
    requestId: z.uuid(),
    session: sessionFingerprintSchema,
    close: z.enum(['needed', 'requested']),
  }),
  z.strictObject({
    kind: z.literal('closed'),
    ...profile,
    requestId: z.uuid(),
    session: sessionFingerprintSchema,
    observedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal('recovery_required'),
    ...profile,
    obligation: unresolvedEnvironmentSchema,
    message: z.string(),
  }),
]);
export const recoveryTaskSchema = workTaskSchema.extend({
  browser: browserSnapshotSchema,
  queueOrder: z.number().int().nonnegative().safe(),
  execution: executionRefSchema.nullable(),
  environment: environmentStateSchema,
});
export const preparedTaskSchema = recoveryTaskSchema.extend({ execution: executionRefSchema });
export const privateClaimSchema = z.strictObject({
  card: cardSchema.readonly(),
  processingId: processingIdSchema,
  claimToken: claimTokenSchema,
});
export const nextCardSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('claimed'), claim: privateClaimSchema }),
]);
export const processorEditableFieldsSchema = z.strictObject({ extra: fieldTextSchema });
export const cardMutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add_amount'), delta: amountUnitsSchema }),
  z.strictObject({ kind: z.literal('set_fields'), values: processorEditableFieldsSchema }),
]);
export const completionInputSchema = cardResultSchema.omit({ committedAt: true });
const claimIdentity = { claimToken: claimTokenSchema, processingId: processingIdSchema };
export const cardRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('next_card') }),
  z.strictObject({
    kind: z.literal('apply'),
    ...claimIdentity,
    operationKey: operationKeySchema,
    identity: processorIdentitySchema,
    mutation: cardMutationSchema,
  }),
  z.strictObject({ kind: z.literal('complete'), ...claimIdentity, result: completionInputSchema }),
]);
export const operationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('amount_added'), amount: amountUnitsSchema }),
  z.strictObject({ kind: z.literal('fields_saved'), values: processorEditableFieldsSchema }),
  z.strictObject({ kind: z.literal('completed'), result: cardResultSchema }),
]);
export const cardReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('next_card'), result: resultSchema(nextCardSchema) }),
  z.strictObject({ kind: z.literal('apply'), result: resultSchema(operationResultSchema) }),
  z.strictObject({ kind: z.literal('complete'), result: resultSchema(operationResultSchema) }),
]);
export const exitProofSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('never_forked'),
    execution: boundExecutionSchema,
    ownerNonce: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal('observed_exit'),
    execution: boundExecutionSchema,
    pid: z.number().int().positive().safe(),
    observedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal('observed_absent'),
    execution: boundExecutionSchema,
    pid: z.number().int().positive().safe(),
    observedAt: z.iso.datetime(),
  }),
]);
export const environmentClosureSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('never_started') }),
  z.strictObject({ kind: z.literal('settled_without_open'), requestId: z.uuid() }),
  z.strictObject({
    kind: z.literal('owned_session_closed'),
    requestId: z.uuid(),
    session: sessionFingerprintSchema,
    observedAt: z.iso.datetime(),
  }),
]);
export const cleanupProofSchema = z.strictObject({
  execution: boundExecutionSchema,
  exit: exitProofSchema,
  environment: environmentClosureSchema,
  outcome: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.enum(['stopped', 'exhausted']) }),
    z.strictObject({ kind: z.literal('failed'), message: z.string() }),
  ]),
});
export const bindingSchema = browserSchema.pick({ id: true, provider: true, profileId: true });
export const settingsCommitInputSchema = z.strictObject({
  values: applicationSettingsSchema,
  expectedRevision: z.number().int().nonnegative().safe(),
  connectionAction: z.enum(['keep', 'clear', 'replace']),
  expectedBindings: z.array(bindingSchema).optional(),
});
export const privateSettingsViewSchema = z.strictObject({
  values: applicationSettingsSchema,
  revision: z.number().int().nonnegative().safe(),
});
const removedSchema = z.strictObject({ removed: z.literal(true) });
export const applicationPublicOperations = {
  'browsers.list': { input: z.undefined(), result: resultSchema(z.array(browserSchema)) },
  'browsers.create': { input: browserCreateSchema, result: resultSchema(browserSchema) },
  'browsers.update': { input: browserUpdateSchema, result: resultSchema(browserSchema) },
  'browsers.remove': {
    input: z.strictObject({ id: browserIdSchema }),
    result: resultSchema(removedSchema),
  },
  'cards.list': { input: cardQuerySchema, result: resultSchema(cardPageSchema) },
  'cards.importText': { input: importTextSchema, result: resultSchema(cardImportReportSchema) },
  'cards.update': { input: cardUpdateSchema, result: resultSchema(cardSchema) },
  'cards.remove': {
    input: z.strictObject({ id: cardIdSchema }),
    result: resultSchema(removedSchema),
  },
  'workTasks.list': { input: z.undefined(), result: resultSchema(z.array(workTaskSchema)) },
  'workTasks.start': { input: browserIdInputSchema, result: resultSchema(workTaskSchema) },
  'workTasks.stop': { input: browserIdInputSchema, result: resultSchema(stopViewSchema) },
  'settings.get': { input: z.undefined(), result: resultSchema(settingsViewSchema) },
  'settings.save': { input: settingsSaveSchema, result: resultSchema(settingsSaveOutcomeSchema) },
} as const;
const nullResult = resultSchema(z.null());
export const dataOperations = {
  'browsers.list': applicationPublicOperations['browsers.list'],
  'browsers.create': applicationPublicOperations['browsers.create'],
  'browsers.update': applicationPublicOperations['browsers.update'],
  'browsers.remove': applicationPublicOperations['browsers.remove'],
  'cards.list': applicationPublicOperations['cards.list'],
  'cards.importText': applicationPublicOperations['cards.importText'],
  'cards.update': applicationPublicOperations['cards.update'],
  'cards.remove': applicationPublicOperations['cards.remove'],
  'settings.read': { input: z.undefined(), result: resultSchema(privateSettingsViewSchema) },
  'settings.bindings': { input: z.undefined(), result: resultSchema(z.array(bindingSchema)) },
  'settings.commit': { input: settingsCommitInputSchema, result: resultSchema(settingsViewSchema) },
  'tasks.list': { input: z.undefined(), result: resultSchema(z.array(recoveryTaskSchema)) },
  'tasks.accept': { input: browserIdInputSchema, result: resultSchema(workTaskSchema) },
  'tasks.prepareNext': {
    input: z.strictObject({ ownerNonce: z.uuid() }),
    result: resultSchema(preparedTaskSchema.nullable()),
  },
  'tasks.authorize': {
    input: z.strictObject({
      execution: boundExecutionSchema,
      pid: z.number().int().positive().safe(),
    }),
    result: nullResult,
  },
  'tasks.startIntent': {
    input: z.strictObject({ execution: boundExecutionSchema, requestId: z.uuid() }),
    result: nullResult,
  },
  'tasks.owned': {
    input: z.strictObject({
      execution: boundExecutionSchema,
      requestId: z.uuid(),
      session: sessionFingerprintSchema,
    }),
    result: nullResult,
  },
  'tasks.running': { input: boundExecutionSchema, result: nullResult },
  'tasks.fence': {
    input: z.strictObject({ taskId: taskIdSchema, reason: z.string() }),
    result: nullResult,
  },
  'tasks.recovery': {
    input: z.strictObject({ execution: boundExecutionSchema, message: z.string() }),
    result: nullResult,
  },
  'tasks.cancelQueued': { input: z.strictObject({ taskId: taskIdSchema }), result: nullResult },
  'tasks.finish': {
    input: cleanupProofSchema,
    result: resultSchema(z.strictObject({ kind: z.enum(['released', 'already_released']) })),
  },
  'tasks.request': {
    input: z.strictObject({ execution: boundExecutionSchema, request: cardRequestSchema }),
    result: cardReplySchema,
  },
} as const;
export type DataMethod = keyof typeof dataOperations;
export type DataInput<M extends DataMethod> = z.infer<(typeof dataOperations)[M]['input']>;
export type DataResult<M extends DataMethod> = z.infer<(typeof dataOperations)[M]['result']>;
export type DataRequest = {
  [M in DataMethod]: { type: 'data-request'; requestId: string; method: M; input: DataInput<M> };
}[DataMethod];
const requestEnvelopeSchema = z.strictObject({
  type: z.literal('data-request'),
  requestId: z.uuid(),
  method: z.string(),
  input: z.unknown().optional(),
});
export function isDataMethod(method: string): method is DataMethod {
  return Object.hasOwn(dataOperations, method);
}
export const dataRequestSchema = z.custom<DataRequest>((value) => {
  const parsed = requestEnvelopeSchema.safeParse(value);
  return (
    parsed.success &&
    isDataMethod(parsed.data.method) &&
    dataOperations[parsed.data.method].input.safeParse(parsed.data.input).success
  );
});
export type BoundExecution = z.infer<typeof boundExecutionSchema>;
export type ExecutionRef = z.infer<typeof executionRefSchema>;
export type EnvironmentState = z.infer<typeof environmentStateSchema>;
export type SessionFingerprint = z.infer<typeof sessionFingerprintSchema>;
export type PrivateClaim = z.infer<typeof privateClaimSchema>;
export type CardRequest = z.infer<typeof cardRequestSchema>;
export type CardReply = z.infer<typeof cardReplySchema>;
export type OperationResult = z.infer<typeof operationResultSchema>;
export type RecoveryTask = z.infer<typeof recoveryTaskSchema>;
export type PreparedTask = z.infer<typeof preparedTaskSchema>;
export type CleanupProof = z.infer<typeof cleanupProofSchema>;
export type SettingsCommitInput = z.infer<typeof settingsCommitInputSchema>;
export type PrivateSettingsView = z.infer<typeof privateSettingsViewSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Processor = z.infer<typeof processorSchema>;
export type ProcessingId = z.infer<typeof processingIdSchema>;
export type ClaimToken = z.infer<typeof claimTokenSchema>;
export type OperationKey = z.infer<typeof operationKeySchema>;

export type DataResponse = {
  [M in DataMethod]: { type: 'data-response'; requestId: string; method: M; result: DataResult<M> };
}[DataMethod];
const responseEnvelopeSchema = z.strictObject({
  type: z.literal('data-response'),
  requestId: z.uuid(),
  method: z.string(),
  result: z.unknown(),
});
export const dataResponseSchema = z.custom<DataResponse>((value) => {
  const parsed = responseEnvelopeSchema.safeParse(value);
  return (
    parsed.success &&
    isDataMethod(parsed.data.method) &&
    dataOperations[parsed.data.method].result.safeParse(parsed.data.result).success
  );
});
export const dataServiceInitializeSchema = z.strictObject({
  type: z.literal('initialize'),
  ownerNonce: z.uuid(),
  dataPath: z.string().min(1),
  nativeBinding: z.string().min(1).optional(),
});
export const dataServiceControlSchema = z.discriminatedUnion('type', [
  dataServiceInitializeSchema,
  z.strictObject({ type: z.literal('heartbeat'), ownerNonce: z.uuid() }),
  z.strictObject({ type: z.literal('shutdown'), requestId: z.uuid() }),
]);
export const dataServiceEventSchema = z.union([
  dataResponseSchema,
  z.strictObject({ type: z.literal('ready'), ownerNonce: z.uuid() }),
  z.strictObject({ type: z.literal('changed') }),
  z.strictObject({ type: z.literal('shutdown-complete'), requestId: z.uuid() }),
  z.strictObject({ type: z.literal('blocked'), message: z.string() }),
]);
