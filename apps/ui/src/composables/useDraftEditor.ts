import { computed, inject, onBeforeUnmount, onMounted, shallowRef, ref } from 'vue';
import { onBeforeRouteLeave, routerKey } from 'vue-router';
import { ElMessageBox } from 'element-plus';

type OpenSession<Row, Draft> =
  { kind: 'create'; draft: Draft } | { kind: 'edit'; original: Row; draft: Draft };
type Session<Row, Draft> = { kind: 'closed' } | OpenSession<Row, Draft>;

export function useDraftEditor<Row, Draft>() {
  const session = shallowRef<Session<Row, Draft>>({ kind: 'closed' });
  const saving = ref(false);
  const deciding = ref(false);
  const baseline = ref('');
  let disposed = false;
  const dirty = computed(
    () => session.value.kind !== 'closed' && JSON.stringify(session.value.draft) !== baseline.value,
  );
  async function transition(next: Session<Row, Draft>) {
    if (saving.value || deciding.value || disposed) return false;
    const current = session.value;
    if (dirty.value) {
      deciding.value = true;
      try {
        await ElMessageBox.confirm('未保存的修改将丢失。是否放弃修改？', '放弃修改', {
          confirmButtonText: '放弃修改',
          cancelButtonText: '继续编辑',
          type: 'warning',
          closeOnHashChange: false,
        });
      } catch {
        return false;
      } finally {
        deciding.value = false;
      }
    }
    if (disposed || saving.value || session.value !== current) return false;
    session.value = next;
    baseline.value = next.kind === 'closed' ? '' : JSON.stringify(next.draft);
    return true;
  }
  const leave = () => transition({ kind: 'closed' });
  async function save(work: (current: OpenSession<Row, Draft>) => Promise<boolean>) {
    const current = session.value;
    if (current.kind === 'closed' || saving.value || deciding.value || disposed) return;
    saving.value = true;
    try {
      if ((await work(current)) && !disposed && session.value === current) {
        session.value = { kind: 'closed' };
        baseline.value = '';
      }
    } finally {
      saving.value = false;
    }
  }
  function beforeClose(done: () => void) {
    void leave().then((allowed) => {
      if (allowed) done();
    });
  }
  function markSaved() {
    if (!disposed && session.value.kind !== 'closed')
      baseline.value = JSON.stringify(session.value.draft);
  }
  function beforeUnload(event: globalThis.BeforeUnloadEvent) {
    if (!dirty.value && !saving.value) return;
    event.preventDefault();
    event.returnValue = '';
  }
  if (inject(routerKey, undefined)) onBeforeRouteLeave(leave);
  onMounted(() => globalThis.addEventListener('beforeunload', beforeUnload));
  onBeforeUnmount(() => {
    disposed = true;
    globalThis.removeEventListener('beforeunload', beforeUnload);
  });
  return {
    session,
    saving,
    deciding,
    dirty,
    replace: transition,
    leave,
    save,
    beforeClose,
    markSaved,
  };
}
