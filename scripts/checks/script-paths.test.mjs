import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { root } from '../process.mjs';
import { migrateReferences, migrateScripts } from './script-paths.mjs';

test('moved modules rebase syntax nodes and preserve import-like fixture strings', () => {
  const source = [
    "import { run } from './process.mjs';",
    "export { root } from './process.mjs';",
    'const fixture = "import(\'./process.mjs\')";',
    "const dynamic = import('./process.mjs');",
    "const literal = new URL('../package.json', import.meta.url);",
    'const template = new URL(`../${file}`, import.meta.url);',
  ].join('\n');
  const output = migrateReferences(source, 'scripts/tool.mjs', 'scripts/checks/tool.mjs', {});
  assert.equal(
    output,
    [
      "import { run } from '../process.mjs';",
      "export { root } from '../process.mjs';",
      'const fixture = "import(\'./process.mjs\')";',
      "const dynamic = import('../process.mjs');",
      "const literal = new URL('../../package.json', import.meta.url);",
      'const template = new URL(`../../${file}`, import.meta.url);',
    ].join('\n'),
  );
});

test('exact map applies to the unmigrated repository and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-script-migration-'));
  const mapping = JSON.parse(
    await readFile(new URL('./script-paths.json', import.meta.url), 'utf8'),
  );
  async function digest() {
    const hash = createHash('sha256');
    async function visit(path) {
      for (const entry of (await readdir(join(directory, path), { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        if (entry.name === '.git') continue;
        const name = join(path, entry.name);
        if (entry.isDirectory()) await visit(name);
        else hash.update(name).update(await readFile(join(directory, name)));
      }
    }
    await visit('');
    return hash.digest('hex');
  }
  try {
    execFileSync('tar', ['-xf', '-', '-C', directory], {
      input: execFileSync('git', ['archive', '438254c0f0ec77e7c1da77e23531fabd6f0bd96c'], {
        cwd: root,
        maxBuffer: 20 * 1024 * 1024,
      }),
    });
    execFileSync('git', ['init', '-q', directory]);
    execFileSync('git', ['add', '.'], { cwd: directory });
    await assert.rejects(migrateScripts(directory, false));
    await migrateScripts(directory, true);
    for (const destination of Object.values(mapping)) {
      if (destination.endsWith('.mjs'))
        execFileSync(process.execPath, ['--check', join(directory, destination)]);
    }
    const boundary = await readFile(
      join(directory, 'scripts/checks/check-boundaries.test.mjs'),
      'utf8',
    );
    assert(boundary.includes("type Hidden = import('../host/index').WorkerRequest;"));
    const workflow = await readFile(join(directory, 'scripts/testing/workflows.test.mjs'), 'utf8');
    assert(workflow.includes('new URL(`../../${path}`, import.meta.url)'));
    const before = await digest();
    await migrateScripts(directory, false);
    await migrateScripts(directory, true);
    assert.equal(await digest(), before);
    await writeFile(join(directory, Object.keys(mapping)[0]), 'sentinel');
    await assert.rejects(migrateScripts(directory, true), /Destination already exists/);
    assert.equal(await readFile(join(directory, Object.keys(mapping)[0]), 'utf8'), 'sentinel');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
