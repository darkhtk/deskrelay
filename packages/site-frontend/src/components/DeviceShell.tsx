import {
  type Component,
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { ApiError, type Device, api } from "../api.ts";
import { deviceDisplayName } from "../device-display.ts";
import { clearDevicePrefs } from "../device-prefs.ts";
import { t } from "../i18n.ts";
import { DeviceSettingsPanel } from "./DeviceSettingsDialog.tsx";

type DeviceCommandKind = "register" | "remove";
const REGISTER_COMMAND_WATCH_MS = 60_000;
const REGISTER_COMMAND_POLL_MS = 1_500;

export interface DeviceShellProps {
  onDevicesChanged?: () => void | Promise<void>;
  onDeviceSelected?: (id: string | null) => void;
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

  const handleAdded = (device: Device) => {
    setError(null);
    mutate((current) => {
      const list = current ?? [];
      return [...list.filter((item) => item.id !== device.id), device];
    });
    setSelected(device.id);
    props.onDeviceSelected?.(device.id);
    void notifyDevicesChanged().catch((err) => {
      setError((err as Error).message);
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

  const remove = async (id: string) => {
    if (removingIds().has(id)) return;
    if (!confirm(t("ds.devices.remove.confirm"))) return;
    setError(null);
    markRemoving(id, true);
    try {
      await api.unregisterDevice(id);
      clearDevicePrefs(id);
      if (selected() === id) setSelected(null);
      mutate((current) => (current ?? []).filter((device) => device.id !== id));
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
                <button
                  type="button"
                  class="danger-button"
                  onClick={() => void remove(device.id)}
                  disabled={removingIds().has(device.id)}
                >
                  {removingIds().has(device.id) ? t("dsd.unpair.busy") : t("ds.devices.remove")}
                </button>
              </div>
            )}
          </For>
        </Show>
        <Show when={error()}>{(message) => <span class="settings-error">{message()}</span>}</Show>
      </section>

      <AddDeviceCard onAdded={handleAdded} />

      <Show when={selectedDevice()} keyed>
        {(device) => (
          <DeviceSettingsPanel
            device={device}
            onChanged={() => void notifyDevicesChanged()}
            onUnpaired={(id) => {
              if (selected() === id) setSelected(null);
              void notifyDevicesChanged();
            }}
          />
        )}
      </Show>
    </div>
  );
};

const AddDeviceCard: Component<{ onAdded: (device: Device) => void | Promise<void> }> = (props) => {
  const [newUrl, setNewUrl] = createSignal("http://127.0.0.1:18091");
  const [newLabel, setNewLabel] = createSignal("");
  const [newToken, setNewToken] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [commandBusy, setCommandBusy] = createSignal<DeviceCommandKind | null>(null);
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [commandText, setCommandText] = createSignal("");
  const [commandTextKind, setCommandTextKind] = createSignal<DeviceCommandKind>("register");
  const [commandCopied, setCommandCopied] = createSignal<DeviceCommandKind | null>(null);
  const [registrationWatchActive, setRegistrationWatchActive] = createSignal(false);
  let registrationWatchTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => stopRegistrationWatch());

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const device = await api.registerDevice(
        newUrl().trim(),
        newLabel().trim() || undefined,
        newToken().trim() || undefined,
      );
      setNewLabel("");
      setNewToken("");
      await props.onAdded(device);
      setSuccess(t("ds.add.selfhost.success", { label: device.label }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyDeviceCommand = async (kind: DeviceCommandKind) => {
    setCommandBusy(kind);
    setCommandError(null);
    setCommandCopied(null);
    setCommandText("");
    setCommandTextKind(kind);
    try {
      const result =
        kind === "register" ? await api.registerOtherPcCommand() : await api.removeOtherPcCommand();
      if (kind === "register") {
        void startRegistrationWatch();
      }
      if (!navigator.clipboard?.writeText) {
        setCommandText(result.command);
        setCommandError(t("ds.add.command.copy-unavailable"));
        return;
      }
      try {
        await navigator.clipboard.writeText(result.command);
      } catch {
        setCommandText(result.command);
        setCommandError(t("ds.add.command.copy-unavailable"));
        return;
      }
      setCommandCopied(kind);
      setTimeout(() => setCommandCopied((current) => (current === kind ? null : current)), 1800);
    } catch (err) {
      setCommandError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setCommandBusy(null);
    }
  };

  function stopRegistrationWatch() {
    if (registrationWatchTimer) clearTimeout(registrationWatchTimer);
    registrationWatchTimer = null;
    setRegistrationWatchActive(false);
  }

  async function startRegistrationWatch() {
    stopRegistrationWatch();
    setSuccess(t("ds.add.command.waiting"));
    const known = new Set((await safeListDevices()).map((device) => device.id));
    const deadline = Date.now() + REGISTER_COMMAND_WATCH_MS;
    setRegistrationWatchActive(true);

    const poll = async () => {
      const list = await safeListDevices();
      const added = list.find((device) => !known.has(device.id));
      if (added) {
        stopRegistrationWatch();
        await props.onAdded(added);
        setSuccess(t("ds.add.command.detected", { label: deviceDisplayName(added) }));
        return;
      }
      if (Date.now() >= deadline) {
        stopRegistrationWatch();
        setSuccess(t("ds.add.command.timeout"));
        return;
      }
      registrationWatchTimer = setTimeout(() => void poll(), REGISTER_COMMAND_POLL_MS);
    };

    registrationWatchTimer = setTimeout(() => void poll(), REGISTER_COMMAND_POLL_MS);
  }

  async function safeListDevices(): Promise<Device[]> {
    try {
      return await api.listDevices();
    } catch {
      return [];
    }
  }

  return (
    <section class="settings-card">
      <h3 class="settings-card-title">{t("ds.section.add")}</h3>
      <form onSubmit={submit} style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
        <p class="settings-card-help">{t("ds.add.selfhost.help")}</p>
        <div class="settings-command-copy">
          <div class="settings-command-copy-text">
            <span class="settings-command-copy-title">{t("ds.add.command.title")}</span>
            <span class="settings-command-copy-help">{t("ds.add.command.help")}</span>
          </div>
          <button
            type="button"
            class="secondary-button"
            onClick={() => void copyDeviceCommand("register")}
            disabled={Boolean(commandBusy()) || registrationWatchActive()}
          >
            {commandBusy() === "register" || registrationWatchActive()
              ? t("ds.add.command.busy")
              : t("ds.add.command.copy")}
          </button>
          <button
            type="button"
            class="secondary-button"
            onClick={() => void copyDeviceCommand("remove")}
            disabled={Boolean(commandBusy())}
          >
            {commandBusy() === "remove"
              ? t("ds.add.command.busy")
              : t("ds.add.command.remove-copy")}
          </button>
        </div>
        <Show when={commandCopied()}>
          {(kind) => (
            <span class="settings-success">
              {kind() === "remove" ? t("ds.add.command.remove-copied") : t("ds.add.command.copied")}
            </span>
          )}
        </Show>
        <Show when={commandError()}>
          {(message) => <span class="settings-error">{message()}</span>}
        </Show>
        <Show when={commandText()}>
          {(value) => (
            <textarea
              class="settings-command-textarea"
              readOnly
              value={value()}
              aria-label={
                commandTextKind() === "remove"
                  ? t("ds.add.command.remove-fallback-label")
                  : t("ds.add.command.fallback-label")
              }
            />
          )}
        </Show>
        <div class="settings-row">
          <input
            type="url"
            class="text-input"
            placeholder={t("ds.add.selfhost.url.placeholder")}
            value={newUrl()}
            onInput={(event) => setNewUrl(event.currentTarget.value)}
          />
          <input
            type="password"
            class="text-input"
            placeholder={t("ds.add.selfhost.token.placeholder")}
            value={newToken()}
            onInput={(event) => setNewToken(event.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <input
            type="text"
            class="text-input"
            placeholder={t("ds.add.selfhost.label.placeholder")}
            value={newLabel()}
            onInput={(event) => setNewLabel(event.currentTarget.value)}
            style={{ "max-width": "200px" }}
          />
          <button type="submit" class="primary-button" disabled={busy()}>
            {busy() ? t("ds.add.selfhost.busy") : t("ds.add.selfhost.submit")}
          </button>
        </div>
        <p class="settings-card-help">{t("ds.add.selfhost.token.help")}</p>
        <Show when={error()}>{(message) => <span class="settings-error">{message()}</span>}</Show>
        <Show when={success()}>
          {(message) => <span class="settings-success">{message()}</span>}
        </Show>
      </form>
    </section>
  );
};
