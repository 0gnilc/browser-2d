import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { matchesGlob, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { parse } from 'yaml';
import { targets } from '../../internal/build-config/release.mjs';

const read = (path) => parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const setup = read('.github/actions/setup-dependencies/action.yml');
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const evaluate = (value, context) =>
  runInNewContext(
    value.startsWith('${{') ? value.slice(3, -2) : value,
    {
      startsWith: (a, b) => a.startsWith(b),
      always: () => true,
      inputs: {},
      github: { event_name: 'push' },
      ...context,
    },
    { timeout: 100 },
  );
const interpolate = (value, context) =>
  value.replace(/\$\{\{[\s\S]*?\}\}/g, (expression) => evaluate(expression, context));
const nativeSteps = (workflow, context) =>
  workflow.jobs.native.steps.filter((step) => step.if === undefined || evaluate(step.if, context));

function completeMatrix(workflow, job) {
  const rows = workflow.jobs[job].strategy.matrix.include;
  assert.deepEqual(rows.map((row) => row.target).sort(), Object.keys(targets).sort());
  for (const row of rows) {
    const { platform, arch } = targets[row.target];
    const prefix = { win32: 'windows-', darwin: 'macos-', linux: 'ubuntu-' }[platform];
    assert(row.runner.startsWith(prefix), `Runner OS mismatch: ${row.target}`);
    if (platform === 'darwin') assert.equal(row.runner.includes('intel'), arch === 'x64');
  }
  assert.equal(workflow.jobs[job].strategy['fail-fast'], false);
}

function preflightBeforeInstall(workflow) {
  const expanded = workflow.jobs.candidate.steps.flatMap((step) =>
    step.uses === './.github/actions/setup-dependencies' ? setup.runs.steps : [step],
  );
  const preflight = expanded.findIndex((step) =>
    step.run?.includes('scripts/release/release-preflight.mjs'),
  );
  const install = expanded.findIndex(
    (step) =>
      step.uses?.startsWith('pnpm/action-setup@') || /(?:pnpm|npm) install/.test(step.run || ''),
  );
  assert(
    preflight >= 0 && install > preflight,
    'Preflight must precede package-manager and dependency installation',
  );
}

const secretValues = {
  MAC_CSC_LINK: 'mac-certificate',
  MAC_CSC_KEY_PASSWORD: 'mac-password',
  MAC_CSC_NAME: 'mac-identity',
  APPLE_ID: 'apple-account',
  APPLE_APP_SPECIFIC_PASSWORD: 'apple-password',
  APPLE_TEAM_ID: 'apple-team',
  WINDOWS_CSC_LINK: 'windows-certificate',
  WINDOWS_CSC_KEY_PASSWORD: 'windows-password',
  WINDOWS_PUBLISHER: 'windows-publisher',
};
function signingScope(workflow) {
  assert(!JSON.stringify(workflow.env || {}).includes('secrets.'));
  assert(!JSON.stringify(workflow.jobs.candidate.env).includes('secrets.'));
  const privileged = workflow.jobs.candidate.steps.filter((step) =>
    JSON.stringify(step).includes('secrets.'),
  );
  assert.equal(privileged.length, 2);
  for (const step of privileged) {
    assert(
      /release-preflight\.mjs|pnpm dist/.test(step.run || ''),
      'Secrets restricted to preflight and packaging',
    );
    for (const mode of ['preview', 'production']) {
      for (const target of Object.keys(targets)) {
        for (const secrets of [
          secretValues,
          { ...secretValues, MAC_CSC_LINK: '', MAC_CSC_KEY_PASSWORD: '' },
        ]) {
          const env = Object.fromEntries(
            Object.entries(step.env).map(([key, value]) => [
              key,
              evaluate(value, { inputs: { mode }, matrix: { target }, secrets }),
            ]),
          );
          if (mode === 'preview' || target.startsWith('linux-')) {
            assert(
              Object.values(env).every((value) => value === ''),
              `${mode}/${target} must receive no signing values`,
            );
          } else if (target.startsWith('mac-')) {
            assert.equal(env.CSC_LINK, secrets.MAC_CSC_LINK);
            assert.equal(env.CSC_KEY_PASSWORD, secrets.MAC_CSC_KEY_PASSWORD);
            assert.equal(env.CSC_NAME, secrets.MAC_CSC_NAME);
            assert.equal(env.APPLE_ID, secrets.APPLE_ID);
            assert.equal(env.APPLE_APP_SPECIFIC_PASSWORD, secrets.APPLE_APP_SPECIFIC_PASSWORD);
            assert.equal(env.APPLE_TEAM_ID, secrets.APPLE_TEAM_ID);
            assert.equal(env.BROWSER2D_WINDOWS_PUBLISHER, '');
          } else {
            assert.equal(env.CSC_LINK, secrets.WINDOWS_CSC_LINK);
            assert.equal(env.CSC_KEY_PASSWORD, secrets.WINDOWS_CSC_KEY_PASSWORD);
            assert.equal(env.BROWSER2D_WINDOWS_PUBLISHER, secrets.WINDOWS_PUBLISHER);
            for (const key of [
              'CSC_NAME',
              'APPLE_ID',
              'APPLE_APP_SPECIFIC_PASSWORD',
              'APPLE_TEAM_ID',
            ])
              assert.equal(env[key], '');
          }
        }
      }
    }
  }
}

function nativeCoverage(workflow) {
  assert.equal(workflow.jobs.native.if, undefined);
  for (const [target, config] of Object.entries(targets)) {
    const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[config.platform];
    const context = { runner: { os }, matrix: { target } };
    const steps = nativeSteps(workflow, context);
    const commands = steps.map((step) => step.run || '').join('\n');
    for (const command of manifest.scripts.verify.split(' && '))
      assert(commands.includes(command), `Missing native suite on ${target}: ${command}`);
    const required = ['pnpm dist', 'pnpm verify:package', 'pnpm verify:installation'];
    if (os !== 'Windows') required.push('pnpm verify:formats');
    if (os === 'Linux') required.push('scripts/packaging/verify-rpm.sh');
    for (const command of required)
      assert(commands.includes(command), `Missing native acceptance on ${target}: ${command}`);
    assert(!commands.includes('--process-only'), `Full acceptance narrowed on ${target}`);
    assert.equal(interpolate(workflow.jobs.native.name, context), `Native (${target})`);
  }
  assert.equal(interpolate(workflow.jobs.acceptance.name), 'Native acceptance');
  assert(!JSON.stringify(workflow).includes('continue-on-error'));
}

function processCoverage(workflow) {
  for (const [target, config] of Object.entries(targets)) {
    const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[config.platform];
    const context = {
      github: {
        event_name: 'workflow_dispatch',
        event: { pull_request: {} },
        workflow: 'CI',
        ref: 'refs/heads/test',
      },
      inputs: { acceptance_scope: 'process' },
      runner: { os },
      matrix: { target },
    };
    const steps = nativeSteps(workflow, context);
    const commands = steps.map((step) => interpolate(step.run || '', context)).join('\n');
    for (const command of [
      'pnpm check',
      'pnpm test:workflows',
      'pnpm test:process',
      `pnpm package -- --target=${target}`,
      `pnpm verify:package -- --target=${target} --process-only`,
    ])
      assert(
        commands.includes(command),
        `Missing task process acceptance on ${target}: ${command}`,
      );
    for (const command of [
      /^pnpm test$/m,
      /pnpm test:(release|storage|credentials|updates|electron)/,
      /pnpm dist|pnpm verify:(installation|formats)|scripts\/verify-rpm\.sh/,
    ])
      assert(!command.test(commands), `Unrelated full acceptance in process scope on ${target}`);
    assert(steps.some((step) => step.uses === './.github/actions/setup-dependencies'));
    assert(steps.some((step) => step.uses?.startsWith('browser-actions/setup-chrome@')));
    assert.equal(interpolate(workflow.jobs.native.name, context), `Task process (${target})`);
    assert.equal(interpolate(workflow.jobs.acceptance.name, context), 'Task process acceptance');
    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(interpolate(upload.with.name, context), `task-process-${target}`);
    const processGroup = interpolate(workflow.concurrency.group, context);
    const fullGroup = interpolate(workflow.concurrency.group, { ...context, inputs: {} });
    assert.notEqual(processGroup, fullGroup, 'Process acceptance must not cancel full acceptance');
  }
  assert(!JSON.stringify(workflow).includes('secrets.'));
}

function storeSelection(action) {
  const steps = action.runs.steps;
  const selection = steps.findIndex((step) => step.run?.includes('PNPM_CONFIG_STORE_DIR'));
  const cache = steps.findIndex((step) => step.uses?.startsWith('actions/cache@'));
  const install = steps.findIndex((step) => step.run === 'pnpm install --frozen-lockfile');
  assert(
    selection >= 0 && cache > selection && install > cache,
    'Shared store must be exported before cache and install',
  );
  const assignment = /^echo "PNPM_CONFIG_STORE_DIR=(.+)" >> "\$GITHUB_ENV"$/.exec(
    steps[selection].run,
  );
  assert(assignment, 'Shared store must reach later steps through GITHUB_ENV');
  assert.equal(assignment[1].replace('$RUNNER_TEMP', '${{ runner.temp }}'), steps[cache].with.path);
}

test('both workflows cover the release targets on matching native runners', () => {
  completeMatrix(ci, 'native');
  completeMatrix(release, 'candidate');
  assert.deepEqual(ci.jobs.native.strategy.matrix, release.jobs.candidate.strategy.matrix);
  assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(ci.on.push, { branches: ['main'] });
  assert.equal(ci.on.pull_request, null);
  assert.deepEqual(ci.on.workflow_dispatch.inputs.acceptance_scope, {
    description: 'Native acceptance scope',
    type: 'choice',
    options: ['full', 'process'],
    default: 'full',
  });
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.equal(release.concurrency['cancel-in-progress'], false);
  nativeCoverage(ci);
});

test('explicit process acceptance has separate checks and only the source and fused process gates', () => {
  completeMatrix(ci, 'native');
  processCoverage(ci);
});

test('push, pull request and default dispatch retain every full acceptance gate', () => {
  for (const event_name of ['push', 'pull_request', 'workflow_dispatch']) {
    for (const inputs of [
      {},
      { acceptance_scope: 'full' },
      ...(event_name === 'workflow_dispatch' ? [] : [{ acceptance_scope: 'process' }]),
    ]) {
      const context = { github: { event_name }, inputs };
      assert.equal(interpolate(ci.jobs.acceptance.name, context), 'Native acceptance');
      for (const [target, config] of Object.entries(targets)) {
        const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[config.platform];
        const commands = nativeSteps(ci, { ...context, runner: { os } })
          .map((step) => step.run || '')
          .join('\n');
        for (const command of manifest.scripts.verify.split(' && '))
          assert(commands.includes(command), `${event_name} is missing ${command} on ${target}`);
        assert(commands.includes('pnpm dist'));
        assert(commands.includes('pnpm verify:package'));
        assert(commands.includes('pnpm verify:installation'));
        assert(!commands.includes('--process-only'));
      }
    }
  }
});

test('acceptance fails for failed, cancelled or skipped native matrices', () => {
  const gate = ci.jobs.acceptance;
  assert.equal(gate.needs, 'native');
  assert.equal(gate.if, 'always()');
  const step = gate.steps[0];
  for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
    const value = evaluate(step.env.NATIVE_RESULT, { needs: { native: { result } } });
    const run = spawnSync(
      process.execPath,
      ['-e', /^node -e "([^"]+)"$/.exec(step.run.trim())[1]],
      {
        env: { ...process.env, NATIVE_RESULT: value },
      },
    );
    assert.ifError(run.error);
    assert.equal(run.status === 0, result === 'success', result);
  }
});

