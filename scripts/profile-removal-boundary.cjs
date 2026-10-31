const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const originalRm = fs.promises.rm;
const originalRmdir = fs.rmdir;
const events = [];
function matches(target) {
  return /browser-2d-closed-recovery-[^/]+\/chrome-sessions\/[0-9a-f-]{36}$/.test(String(target));
}
function snapshot(target) {
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    return {
      inode: String(stat.ino),
      birthtimeNs: String(stat.birthtimeNs),
      ctimeNs: String(stat.ctimeNs),
      mtimeNs: String(stat.mtimeNs),
      size: String(stat.size),
    };
  } catch (error) {
    return { error: error.code };
  }
}
function record(event, target, extra = {}) {
  events.push({
    time: new Date().toISOString(),
    monotonicNs: String(process.hrtime.bigint()),
    event,
    path: String(target),
    ...extra,
  });
}
function flush() {
  const output = process.env.BROWSER2D_PROFILE_TRACE_DIR;
  if (!output || events.length === 0) return;
  fs.mkdirSync(output, { recursive: true });
  fs.appendFileSync(
    path.join(output, `boundary-${process.pid}.jsonl`),
    JSON.stringify({
      node: process.version,
      pid: process.pid,
      events: events.splice(0),
    }) + '\n',
  );
}
fs.rmdir = function (...args) {
  if (!matches(args[0])) return Reflect.apply(originalRmdir, this, args);
  const target = args[0];
  const callback = args.at(-1);
  record('rmdir:start', target, { options: args.length > 2 ? args[1] : null });
  args[args.length - 1] = function (...result) {
    record('rmdir:callback', target, { error: result[0]?.code, after: snapshot(target) });
    return Reflect.apply(callback, this, result);
  };
  return Reflect.apply(originalRmdir, this, args);
};
fs.promises.rm = async function (target, options) {
  if (!matches(target)) return originalRm(target, options);
  record('rm:start', target, { options, before: snapshot(target) });
  try {
    const result = await originalRm(target, options);
    record('rm:resolved', target, { after: snapshot(target) });
    return result;
  } catch (error) {
    record('rm:rejected', target, { error: error.code, after: snapshot(target) });
    throw error;
  } finally {
    flush();
  }
};
syncBuiltinESMExports();
