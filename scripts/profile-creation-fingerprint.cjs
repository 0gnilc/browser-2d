const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const originalPromiseMkdir = fs.promises.mkdir;
const originalMkdir = fs.mkdir;
const originalMkdirSync = fs.mkdirSync;
function matches(target) {
  return /browser-2d-closed-recovery-[^/]+\/chrome-sessions\/[0-9a-f-]{36}$/.test(String(target));
}
function record(target, api, stack) {
  const output = process.env.BROWSER2D_PROFILE_TRACE_DIR;
  if (!output) return;
  let fingerprint;
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    fingerprint = {
      inode: String(stat.ino),
      birthtimeNs: String(stat.birthtimeNs),
      ctimeNs: String(stat.ctimeNs),
      mtimeNs: String(stat.mtimeNs),
      size: String(stat.size),
    };
  } catch (error) {
    fingerprint = { error: error.code };
  }
  originalMkdirSync(output, { recursive: true });
  fs.appendFileSync(
    path.join(output, `created-${process.pid}.jsonl`),
    JSON.stringify({
      source: process.env.GITHUB_SHA ?? null,
      node: process.version,
      pid: process.pid,
      time: new Date().toISOString(),
      monotonicNs: String(process.hrtime.bigint()),
      path: String(target),
      api,
      stack,
      ...fingerprint,
    }) + '\n',
  );
}
fs.promises.mkdir = function (target, options) {
  const pending = originalPromiseMkdir(target, options);
  if (!matches(target)) return pending;
  const stack = new Error('Matching mkdir caller').stack;
  return pending.then((result) => {
    record(target, 'fs.promises.mkdir', stack);
    return result;
  });
};
fs.mkdir = function (...args) {
  if (!matches(args[0])) return Reflect.apply(originalMkdir, this, args);
  const target = args[0];
  const callback = args.at(-1);
  const stack = new Error('Matching mkdir caller').stack;
  args[args.length - 1] = function (...result) {
    if (!result[0]) record(target, 'fs.mkdir', stack);
    return Reflect.apply(callback, this, result);
  };
  return Reflect.apply(originalMkdir, this, args);
};
fs.mkdirSync = function (...args) {
  if (!matches(args[0])) return Reflect.apply(originalMkdirSync, this, args);
  const stack = new Error('Matching mkdir caller').stack;
  const result = Reflect.apply(originalMkdirSync, this, args);
  record(args[0], 'fs.mkdirSync', stack);
  return result;
};
syncBuiltinESMExports();
