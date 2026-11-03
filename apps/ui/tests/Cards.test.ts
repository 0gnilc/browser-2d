import { createPinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox, type MessageBoxInputData } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardImportReportSchema, failure, type Browser2dApi } from '@browser-2d/contracts/public';
import CardsPage from '../src/views/cards/CardsPage.vue';
import CardImport from '../src/views/cards/CardImport.vue';
import CardEditor from '../src/views/cards/CardEditor.vue';
import { desktopApiKey } from '../src/platform/desktop-api';
import { card, createTestApi } from './helpers';

const sourceText =
  ' 0001  2345-6789 | 02 | 29 | 012 |测试 姓名|12  Main St|城市|省份|00123|CN|扩展 文本\n';
const report = cardImportReportSchema.parse({
  outcome: 'complete',
  inserted: 1,
  duplicates: 0,
  invalid: 0,
  blank: 1,
  lines: [
    { line: 1, kind: 'inserted', cardId: card.id },
    { line: 2, kind: 'blank' },
  ],
  unprocessedFromLine: null,
  message: '',
});
function field(id: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!input) throw new Error(`Missing ${id}`);
  return input;
}
async function input(id: string, value: string) {
  const element = field(id);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}
async function click(testId: string) {
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
  await flushPromises();
}
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Card table and queries', () => {
  it('renders all Card values in plaintext with raw whitespace in the cell and accessible label', async () => {
    const test = createTestApi();
    const wrapper = mount(CardsPage, {
      attachTo: document.body,
      global: { plugins: [createPinia()], provide: { [desktopApiKey]: test.api } },
    });
    await flushPromises();
    for (const value of [
      card.number,
      card.expiryMonth,
      card.expiryYear,
      card.securityCode,
      card.cardholderName,
      card.billingAddress,
      card.billingCity,
      card.billingRegion,
      card.billingPostalCode,
      card.billingCountryCode,
      card.extra,
      card.notes,
      card.amount,
      card.createdAt,
      card.updatedAt,
      '验证成功',
      '页面已打开',
      '百度',
    ])
      expect(wrapper.element.textContent).toContain(value);
    const number = wrapper
      .findAll('.raw-value')
      .find((element) => element.attributes('aria-label') === card.number);
    expect(number?.element.textContent).toBe('0001  2345-6789');
    expect(number?.attributes('title')).toBe(card.number);
    expect(wrapper.get('[data-testid="cards-table"]').classes()).toContain('el-table--border');
    expect(wrapper.text()).not.toContain('新增卡');
    wrapper.unmount();
  });

  it('retains the applied search across ascending pages and resets the page for a new filter', async () => {
    const test = createTestApi();
    test.api.cards.list = vi.fn<Browser2dApi['cards']['list']>(async (query) => ({
      ok: true,
      value: { items: [card], total: 61, page: query.page, pageSize: query.pageSize },
    }));
    const wrapper = mount(CardsPage, {
      attachTo: document.body,
      global: { provide: { [desktopApiKey]: test.api } },
    });
    await flushPromises();
    await wrapper.get('input[aria-label="搜索卡"]').setValue('0001  ');
    await wrapper.get('[data-testid="card-filter"]').trigger('click');
    await flushPromises();
    const page2 = wrapper.findAll('.el-pager li').find((page) => page.text() === '2');
    if (!page2) throw new Error('Page 2 missing');
    await page2.trigger('click');
    await flushPromises();
    expect(test.api.cards.list).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
      search: '0001  ',
    });
    await wrapper.get('input[aria-label="搜索卡"]').setValue('姓名');
    await wrapper.get('[data-testid="card-filter"]').trigger('click');
    await flushPromises();
    expect(test.api.cards.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, search: '姓名' });
    expect(wrapper.text()).toContain('升序');
    wrapper.unmount();
  });
});

