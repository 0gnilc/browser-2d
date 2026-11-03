import assert from 'node:assert/strict';

export function runtimeArtifacts(manifest) {
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    assert(chunk && typeof chunk.file === 'string', `Missing runtime dependency ${key}`);
    assert(
      !chunk.file.startsWith('/') && !chunk.file.split('/').includes('..'),
      `Invalid runtime artifact ${key}`,
    );
    files.add(chunk.file);
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])])
      visit(dependency);
  }
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
  assert(
    entries.some(([, chunk]) => chunk.file === 'browser-worker.cjs'),
    'Missing BrowserWorker entry',
  );
  assert(
    manifest['src/browser-worker/entry.ts']?.dynamicImports?.includes(
      'src/browser-worker/automation.ts',
    ),
    'BrowserWorker must load its automation module only inside the worker thread',
  );
  for (const [key] of entries) visit(key);
  return [...files];
}

export function assertBundledWorkspace(source, label) {
  assert(
    !/(?:require\s*\(|import\s*\(|from\s*)\s*["']@browser-2d\/(?:contracts|amount)(?:["'/])/.test(
      source,
    ),
    `Unbundled workspace runtime in ${label}`,
  );
}
