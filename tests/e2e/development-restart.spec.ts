import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { absent, developer } from './development-helper';

test('real source rebuild preserves the old worker on build failure and replaces only after clean exit', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo);
  let closed = false;
  try {
    const first = await dev.page();
    const oldPid = Number(await first.page.getByTestId('worker-pid').textContent());
    await writeFile(dev.source, `${dev.original}\nconst = invalid syntax;\n`);
    await expect.poll(() => dev.output(), { timeout: 30_000 }).toContain('exited 1');
    expect(absent(oldPid)).toBe(false);
    await expect(first.page.getByTestId('worker-pid')).toHaveText(String(oldPid));
    await first.page.getByTestId('task-new').click();
    await first.page.getByTestId('create-fixture-device').click();
    await expect(first.page.getByTestId('start-run')).toBeEnabled();
    await first.page.getByTestId('start-run').click();
    await expect(first.page.getByTestId('run-table')).toContainText('运行中');
    await writeFile(dev.source, dev.original);
    const replacement = await dev.page(first.port);
    expect(absent(oldPid)).toBe(true);
    expect(Number(await replacement.page.getByTestId('worker-pid').textContent())).not.toBe(oldPid);
    const state = await replacement.page.evaluate(async () => window.browser2d?.work.getSnapshot());
    expect(state?.ok && state.value.runs.length).toBe(1);
    expect(
      state?.ok && state.value.runs.every((run) => ['completed', 'cancelled'].includes(run.state)),
    ).toBe(true);
    expect(state?.ok && state.value.resources).toEqual([]);
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});

test('development restart refuses to replace an unresponsive predecessor after forced shutdown', async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(
    process.platform === 'win32',
    'Portable uncooperative execution is covered in scheduler.spec; this case suspends the entire POSIX worker',
  );
  test.setTimeout(120_000);
  const dev = await developer(testInfo);
  let pid: number | undefined;
  let closed = false;
  try {
    const initial = await dev.page();
    pid = Number(await initial.page.getByTestId('worker-pid').textContent());
    process.kill(pid, 'SIGSTOP');
    await writeFile(dev.source, `${dev.original}\n`);
    await expect
      .poll(() => dev.output(), { timeout: 30_000 })
      .toContain('Development shutdown exited 1');
    expect(absent(pid)).toBe(true);
    const port = (await readFile(join(dev.directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    expect(port).toBe(initial.port);
    expect(await readdir(join(dev.directory, 'worker-owners'))).toEqual([]);
    expect(await dev.close()).toBe(1);
    closed = true;
  } finally {
    if (pid && !absent(pid)) process.kill(pid, 'SIGKILL');
    if (!closed) await dev.close();
  }
});

test('shared TypeScript preset changes restart only after the previous worker exits', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo, 'internal/tsconfig/base.json');
  let closed = false;
  try {
    const first = await dev.page();
    const previousPid = Number(await first.page.getByTestId('worker-pid').textContent());
    await writeFile(dev.source, `${dev.original}\n`);
    const replacement = await dev.page(first.port);
    expect(absent(previousPid)).toBe(true);
    expect(Number(await replacement.page.getByTestId('worker-pid').textContent())).not.toBe(
      previousPid,
    );
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});

test('renderer preset changes reach the live page after coordinated restart', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo, 'internal/build-config/index.mjs');
  let closed = false;
  try {
    const first = await dev.page();
    const previousPid = Number(await first.page.getByTestId('worker-pid').textContent());
    await expect(first.page.locator('meta[name="development-config-proof"]')).toHaveCount(0);
    expect(dev.original).toContain('plugins: [');
    await writeFile(
      dev.source,
      dev.original.replace(
        'plugins: [',
        `plugins: [{
      name: 'development-config-proof',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'development-config-proof', content: 'changed' }, injectTo: 'head' }],
    }, `,
      ),
    );
    const replacement = await dev.page(first.port);
    await expect(replacement.page.locator('meta[name="development-config-proof"]')).toHaveAttribute(
      'content',
      'changed',
    );
    expect(absent(previousPid)).toBe(true);
    expect(Number(await replacement.page.getByTestId('worker-pid').textContent())).not.toBe(
      previousPid,
    );
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});
