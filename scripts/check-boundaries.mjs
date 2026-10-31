import { builtinModules } from 'node:module';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { root } from './process.mjs';

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const uiModules = new Set([
  'vue',
  'vue-router',
  'pinia',
  'naive-ui',
  'react',
  'react-dom',
  'svelte',
]);
const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
]);
const excludedDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function within(directory, path) {
  const location = relative(directory, path);
  return !isAbsolute(location) && location.split(/[\\/]/)[0] !== '..';
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => !excludedDirectories.has(entry.name))
        .map((entry) =>
          entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name),
        ),
    )
  ).flat();
}

function imports(source, path) {
  const edges = [];
  const scripts =
    extname(path) === '.vue'
      ? [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((match) => {
          const src = match[1].match(/\bsrc\s*=\s*['"]([^'"]+)['"]/i);
          if (src) edges.push({ name: src[1], kind: 'import' });
          return match[2];
        })
      : [source];
  for (const script of scripts) {
    const scriptKind = /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const ast = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, scriptKind);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isStringLiteralLike(node.moduleSpecifier))
          edges.push({ name: node.moduleSpecifier.text, kind: 'import' });
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const expression = node.moduleReference.expression;
        if (expression && ts.isStringLiteralLike(expression))
          edges.push({ name: expression.text, kind: 'import' });
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        if (ts.isStringLiteralLike(node.argument.literal))
          edges.push({ name: node.argument.literal.text, kind: 'import' });
      } else if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const resolution =
          ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === 'require' &&
          expression.name.text === 'resolve';
        const loading =
          expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) && expression.text === 'require');
        if (loading || resolution) {
          if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
            edges.push({ name: node.arguments[0].text, kind: resolution ? 'resolve' : 'import' });
          else edges.push({ kind: 'computed' });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return edges;
}

function packageName(name) {
  return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
}

function exportedTargets(exports, subpath) {
  if (typeof exports === 'string') return subpath === '.' ? [exports] : [];
  if (!exports || typeof exports !== 'object') return [];
  if (Array.isArray(exports)) return exports.flatMap((entry) => exportedTargets(entry, subpath));
  if (Object.keys(exports).some((key) => key.startsWith('.'))) {
    if (subpath in exports) return exportedTargets(exports[subpath], '.');
    for (const [key, target] of Object.entries(exports)) {
      const [prefix, suffix] = key.split('*');
      if (key.includes('*') && subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
        return exportedTargets(target, '.').map((value) =>
          value.replaceAll('*', subpath.slice(prefix.length, subpath.length - suffix.length)),
        );
      }
    }
    return [];
  }
  return Object.values(exports).flatMap((entry) => exportedTargets(entry, '.'));
}