test('production preflight precedes composite dependency installation', () =>
  preflightBeforeInstall(release));
test('signing values stay in the correct mode, platform and steps', () => {
  assert(!JSON.stringify(ci).includes('secrets.'));
  assert(!JSON.stringify(setup).includes('secrets.'));
  signingScope(release);
});

test('bootstrap reads repository pins and caches only the shared pnpm store', () => {
  storeSelection(setup);
  const pnpm = setup.runs.steps.find((step) => step.uses?.startsWith('pnpm/action-setup@'));
  assert.equal(pnpm.with.version, undefined);
  assert.equal(pnpm.with.run_install, false);
  assert(setup.runs.steps.some((step) => step.run === 'pnpm install --frozen-lockfile'));
  const cache = setup.runs.steps.find((step) => step.uses?.startsWith('actions/cache@'));
  assert.equal(cache.with.path, '${{ runner.temp }}/pnpm-store');
  assert.equal(cache.with['restore-keys'], undefined);
  for (const key of ['runner.os', 'runner.arch', '.node-version', 'package.json', 'pnpm-lock.yaml'])
    assert(cache.with.key.includes(key));
  for (const workflow of [ci, release]) {
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps || []);
    for (const step of steps.filter((item) => item.uses?.startsWith('actions/setup-node@')))
      assert.equal(step.with['node-version-file'], '.node-version');
    for (const step of steps.filter((item) => item.uses?.startsWith('actions/checkout@')))
      assert.equal(step.with['persist-credentials'], false);
  }
});

