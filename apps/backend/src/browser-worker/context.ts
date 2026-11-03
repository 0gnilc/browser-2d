import {
  taskProcessCommandSchema,
  type BoundExecution,
  type CardRequest,
  type CardReply,
  type PrivateClaim,
} from '@browser-2d/contracts/host';

export function createCardContext(options: {
  execution: BoundExecution;
  post: (value: unknown) => void;
  receive: (listener: (value: unknown) => void) => void;
}) {
  let sequence = 0;
  let pending:
    | {
        sequence: number;
        kind: CardRequest['kind'];
        resolve: (reply: CardReply) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let ready!: () => void;
  const barrier = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let stopped = false;
  options.receive((raw) => {
    const command = taskProcessCommandSchema.parse(raw);
    if (command.kind === 'work-ready') ready();
    if (command.kind === 'stop' || command.kind === 'cancel') {
      stopped = true;
      pending?.reject(new Error('Execution stopped'));
      pending = undefined;
    }
    if (command.kind !== 'receipt') return;
    if (!pending || pending.sequence !== command.sequence || pending.kind !== command.reply.kind)
      throw new Error('Unexpected Card receipt');
    const waiting = pending;
    pending = undefined;
    waiting.resolve(command.reply);
  });
  async function request(input: CardRequest) {
    await barrier;
    if (stopped || pending) throw new Error('Card context is unavailable');
    const current = sequence++;
    return new Promise<CardReply>((resolve, reject) => {
      pending = { sequence: current, kind: input.kind, resolve, reject };
      options.post({ kind: 'request', ...options.execution, sequence: current, request: input });
    });
  }
  return {
    async nextCard() {
      const reply = await request({ kind: 'next_card' });
      if (reply.kind !== 'next_card') throw new Error('Wrong Card receipt');
      if (!reply.result.ok) throw new Error('Card claim was refused');
      return reply.result.value;
    },
    async apply(
      claim: PrivateClaim,
      input: Omit<Extract<CardRequest, { kind: 'apply' }>, 'kind' | 'claimToken' | 'processingId'>,
    ) {
      const reply = await request({
        kind: 'apply',
        claimToken: claim.claimToken,
        processingId: claim.processingId,
        ...input,
      });
      if (reply.kind !== 'apply') throw new Error('Wrong Card receipt');
      if (!reply.result.ok) throw new Error('Card operation was refused');
      return reply.result.value;
    },
    async complete(
      claim: PrivateClaim,
      result: Extract<CardRequest, { kind: 'complete' }>['result'],
    ) {
      const reply = await request({
        kind: 'complete',
        claimToken: claim.claimToken,
        processingId: claim.processingId,
        result,
      });
      if (reply.kind !== 'complete') throw new Error('Wrong Card receipt');
      if (!reply.result.ok) throw new Error('Card completion was refused');
      return reply.result.value;
    },
  };
}
