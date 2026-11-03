import type { DataRequest } from '@browser-2d/contracts/host';
import type { ApplicationRepository } from './repository';

export function dispatch(repository: ApplicationRepository, request: DataRequest) {
  switch (request.method) {
    case 'browsers.list':
      return repository.browsers.list();
    case 'browsers.create':
      return repository.browsers.create(request.input);
    case 'browsers.update':
      return repository.browsers.update(request.input);
    case 'browsers.remove':
      return repository.browsers.remove(request.input);
    case 'cards.list':
      return repository.cards.list(request.input);
    case 'cards.importText':
      return repository.cards.importText(request.input);
    case 'cards.update':
      return repository.cards.update(request.input);
    case 'cards.remove':
      return repository.cards.remove(request.input);
    case 'settings.read':
      return repository.settings.read();
    case 'settings.bindings':
      return repository.settings.bindings();
    case 'settings.commit':
      return repository.settings.commit(request.input);
    case 'tasks.list':
      return repository.tasks.list();
    case 'tasks.accept':
      return repository.tasks.accept(request.input);
    case 'tasks.prepareNext':
      return repository.tasks.prepareNext(request.input);
    case 'tasks.authorize':
      return repository.tasks.authorize(request.input);
    case 'tasks.startIntent':
      return repository.tasks.startIntent(request.input);
    case 'tasks.owned':
      return repository.tasks.owned(request.input);
    case 'tasks.running':
      return repository.tasks.running(request.input);
    case 'tasks.fence':
      return repository.tasks.fence(request.input);
    case 'tasks.recovery':
      return repository.tasks.recovery(request.input);
    case 'tasks.cancelQueued':
      return repository.tasks.cancelQueued(request.input);
    case 'tasks.finish':
      return repository.tasks.finish(request.input);
    case 'tasks.request':
      return repository.tasks.request(request.input);
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}
