import { type Component, For, Show, createEffect, createResource, createSignal } from "solid-js";
import { type Device, type DeviceCleanupEntry, api } from "../api.ts";
import { deviceDisplayName, deviceDisplayRole } from "../device-display.ts";
import { clearDevicePrefs } from "../device-prefs.ts";
import { t } from "../i18n.ts";
import { DeviceSettingsPanel } from "./DeviceSettingsDialog.tsx";

export interface DeviceShellProps {
  onDevicesChanged?: () => void | Promise<void>;
  onDeviceSelected?: (id: string | null) => void;
  onManualCleanupRequired?: (devices: DeviceCleanupEntry[]) => void;
  initialSelectedDeviceId?: string | null;
}

export const DeviceShell: Component<DeviceShellProps> = (props) => {
  const [devices, { refetch, mutate }] = createResource(() => api.listDevices());
  const [selected, setSelected] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [removingIds, setRemovingIds] = createSignal<Set<string>>(new Set());

  const notifyDevicesChanged = async () => {
    await refetch();
    await props.onDevicesChanged?.();
  };

  const markRemoving = (id: string, removing: boolean) => {
    setRemovingIds((current) => {
      const next = new Set(current);
      if (removing) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  createEffect(() => {
    const list = devices();
    if (!list) return;
    if (list.length === 0) {
      if (selected() !== null) setSelected(null);
      return;
    }
    const current = selected();
    if (current && list.some((device) => device.id === current)) return;
    const initial = props.initialSelectedDeviceId;
    const next = initial && list.some((device) => device.id === initial) ? initial : list[0]?.id;
    setSelected(next ?? null);
  });

  const selectedDevice = () => {
    const id = selected();
    if (!id) return null;
    return (devices() ?? []).find((device) => device.id === id) ?? null;
  };

  const isServerDevice = (device: Device) => deviceDisplayRole(device) === "Server";

  const handleRemoved = (ids: string[]) => {
    const removed = new Set(ids);
    if (selected() && removed.has(selected() as string)) setSelected(null);
    mutate((current) => (current ?? []).filter((device) => !removed.has(device.id)));
  };

  const remove = async (device: Device) => {
    if (isServerDevice(device)) {
      setError(t("ds.devices.server.blocked"));
      return;
    }
    const id = device.id;
    if (removingIds().has(id)) return;
    if (!confirm(t("ds.devices.remove.confirm"))) return;
    setError(null);
    markRemoving(id, true);
    try {
      const result = await api.unregisterDevice(id);
      clearDevicePrefs(id);
      handleRemoved([id]);
      if (result.cleanup && !result.cleanup.ok) {
        props.onManualCleanupRequired?.([
          { id: device.id, label: device.label, daemonUrl: device.daemonUrl, cleanup: result.cleanup },
        ]);
      }
      void notifyDevicesChanged().catch((err) => {
        setError((err as Error).message);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      markRemoving(id, false);
    }
  };

  return (
    <div class="settings-stack">
      <section class="settings-card">
        <h3 class="settings-card-title">{t("ds.section.devices")}</h3>
        <Show
          when={(devices() ?? []).length > 0}
          fallback={<p class="settings-card-help">{t("ds.devices.empty")}</p>}
        >
          <For each={devices() ?? []}>
            {(device: Device) => (
              <div class="settings-list-item">
                <button
                  type="button"
                  class="settings-list-item-main"
                  style={{
                    background: "transparent",
                    border: "0",
                    padding: "0",
                    cursor: "pointer",
                    "text-align": "left",
                  }}
                  aria-pressed={selected() === device.id}
                  onClick={() => setSelected(device.id)}
                >
                  <span class="settings-list-item-title">
                    {deviceDisplayName(device)}
                    <Show when={selected() === device.id}>
                      <span style={{ color: "var(--accent-coral)", "margin-left": "8px" }}>*</span>
                    </Show>
                  </span>
                  <span class="settings-list-item-meta">{device.daemonUrl}</span>
                </button>
                <Show
                  when={!isServerDevice(device)}
                  fallback={<span class="settings-list-item-meta">{t("ds.devices.server.locked")}</span>}
                >
                  <button
                    type="button"
                    class="danger-button"
                    onClick={() => void remove(device)}
                    disabled={removingIds().has(device.id)}
                  >
                    {removingIds().has(device.id) ? t("dsd.unpair.busy") : t("ds.devices.remove")}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </Show>
        <Show when={error()}>{(message) => <span class="settings-error">{message()}</span>}</Show>
      </section>

      <Show when={selectedDevice()} keyed>
        {(device) => (
          <DeviceSettingsPanel
            device={device}
            devices={devices() ?? []}
            onChanged={() => void notifyDevicesChanged()}
            onDevicesRemoved={handleRemoved}
            onManualCleanupRequired={props.onManualCleanupRequired}
            onUnpaired={(id) => {
              if (selected() === id) setSelected(null);
            }}
          />
        )}
      </Show>
    </div>
  );
};
