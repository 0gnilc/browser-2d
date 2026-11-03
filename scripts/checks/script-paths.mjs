import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rename, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { root } from '../process.mjs';

const mapping = JSON.parse(await readFile(new URL('./script-paths.json', import.meta.url), 'utf8'));
const apply = process.argv.includes('--apply');
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const failures = [];
const moved = new Set();
for (const [oldPath, newPath] of Object.entries(mapping)) {
  const oldExists = await access(resolve(root, oldPath)).then(
    () => true,
    () => false,
  );
  if (oldExists && apply) {
    await mkdir(dirname(resolve(root, newPath)), { recursive: true });
    await rename(resolve(root, oldPath), resolve(root, newPath));
    moved.add(oldPath);
  } else if (oldExists) failures.push(`Retired script ${oldPath}`);
  await access(resolve(root, newPath));
}
for (const path of files) {
  if (path === 'scripts/checks/script-paths.json') continue;
  if (!/\.(?:mjs|ts|json|md|yml|yaml|sh)$/.test(path)) continue;
  const destination = mapping[path] ?? path;
  let source;
  try {
    source = await readFile(resolve(root, destination), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  let next = source;
  if (moved.has(path))
    next = next.replace(
      /(?<=from |import\(|new URL\()(['"])(\.{1,2}\/[^'"\n]+)\1/g,
      (literal, quote, value) => {
        const absolute = resolve(root, dirname(path), value);
        const target = mapping[relative(root, absolute)] ?? relative(root, absolute);
        const name = relative(
          dirname(resolve(root, destination)),
          resolve(root, target),
        ).replaceAll('\\', '/');
        return `${quote}${name.startsWith('.') ? name : `./${name}`}${quote}`;
      },
    );
  for (const [oldPath, newPath] of Object.entries(mapping)) {
    if (next.includes(oldPath)) {
      if (apply) next = next.replaceAll(oldPath, newPath);
      else failures.push(`${destination} references ${oldPath}`);
    }
  }
  if (next !== source) await writeFile(resolve(root, destination), next);
}
assert.deepEqual(failures, [], 'Script path migration is incomplete');
console.log('Categorized script paths verified.');
