import type { Browser2dApi, Snapshot } from "@browser-2d/contracts/public";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

export const useRunsStore = defineStore("runs", () => {
  const snapshot = shallowRef<Snapshot>();
  const connection = ref<"connecting" | "connected" | "unavailable">(
    "connecting",
  );
  const error = ref("");
  const busy = ref(false);
  const runs = computed(() => snapshot.value?.runs ?? []);
  let api: Browser2dApi | undefined;
  let generation = 0;
  let updates = 0;
  const retiredEpochs = new Set<string>();

  function accept(value: Snapshot) {
    if (retiredEpochs.has(value.epoch)) return;
    const current = snapshot.value;
    if (current?.epoch === value.epoch && current.revision > value.revision)
      return;
    if (current && current.epoch !== value.epoch)
      retiredEpochs.add(current.epoch);
    snapshot.value = value;
    connection.value = "connected";
    updates++;
  }

  function reject(reason: unknown) {
    error.value =
      reason instanceof Error
        ? reason.message
        : typeof reason === "object" &&
            reason !== null &&
            "message" in reason &&
            typeof reason.message === "string"
          ? reason.message
          : "请求失败，请重试。";
    if (
      typeof reason === "object" &&
      reason !== null &&
      "code" in reason &&
      reason.code === "UNAVAILABLE"
    ) {
      connection.value = "unavailable";
    }
  }

  async function refresh() {
    if (!api) return;
    const currentGeneration = generation;
    const before = updates;
    try {
      const result = await api.getSnapshot();
      if (currentGeneration !== generation || before !== updates) return;
      if (result.ok) {
        accept(result.value);
        error.value = "";
      } else reject(result.error);
    } catch (reason) {
      if (currentGeneration !== generation || before !== updates) return;
      connection.value = "unavailable";
      reject(reason);
    }
  }

  function connect(bridge: Browser2dApi | undefined) {
    api = bridge;
    const currentGeneration = ++generation;
    connection.value = "connecting";
    busy.value = false;
    error.value = "";
    if (!bridge) {
      connection.value = "unavailable";
      error.value = "桌面连接不可用，请在桌面应用中打开。";
      return () => {};
    }
    let dispose = () => {};
    try {
      dispose = bridge.subscribe((value) => {
        if (currentGeneration === generation) accept(value);
      });
      void refresh();
    } catch (reason) {
      connection.value = "unavailable";
      reject(reason);
    }
    return () => {
      generation++;
      api = undefined;
      dispose();
    };
  }

  async function command(
    action: (bridge: Browser2dApi) => ReturnType<Browser2dApi["start"]>,
  ) {
    if (!api || busy.value) return;
    const currentGeneration = generation;
    busy.value = true;
    error.value = "";
    try {
      const result = await action(api);
      if (currentGeneration !== generation) return;
      if (result.ok) await refresh();
      else reject(result.error);
    } catch (reason) {
      if (currentGeneration === generation) reject(reason);
    } finally {
      if (currentGeneration === generation) busy.value = false;
    }
  }

  function start(deviceId: string, durationMs: number) {
    return command((bridge) =>
      bridge.start({ commandId: crypto.randomUUID(), deviceId, durationMs }),
    );
  }

  function cancel(runId: string) {
    return command((bridge) => bridge.cancel({ runId }));
  }

  return {
    snapshot,
    connection,
    error,
    busy,
    runs,
    connect,
    refresh,
    start,
    cancel,
  };
});
