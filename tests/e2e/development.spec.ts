import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { absent, developer } from './development-helper';
async function owner(directory: string) {
  const folder = join(directory, 'data', 'data-service-owners');
  const files = await readdir(folder);
  expect(files).toHaveLength(1);
  const path = files[0];
  if (!path) throw new Error('No DataService ownership record');
  const raw: unknown = JSON.parse(await readFile(join(folder, path), 'utf8'));
  if (!raw || typeof raw !== 'object' || !('pid' in raw) || typeof raw.pid !== 'number')
    throw new Error('No DataService PID');
  return raw.pid;
}
test('renderer HMR preserves the DataService and database, and backend rebuild waits for clean shutdown', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo);
  const stylePath = 'apps/ui/src/assets/styles/main.css';
  const style = await readFile(stylePath, 'utf8');
  let closed = false;
  try {
    const first = await dev.page();
    const oldPid = await owner(dev.directory);
    const created = await first.page.evaluate(async () =>
      window.browser2d?.browsers.create({
        provider: 'adspower',
        profileId: 'development-persist',
        name: 'Before restart',
        account: '0001',
        amount: '1.23',
        notes: '',
      }),
    );
    expect(created?.ok).toBe(true);
    await writeFile(stylePath, `${style}\n:root { --s6-hmr-proof: changed; }\n`);
    await expect
      .poll(() =>
        first.page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--s6-hmr-proof').trim(),
        ),
      )
      .toBe('changed');
    expect(await owner(dev.directory)).toBe(oldPid);
    expect(absent(oldPid)).toBe(false);
    await writeFile(dev.source, `${dev.original}\nconst = invalid syntax;\n`);
    await expect.poll(() => dev.output(), { timeout: 30_000 }).toContain('exited 1');
    expect(absent(oldPid)).toBe(false);
    const retained = await first.page.evaluate(async () => window.browser2d?.browsers.list());
    expect(retained).toMatchObject({ ok: true, value: [{ name: 'Before restart' }] });
    expect(dev.original).toContain('.map(readBrowser)');
    await writeFile(
      dev.source,
      dev.original.replace(
        '.map(readBrowser)',
        ".map(readBrowser).map((row) => ({ ...row, name: row.name + ' restarted' }))",
      ),
    );
    const replacement = await dev.page(first.port);
    expect(absent(oldPid)).toBe(true);
    expect(await owner(dev.directory)).not.toBe(oldPid);
    const restored = await replacement.page.evaluate(async () => window.browser2d?.browsers.list());
    expect(restored).toMatchObject({
      ok: true,
      value: [
        {
          profileId: 'development-persist',
          name: 'Before restart restarted',
          account: '0001',
          amount: '1.23',
        },
      ],
    });
    await writeFile(stylePath, style);
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    await writeFile(stylePath, style);
    if (!closed) await dev.close();
  }
});
for (const source of ['internal/tsconfig/base.json', 'internal/build-config/index.mjs']) {
  test(`shared preset ${source} replaces the app only after DataService exit`, async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(120_000);
    const dev = await developer(testInfo, source);
    let closed = false;
    try {
      const first = await dev.page();
      const pid = await owner(dev.directory);
      const next = source.endsWith('.mjs')
        ? dev.original.replace(
            'plugins: [',
            "plugins: [{ name: 'development-proof', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'development-proof', content: 'changed' }, injectTo: 'head' }] }, ",
          )
        : `${dev.original}\n`;
      await writeFile(dev.source, next);
      const replacement = await dev.page(first.port);
      expect(absent(pid)).toBe(true);
      expect(await owner(dev.directory)).not.toBe(pid);
      if (source.endsWith('.mjs'))
        await expect(replacement.page.locator('meta[name="development-proof"]')).toHaveAttribute(
          'content',
          'changed',
        );
      expect(await dev.close()).toBe(0);
      closed = true;
      expect(
        dev.output().match(/pnpm --filter @browser-2d\/backend build/g),
        'One preset edit should trigger one replacement build',
      ).toHaveLength(2);
    } finally {
      if (!closed) await dev.close();
    }
  });
}

test('a nonzero predecessor exit refuses replacement on every rebuild', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo);
  let closed = false;
  try {
    const first = await dev.page();
    const pid = await owner(dev.directory);
    dev.failStop();
    await writeFile(dev.source, `${dev.original}\n`);
    await expect
      .poll(() => dev.output(), { timeout: 45_000 })
      .toContain('Development shutdown exited 23');
    expect(absent(pid)).toBe(true);
    const firstFailure = dev.output().length;
    await writeFile(dev.source, `${dev.original}\n\n`);
    await expect
      .poll(() => dev.output().slice(firstFailure), { timeout: 45_000 })
      .toContain('Previous application exited 23');
    expect((await readFile(join(dev.directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]).toBe(
      first.port,
    );
    expect(await readdir(join(dev.directory, 'data', 'data-service-owners'))).toHaveLength(0);
    expect(await dev.close()).toBe(1);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});
