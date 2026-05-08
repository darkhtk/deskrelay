import { type Component, Show, createSignal } from "solid-js";
import { type Device, api } from "../api.ts";
import { deviceDisplayName, deviceDisplayRole } from "../device-display.ts";
import { clearDevicePrefs, getDeviceDefaultCwd, setDeviceDefaultCwd } from "../device-prefs.ts";
import { t } from "../i18n.ts";
import { CwdPicker } from "./CwdPicker.tsx";

export interface DeviceSettingsPanelProps {
  device: Device;
  devices?: Device[] | undefined;
  onChanged: () => void;
  onDevicesRemoved?: ((deviceIds: string[]) => void) | undefined;
  onUnpaired?: ((deviceId: string) => void) | undefined;
  onClose?: (() => void) | undefined;
}

export interface DeviceSettingsDialogProps extends DeviceSettingsPanelProps {
  onClose: () => void;
}

export const DeviceSettingsPanel: Component<DeviceSettingsPanelProps> = (props) => {
  const [label, setLabel] = createSignal(props.device.label);
  const [labelBusy, setLabelBusy] = createSignal(false);
  const [labelError, setLabelError] = createSignal<string | null>(null);
  const [labelSaved, setLabelSaved] = createSignal(false);

  const [cwd, setCwd] = createSignal(getDeviceDefaultCwd(props.device.id) ?? "");
  const [cwdSaved, setCwdSaved] = createSignal(false);

  const [unpairBusy, setUnpairBusy] = createSignal(false);
  const [unpairAllBusy, setUnpairAllBusy] = createSignal(false);
  const [unpairError, setUnpairError] = createSignal<string | null>(null);

  const isServerDevice = (device: Device) => deviceDisplayRole(device) === "Server";
  const currentIsServer = () => isServerDevice(props.device);
  const globalDevices = () => props.devices ?? [];

  async function saveLabel() {
    const next = label().trim();
    if (!next || next === props.device.label) return;
    setLabelBusy(true);
    setLabelError(null);
    setLabelSaved(false);
    try {
      await api.renameDevice(props.device.id, next);
      props.onChanged();
      setLabelSaved(true);
      setTimeout(() => setLabelSaved(false), 1500);
    } catch (err) {
      setLabelError((err as Error).message);
    } finally {
      setLabelBusy(false);
    }
  }

  function saveCwd() {
    const value = cwd().trim();
    setDeviceDefaultCwd(props.device.id, value || null);
    props.onChanged();
    setCwdSaved(true);
    setTimeout(() => setCwdSaved(false), 1500);
  }

  async function unpair() {
    if (currentIsServer()) {
      setUnpairError(t("dsd.unpair.server.blocked"));
      return;
    }
    if (!confirm(t("dsd.unpair.confirm", { label: props.device.label }))) return;
    setUnpairBusy(true);
    setUnpairError(null);
    try {
      await api.unregisterDevice(props.device.id);
      clearDevicePrefs(props.device.id);
      props.onDevicesRemoved?.([props.device.id]);
      props.onUnpaired?.(props.device.id);
      props.onChanged();
      props.onClose?.();
    } catch (err) {
      setUnpairError((err as Error).message);
      setUnpairBusy(false);
    }
  }

  async function unpairAllDevices() {
    const list = globalDevices();
    if (list.length === 0 || unpairAllBusy()) return;
    if (!confirm(t("dsd.unpair.all.confirm", { count: String(list.length) }))) return;

    setUnpairAllBusy(true);
    setUnpairError(null);
    const ordered = [...list].sort((left, right) => {
      return Number(isServerDevice(left)) - Number(isServerDevice(right));
    });
    const removedIds: string[] = [];
    const failures: string[] = [];

    for (const device of ordered) {
      try {
        await api.unregisterDevice(device.id);
        clearDevicePrefs(device.id);
        removedIds.push(device.id);
      } catch (err) {
        failures.push(`${deviceDisplayName(device)}: ${(err as Error).message}`);
      }
    }

    if (removedIds.length > 0) {
      props.onDevicesRemoved?.(removedIds);
      if (!props.onDevicesRemoved) {
        for (const id of removedIds) props.onUnpaired?.(id);
      }
      props.onChanged();
    }

    if (failures.length > 0) {
      setUnpairError(t("dsd.unpair.all.partial", { errors: failures.join("; ") }));
      setUnpairAllBusy(false);
      return;
    }

    props.onClose?.();
  }

  return (
    <div class="settings-stack">
      <section class="settings-card">
        <h3 class="settings-card-title">{t("dsd.section.identity")}</h3>
        <div class="settings-row">
          <input
            id="device-label"
            type="text"
            class="text-input"
            value={label()}
            onInput={(event) => setLabel(event.currentTarget.value)}
          />
          <button
            type="button"
            class="primary-button"
            onClick={() => void saveLabel()}
            disabled={labelBusy() || !label().trim() || label().trim() === props.device.label}
          >
            {labelBusy() ? t("dsd.identity.save.busy") : t("dsd.identity.save")}
          </button>
        </div>
        <div class="settings-meta">
          {t("dsd.identity.meta", {
            daemonUrl: props.device.daemonUrl,
            date: formatDate(props.device.registeredAt),
          })}
        </div>
        <Show when={labelSaved()}>
          <span class="settings-saved">{t("dsd.saved")}</span>
        </Show>
        <Show when={labelError()}>
          {(message) => <span class="settings-error">{message()}</span>}
        </Show>
      </section>

      <section class="settings-card">
        <h3 class="settings-card-title">{t("dsd.section.cwd")}</h3>
        <p class="settings-card-help">{t("dsd.cwd.help")}</p>
        <div class="settings-row">
          <div style={{ flex: "1", "min-width": "0", position: "relative" }}>
            <CwdPicker
              deviceId={props.device.id}
              deviceLabel={props.device.label}
              value={cwd()}
              onChange={setCwd}
              onSubmit={saveCwd}
            />
          </div>
          <button type="button" class="primary-button" onClick={saveCwd}>
            {t("dsd.identity.save")}
          </button>
        </div>
        <Show when={cwdSaved()}>
          <span class="settings-saved">{t("dsd.saved")}</span>
        </Show>
      </section>

      <section class="settings-card">
        <h3 class="settings-card-title danger">{t("dsd.section.danger")}</h3>
        <p class="settings-card-help">
          {currentIsServer() ? t("dsd.unpair.server.help") : t("dsd.danger.help")}
        </p>
        <Show
          when={!currentIsServer()}
          fallback={<p class="settings-card-help">{t("dsd.unpair.server.blocked")}</p>}
        >
          <div class="settings-row">
            <button
              type="button"
              class="danger-button"
              data-testid="device-unpair-button"
              onClick={() => void unpair()}
              disabled={unpairBusy()}
            >
              {unpairBusy() ? t("dsd.unpair.busy") : t("dsd.unpair")}
            </button>
          </div>
        </Show>
        <Show when={globalDevices().length > 0}>
          <div class="settings-row">
            <button
              type="button"
              class="danger-button"
              data-testid="device-unpair-all-button"
              onClick={() => void unpairAllDevices()}
              disabled={unpairAllBusy()}
            >
              {unpairAllBusy() ? t("dsd.unpair.all.busy") : t("dsd.unpair.all")}
            </button>
          </div>
          <p class="settings-card-help">{t("dsd.unpair.all.help")}</p>
        </Show>
        <Show when={unpairError()}>
          {(message) => <span class="settings-error">{message()}</span>}
        </Show>
      </section>
    </div>
  );
};

export const DeviceSettingsDialog: Component<DeviceSettingsDialogProps> = (props) => {
  return (
    <dialog
      open
      class="approval-modal-root"
      aria-label={t("dsd.aria")}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <button
        type="button"
        class="approval-backdrop"
        onClick={() => props.onClose()}
        aria-label={t("dsd.close.aria")}
      />
      <div
        class="approval-card"
        style={{
          width: "min(640px, 95vw)",
          "max-width": "640px",
          "max-height": "85vh",
          "overflow-y": "auto",
        }}
      >
        <div class="approval-header">
          <span class="approval-title">{props.device.label}</span>
          <button
            type="button"
            class="sidebar-action"
            onClick={() => props.onClose()}
            style={{ "margin-left": "auto", width: "auto", padding: "4px 10px" }}
            aria-label={t("app.dialog.close")}
          >
            x
          </button>
        </div>

        <DeviceSettingsPanel
          device={props.device}
          devices={props.devices}
          onChanged={props.onChanged}
          onClose={props.onClose}
          onDevicesRemoved={props.onDevicesRemoved}
          onUnpaired={props.onUnpaired}
        />
      </div>
    </dialog>
  );
};

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
