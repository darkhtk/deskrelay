import {
  type Component,
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { type BehaviorSummary, api } from "../api.ts";
import { t } from "../i18n.ts";

export interface DeviceWorkbenchProps {
  deviceId: string;
}

export const DeviceWorkbench: Component<DeviceWorkbenchProps> = (props) => {
  const [behaviors, { refetch }] = createResource(
    () => props.deviceId,
    () => api.listBehaviors(props.deviceId),
  );

  const [packageDir, setPackageDir] = createSignal("");
  const [instanceLabel, setInstanceLabel] = createSignal("");
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const onLoad = async (e: Event) => {
    e.preventDefault();
    setLoadError(null);
    try {
      await api.loadBehavior(
        props.deviceId,
        packageDir().trim(),
        instanceLabel().trim() || undefined,
      );
      setPackageDir("");
      setInstanceLabel("");
      await refetch();
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  return (
    <>
      <section class="settings-card">
        <h3 class="settings-card-title">{t("dw.section.behaviors")}</h3>
        <Show
          when={(behaviors() ?? []).length > 0}
          fallback={<p class="settings-card-help">{t("dw.behaviors.empty")}</p>}
        >
          <For each={behaviors() ?? []}>
            {(b: BehaviorSummary) => (
              <BehaviorRow deviceId={props.deviceId} behavior={b} onChange={() => void refetch()} />
            )}
          </For>
        </Show>

        <form onSubmit={onLoad} style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <div class="settings-row">
            <input
              type="text"
              class="text-input"
              placeholder={t("dw.behaviors.path.placeholder")}
              value={packageDir()}
              onInput={(e) => setPackageDir(e.currentTarget.value)}
            />
            <input
              type="text"
              class="text-input"
              placeholder={t("dw.behaviors.instance.placeholder")}
              value={instanceLabel()}
              onInput={(e) => setInstanceLabel(e.currentTarget.value)}
              style={{ "max-width": "180px" }}
            />
            <button type="submit" class="primary-button" disabled={!packageDir().trim()}>
              {t("dw.behaviors.load")}
            </button>
          </div>
          <Show when={loadError()}>{(msg) => <span class="settings-error">{msg()}</span>}</Show>
        </form>
      </section>
    </>
  );
};

const BehaviorRow: Component<{
  deviceId: string;
  behavior: BehaviorSummary;
  onChange: () => void;
}> = (props) => {
  const [method, setMethod] = createSignal("echo");
  const [paramsRaw, setParamsRaw] = createSignal('{"message":"hello from browser"}');
  const [out, setOut] = createSignal<string>("");
  const [events, setEvents] = createSignal<string>("");
  const [streaming, setStreaming] = createSignal(false);

  let abortCtl: AbortController | undefined;

  const call = async () => {
    setOut(t("dw.rpc.loading"));
    let params: unknown = undefined;
    if (paramsRaw().trim()) {
      try {
        params = JSON.parse(paramsRaw());
      } catch (err) {
        setOut(t("dw.rpc.error.json", { error: (err as Error).message }));
        return;
      }
    }
    try {
      const res = await api.callBehavior(
        props.deviceId,
        props.behavior.instanceId,
        method().trim(),
        params,
      );
      setOut(JSON.stringify(res, null, 2));
    } catch (err) {
      setOut(t("dw.rpc.error", { error: (err as Error).message }));
    }
  };

  const startStream = async () => {
    if (streaming()) return;
    setStreaming(true);
    abortCtl = new AbortController();
    const space = `${props.behavior.name}.default:${props.behavior.instanceId}`;
    setEvents(`${t("dw.events.subscribing", { space })}\n`);
    try {
      const init: { signal?: AbortSignal } = {};
      if (abortCtl?.signal) init.signal = abortCtl.signal;
      for await (const env of api.streamEvents(props.deviceId, space, init)) {
        setEvents((prev) => `${prev}${JSON.stringify(env)}\n`);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setEvents((prev) => `${prev}error: ${(err as Error).message}\n`);
      }
    } finally {
      setStreaming(false);
    }
  };

  const stopStream = () => {
    abortCtl?.abort();
    abortCtl = undefined;
    setStreaming(false);
  };

  const unload = async () => {
    stopStream();
    await api.unloadBehavior(props.deviceId, props.behavior.instanceId);
    props.onChange();
  };

  // Tear down stream on unmount.
  createEffect(() => {
    void streaming();
  });
  onCleanup(stopStream);

  return (
    <div
      class="settings-list-item"
      style={{ "flex-direction": "column", "align-items": "stretch" }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
        <div class="settings-list-item-main">
          <span class="settings-list-item-title">{props.behavior.instanceId}</span>
          <span class="settings-list-item-meta">
            {props.behavior.name}@{props.behavior.version} · loaded {props.behavior.loadedAt}
          </span>
        </div>
        <button type="button" class="danger-button" onClick={unload}>
          {t("dw.behaviors.unload")}
        </button>
      </div>

      <div class="settings-row">
        <input
          type="text"
          class="text-input"
          placeholder={t("dw.rpc.method.placeholder")}
          value={method()}
          onInput={(e) => setMethod(e.currentTarget.value)}
          style={{ "max-width": "180px" }}
        />
        <input
          type="text"
          class="text-input"
          placeholder={t("dw.rpc.params.placeholder")}
          value={paramsRaw()}
          onInput={(e) => setParamsRaw(e.currentTarget.value)}
        />
        <button type="button" class="primary-button" onClick={call}>
          {t("dw.rpc.call")}
        </button>
      </div>
      <Show when={out()}>
        <pre class="events">{out()}</pre>
      </Show>

      <div class="settings-row">
        <button type="button" class="secondary-button" onClick={startStream} disabled={streaming()}>
          {streaming() ? t("dw.events.subscribe.busy") : t("dw.events.subscribe")}
        </button>
        <Show when={streaming()}>
          <button type="button" class="danger-button" onClick={stopStream}>
            {t("dw.events.stop")}
          </button>
        </Show>
      </div>
      <Show when={events()}>
        <pre class="events">{events()}</pre>
      </Show>
    </div>
  );
};
