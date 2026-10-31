const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const originalMkdir = fs.promises.mkdir;
fs.promises.mkdir = async function (target, options) {
  const result = await originalMkdir(target, options);
  if (!/browser-2d-closed-recovery-[^/]+\/chrome-sessions\/[0-9a-f-]{36}$/.test(String(target)))
    return result;
  const output = process.env.BROWSER2D_PROFILE_TRACE_DIR;
  if (!output) return result;
  const stat = fs.lstatSync(target, { bigint: true });
  const fingerprint = {
    source: process.env.GITHUB_SHA ?? null,
    node: process.version,
    pid: process.pid,
    time: new Date().toISOString(),
    monotonicNs: String(process.hrtime.bigint()),
    path: String(target),
    inode: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs),
    ctimeNs: String(stat.ctimeNs),
    mtimeNs: String(stat.mtimeNs),
    size: String(stat.size),
  };
  fs.mkdirSync(output, { recursive: true });
  fs.appendFileSync(
    path.join(output, `created-${process.pid}.jsonl`),
    JSON.stringify(fingerprint) + '\n',
  );
  return result;
};
syncBuiltinESMExports();