async function resolveFile(path) {
  for (const candidate of [
    path,
    ...(/\.[cm]?js$/.test(path)
      ? [
          path.replace(/\.js$/, '.ts'),
          path.replace(/\.js$/, '.tsx'),
          path.replace(/\.mjs$/, '.mts'),
          path.replace(/\.cjs$/, '.cts'),
        ]
      : []),
    ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'].map((ext) => path + ext),
    ...['index.ts', 'index.tsx', 'index.js', 'index.mjs'].map((name) => join(path, name)),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
}

export async function checkBoundaries(workspaceRoot = root) {
  const errors = new Set();
  const fail = (message) => errors.add(message);
  const units = [];
  for (const group of ['apps', 'packages', 'internal']) {
    for (const entry of await readdir(join(workspaceRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(workspaceRoot, group, entry.name);
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      units.push({
        directory,
        group,
        manifest,
        dependencies: new Set(
          dependencyFields.flatMap((field) => Object.keys(manifest[field] ?? {})),
        ),
        sources: await files(directory),
      });
    }
  }
  const byName = new Map(units.map((unit) => [unit.manifest.name, unit]));
  if (byName.size !== units.length) fail('Duplicate workspace package names');
  const rootManifest = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'));
  if (
    ['dependencies', 'optionalDependencies'].some(
      (field) => Object.keys(rootManifest[field] ?? {}).length,
    )
  )
    fail('Root must not own production dependencies');
  const desktop = byName.get('@browser-2d/desktop');
  if (desktop?.manifest.dependencies?.['@browser-2d/worker-runtime'] !== 'workspace:*')
    fail('Desktop must declare the worker runtime production dependency');

  for (const unit of units) {
    const name = unit.manifest.name;
    for (const field of dependencyFields) {
      for (const [dependency, version] of Object.entries(unit.manifest[field] ?? {})) {
        const target = byName.get(dependency);
        if (version.startsWith('workspace:') && !target)
          fail(`${name}: unknown workspace dependency ${dependency}`);
        if (target && !version.startsWith('workspace:'))
          fail(`${name}: workspace dependency ${dependency} must use workspace:`);
        if (target?.group === 'apps') {
          const allowed =
            name === '@browser-2d/desktop' &&
            ((field === 'dependencies' && dependency === '@browser-2d/worker-runtime') ||
              (field === 'devDependencies' && dependency === '@browser-2d/ui'));
          if (!allowed) fail(`${name}: forbidden app dependency ${dependency}`);
        }
        if (
          unit.group !== 'internal' &&
          field !== 'devDependencies' &&
          target?.group === 'internal'
        )
          fail(`${name}: production dependency on internal tooling ${dependency}`);
        if (
          name === '@browser-2d/ui' &&
          (dependency === 'electron' || /sqlite/i.test(dependency) || builtins.has(dependency))
        )
          fail(`${name}: privileged UI dependency ${dependency}`);
        if (name === '@browser-2d/desktop' && /sqlite/i.test(dependency))
          fail(`${name}: SQLite belongs to worker (${dependency})`);
        if (name === '@browser-2d/worker-runtime' && uiModules.has(dependency))
          fail(`${name}: worker cannot depend on UI module ${dependency}`);
      }
    }
  }

  const visited = new Set();
  const visiting = [];
  function visit(unit) {
    const name = unit.manifest.name;
    if (visiting.includes(name)) {
      fail(
        `Workspace dependency cycle: ${[...visiting.slice(visiting.indexOf(name)), name].join(' -> ')}`,
      );
      return;
    }
    if (visited.has(name)) return;
    visiting.push(name);
    for (const dependency of unit.dependencies)
      if (byName.has(dependency)) visit(byName.get(dependency));
    visiting.pop();
    visited.add(name);
  }
  for (const unit of units) visit(unit);

  const graph = new Map();
  for (const unit of units) {
    for (const path of unit.sources.filter((path) => sourceExtensions.has(extname(path)))) {
      const runtime =
        within(join(unit.directory, 'src'), path) && !/\.(test|spec)\.[^.]+$/.test(path);
      const edges = [];
      graph.set(path, { unit, runtime, edges });
      for (const edge of imports(await readFile(path, 'utf8'), path)) {
        if (edge.kind === 'computed') {
          edges.push(edge);
          if (runtime)
            fail(`Computed production import cannot be checked: ${relative(workspaceRoot, path)}`);
          continue;
        }
        const { name } = edge;
        const label = `${relative(workspaceRoot, path)}: ${name}`;
        const builtin = name.startsWith('node:') || builtins.has(name);
        const dependency = packageName(name);
        const targetUnit = byName.get(dependency);
        let target;
        if (name.startsWith('.')) {
          target = await resolveFile(resolve(dirname(path), name));
          if (!within(unit.directory, resolve(dirname(path), name)))
            fail(`Cross-package source import ${label}`);
        } else if (!builtin) {
          if (!unit.dependencies.has(dependency) && dependency !== unit.manifest.name)
            fail(`Undeclared dependency ${label}`);
          if (targetUnit) {
            const subpath = name === dependency ? '.' : `.${name.slice(dependency.length)}`;
            const exported = exportedTargets(targetUnit.manifest.exports, subpath);
            if (!exported.length) fail(`Unexported workspace entry ${label}`);
            for (const entry of exported) {
              edges.push({
                ...edge,
                target: await resolveFile(resolve(targetUnit.directory, entry)),
                builtin,
                label,
                dependency,
              });
            }
            if (targetUnit.group === 'apps') {
              const allowed =
                unit === desktop &&
                dependency === '@browser-2d/worker-runtime' &&
                name === '@browser-2d/worker-runtime/entry' &&
                edge.kind === 'resolve' &&
                exported.length > 0 &&
                exported.every((entry) =>
                  within(join(targetUnit.directory, 'dist'), resolve(targetUnit.directory, entry)),
                );
              if (!allowed) fail(`Cross-app implementation import ${label}`);
            }
          }
        }
        edges.push({ ...edge, target, builtin, label, dependency });
      }
    }
  }

  const sourceVisited = new Set();
  const sourceVisiting = [];
  function visitSource(path) {
    if (sourceVisiting.includes(path)) {
      fail(
        `Source dependency cycle: ${[...sourceVisiting.slice(sourceVisiting.indexOf(path)), path]
          .map((file) => relative(workspaceRoot, file))
          .join(' -> ')}`,
      );
      return;
    }
    if (sourceVisited.has(path)) return;
    sourceVisiting.push(path);
    for (const edge of graph.get(path)?.edges ?? []) if (edge.target) visitSource(edge.target);
    sourceVisiting.pop();
    sourceVisited.add(path);
  }
  for (const path of graph.keys()) visitSource(path);

  for (const [path, source] of graph) {
    const publicContract = within(join(workspaceRoot, 'packages/contracts/src/public'), path);
    if (!publicContract && !source.runtime) continue;
    const owner = source.unit.manifest.name;
    const browserOnly = publicContract || owner === '@browser-2d/ui';
    const seen = new Set();
    function verify(path) {
      if (seen.has(path)) return;
      seen.add(path);
      for (const edge of graph.get(path)?.edges ?? []) {
        if (edge.kind === 'computed') {
          fail(`Computed production import reachable from ${relative(workspaceRoot, path)}`);
          continue;
        }
        const host =
          edge.name.startsWith('@browser-2d/contracts/host') ||
          (edge.target && within(join(workspaceRoot, 'packages/contracts/src/host'), edge.target));
        const internal =
          byName.get(edge.dependency)?.group === 'internal' ||
          (edge.target && within(join(workspaceRoot, 'internal'), edge.target));
        if (
          browserOnly &&
          (edge.builtin ||
            edge.dependency === 'electron' ||
            /sqlite/i.test(edge.dependency) ||
            host ||
            (publicContract && uiModules.has(edge.dependency)))
        )
          fail(`${publicContract ? 'Public contract' : 'UI'} privileged import ${edge.label}`);
        if (internal) fail(`Production imports internal tooling ${edge.label}`);
        if (owner === '@browser-2d/desktop' && /sqlite/i.test(edge.dependency))
          fail(`Desktop SQLite import ${edge.label}`);
        if (owner === '@browser-2d/worker-runtime' && uiModules.has(edge.dependency))
          fail(`Worker UI import ${edge.label}`);
        if (edge.target) verify(edge.target);
      }
    }
    verify(path);
  }
  if (errors.size) throw new Error([...errors].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkBoundaries();
  console.log('Workspace manifests and source boundaries verified.');
}
