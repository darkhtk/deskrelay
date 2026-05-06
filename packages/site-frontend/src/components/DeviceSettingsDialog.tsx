import { type Component, Show, createSignal } from "solid-js";
import { type Device, api } from "../api.ts";
import {
  type SecurityProfile,
  clearAlwaysAllowed,
  clearDevicePrefs,
  getAlwaysAllowedTools,
  getDeviceDefaultCwd,
  getDeviceSecurityProfile,
  setDeviceDefaultCwd,
  setDeviceSecurityProfile,
} from "../device-prefs.ts";
import { t } from "../i18n.ts";
import { CwdPicker } from "./CwdPicker.tsx";

export interface DeviceSettingsPanelProps {
  device: Device;
  onChanged: () => void;
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
  const [unpairError, setUnpairError] = createSignal<string | null>(null);

  const [allowedTools, setAllowedTools] = createSignal<string[]>(
    [...getAlwaysAllowedTools(props.device.id)].sort(),
  );
  const [securityProfile, setSecurityProfileState] = createSignal<SecurityProfile>(
    getDeviceSecurityProfile(props.device.id),
  );

  function pickProfile(next: SecurityProfile): void {
    setDeviceSecurityProfile(props.device.id, next);
    setSecurityProfileState(next);
  }

  function clearApprovals() {
    if (!confirm(t("dsd.approval.clear.confirm"))) return;
    clearAlwaysAllowed(props.device.id);
    setAllowedTools([]);
  }

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
    if (!confirm(t("dsd.unpair.confirm", { label: props.device.label }))) return;
    setUnpairBusy(true);
    setUnpairError(null);
    try {
      await api.unregisterDevice(props.device.id);
      clearDevicePrefs(props.device.id);
      props.onUnpaired?.(props.device.id);
      props.onChanged();
      props.onClose?.();
    } catch (err) {
      setUnpairError((err as Error).message);
      setUnpairBusy(false);
    }
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
        <Show when={labelError()}>{(message) => <span class="settings-error">{message()}</span>}</Show>
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
        <h3 class="settings-card-title">{t("dsd.section.approval")}</h3>
        <p class="settings-card-help">{t("dsd.approval.help")}</p>
        <Show
          when={allowedTools().length > 0}
          fallback={<p class="settings-card-help">{t("dsd.approval.empty")}</p>}
        >
          <div class="settings-meta">
            <code>{allowedTools().join(", ")}</code>
          </div>
          <div class="settings-row">
            <button type="button" class="secondary-button" onClick={clearApprovals}>
              {t("dsd.approval.clear")}
            </button>
          </div>
        </Show>
      </section>

      <section class="settings-card">
        <h3 class="settings-card-title">{t("dsd.section.security-profile")}</h3>
        <p class="settings-card-help">{t("dsd.security-profile.help")}</p>
        <div class="settings-row" role="radiogroup" aria-label={t("dsd.section.security-profile")}>
          <button
            type="button"
            class={`secondary-button${securityProfile() === "relaxed" ? " primary-button" : ""}`}
            aria-pressed={securityProfile() === "relaxed"}
            onClick={() => pickProfile("relaxed")}
          >
            {t("dsd.security-profile.relaxed")}
          </button>
          <button
            type="button"
            class={`secondary-button${securityProfile() === "normal" ? " primary-button" : ""}`}
            aria-pressed={securityProfile() === "normal"}
            onClick={() => pickProfile("normal")}
          >
            {t("dsd.security-profile.normal")}
          </button>
          <button
            type="button"
            class={`secondary-button${securityProfile() === "strict" ? " primary-button" : ""}`}
            aria-pressed={securityProfile() === "strict"}
            onClick={() => pickProfile("strict")}
          >
            {t("dsd.security-profile.strict")}
          </button>
        </div>
        <p class="settings-meta">
          {securityProfile() === "relaxed"
            ? t("dsd.security-profile.relaxed.note")
            : securityProfile() === "normal"
              ? t("dsd.security-profile.normal.note")
              : t("dsd.security-profile.strict.note")}
        </p>
      </section>

      <section class="settings-card">
        <h3 class="settings-card-title danger">{t("dsd.section.danger")}</h3>
        <p class="settings-card-help">{t("dsd.danger.help")}</p>
        <div class="settings-row">
          <button
            type="button"
            class="danger-button"
            onClick={() => void unpair()}
            disabled={unpairBusy()}
          >
            {unpairBusy() ? t("dsd.unpair.busy") : t("dsd.unpair")}
          </button>
        </div>
        <Show when={unpairError()}>{(message) => <span class="settings-error">{message()}</span>}</Show>
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
          onChanged={props.onChanged}
          onClose={props.onClose}
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
