import { mount } from '@vue/test-utils';
import { ElMessageBox, type MessageBoxData, type MessageBoxInputData } from 'element-plus';
import { defineComponent, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../src/business/useEditor';

function fixture() {
  let editor: ReturnType<typeof useEditor<never, { text: string }>> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useEditor<never, { text: string }>();
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