test('the pinned pnpm selects the same store in checkout and isolated source copy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-2d-store-'));
  try {
    for (const file of ['package.json', 'pnpm-workspace.yaml', '.npmrc', 'pnpm-lock.yaml'])
      copyFileSync(new URL(`../../${file}`, import.meta.url), join(directory, file));
    const executable = process.env.npm_execpath || 'pnpm';
    const command = /\.[cm]?js$/.test(executable) ? process.execPath : executable;
    const prefix = command === process.execPath ? [executable] : [];
    const env = { ...process.env, PNPM_CONFIG_STORE_DIR: join(directory, 'store') };
    const paths = [process.cwd(), directory].map((cwd) => {
      const child = spawnSync(command, [...prefix, 'store', 'path', '--silent'], {
        cwd,
        env,
        encoding: 'utf8',
      });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr);
      return resolve(child.stdout.trim());
    });
    assert.equal(paths[0], paths[1]);
    assert(paths[0].startsWith(resolve(env.PNPM_CONFIG_STORE_DIR)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('candidate upload includes formats, provenance and notarization but no receipt', () => {
  const upload = release.jobs.candidate.steps.find((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  const patterns = upload.with.path.trim().split('\n');
  const included = (path) => patterns.some((pattern) => matchesGlob(path, pattern));
  for (const [target, config] of Object.entries(targets)) {
    const directory = `release/production/test/${target}`;
    for (const extension of config.extensions) assert(included(`${directory}/app${extension}`));
    for (const name of ['build-context.json', 'artifact-inventory.json', config.metadata])
      assert(included(`${directory}/${name}`));
    assert(!included(`${directory}/release-receipt.json`));
  }
  assert(included('release/production/test/mac-x64/notarization.json'));
  assert(included('release/production/test/win-x64/win-unpacked/browser-2d.exe'));
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.deepEqual(ci.permissions, { contents: 'read' });
  assert.deepEqual(release.permissions, { contents: 'read' });
});

test('policy rejects missing coverage, late preflight and leaked signing scope', () => {
  const missingTarget = structuredClone(ci);
  missingTarget.jobs.native.strategy.matrix.include.pop();
  assert.throws(() => completeMatrix(missingTarget, 'native'), assert.AssertionError);
  const missingVerifier = structuredClone(ci);
  missingVerifier.jobs.native.steps = missingVerifier.jobs.native.steps.filter(
    (step) => !step.run?.includes('pnpm verify:formats'),
  );
  assert.throws(() => nativeCoverage(missingVerifier), /Missing native acceptance/);
  const skipped = structuredClone(ci);
  skipped.jobs.native.steps.find((step) => step.run?.includes('pnpm verify:package')).if = 'false';
  assert.throws(() => nativeCoverage(skipped), /Missing native acceptance/);
  const missingProcessProof = structuredClone(ci);
  missingProcessProof.jobs.native.steps = missingProcessProof.jobs.native.steps.filter(
    (step) => !step.run?.includes('--process-only'),
  );
  assert.throws(() => processCoverage(missingProcessProof), /Missing task process acceptance/);
  const reusedCheck = structuredClone(ci);
  reusedCheck.jobs.acceptance.name = 'Native acceptance';
  assert.throws(() => processCoverage(reusedCheck), assert.AssertionError);
  const narrowedFull = structuredClone(ci);
  narrowedFull.jobs.native.steps.find((step) => step.run?.includes('--process-only')).if =
    undefined;
  assert.throws(() => nativeCoverage(narrowedFull), /Full acceptance narrowed/);
  const noStore = structuredClone(setup);
  noStore.runs.steps = noStore.runs.steps.filter(
    (step) => !step.run?.includes('PNPM_CONFIG_STORE_DIR'),
  );
  assert.throws(() => storeSelection(noStore), /Shared store must be exported/);
  const late = structuredClone(release);
  const steps = late.jobs.candidate.steps;
  const index = steps.findIndex((step) => step.run?.includes('release-preflight.mjs'));
  steps.push(...steps.splice(index, 1));
  assert.throws(() => preflightBeforeInstall(late), /Preflight must precede/);
  const leaked = structuredClone(release);
  leaked.jobs.candidate.env.CSC_LINK = '${{ secrets.WINDOWS_CSC_LINK }}';
  assert.throws(() => signingScope(leaked), assert.AssertionError);
  const fallback = structuredClone(release);
  const step = fallback.jobs.candidate.steps.find((item) => item.env?.CSC_LINK);
  step.env.CSC_LINK =
    "${{ startsWith(matrix.target, 'mac-') && secrets.MAC_CSC_LINK || secrets.WINDOWS_CSC_LINK }}";
  assert.throws(() => signingScope(fallback), assert.AssertionError);
});
