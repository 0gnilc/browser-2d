import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { root } from './process.mjs';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name),
      ),
    )
  ).flat();
}
for (const app of ['ui', 'desktop', 'worker']) {
  const directory = join(root, 'apps', app);
  for (const path of await files(join(directory, 'src'))) {
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g,
    )) {
      const name = match[1];
      if (name.startsWith('.')) {
        const location = relative(directory, resolve(dirname(path), name));
        assert(
          !isAbsolute(location) && location.split(/[\\/]/)[0] !== '..',
          `Cross-app source import ${path}: ${name}`,
        );
      }
      assert(
        !name.startsWith('@browser-2d/worker-runtime'),
        `Worker implementation imported by ${path}`,
      );
      assert(!name.includes('/internal/'), `Production imports internal tooling: ${path}`);
      if (app === 'ui')
        assert(
          !/^(node:|electron$|better-sqlite3$|@browser-2d\/contracts\/host)/.test(name),
          `Privileged UI import: ${path}`,
        );
    }
  }
}
const main = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const desktop = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8'));
assert(!main.dependencies, 'Root must not own production dependencies');
assert.equal(desktop.dependencies['@browser-2d/worker-runtime'], 'workspace:*');
assert(!desktop.dependencies['better-sqlite3'], 'Native dependency belongs to worker');
console.log('Workspace runtime boundaries verified.');