describe('one import protocol', () => {
  it('sends textarea and decoded UTF-8 TXT through the same API and retains text after the committed report', async () => {
    const test = createTestApi();
    test.api.cards.importText = vi.fn<Browser2dApi['cards']['importText']>(async () => ({
      ok: true,
      value: report,
    }));
    const wrapper = mount(CardImport, {
      attachTo: document.body,
      global: { provide: { [desktopApiKey]: test.api } },
    });
    await wrapper.vm.open();
    await flushPromises();
    await input('card-import-text', sourceText);
    await click('card-import-submit');
    expect(test.api.cards.importText).toHaveBeenLastCalledWith({ text: sourceText });
    expect(field('card-import-text').value).toBe(sourceText);
    expect(document.body.textContent).toContain('已插入 1');
    const file = new File([], 'cards.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('\ufeff' + sourceText).buffer,
    });
    const fileInput = field('card-import-file');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    await click('card-import-submit');
    expect(test.api.cards.importText).toHaveBeenLastCalledWith({ text: sourceText });
    expect(test.api.cards.importText).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain(
      'number|month|year|security_code|cardholder_name|address|city|region|postal_code|country_code|extra',
    );
    wrapper.unmount();
  });

  it.each(['edit', 'submit'])('invalidates a delayed TXT read on a newer %s', async (action) => {
    const test = createTestApi();
    let finishImport: () => void = () => {};
    test.api.cards.importText = vi.fn<Browser2dApi['cards']['importText']>(
      () =>
        new Promise((resolve) => {
          finishImport = () => resolve({ ok: true, value: report });
        }),
    );
    const wrapper = mount(CardImport, {
      attachTo: document.body,
      global: { provide: { [desktopApiKey]: test.api } },
    });
    await wrapper.vm.open();
    await flushPromises();
    await input('card-import-text', sourceText);
    let finishFile: (bytes: ArrayBuffer) => void = () => {};
    const file = new File([], 'delayed.txt');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishFile = resolve;
        }),
    });
    const fileInput = field('card-import-file');
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    const expectedText = action === 'edit' ? sourceText + 'new draft' : sourceText;
    if (action === 'edit') await input('card-import-text', expectedText);
    else await click('card-import-submit');
    finishFile(new TextEncoder().encode('old file contents').buffer);
    await flushPromises();
    expect(field('card-import-text').value).toBe(expectedText);
    if (action === 'submit') {
      expect(test.api.cards.importText).toHaveBeenCalledWith({ text: expectedText });
      finishImport();
      await flushPromises();
      expect(field('card-import-text').value).toBe(expectedText);
      expect(document.body.textContent).toContain('已插入 1');
    }
    wrapper.unmount();
  });

  it('reports a known partial commit by original line and preserves the retry text', async () => {
    const test = createTestApi();
    const partial = cardImportReportSchema.parse({
      ...report,
      outcome: 'partial',
      unprocessedFromLine: 3,
      message: '后续批次未提交',
    });
    test.api.cards.importText = async () => ({ ok: true, value: partial });
    const wrapper = mount(CardImport, {
      attachTo: document.body,
      global: { provide: { [desktopApiKey]: test.api } },
    });
    await wrapper.vm.open();
    await flushPromises();
    await input('card-import-text', sourceText);
    await click('card-import-submit');
    expect(document.body.textContent).toContain('部分导入已提交');
    expect(document.body.textContent).toContain('从原始第 3 行起尚未处理');
    expect(document.body.textContent).toContain('原始行号');
    expect(field('card-import-text').value).toBe(sourceText);
    wrapper.unmount();
  });

  it('describes transport loss as unknown progress instead of an invented zero report', async () => {
    const test = createTestApi();
    test.api.cards.importText = async () => {
      throw new Error('private transport');
    };
    const wrapper = mount(CardImport, {
      attachTo: document.body,
      global: { provide: { [desktopApiKey]: test.api } },
    });
    await wrapper.vm.open();
    await flushPromises();
    await input('card-import-text', sourceText);
    await click('card-import-submit');
    expect(document.body.textContent).toContain('导入进度未知');
    expect(document.body.textContent).not.toContain('已插入 0');
    expect(document.body.textContent).not.toContain('private transport');
    expect(field('card-import-text').value).toBe(sourceText);
    wrapper.unmount();
  });

  it('rejects invalid UTF-8 without replacing an existing draft or importing', async () => {
    const test = createTestApi();
    test.api.cards.importText = vi.fn(test.api.cards.importText);
    const wrapper = mount(CardImport, {
      attachTo: document.body,
      global: { provide: { [desktopApiKey]: test.api } },
    });
    await wrapper.vm.open();
    await flushPromises();
    await input('card-import-text', 'existing draft');
    const file = new File([], 'bad.txt');
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array([0xff]).buffer,
    });
    const fileInput = field('card-import-file');
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    expect(field('card-import-text').value).toBe('existing draft');
    expect(document.body.textContent).toContain('不是有效的 UTF-8');
    expect(test.api.cards.importText).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

