import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBoundaries } from './check-boundaries.mjs';
import { root } from './process.mjs';

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-boundaries-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['apps', 'packages', 'internal', 'package.json']) {
    await cp(join(root, name), join(directory, name), {
      recursive: true,
      filter: (path) =>
        !path
          .split(/[\\/]/)
          .some((part) => ['node_modules', 'dist', 'build', 'coverage'].includes(part)),
    });
  }
  return directory;
}

async function append(directory, path, source) {
  const file = join(directory, path);
  await writeFile(file, `${await readFile(file, 'utf8')}\n${source}\n`);
}

async function manifest(directory, path, change) {
  const file = join(directory, path, 'package.json');
  const value = JSON.parse(await readFile(file, 'utf8'));
  change(value);
  await writeFile(file, JSON.stringify(value));
}

test('the actual workspace graph allows build tooling and worker runtime resolution', async () => {
  await checkBoundaries();
});

for (const name of ['forge.config.js', 'vite.config.js', 'package-lock.json']) {
  test(`retired root ${name} cannot reintroduce a second toolchain`, async (t) => {
    const directory = await workspace(t);
    await writeFile(join(directory, name), '{}');
    await assert.rejects(checkBoundaries(directory), /Retired root entry must not return/);
  });
}

for (const dependency of ['@electron-forge/cli', 'element-plus', 'sqlite3']) {
  test(`retired dependency ${dependency} cannot reenter a workspace manifest`, async (t) => {
    const directory = await workspace(t);
    await manifest(directory, 'apps/worker', (value) => {
      value.devDependencies[dependency] = '1.0.0';
    });
    await assert.rejects(checkBoundaries(directory), /retired dependency/);
  });
}

const violations = [
  [
    'public contracts cannot re-export host',
    'packages/contracts/src/public/index.ts',
    "export * from '../host/index';",
    /Public contract privileged import/,
  ],
  [
    'public contracts cannot use bare Node builtins',
    'packages/contracts/src/public/index.ts',
    "import 'fs/promises';",
    /Public contract privileged import/,
  ],
  [
    'UI side-effect imports cannot load Node',
    'apps/ui/src/main.ts',
    "import 'node:fs';",
    /UI privileged import/,
  ],
  [
    'UI dynamic imports cannot load Electron',
    'apps/ui/src/main.ts',
    "void import('electron');",
    /UI privileged import/,
  ],
  [
    'Vue script imports are checked',
    'apps/ui/src/Foundation.vue',
    "<script>import 'fs';</script>",
    /UI privileged import/,
  ],
  [
    'Vue external scripts are checked',
    'apps/ui/src/Foundation.vue',
    '<script src="../../desktop/src/main/index.ts"></script>',
    /Cross-package source import/,
  ],
  [
    'applications cannot import another application source',
    'apps/ui/src/main.ts',
    "import '../../desktop/src/main/index';",
    /Cross-package source import/,
  ],
  [
    'applications cannot import the worker implementation',
    'apps/desktop/src/main/index.ts',
    "import '@browser-2d/worker-runtime/entry';",
    /Cross-app implementation import/,
  ],
  [
    'production imports cannot use internal tooling',
    'apps/desktop/src/main/index.ts',
    "import '@browser-2d/build-config';",
    /Production imports internal tooling/,
  ],
  [
    'desktop cannot load SQLite through require',
    'apps/desktop/src/main/index.ts',
    "require('better-sqlite3');",
    /Desktop SQLite import/,
  ],
  [
    'desktop cannot load builtin SQLite',
    'apps/desktop/src/main/index.ts',
    "import 'node:sqlite';",
    /Desktop SQLite import/,
  ],
  [
    'worker cannot load UI frameworks',
    'apps/worker/src/entry.ts',
    "import 'vue';",
    /Worker UI import/,
  ],
  [
    'source imports require declared dependencies',
    'apps/worker/src/entry.ts',
    "import 'some-undeclared-package/subpath';",
    /Undeclared dependency/,
  ],
  [
    'workspace imports must use exported subpaths',
    'apps/worker/src/entry.ts',
    "import '@browser-2d/contracts/src/public/index';",
    /Unexported workspace entry/,
  ],
  [
    'import type expressions are checked',
    'packages/contracts/src/public/index.ts',
    "type Hidden = import('../host/index').WorkerRequest;",
    /Public contract privileged import/,
  ],
];
for (const [name, path, source, error] of violations) {
  test(name, async (t) => {
    const directory = await workspace(t);
    await append(directory, path, source);
    await assert.rejects(checkBoundaries(directory), error);
  });
}

