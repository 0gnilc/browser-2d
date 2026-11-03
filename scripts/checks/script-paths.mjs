import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rename, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { root } from '../process.mjs';

export function migrateReferences(source, path, destination, mapping) {
  const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function rebase(node) {
    const value = node.text;
    if (!value.startsWith('.')) return;
    const targetPath = relative(root, resolve(root, dirname(path), value)).replaceAll('\\', '/');
    const target = mapping[targetPath] ?? targetPath;
    const name = relative(dirname(resolve(root, destination)), resolve(root, target)).replaceAll(
      '\\',
      '/',
    );
    const next = `${name.startsWith('.') ? name : `./${name}`}${value.endsWith('/') ? '/' : ''}`;
    if (next !== value)
      edits.push({
        start: node.getStart(syntax) + 1,
        end: node.end - (ts.isTemplateHead(node) ? 2 : 1),
        value: next,
      });
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      rebase(node.moduleSpecifier);
    if (
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
      (ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL')
    ) {
      const argument = node.arguments?.[0];
      if (
        argument &&
        (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      )
        rebase(argument);
      else if (argument && ts.isTemplateExpression(argument)) rebase(argument.head);
    }
    ts.forEachChild(node, visit);
  }
  if (path !== destination && /\.[cm]?[jt]sx?$/.test(path)) visit(syntax);
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    next = next.slice(0, edit.start) + edit.value + next.slice(edit.end);
  for (const [oldPath, newPath] of Object.entries(mapping))
    next = next.replaceAll(oldPath, newPath);
  return next;
}

export async function migrateScripts(directory, apply) {
  const mapping = JSON.parse(
    await readFile(new URL('./script-paths.json', import.meta.url), 'utf8'),
  );
  const files = execFileSync('git', ['ls-files'], { cwd: directory, encoding: 'utf8' })
    .trim()
    .split('\n');
  const failures = [];
  const moved = new Set();
  for (const [oldPath, newPath] of Object.entries(mapping)) {
    const oldExists = await access(resolve(directory, oldPath)).then(
      () => true,
      () => false,
    );
    if (oldExists && apply) {
      await assert.rejects(
        access(resolve(directory, newPath)),
        { code: 'ENOENT' },
        `Destination already exists: ${newPath}`,
      );
      await mkdir(dirname(resolve(directory, newPath)), { recursive: true });
      await rename(resolve(directory, oldPath), resolve(directory, newPath));
      moved.add(oldPath);
    } else if (oldExists) failures.push(`Retired script ${oldPath}`);
    await access(resolve(directory, newPath));
  }
  for (const path of files) {
    if (path === 'scripts/checks/script-paths.json') continue;
    if (!/\.(?:mjs|ts|json|md|yml|yaml|sh)$/.test(path)) continue;
    const destination = mapping[path] ?? path;
    let source;
    try {
      source = await readFile(resolve(directory, destination), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const next = migrateReferences(
      source,
      moved.has(path) ? path : destination,
      destination,
      mapping,
    );
    if (next !== source) {
      if (apply) await writeFile(resolve(directory, destination), next);
      else failures.push(`${destination} references retired scripts`);
    }
  }
  assert.deepEqual(failures, [], 'Script path migration is incomplete');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await migrateScripts(root, process.argv.includes('--apply'));
  console.log('Categorized script paths verified.');
}
