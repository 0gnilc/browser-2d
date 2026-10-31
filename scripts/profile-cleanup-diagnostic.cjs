const fs = require('node:fs');
const { channel } = require('node:diagnostics_channel');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const events = [];
const roots = new Set();
const originalRm = fs.promises.rm;
const match = (value) => String(value).includes('browser-2d-closed-recovery-');
function snapshot(target) {
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    return {
      path: String(target),
      inode: String(stat.ino),
      ctimeNs: String(stat.ctimeNs),
      mtimeNs: String(stat.mtimeNs),
      birthtimeNs: String(stat.birthtimeNs),
      size: String(stat.size),
      entries: stat.isDirectory() ? fs.readdirSync(target) : null,
    };
  } catch (error) {
    return { path: String(target), error: error.code };
  }
}
function record(event, data) {
  events.push({
    time: new Date().toISOString(),
    monotonicNs: String(process.hrtime.bigint()),
    event,
    ...data,
  });
}
for (const name of ['lstat', 'rmdir', 'readdir', 'unlink']) {
  const original = fs[name];
  fs[name] = function (...args) {
    const target = String(args[0]);
    if (!match(target)) return Reflect.apply(original, this, args);
    const callback = args.at(-1);
    record(`${name}:start`, { path: target });
    args[args.length - 1] = function (...result) {
      record(`${name}:end`, {
        path: target,
        error: result[0]?.code,
        ...(name === 'rmdir' ? { after: snapshot(target) } : {}),
      });
      return Reflect.apply(callback, this, result);
    };
    return Reflect.apply(original, this, args);
  };
}
fs.promises.rm = async function (target, options) {
  if (!match(target)) return originalRm(target, options);
  roots.add(String(target));
  record('rm:start', { target: snapshot(target) });
  try {
    const result = await originalRm(target, options);
    record('rm:resolved', { target: snapshot(target) });
    return result;
  } catch (error) {
    record('rm:rejected', { code: error.code, target: snapshot(target) });
    throw error;
  }
};
syncBuiltinESMExports();
channel('browser-2d/profile').subscribe(({ event, data }) => {
  record(event, data);
  if (event === 'assertion-sample') flush();
});
process.on('exit', flush);
function flush() {
  if (events.length === 0) return;
  const output = process.env.BROWSER2D_PROFILE_TRACE_DIR;
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, `trace-${process.pid}-${Date.now()}.json`),
    JSON.stringify(
      {
        node: process.version,
        pid: process.pid,
        roots: [...roots],
        events,
      },
      null,
      2,
    ),
  );
}