it('sends only changed ordinary fields and handles receipt locks without exposing amount or state inputs', async () => {
  const test = createTestApi();
  test.api.cards.update = vi
    .fn<Browser2dApi['cards']['update']>()
    .mockResolvedValueOnce(failure('CONFLICT', '输入已有处理凭证', 'INPUT_LOCKED'))
    .mockResolvedValue({ ok: true, value: { ...card, notes: 'new note' } });
  const wrapper = mount(CardEditor, {
    attachTo: document.body,
    global: { provide: { [desktopApiKey]: test.api } },
  });
  await wrapper.vm.open(card);
  await flushPromises();
  expect(document.querySelector('#card-amount')).toBeNull();
  expect(document.querySelector('#card-status')).toBeNull();
  await input('card-number', '0001  changed');
  await input('card-notes', 'new note');
  await click('card-save');
  expect(test.api.cards.update).toHaveBeenCalledWith({
    id: card.id,
    number: '0001  changed',
    notes: 'new note',
  });
  expect(field('card-number').value).toBe('0001  changed');
  expect(field('card-number').disabled).toBe(true);
  const restore = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('保留备注并恢复原始输入'),
  );
  restore?.click();
  await flushPromises();
  await click('card-save');
  expect(test.api.cards.update).toHaveBeenLastCalledWith({ id: card.id, notes: 'new note' });
  wrapper.unmount();
});

it('requires confirmation before deleting a Card and reports a rejected deletion', async () => {
  const test = createTestApi();
  test.api.cards.remove = vi.fn(async () => failure('CONFLICT', '卡正在领取', 'ACTIVE_CLAIM'));
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel');
  const wrapper = mount(CardsPage, {
    attachTo: document.body,
    global: { provide: { [desktopApiKey]: test.api } },
  });
  await flushPromises();
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === '删除');
  if (!button) throw new Error('Delete button missing');
  await button.trigger('click');
  await flushPromises();
  expect(test.api.cards.remove).not.toHaveBeenCalled();
  confirm.mockResolvedValueOnce(
    Object.assign('confirm', { value: '', action: 'confirm' } satisfies MessageBoxInputData),
  );
  await button.trigger('click');
  await flushPromises();
  expect(test.api.cards.remove).toHaveBeenCalledWith({ id: card.id });
  expect(wrapper.text()).toContain('卡正在领取');
  wrapper.unmount();
});

it('uses the actual inputLocked projection while preserving unclaimed notes editing', async () => {
  const test = createTestApi();
  const wrapper = mount(CardEditor, {
    attachTo: document.body,
    global: { provide: { [desktopApiKey]: test.api } },
  });
  await wrapper.vm.open({ ...card, inputLocked: true });
  await flushPromises();
  expect(field('card-number').disabled).toBe(true);
  expect(field('card-securityCode').disabled).toBe(true);
  expect(field('card-notes').disabled).toBe(false);
  await wrapper.vm.open({ ...card, status: 'processing', inputLocked: true });
  await flushPromises();
  expect(field('card-notes').disabled).toBe(true);
  wrapper.unmount();
});

it('fences an older TXT read when a newer selection has already populated the draft', async () => {
  const test = createTestApi();
  const wrapper = mount(CardImport, {
    attachTo: document.body,
    global: { provide: { [desktopApiKey]: test.api } },
  });
  await wrapper.vm.open();
  await flushPromises();
  let finishOld: (value: ArrayBuffer) => void = () => {};
  const old = new File([], 'old.txt');
  Object.defineProperty(old, 'arrayBuffer', {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finishOld = resolve;
      }),
  });
  const next = new File([], 'next.txt');
  Object.defineProperty(next, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('new selection').buffer,
  });
  const fileInput = field('card-import-file');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [old] });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flushPromises();
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [next] });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flushPromises();
  finishOld(new TextEncoder().encode('old selection').buffer);
  await flushPromises();
  expect(field('card-import-text').value).toBe('new selection');
  wrapper.unmount();
});

it('fences a delayed UTF-8 failure after the drawer closes and reopens', async () => {
  const test = createTestApi();
  const wrapper = mount(CardImport, {
    attachTo: document.body,
    global: { provide: { [desktopApiKey]: test.api } },
  });
  await wrapper.vm.open();
  await flushPromises();
  let finishFile: (bytes: ArrayBuffer) => void = () => {};
  const file = new File([], 'delayed.txt');
  Object.defineProperty(file, 'arrayBuffer', {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finishFile = resolve;
      }),
  });
  const fileInput = field('card-import-file');
  Object.defineProperty(fileInput, 'files', { value: [file] });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await flushPromises();
  const close = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '关闭',
  );
  if (!close) throw new Error('Close button missing');
  close.click();
  await flushPromises();
  await wrapper.vm.open();
  await flushPromises();
  await input('card-import-text', sourceText);
  finishFile(new Uint8Array([0xff]).buffer);
  await flushPromises();
  expect(field('card-import-text').value).toBe(sourceText);
  expect(document.body.textContent).not.toContain('不是有效的 UTF-8');
  wrapper.unmount();
});