test('public contracts cannot hide a privileged import in a shared helper', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'packages/contracts/src/helper.ts'),
    "export * from './host/index';",
  );
  await append(directory, 'packages/contracts/src/public/index.ts', "export * from '../helper';");
  await assert.rejects(checkBoundaries(directory), /Public contract privileged import/);
});

test('workspace manifest cycles fail even without source imports', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'internal/tsconfig', (value) => {
    value.devDependencies = { '@browser-2d/contracts': 'workspace:*' };
  });
  await assert.rejects(checkBoundaries(directory), /Workspace dependency cycle/);
});

test('source cycles fail even without a manifest cycle', async (t) => {
  const directory = await workspace(t);
  await append(directory, 'packages/contracts/src/public/index.ts', "export * from '../helper';");
  await writeFile(join(directory, 'packages/contracts/src/helper.ts'), "import './public/index';");
  await assert.rejects(checkBoundaries(directory), /Source dependency cycle/);
});

test('desktop cannot declare SQLite in any dependency field', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'apps/desktop', (value) => {
    value.devDependencies['better-sqlite3'] = 'catalog:';
  });
  await assert.rejects(checkBoundaries(directory), /SQLite belongs to worker/);
});

test('app manifests cannot create a worker to UI dependency', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'apps/worker', (value) => {
    value.devDependencies['@browser-2d/ui'] = 'workspace:*';
  });
  await assert.rejects(checkBoundaries(directory), /forbidden app dependency/);
});

test('unknown workspace packages fail', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'packages/contracts', (value) => {
    value.devDependencies['@browser-2d/missing'] = 'workspace:*';
  });
  await assert.rejects(checkBoundaries(directory), /unknown workspace dependency/);
});

test('import-like text in comments and strings is not an import', async (t) => {
  const directory = await workspace(t);
  await append(
    directory,
    'apps/ui/src/main.ts',
    `
    // import 'fs';
    const example = "import('electron')";
  `,
  );
  await checkBoundaries(directory);
});

test('UI manifests cannot declare Electron', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'apps/ui', (value) => {
    value.dependencies.electron = 'catalog:';
  });
  await assert.rejects(checkBoundaries(directory), /privileged UI dependency/);
});

test('public contracts cannot import UI frameworks', async (t) => {
  const directory = await workspace(t);
  await append(directory, 'packages/contracts/src/public/index.ts', "import 'vue';");
  await assert.rejects(checkBoundaries(directory), /Public contract privileged import/);
});

test('computed runtime imports cannot bypass the static graph', async (t) => {
  const directory = await workspace(t);
  await append(directory, 'apps/ui/src/main.ts', "const name = 'electron'; void import(name);");
  await assert.rejects(checkBoundaries(directory), /Computed production import/);
});

test('worker runtime resolution must use a compiled export', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'apps/worker', (value) => {
    value.exports['./entry'] = './src/entry.ts';
  });
  await assert.rejects(checkBoundaries(directory), /Cross-app implementation import/);
});

test('TypeScript helpers imported through emitted .js names are checked', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'packages/contracts/src/helper.ts'), "import 'fs';");
  await append(
    directory,
    'packages/contracts/src/public/index.ts',
    "export * from '../helper.js';",
  );
  await assert.rejects(checkBoundaries(directory), /Public contract privileged import/);
});

test('browser conditional exports cannot expose host contracts to UI', async (t) => {
  const directory = await workspace(t);
  await manifest(directory, 'packages/contracts', (value) => {
    value.exports['./public'] = {
      browser: './src/host/index.ts',
      default: './src/public/index.ts',
    };
  });
  await assert.rejects(checkBoundaries(directory), /UI privileged import/);
});

test('computed imports in package-root helpers reachable from public contracts fail', async (t) => {
  const directory = await workspace(t);
  await writeFile(
    join(directory, 'packages/contracts/helper.ts'),
    "const name = 'node:fs'; export const load = () => import(name);",
  );
  await append(
    directory,
    'packages/contracts/src/public/index.ts',
    "export * from '../../helper';",
  );
  await assert.rejects(checkBoundaries(directory), /Computed production import/);
});
