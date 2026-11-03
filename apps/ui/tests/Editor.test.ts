import { mount } from '@vue/test-utils';
import { ElMessageBox, type MessageBoxData, type MessageBoxInputData } from 'element-plus';
import { defineComponent, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDraftEditor } from '../src/composables/useDraftEditor';

function fixture() {
  let editor: ReturnType<typeof useDraftEditor<never, { text: string }>> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useDraftEditor<never, { text: string }>();
        return () => null;
      },
    }),
  );
  if (!editor) throw new Error('Editor missing');
  return { editor, wrapper };
}
afterEach(() => vi.restoreAllMocks());

describe('guarded editor lifecycle', () => {
  it('keeps a cancelled draft and arbitrates replacement and close through one pending decision', async () => {
    const { editor, wrapper } = fixture();
    const draft = reactive({ text: '' });
    await editor.replace({ kind: 'create', draft });
    draft.text = 'unsaved';
    let reject: (reason: Error) => void = () => {};
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const close = editor.leave();
    expect(await editor.replace({ kind: 'create', draft: reactive({ text: 'other' }) })).toBe(
      false,
    );
    expect(await editor.leave()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    reject(new Error('cancel'));
    expect(await close).toBe(false);
    expect(editor.session.value).toMatchObject({ kind: 'create', draft: { text: 'unsaved' } });
    confirm.mockResolvedValue(
      Object.assign('confirm', { value: '', action: 'confirm' } satisfies MessageBoxInputData),
    );
    expect(await editor.replace({ kind: 'create', draft: reactive({ text: 'replacement' }) })).toBe(
      true,
    );
    expect(editor.dirty.value).toBe(false);
    expect(await editor.leave()).toBe(true);
    wrapper.unmount();
  });

  it('blocks closing, replacement and duplicate saves until a failed save settles and retains the draft', async () => {
    const { editor, wrapper } = fixture();
    const draft = reactive({ text: 'initial' });
    await editor.replace({ kind: 'create', draft });
    draft.text = 'changed';
    let settle: (value: boolean) => void = () => {};
    const work = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    const saving = editor.save(work);
    expect(await editor.leave()).toBe(false);
    expect(await editor.replace({ kind: 'create', draft: reactive({ text: '' }) })).toBe(false);
    await editor.save(work);
    expect(work).toHaveBeenCalledOnce();
    settle(false);
    await saving;
    expect(editor.dirty.value).toBe(true);
    expect(editor.session.value).toMatchObject({ draft: { text: 'changed' } });
    await editor.save(async () => true);
    expect(editor.session.value.kind).toBe('closed');
    wrapper.unmount();
  });

  it('does not apply a stale discard after unmount', async () => {
    const { editor, wrapper } = fixture();
    const draft = reactive({ text: '' });
    await editor.replace({ kind: 'create', draft });
    draft.text = 'changed';
    let confirm: (value: MessageBoxData) => void = () => {};
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const replacement = editor.replace({ kind: 'create', draft: reactive({ text: 'stale' }) });
    wrapper.unmount();
    confirm(
      Object.assign('confirm', { value: '', action: 'confirm' } satisfies MessageBoxInputData),
    );
    expect(await replacement).toBe(false);
    expect(editor.session.value).toMatchObject({ draft: { text: 'changed' } });
  });
});

it('protects unload while dirty or saving and releases the warning after an acknowledged inline save', async () => {
  const { editor, wrapper } = fixture();
  const draft = reactive({ text: 'initial' });
  await editor.replace({ kind: 'create', draft });
  const clean = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  draft.text = 'changed';
  const dirty = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  editor.markSaved();
  expect(editor.dirty.value).toBe(false);
  const acknowledged = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(acknowledged);
  expect(acknowledged.defaultPrevented).toBe(false);
  let finish: (value: boolean) => void = () => {};
  const save = editor.save(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(saving);
  expect(saving.defaultPrevented).toBe(true);
  finish(false);
  await save;
  wrapper.unmount();
  const unmounted = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(unmounted);
  expect(unmounted.defaultPrevented).toBe(false);
});

it('arbitrates drawer closure through the discard decision and calls done only when accepted', async () => {
  const { editor, wrapper } = fixture();
  const draft = reactive({ text: 'initial' });
  await editor.replace({ kind: 'create', draft });
  draft.text = 'changed';
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel');
  const done = vi.fn();
  editor.beforeClose(done);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done).not.toHaveBeenCalled();
  expect(editor.dirty.value).toBe(true);
  confirm.mockResolvedValue(
    Object.assign('confirm', { value: '', action: 'confirm' } satisfies MessageBoxInputData),
  );
  editor.beforeClose(done);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done).toHaveBeenCalledOnce();
  expect(editor.session.value.kind).toBe('closed');
  wrapper.unmount();
});
