import { isMainThread } from 'node:worker_threads';
import { runBrowserWorkerHost } from './host';

if (isMainThread) runBrowserWorkerHost(__filename);
else void import('./automation');
