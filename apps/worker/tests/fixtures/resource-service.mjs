import { createServer } from 'node:http';
import process from 'node:process';

const modes = new Map();
const operations = new Map();
const events = [];
const record = (operationId, kind) => events.push({ operationId, kind });
const reply = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
function result(operation) {
  return { ownership: operation.ownership, externalId: operation.operationId };
}
function deliver(operation) {
  if (operation.present && operation.responseAllowed && !operation.response.writableEnded) {
    record(operation.operationId, 'acquire-response');
    reply(operation.response, result(operation));
  }
}
function create(operation) {
  if (operation.fenced) {
    record(operation.operationId, 'creation-suppressed');
    return;
  }
  operation.present = true;
  record(operation.operationId, 'created');
  deliver(operation);
}
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/state') {
      reply(response, {
        pid: process.pid,
        operations: [...operations.values()].map(({ response: pending, ...operation }) => {
          void pending;
          return operation;
        }),
        events,
      });
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    if (request.url === '/configure') {
      modes.set(input.deviceId, input.mode);
      reply(response, {});
      return;
    }
    if (request.url === '/acquire') {
      const mode = modes.get(input.deviceId);
      const operation = {
        ...input,
        mode,
        ownership: mode === 'borrowed' ? 'borrowed' : 'owned',
        present: false,
        fenced: false,
        fenceAllowed: false,
        releaseAllowed: mode !== 'cleanup-refused',
        responseAllowed: mode !== 'late-success',
        response,
      };
      operations.set(input.operationId, operation);
      record(input.operationId, 'acquire-requested');
      if (mode !== 'late-success' && mode !== 'unknown') create(operation);
      return;
    }
    const operation = operations.get(input.operationId ?? input.externalId);
    if (!operation) throw new Error('Unknown operation');
    if (request.url === '/control') {
      switch (input.action) {
        case 'create':
          create(operation);
          break;
        case 'respond':
          operation.responseAllowed = true;
          deliver(operation);
          break;
        case 'allow-fence':
          operation.fenceAllowed = true;
          break;
        case 'allow-release':
          operation.releaseAllowed = true;
          break;
        default:
          throw new Error('Unknown control');
      }
      reply(response, {});
    } else if (request.url === '/reconcile') {
      if (operation.ownerToken !== input.ownerToken) throw new Error('Ownership mismatch');
      if (operation.present) reply(response, { kind: 'present', resource: result(operation) });
      else if (operation.fenced) reply(response, { kind: 'absent-final' });
      else if (operation.fenceAllowed) {
        operation.fenced = true;
        record(operation.operationId, 'fenced');
        reply(response, { kind: 'absent-final' });
      } else {
        record(operation.operationId, 'transient-absence');
        reply(response, { kind: 'unknown' });
      }
    } else if (request.url === '/execute') {
      if (!operation.present) throw new Error('Execution without resource');
      record(operation.operationId, 'executed');
      reply(response, {});
    } else if (request.url === '/release') {
      if (operation.ownership === 'borrowed') record(operation.operationId, 'detached');
      else if (!operation.releaseAllowed) {
        record(operation.operationId, 'release-refused');
        reply(response, { error: 'release refused' }, 503);
        return;
      } else {
        operation.present = false;
        operation.fenced = true;
        record(operation.operationId, 'released');
      }
      reply(response, {});
    } else throw new Error('Unknown route');
  } catch (error) {
    reply(response, { error: error.message }, 400);
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.send({ port: address.port });
});
process.on('disconnect', () => process.exit(0));
