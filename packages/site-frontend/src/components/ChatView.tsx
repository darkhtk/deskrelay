// ChatView — full claude-remote-style chat experience.
//
// Layout: sidebar (device picker, sessions, profile) + main (transcript +
// composer). The class names + structure mirror the index.html shell
// from C:\Users\darkh\Projects\claude-remote so styles.css (also ported
// from there) styles them correctly.

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  ApiError,
  type ClaudeSessionSummary,
  type ClaudeSessionTranscript,
  type ClaudeStreamEvent,
  type Device,
  api,
} from "../api.ts";
import {
  claudeEventForTranscript,
  describeCliActionFromEnvelope,
  isApprovalWaitingAction,
} from "../claude/cli-action.ts";
import { type RuntimeSlashCommands, mergeRuntimeSlashCommands } from "../claude/slash-commands.ts";
import {
  CLAUDE_PERMISSION_MODES,
  CLAUDE_PERMISSION_MODE_VALUES,
  type ClaudePermissionMode,
} from "../claude/stream-contract.ts";
import { type ConnectionStatusAction, deriveConnectionStatus } from "../connection-status.ts";
import { deviceDisplayName } from "../device-display.ts";
import {
  getDeviceClaudeModel,
  getDeviceDefaultCwd,
  getDeviceSecurityProfile,
  isSafeClaudeModel,
  setDeviceClaudeModel,
} from "../device-prefs.ts";
import { t } from "../i18n.ts";
import { scrollToBottomOnSend } from "../ui-prefs.ts";
import { ApprovalModal } from "./ApprovalModal.tsx";
import { Attachments, type AttachmentsAPI, imagesFromClipboard } from "./Attachments.tsx";
import { CapabilitiesBadge } from "./CapabilitiesBadge.tsx";
import { Composer } from "./Composer.tsx";
import { NewChatCard } from "./NewChatCard.tsx";
import { OfflineHint, daemonOfflineBannerMessage, isDaemonOfflineMessage } from "./OfflineHint.tsx";
import { PermissionModePicker } from "./PermissionModePicker.tsx";
import { type SessionEntry, type SessionGroupDeleteProgress, SessionList } from "./SessionList.tsx";
import { Transcript } from "./Transcript.tsx";

const SESSION_LIMIT = 200;
const SESSION_READ_MAX_BYTES = 8 * 1024 * 1024;
const SESSION_TRANSCRIPT_EVENT_LIMIT = 100;
const SESSION_NOTICE_AUTO_DISMISS_MS = 5000;
const BEHAVIOR_READY_RETRY_MS = 1000;
const BEHAVIOR_READY_MAX_RETRIES = 15;
const DEVICE_OFFLINE_REFETCH_MS = 1500;
const STREAM_OPEN_GRACE_MS = 2500;
const DEFAULT_NEW_CHAT_CWD = "C:\\Users\\";
const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 32;

function latestTranscriptEvents(events: ClaudeStreamEvent[]): ClaudeStreamEvent[] {
  return events.length > SESSION_TRANSCRIPT_EVENT_LIMIT
    ? events.slice(-SESSION_TRANSCRIPT_EVENT_LIMIT)
    : events;
}

function runErrorMessage(content: unknown): string | null {
  if (typeof content !== "object" || content === null) return null;
  const message = (content as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

function isMissingSessionFileError(message: string): boolean {
  return /\bENOENT\b/.test(message) && /\.jsonl\b/i.test(message);
}

function isBehaviorMethodNotFound(
  error: { code?: number; message?: string } | undefined,
  method: string,
): boolean {
  const message = error?.message ?? "";
  return (
    error?.code === -32601 ||
    (message.toLowerCase().includes("method not found") && message.includes(method))
  );
}

function defaultDeviceId(list: Device[] | undefined): string | null {
  if (!list?.length) return null;
  return list.find((d) => d.connectionState !== "offline")?.id ?? list[0]?.id ?? null;
}

function normalizePermissionMode(value: unknown): ClaudePermissionMode | null {
  if (typeof value !== "string") return null;
  return CLAUDE_PERMISSION_MODE_VALUES.has(value) ? (value as ClaudePermissionMode) : null;
}

function parsePermissionModeSlashArg(value: string): ClaudePermissionMode | null {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!key) return null;
  if (key === "default") return CLAUDE_PERMISSION_MODES.DEFAULT;
  if (key === "auto") return CLAUDE_PERMISSION_MODES.AUTO;
  if (key === "plan") return CLAUDE_PERMISSION_MODES.PLAN;
  if (key === "acceptedits" || key === "accept") return CLAUDE_PERMISSION_MODES.ACCEPT_EDITS;
  if (key === "dontask" || key === "donotask") return CLAUDE_PERMISSION_MODES.DONT_ASK;
  if (key === "bypasspermissions" || key === "bypass") {
    return CLAUDE_PERMISSION_MODES.BYPASS_PERMISSIONS;
  }
  return null;
}

function permissionModeFromSystemInit(event: unknown): ClaudePermissionMode | null {
  if (!event || typeof event !== "object") return null;
  const e = event as {
    type?: unknown;
    subtype?: unknown;
    permissionMode?: unknown;
    permission_mode?: unknown;
  };
  if (e.type !== "system" || e.subtype !== "init") return null;
  return normalizePermissionMode(e.permissionMode ?? e.permission_mode);
}

function isClaudeSystemInit(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const e = event as { type?: unknown; subtype?: unknown };
  return e.type === "system" && e.subtype === "init";
}

function isLocalSlashCommandText(value: string): boolean {
  return /^\/(?:help|clear|model|permissions|status)(?:\s+.*)?$/i.test(value.trim());
}

type SettingsOpenOptions = {
  tab?: "general" | "devices" | "diagnostics";
  deviceId?: string | null;
};

type DeviceSelectionRequest = {
  id: string | null;
  seq: number;
};

type PermissionModeStatus = "unconfirmed" | "pending" | "confirmed" | "mismatch" | "unknown";

export interface ChatViewProps {
  me?: unknown;
  onSignOut?: () => void;
  onClearAccess?: () => void;
  /** Open the unified Settings overlay. */
  onOpenSettings: (options?: SettingsOpenOptions) => void;
  /** Incremented by the settings dialog after pair/register/remove so
   *  the sidebar device picker reflects changes without a page refresh. */
  devicesRevision?: number;
  /** One-shot request from Settings -> Devices to activate a newly
   *  registered device once it appears in the refreshed sidebar list. */
  requestedDeviceSelection?: DeviceSelectionRequest;
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const [devices, { refetch: refetchDevices }] = createResource(async () => {
    try {
      return await api.listDevices();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        queueMicrotask(() => props.onClearAccess?.());
      }
      return [] as Device[];
    }
  });

  createEffect(() => {
    const revision = props.devicesRevision ?? 0;
    if (revision > 0) void refetchDevices();
  });

  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | null>(null);
  const [appliedDeviceSelectionSeq, setAppliedDeviceSelectionSeq] = createSignal<number | null>(
    null,
  );
  const effectiveDeviceId = () => selectedDeviceId() ?? defaultDeviceId(devices());
  const [selectedClaudeModel, setSelectedClaudeModel] = createSignal<string | null>(null);

  createEffect(() => {
    const request = props.requestedDeviceSelection;
    if (!request || appliedDeviceSelectionSeq() === request.seq) return;
    if (!request.id) {
      setSelectedDeviceId(null);
      setAppliedDeviceSelectionSeq(request.seq);
      return;
    }
    const list = devices();
    if (!list?.some((device) => device.id === request.id)) return;
    setSelectedDeviceId(request.id);
    setAppliedDeviceSelectionSeq(request.seq);
  });

  createEffect(() => {
    const selected = selectedDeviceId();
    const list = devices();
    if (!selected || !list) return;
    if (list.some((d) => d.id === selected)) return;
    setSelectedDeviceId(null);
    setSelectedSession(null);
    setTranscript([]);
    setError(null);
    setCwd("");
    resetConfirmedPermissionMode();
  });

  // Find a remote-claude instance loaded on the active device.
  const [behaviors, { refetch: refetchBehaviors }] = createResource(
    () => effectiveDeviceId(),
    async (deviceId) => {
      if (!deviceId) return [];
      try {
        return await api.listBehaviors(deviceId);
      } catch {
        return [];
      }
    },
  );
  const remoteClaudeInstance = () =>
    (behaviors() ?? []).find((b) => b.name === "remote-claude")?.instanceId ?? null;

  createEffect(() => {
    const dev = effectiveDeviceId();
    setSelectedClaudeModel(dev ? getDeviceClaudeModel(dev) : null);
  });

  const [runtimeSlashCommands] = createResource(
    () => {
      const d = effectiveDeviceId();
      const i = remoteClaudeInstance();
      if (!d || !i) return null;
      return { deviceId: d, instanceId: i, cwd: cwd().trim() || getDeviceDefaultCwd(d) || "." };
    },
    async (input) => {
      if (!input) return null;
      try {
        const res = await api.callBehavior<RuntimeSlashCommands>(
          input.deviceId,
          input.instanceId,
          "slashCommands",
          { cwd: input.cwd },
        );
        if (res.error) return null;
        return res.result ?? null;
      } catch {
        return null;
      }
    },
  );
  const composerSlashCommands = createMemo(() => mergeRuntimeSlashCommands(runtimeSlashCommands()));

  const behaviorReadyRetryCounts = new Map<string, number>();
  createEffect(() => {
    const id = effectiveDeviceId();
    const revision = props.devicesRevision ?? 0;
    if (!id) return;
    void revision;
    behaviorReadyRetryCounts.delete(id);
  });
  createEffect(() => {
    const id = effectiveDeviceId();
    const instance = remoteClaudeInstance();
    if (!id) return;
    if (instance) {
      behaviorReadyRetryCounts.delete(id);
      return;
    }
    const attempts = behaviorReadyRetryCounts.get(id) ?? 0;
    if (attempts >= BEHAVIOR_READY_MAX_RETRIES) return;
    const timer = setTimeout(() => {
      behaviorReadyRetryCounts.set(id, attempts + 1);
      void refetchBehaviors();
    }, BEHAVIOR_READY_RETRY_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const [sessions, { refetch: refetchSessions, mutate: mutateSessions }] = createResource(
    () => {
      const d = effectiveDeviceId();
      const i = remoteClaudeInstance();
      return d && i ? `${d}:${i}` : null;
    },
    async (key) => {
      if (!key) return [];
      const [d, i] = key.split(":") as [string, string];
      try {
        const res = await api.callBehavior<ClaudeSessionSummary[]>(d, i, "sessions.list", {
          limit: SESSION_LIMIT,
          dedupeSessionIds: true,
        });
        if (res.error) throw new Error(res.error.message);
        return res.result ?? [];
      } catch {
        return [];
      }
    },
  );
  const [sessionSearch, setSessionSearch] = createSignal("");
  const [showSessionSearch, setShowSessionSearch] = createSignal(false);
  let sessionSearchInput: HTMLInputElement | undefined;
  const sessionEntries = (): SessionEntry[] => {
    const all = (sessions() ?? []).map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      ...(s.fullTitle ? { fullTitle: s.fullTitle } : {}),
      cwd: s.cwd,
      updatedAt: Date.parse(s.modifiedAt),
    }));
    const q = sessionSearch().trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) => (e.title ?? "").toLowerCase().includes(q) || (e.cwd ?? "").toLowerCase().includes(q),
    );
  };

  function toggleSessionSearch() {
    if (showSessionSearch()) {
      setShowSessionSearch(false);
      setSessionSearch("");
      return;
    }
    setShowSessionSearch(true);
    setTimeout(() => sessionSearchInput?.focus(), 0);
  }

  const [selectedSession, setSelectedSession] = createSignal<ClaudeSessionSummary | null>(null);
  const [transcript, setTranscript] = createSignal<ClaudeStreamEvent[]>([]);
  const [cwd, setCwd] = createSignal<string>("");
  const [requestedPermissionMode, setRequestedPermissionMode] = createSignal<ClaudePermissionMode>(
    CLAUDE_PERMISSION_MODES.DEFAULT,
  );
  const [confirmedPermissionMode, setConfirmedPermissionMode] =
    createSignal<ClaudePermissionMode | null>(null);
  const [permissionModeStatus, setPermissionModeStatus] =
    createSignal<PermissionModeStatus>("unconfirmed");
  const [lastPermissionModeRequest, setLastPermissionModeRequest] =
    createSignal<ClaudePermissionMode | null>(null);
  const [running, setRunning] = createSignal(false);
  const [cliAction, setCliAction] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let sessionNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  function setTransientSessionNotice(message: string) {
    if (sessionNoticeTimer) clearTimeout(sessionNoticeTimer);
    setError(message);
    sessionNoticeTimer = setTimeout(() => {
      if (error() === message) setError(null);
      sessionNoticeTimer = null;
    }, SESSION_NOTICE_AUTO_DISMISS_MS);
  }

  function resetConfirmedPermissionMode() {
    setConfirmedPermissionMode(null);
    setPermissionModeStatus("unconfirmed");
    setLastPermissionModeRequest(null);
  }

  function setNextPermissionMode(next: ClaudePermissionMode) {
    setRequestedPermissionMode(next);
    setLastPermissionModeRequest(null);
    setPermissionModeStatus(confirmedPermissionMode() ? "confirmed" : "unconfirmed");
  }

  function confirmPermissionMode(
    actual: ClaudePermissionMode,
    requested: ClaudePermissionMode | null,
  ) {
    setConfirmedPermissionMode(actual);
    setLastPermissionModeRequest(requested);
    if (requested && requested !== actual) {
      // Keep future runs aligned with the actual mode Claude reported,
      // unless the user has already picked a different next-run request
      // while this run was in flight.
      if (requestedPermissionMode() === requested) setRequestedPermissionMode(actual);
      setPermissionModeStatus("mismatch");
      return;
    }
    if (!requested || requestedPermissionMode() === requested) setRequestedPermissionMode(actual);
    setPermissionModeStatus("confirmed");
  }

  function permissionModeStatusText(): string {
    const requested = requestedPermissionMode();
    const confirmed = confirmedPermissionMode();
    const lastRequested = lastPermissionModeRequest();
    const state = permissionModeStatus();
    if (state === "pending") {
      return t("pm.status.checking", { mode: lastRequested ?? requested });
    }
    if (state === "unknown") {
      return t("pm.status.unknown", { mode: lastRequested ?? requested });
    }
    if (state === "mismatch" && confirmed && lastRequested) {
      return t("pm.status.mismatch", { requested: lastRequested, actual: confirmed });
    }
    if (confirmed) {
      if (requested !== confirmed) {
        return t("pm.status.confirmed-next", { actual: confirmed, next: requested });
      }
      return t("pm.status.confirmed", { mode: confirmed });
    }
    return t("pm.status.pending-next", { mode: requested });
  }

  onCleanup(() => {
    if (sessionNoticeTimer) clearTimeout(sessionNoticeTimer);
  });

  const [showNewChat, setShowNewChat] = createSignal(false);
  const [activeRunId, setActiveRunId] = createSignal<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [transcriptAtBottom, setTranscriptAtBottom] = createSignal(true);
  let transcriptScroller!: HTMLDivElement;

  function isTranscriptAtBottomNow(): boolean {
    if (!transcriptScroller) return true;
    const distance =
      transcriptScroller.scrollHeight -
      transcriptScroller.scrollTop -
      transcriptScroller.clientHeight;
    return distance <= TRANSCRIPT_BOTTOM_THRESHOLD_PX;
  }

  function updateTranscriptBottomState() {
    setTranscriptAtBottom(isTranscriptAtBottomNow());
  }

  function scrollTranscriptToBottom(behavior: ScrollBehavior = "auto") {
    if (!transcriptScroller) return;
    const scroll = () => {
      if (!transcriptScroller) return;
      if (typeof transcriptScroller.scrollTo === "function") {
        transcriptScroller.scrollTo({ top: transcriptScroller.scrollHeight, behavior });
      } else {
        transcriptScroller.scrollTop = transcriptScroller.scrollHeight;
      }
      setTranscriptAtBottom(true);
    };
    queueMicrotask(scroll);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(scroll);
    } else {
      setTimeout(scroll, 0);
    }
  }

  function appendTranscriptEvent(
    event: ClaudeStreamEvent,
    options: { forceScroll?: boolean } = {},
  ) {
    const shouldFollow = options.forceScroll === true || isTranscriptAtBottomNow();
    setTranscript((events) => [...events, event]);
    if (shouldFollow) {
      scrollTranscriptToBottom();
    } else {
      setTranscriptAtBottom(false);
    }
  }

  function handleScrollToBottomClick() {
    scrollTranscriptToBottom("smooth");
  }

  createEffect(() => {
    if (transcript().length === 0) setTranscriptAtBottom(true);
  });

  // Mobile drawer toggle — the CSS rules at @media (max-width: 720px)
  // key off body.sidebar-open (so the sibling backdrop selector +
  // body-scroll-lock both work from the same hook). Sync the body
  // class with the signal here. Without this the drawer never slid
  // in at all on mobile despite the signal flipping.
  createEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("sidebar-open", sidebarOpen());
  });
  onCleanup(() => {
    if (typeof document !== "undefined") {
      document.body.classList.remove("sidebar-open");
    }
  });
  const activeDevice = () => {
    const id = effectiveDeviceId();
    if (!id) return null;
    return (devices() ?? []).find((d) => d.id === id) ?? null;
  };

  createEffect(() => {
    const device = activeDevice();
    if (!device || device.connectionState !== "offline" || devices.loading) return;
    const timer = setTimeout(() => {
      void refetchDevices();
    }, DEVICE_OFFLINE_REFETCH_MS);
    onCleanup(() => clearTimeout(timer));
  });

  let previousActiveDeviceConnection: string | null = null;
  createEffect(() => {
    const device = activeDevice();
    const state = device?.connectionState ?? "online";
    const key = device ? `${device.id}:${state}` : null;
    const previous = previousActiveDeviceConnection;
    previousActiveDeviceConnection = key;
    if (!device || state === "offline") return;
    if (previous === `${device.id}:offline`) {
      behaviorReadyRetryCounts.delete(device.id);
      void refetchBehaviors();
    }
  });

  const connectionStatus = createMemo(() =>
    deriveConnectionStatus({
      devices: devices(),
      devicesLoading: devices.loading,
      activeDevice: activeDevice(),
      behaviorsLoading: behaviors.loading,
      hasRemoteClaude: Boolean(remoteClaudeInstance()),
      running: running(),
      activityLabel: cliAction(),
      approvalWaiting: isApprovalWaitingAction(cliAction()),
      hasError: Boolean(error()),
    }),
  );

  const connectionStatusDetail = () =>
    connectionStatus().detailOverride ?? t(connectionStatus().detailKey);

  const deviceStatusTone = () => {
    const device = activeDevice();
    if (!device) return "none";
    const status = connectionStatus();
    if (status.tone === "ok") return "online";
    if (status.tone === "offline") return "offline";
    if (status.tone === "pending" || status.tone === "warning") return "pending";
    return "action";
  };

  const deviceStatusLabel = () => {
    const device = activeDevice();
    if (!device) return t("chat.sidebar.device.status.none");
    return `${deviceDisplayName(device)}: ${t(connectionStatus().mainKey)} - ${connectionStatusDetail()}`;
  };

  const newChatCwd = () => {
    const id = effectiveDeviceId();
    if (id) {
      const pref = getDeviceDefaultCwd(id);
      if (pref) return pref;
    }
    if (cwd()) return cwd();
    return DEFAULT_NEW_CHAT_CWD;
  };

  let attachmentsApi: AttachmentsAPI | null = null;
  const [attachmentCount, setAttachmentCount] = createSignal(0);
  const [deletingSessionIds, setDeletingSessionIds] = createSignal<Record<string, boolean>>({});
  const [deletingSessionGroups, setDeletingSessionGroups] = createSignal<
    Record<string, SessionGroupDeleteProgress | undefined>
  >({});

  function setSessionDeleting(id: string, deleting: boolean) {
    setDeletingSessionIds((current) => {
      const next = { ...current };
      if (deleting) next[id] = true;
      else delete next[id];
      return next;
    });
  }

  function setSessionGroupDeleteProgress(
    cwdToDelete: string,
    progress: SessionGroupDeleteProgress | undefined,
  ) {
    setDeletingSessionGroups((current) => {
      const next = { ...current };
      if (progress) next[cwdToDelete] = progress;
      else delete next[cwdToDelete];
      return next;
    });
  }

  async function listSessionDeleteCandidates(
    dev: string,
    inst: string,
    summary: ClaudeSessionSummary,
  ): Promise<Array<{ cwd: string; sessionId: string }>> {
    const candidates = new Map<string, { cwd: string; sessionId: string }>();
    candidates.set(`${summary.cwd}\n${summary.sessionId}`, {
      cwd: summary.cwd,
      sessionId: summary.sessionId,
    });
    try {
      const listRes = await api.callBehavior<ClaudeSessionSummary[]>(dev, inst, "sessions.list", {
        limit: 10000,
      });
      if (!listRes.error) {
        for (const row of listRes.result ?? []) {
          if (row.sessionId !== summary.sessionId) continue;
          candidates.set(`${row.cwd}\n${row.sessionId}`, {
            cwd: row.cwd,
            sessionId: row.sessionId,
          });
        }
      }
    } catch {
      // The visible row can still be deleted even if duplicate discovery fails.
    }
    return [...candidates.values()];
  }

  async function handleSessionDelete(id: string) {
    const dev = effectiveDeviceId();
    const inst = remoteClaudeInstance();
    if (!dev || !inst) return;
    // sessions.delete needs cwd to locate the file; read it from the
    // already-loaded summaries (the SessionList only knows ids).
    const summary = (sessions() ?? []).find((s) => s.sessionId === id);
    if (!summary) return;
    if (deletingSessionIds()[id]) return;
    setSessionDeleting(id, true);
    let deleted = false;
    try {
      const byId = await api.callBehavior<{
        sessionId: string;
        total: number;
        deleted: number;
        missing: number;
        paths: string[];
      }>(dev, inst, "sessions.deleteBySessionId", { sessionId: id });
      if (byId.error && !isBehaviorMethodNotFound(byId.error, "sessions.deleteBySessionId")) {
        setError(`couldn't delete session: ${byId.error.message}`);
        return;
      }
      if (byId.error) {
        const candidates = await listSessionDeleteCandidates(dev, inst, summary);
        for (const candidate of candidates) {
          const res = await api.callBehavior<{ deleted: boolean; path: string }>(
            dev,
            inst,
            "sessions.delete",
            { cwd: candidate.cwd, sessionId: candidate.sessionId },
          );
          if (res.error) {
            setError(`couldn't delete session: ${res.error.message}`);
            return;
          }
        }
      }
      deleted = true;
    } catch (err) {
      setError(`couldn't delete session: ${(err as Error).message}`);
      return;
    } finally {
      if (!deleted) setSessionDeleting(id, false);
    }
    // Drop selection if the active session is the one being deleted, then
    // refresh the list so the row disappears.
    if (selectedSession()?.sessionId === id) {
      setSelectedSession(null);
      setTranscript([]);
      resetConfirmedPermissionMode();
    }
    mutateSessions((current) => (current ?? []).filter((session) => session.sessionId !== id));
    try {
      await refetchSessions();
    } finally {
      setSessionDeleting(id, false);
    }
  }

  async function handleSessionGroupDelete(cwdToDelete: string, visibleRows: SessionEntry[] = []) {
    const dev = effectiveDeviceId();
    const inst = remoteClaudeInstance();
    if (!dev || !inst) return;
    setSessionGroupDeleteProgress(cwdToDelete, {});
    try {
      const res = await api.callBehavior<{ total: number; deleted: number; missing: number }>(
        dev,
        inst,
        "sessions.deleteByCwd",
        { cwd: cwdToDelete },
      );
      if (res.error) {
        if (!isBehaviorMethodNotFound(res.error, "sessions.deleteByCwd")) {
          setError(t("chat.error.delete-folder", { error: res.error.message }));
          setSessionGroupDeleteProgress(cwdToDelete, undefined);
          return;
        }
        const listRes = await api.callBehavior<ClaudeSessionSummary[]>(dev, inst, "sessions.list", {
          cwd: cwdToDelete,
          limit: 10000,
        });
        if (listRes.error) {
          setError(t("chat.error.delete-folder", { error: listRes.error.message }));
          setSessionGroupDeleteProgress(cwdToDelete, undefined);
          return;
        }
        const candidates = new Map<string, { cwd: string; sessionId: string }>();
        for (const row of listRes.result ?? []) {
          candidates.set(`${row.cwd}\n${row.sessionId}`, {
            cwd: row.cwd,
            sessionId: row.sessionId,
          });
        }
        for (const row of visibleRows) {
          const cwd = row.cwd ?? cwdToDelete;
          candidates.set(`${cwd}\n${row.sessionId}`, { cwd, sessionId: row.sessionId });
        }
        if (candidates.size === 0) {
          setSessionGroupDeleteProgress(cwdToDelete, undefined);
          return;
        }
        let completed = 0;
        setSessionGroupDeleteProgress(cwdToDelete, { completed, total: candidates.size });
        for (const row of candidates.values()) {
          const deleteRes = await api.callBehavior<{ deleted: boolean; path: string }>(
            dev,
            inst,
            "sessions.delete",
            { cwd: row.cwd, sessionId: row.sessionId },
          );
          if (deleteRes.error) {
            setError(t("chat.error.delete-folder", { error: deleteRes.error.message }));
            setSessionGroupDeleteProgress(cwdToDelete, undefined);
            return;
          }
          completed += 1;
          setSessionGroupDeleteProgress(cwdToDelete, { completed, total: candidates.size });
        }
      }
    } catch (err) {
      setError(t("chat.error.delete-folder", { error: (err as Error).message }));
      setSessionGroupDeleteProgress(cwdToDelete, undefined);
      return;
    }
    if (selectedSession()?.cwd === cwdToDelete) {
      setSelectedSession(null);
      setTranscript([]);
      setCwd("");
      resetConfirmedPermissionMode();
    }
    mutateSessions((current) => (current ?? []).filter((session) => session.cwd !== cwdToDelete));
    try {
      await refetchSessions();
    } catch (err) {
      setError(t("chat.error.delete-folder", { error: (err as Error).message }));
    } finally {
      setSessionGroupDeleteProgress(cwdToDelete, undefined);
    }
  }

  async function selectSession(id: string, _entry: SessionEntry | undefined) {
    const summary = (sessions() ?? []).find((s) => s.sessionId === id) ?? null;
    setSelectedSession(summary);
    setError(null);
    setShowNewChat(false);
    setSidebarOpen(false);
    if (!summary) {
      setTranscript([]);
      return;
    }
    setCwd(summary.cwd);
    resetConfirmedPermissionMode();
    const dev = effectiveDeviceId();
    const inst = remoteClaudeInstance();
    if (!dev || !inst) return;
    try {
      const res = await api.callBehavior<ClaudeSessionTranscript>(dev, inst, "sessions.read", {
        cwd: summary.cwd,
        sessionId: summary.sessionId,
        maxBytes: SESSION_READ_MAX_BYTES,
        eventLimit: SESSION_TRANSCRIPT_EVENT_LIMIT,
      });
      if (res.error) throw new Error(res.error.message);
      const rawEvents = (res.result?.events ?? []) as ClaudeStreamEvent[];
      const latestRawEvents = latestTranscriptEvents(rawEvents);
      const latestWindowPermissionMode = latestRawEvents.reduce<ClaudePermissionMode | null>(
        (mode, event) => permissionModeFromSystemInit(event) ?? mode,
        null,
      );
      const transcriptPermissionMode =
        normalizePermissionMode(res.result?.permissionMode) ?? latestWindowPermissionMode;
      const latestEvents = latestRawEvents.flatMap((event) => {
        const transcriptEvent = claudeEventForTranscript(event);
        return transcriptEvent ? [transcriptEvent] : [];
      });
      const locallyEventsTruncated = latestRawEvents.length < rawEvents.length;
      setTranscript(latestEvents);
      if (transcriptPermissionMode) {
        confirmPermissionMode(transcriptPermissionMode, transcriptPermissionMode);
      } else {
        resetConfirmedPermissionMode();
      }
      scrollTranscriptToBottom();
      if (res.result?.eventsTruncated || locallyEventsTruncated) {
        setTransientSessionNotice(
          t("chat.error.session-event-limited", { count: SESSION_TRANSCRIPT_EVENT_LIMIT }),
        );
      } else if (res.result?.truncated) {
        setTransientSessionNotice(
          t("chat.error.session-truncated", { mb: bytesToMiB(SESSION_READ_MAX_BYTES) }),
        );
      }
    } catch (err) {
      const message = (err as Error).message;
      if (isMissingSessionFileError(message)) {
        setSelectedSession(null);
        setTranscript([]);
        setCwd("");
        resetConfirmedPermissionMode();
        void refetchSessions();
        setTransientSessionNotice(t("chat.error.session-missing"));
        return;
      }
      setError(message);
      setTranscript([]);
    }
  }

  function openNewChat() {
    // The NewChatCard renders INSIDE the sidebar (cwd picker + start
    // button), so we explicitly keep the sidebar open here — closing it
    // would hide the very surface the user just clicked into. The
    // drawer closes when the cwd is confirmed (startSession) instead.
    setShowNewChat(true);
    setSelectedSession(null);
    setTranscript([]);
    setError(null);
    resetConfirmedPermissionMode();
  }

  /** Opening Settings while the mobile drawer is open leaves the drawer
   *  rendered behind the modal, so collapse the drawer first. */
  function openSettingsOverlay(options: SettingsOpenOptions = {}) {
    setSidebarOpen(false);
    props.onOpenSettings(options);
  }

  function openDeviceSettings() {
    openSettingsOverlay({ tab: "devices", deviceId: effectiveDeviceId() });
  }

  function openConnectionStatusAction(action: ConnectionStatusAction) {
    if (action === "diagnostics") {
      openSettingsOverlay({ tab: "diagnostics", deviceId: effectiveDeviceId() });
      return;
    }
    if (action === "devices") {
      openSettingsOverlay({ tab: "devices", deviceId: effectiveDeviceId() });
    }
  }

  function startSession(input: { cwd: string; permissionMode: ClaudePermissionMode }) {
    setCwd(input.cwd);
    setNextPermissionMode(input.permissionMode);
    setShowNewChat(false);
    setTranscript([]);
    setError(null);
    setSelectedSession(null);
    resetConfirmedPermissionMode();
    // User has committed to a chat — collapse the drawer so the
    // composer + transcript take the full mobile viewport.
    setSidebarOpen(false);
  }

  function appendLocalAssistantMessage(text: string) {
    appendTranscriptEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    });
  }

  function handleLocalSlashCommand(message: string): boolean {
    const trimmed = message.trim();
    const match = trimmed.match(/^\/(help|clear|model|permissions|status)(?:\s+(.+))?$/i);
    if (!match) return false;
    const command = match[1]?.toLowerCase();
    const arg = (match[2] ?? "").trim();
    const dev = effectiveDeviceId();
    const device = (devices() ?? []).find((d) => d.id === dev);

    if (command === "help") {
      const commands = composerSlashCommands();
      appendLocalAssistantMessage(
        [
          "Available slash commands:",
          "",
          ...commands.map((item) => `- \`${item.name}\` - ${item.hint}`),
        ].join("\n"),
      );
      return true;
    }

    if (command === "clear") {
      setTranscript([]);
      setError(null);
      resetConfirmedPermissionMode();
      appendLocalAssistantMessage("Transcript cleared.");
      return true;
    }

    if (command === "model") {
      if (!dev) {
        appendLocalAssistantMessage("No active device is selected.");
        return true;
      }
      if (!arg) {
        const current =
          selectedClaudeModel() ?? runtimeSlashCommands()?.model ?? "Claude CLI default";
        appendLocalAssistantMessage(
          [
            `Current model: ${current}`,
            "",
            "Use `/model sonnet`, `/model opus`, or `/model <model-id>` to set the model for future turns.",
            "Use `/model default` to return to the Claude CLI default.",
          ].join("\n"),
        );
        return true;
      }
      if (/^(default|reset|auto)$/i.test(arg)) {
        setDeviceClaudeModel(dev, null);
        setSelectedClaudeModel(null);
        appendLocalAssistantMessage(
          "Model override cleared. Future turns will use the Claude CLI default.",
        );
        return true;
      }
      if (!isSafeClaudeModel(arg)) {
        appendLocalAssistantMessage(
          "That model name is not valid here. Use a Claude model alias or id without spaces.",
        );
        return true;
      }
      setDeviceClaudeModel(dev, arg);
      setSelectedClaudeModel(arg);
      appendLocalAssistantMessage(
        `Model set to ${arg}. Future turns will run with \`--model ${arg}\`.`,
      );
      return true;
    }

    if (command === "permissions") {
      const mode = parsePermissionModeSlashArg(arg);
      if (!arg) {
        const confirmed = confirmedPermissionMode();
        appendLocalAssistantMessage(
          [
            `Confirmed permission mode: ${confirmed ?? "not confirmed"}`,
            `Next run permission mode: ${requestedPermissionMode()}`,
            `Security profile: ${dev ? getDeviceSecurityProfile(dev) : "unknown"}`,
            "",
            "Use `/permissions default`, `/permissions auto`, `/permissions plan`, `/permissions acceptEdits`, `/permissions dontAsk`, or `/permissions bypassPermissions` to set the next Claude run's requested permission mode.",
            "Use `/permissions settings` to open device security settings.",
          ].join("\n"),
        );
        return true;
      }
      if (/^(open|settings|security)$/i.test(arg)) {
        openSettingsOverlay({ tab: "devices", deviceId: dev });
        appendLocalAssistantMessage("Opened device settings for permission and security controls.");
        return true;
      }
      if (!mode) {
        appendLocalAssistantMessage(
          "Unknown permission mode. Use default, auto, plan, acceptEdits, dontAsk, or bypassPermissions.",
        );
        return true;
      }
      setNextPermissionMode(mode);
      appendLocalAssistantMessage(
        `Next run permission mode set to ${mode}. The current mode will update after Claude reports system:init.permissionMode.`,
      );
      return true;
    }

    if (command === "status") {
      const lines = [
        `Device: ${device ? deviceDisplayName(device) : "none selected"}`,
        `Connection: ${device?.connectionState ?? "unknown"}`,
        `Claude module: ${remoteClaudeInstance() ? "loaded" : "not ready"}`,
        `CWD: ${cwd().trim() || "not set"}`,
        `Session: ${selectedSession()?.sessionId ?? "new chat"}`,
        `Model: ${selectedClaudeModel() ?? runtimeSlashCommands()?.model ?? "Claude CLI default"}`,
        `Confirmed permission mode: ${confirmedPermissionMode() ?? "not confirmed"}`,
        `Next run permission mode: ${requestedPermissionMode()}`,
        `Run state: ${running() ? (cliAction() ?? "running") : "idle"}`,
      ];
      appendLocalAssistantMessage(lines.join("\n"));
      return true;
    }

    return false;
  }

  async function sendMessage(message: string) {
    setError(null);
    if (!message.trim() && (!attachmentsApi || attachmentsApi.list().length === 0)) return;
    const pendingAttachments = attachmentsApi?.list() ?? [];
    const content = [
      ...(message.trim() ? [{ type: "text", text: message }] : []),
      ...pendingAttachments.map((att) => ({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataBase64 },
      })),
    ];

    const userEvent: ClaudeStreamEvent = {
      type: "user",
      message: { role: "user", content },
    };

    if (pendingAttachments.length === 0 && isLocalSlashCommandText(message)) {
      appendTranscriptEvent(userEvent, { forceScroll: scrollToBottomOnSend() });
      attachmentsApi?.clear();
      if (handleLocalSlashCommand(message)) return;
    }

    const dev = effectiveDeviceId();
    const inst = remoteClaudeInstance();
    if (!dev || !inst) {
      setError(t("chat.error.no-device"));
      return;
    }
    if (!cwd().trim()) {
      setError(t("chat.error.no-cwd"));
      return;
    }
    appendTranscriptEvent(userEvent, { forceScroll: scrollToBottomOnSend() });
    attachmentsApi?.clear();

    setRunning(true);
    setCliAction(t("cli.action.starting"));

    const runId = `r${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const requestedModeForRun = requestedPermissionMode();
    const space = `remote-claude.run:${runId}`;
    const abort = new AbortController();
    setActiveRunId(runId);
    setLastPermissionModeRequest(requestedModeForRun);
    setPermissionModeStatus("pending");

    let markStreamReady = () => {};
    const streamReady = new Promise<void>((resolve) => {
      markStreamReady = resolve;
    });
    let streamSawRun = false;
    let chatAccepted = false;
    let streamSawSystemInit = false;

    const streamPromise = (async () => {
      try {
        for await (const env of api.streamEvents(dev, space, {
          signal: abort.signal,
          onOpen: markStreamReady,
        })) {
          const e = env as { kind?: string; content?: unknown };
          const action = describeCliActionFromEnvelope(e.kind, e.content);
          if (action) setCliAction(action);
          if (
            e.kind === "run.started" ||
            e.kind === "claude.event" ||
            e.kind === "run.finished" ||
            e.kind === "run.error"
          ) {
            streamSawRun = true;
          }
          if (e.kind === "claude.event" && e.content) {
            if (activeRunId() === runId && isClaudeSystemInit(e.content)) {
              streamSawSystemInit = true;
              const actualMode = permissionModeFromSystemInit(e.content);
              if (actualMode) {
                confirmPermissionMode(actualMode, requestedModeForRun);
              } else {
                setLastPermissionModeRequest(requestedModeForRun);
                setPermissionModeStatus("unknown");
              }
            }
            const transcriptEvent = claudeEventForTranscript(e.content);
            if (transcriptEvent) appendTranscriptEvent(transcriptEvent);
          } else if (e.kind === "run.error") {
            setError(runErrorMessage(e.content) ?? t("cli.action.error"));
            abort.abort();
            return;
          } else if (e.kind === "run.finished") {
            abort.abort();
            return;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        markStreamReady();
      }
    })();

    try {
      await Promise.race([
        streamReady,
        new Promise<void>((resolve) => setTimeout(resolve, STREAM_OPEN_GRACE_MS)),
      ]);
      const res = await api.callBehavior<{ ok: true; runId: string; eventCount: number }>(
        dev,
        inst,
        "chat",
        {
          cwd: cwd(),
          message,
          attachments: pendingAttachments,
          runId,
          permissionMode: requestedModeForRun,
          ...(selectedClaudeModel() ? { model: selectedClaudeModel() } : {}),
          // Per-device fail-policy hint for the PreToolUse hook. Persisted
          // in localStorage via Settings → Devices → device-prefs.
          securityProfile: getDeviceSecurityProfile(dev),
          ...(selectedSession()?.sessionId ? { sessionId: selectedSession()?.sessionId } : {}),
        },
      );
      if (res.error) {
        setError(res.error.message);
      } else {
        chatAccepted = true;
      }
    } catch (err) {
      if (
        streamSawRun &&
        err instanceof ApiError &&
        (err.status === 504 ||
          /relay timeout/i.test(err.message) ||
          ((err.body as { code?: unknown } | undefined)?.code === "timeout" &&
            (err.status === 502 || err.status === 504)))
      ) {
        // Older daemon/site pairs can still let the start request time out
        // while the run SSE is alive. Keep following the stream; run.error
        // will surface a real Claude failure if one arrives.
        chatAccepted = true;
      } else {
        setError((err as Error).message);
      }
    } finally {
      if (!chatAccepted && !streamSawRun) abort.abort();
      await streamPromise;
      if (chatAccepted && !streamSawSystemInit && activeRunId() === runId) {
        setLastPermissionModeRequest(requestedModeForRun);
        setPermissionModeStatus("unknown");
      }
      abort.abort();
      setRunning(false);
      setCliAction(null);
      setActiveRunId(null);
      attachmentsApi?.clear();
      void refetchSessions();
    }
  }

  async function interrupt() {
    const dev = effectiveDeviceId();
    const inst = remoteClaudeInstance();
    const runId = activeRunId();
    if (!dev || !inst || !runId) {
      setRunning(false);
      return;
    }
    try {
      const res = await api.callBehavior<{ ok: true; found: boolean }>(dev, inst, "interrupt", {
        runId,
      });
      if (res.error) setError(`couldn't stop: ${res.error.message}`);
    } catch (err) {
      setError(`couldn't stop: ${(err as Error).message}`);
    }
  }

  function handlePaste(event: ClipboardEvent) {
    const files = imagesFromClipboard(event);
    if (files.length > 0 && attachmentsApi) {
      event.preventDefault();
      void attachmentsApi.add(files);
      return;
    }
    // Non-image clipboard content falls through to the browser default.
  }

  function handleAttachClick() {
    attachmentsApi?.openPicker();
  }

  return (
    <section class="signed-in" id="signed-in-pane">
      <Show when={sidebarOpen()}>
        <button
          type="button"
          class="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label={t("chat.sidebar.close")}
        />
      </Show>

      <aside class={`sidebar${sidebarOpen() ? " sidebar-open" : ""}`}>
        <div class="sidebar-brand">
          <span class="brand">
            <img class="brand-mark" src="/deskrelay-logo-mark.svg" alt="" aria-hidden="true" />
            {t("app.brand")}
          </span>
        </div>

        <div class="sidebar-section sidebar-section-devices">
          <span class="sidebar-label">{t("chat.sidebar.device.label")}</span>
          <button
            type="button"
            class={`device-status-icon device-status-${deviceStatusTone()}`}
            aria-label={deviceStatusLabel()}
            title={deviceStatusLabel()}
            onClick={() => openSettingsOverlay({ tab: "devices", deviceId: effectiveDeviceId() })}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M6.5 17.5h11" />
              <path d="M8 14a5.7 5.7 0 0 1 8 0" />
              <path d="M10.1 10.8a8.7 8.7 0 0 1 7.8 0" />
            </svg>
          </button>
          <div class="row" style={{ gap: "6px" }}>
            <select
              class="text-input"
              style={{ flex: "1" }}
              value={effectiveDeviceId() ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === "__settings__") {
                  openSettingsOverlay({ tab: "devices", deviceId: effectiveDeviceId() });
                  e.currentTarget.value = effectiveDeviceId() ?? "";
                } else {
                  setSelectedDeviceId(v || null);
                  setSelectedSession(null);
                  setTranscript([]);
                  resetConfirmedPermissionMode();
                  void refetchBehaviors();
                }
              }}
            >
              <Show
                when={(devices() ?? []).length > 0}
                fallback={<option value="">{t("chat.sidebar.device.empty")}</option>}
              >
                <For each={devices() ?? []}>
                  {(d) => (
                    <option value={d.id}>
                      {d.connectionState === "offline"
                        ? t("chat.sidebar.device.offline-prefix", { label: deviceDisplayName(d) })
                        : deviceDisplayName(d)}
                    </option>
                  )}
                </For>
              </Show>
              <option value="__settings__">{t("chat.sidebar.device.manage")}</option>
            </select>
          </div>
          <Show
            when={(() => {
              const id = effectiveDeviceId();
              if (!id) return false;
              const dev = (devices() ?? []).find((x) => x.id === id);
              return dev?.connectionState === "offline";
            })()}
          >
            <p class="sidebar-help sidebar-help-warn">{t("chat.sidebar.device.offline-hint")}</p>
          </Show>
        </div>

        <div class="sidebar-section">
          <div class="sidebar-primary-row">
            <button
              type="button"
              class="sidebar-action sidebar-new-chat-action"
              onClick={openNewChat}
              disabled={!effectiveDeviceId()}
              aria-label={t("chat.sidebar.new.button")}
              title={
                effectiveDeviceId()
                  ? t("chat.sidebar.new.title.ready")
                  : t("chat.sidebar.new.title.no-device")
              }
            >
              <span aria-hidden="true" class="sidebar-action-plus">
                +
              </span>
            </button>
            <button
              type="button"
              class="sidebar-action sidebar-icon-action"
              classList={{ "is-active": showSessionSearch() }}
              onClick={toggleSessionSearch}
              aria-label={t("chat.sidebar.search.toggle")}
              aria-pressed={showSessionSearch()}
              title={t("chat.sidebar.search.toggle")}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
            </button>
          </div>
        </div>

        <Show when={showNewChat()}>
          <div class="new-chat-card">
            <NewChatCard
              deviceId={effectiveDeviceId()}
              deviceLabel={activeDevice()?.label ?? null}
              permissionMode={requestedPermissionMode()}
              onConfirm={startSession}
              onCancel={() => setShowNewChat(false)}
              initialCwd={newChatCwd()}
            />
          </div>
        </Show>

        <div class="sidebar-section sidebar-section-list">
          <span class="sidebar-label">{t("chat.sidebar.recent")}</span>
          <Show when={showSessionSearch()}>
            <input
              ref={(el) => {
                sessionSearchInput = el;
              }}
              type="search"
              class="text-input session-search"
              placeholder={t("chat.sidebar.search.placeholder")}
              aria-label={t("chat.sidebar.search.placeholder")}
              value={sessionSearch()}
              onInput={(e) => setSessionSearch(e.currentTarget.value)}
            />
          </Show>
          <SessionList
            entries={sessionEntries()}
            selectedId={selectedSession()?.sessionId ?? null}
            onSelect={selectSession}
            onDelete={(id) => void handleSessionDelete(id)}
            deletingIds={deletingSessionIds()}
            onDeleteGroup={(cwdToDelete, rows) => void handleSessionGroupDelete(cwdToDelete, rows)}
            deletingGroups={deletingSessionGroups()}
            groupByCwd={true}
          />
        </div>

        <div class="sidebar-section sidebar-section-bottom">
          <PermissionModePicker
            value={requestedPermissionMode()}
            onChange={setNextPermissionMode}
          />
          <CapabilitiesBadge events={transcript()} permissionMode={confirmedPermissionMode()} />
        </div>

        <div class="profile-card" id="profile-card">
          <div class="profile-avatar">D</div>
          <div class="profile-meta">
            <span class="profile-name">DeskRelay</span>
            <span class="profile-tag">{t("app.self-host")}</span>
          </div>
          <button
            type="button"
            class="sidebar-action profile-settings-action"
            aria-label={t("app.settings.aria")}
            title={t("app.settings.title")}
            style={{
              "margin-left": "auto",
              width: "auto",
              padding: "6px 8px",
            }}
            onClick={() => openDeviceSettings()}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            class="sidebar-action"
            aria-label={t("app.clear-access")}
            title={t("app.clear-access")}
            style={{
              width: "auto",
              padding: "6px 8px",
            }}
            onClick={props.onClearAccess ?? props.onSignOut ?? (() => undefined)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      <section class="chat" onPaste={handlePaste}>
        <div class="chat-header">
          <button
            type="button"
            class="hamburger"
            aria-label={t("chat.toggle-sidebar")}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>

        <div ref={transcriptScroller} class="transcript" onScroll={updateTranscriptBottomState}>
          <div class="transcript-inner">
            <Show
              when={transcript().length > 0 || selectedSession()}
              fallback={
                <Show
                  when={(devices() ?? []).length === 0}
                  fallback={
                    <div class="empty-chat">
                      <p>
                        {showNewChat() || cwd()
                          ? t("chat.empty.new-session")
                          : t("chat.empty.select-session")}
                      </p>
                    </div>
                  }
                >
                  {/* First-run state: signed in but no PC paired yet.
                      Push the pair flow front-and-center so the user
                      doesn't have to discover it through the sidebar. */}
                  <div class="empty-chat empty-chat-no-device">
                    <h2>{t("chat.empty.no-device.title")}</h2>
                    <p>{t("chat.empty.no-device.body")}</p>
                    <button
                      type="button"
                      class="primary-button"
                      onClick={() => openSettingsOverlay({ tab: "devices" })}
                    >
                      {t("chat.empty.no-device.cta")}
                    </button>
                  </div>
                </Show>
              }
            >
              <Transcript events={transcript()} deviceId={effectiveDeviceId()} cwd={cwd()} />
            </Show>
          </div>
        </div>

        <Show when={error()}>
          {(msg) => (
            // role="alert" announces the error to assistive tech without
            // relying on <output>, which is phrasing content and can't
            // legally contain the OfflineHint's block-level <div>.
            <div class="upstream-banner" role="alert">
              <span class="upstream-banner-message">
                {isDaemonOfflineMessage(msg())
                  ? daemonOfflineBannerMessage(activeDevice()?.label)
                  : msg()}
              </span>
              <OfflineHint
                message={msg()}
                deviceLabel={activeDevice()?.label}
                onPickDevice={() => setSidebarOpen(true)}
              />
            </div>
          )}
        </Show>
        <div class="composer-shell">
          <Show when={!transcriptAtBottom() && transcript().length > 0}>
            <button
              type="button"
              class="scroll-to-bottom-button"
              aria-label={t("chat.scroll-to-bottom.aria")}
              title={t("chat.scroll-to-bottom.title")}
              onClick={handleScrollToBottomClick}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 5v14" />
                <path d="m6 13 6 6 6-6" />
              </svg>
            </button>
          </Show>
          <output
            class={`composer-status composer-status-${connectionStatus().tone}`}
            aria-live="polite"
          >
            <span class="composer-status-main">{t(connectionStatus().mainKey)}</span>
            <span class="composer-status-detail">
              {connectionStatusDetail()} · {permissionModeStatusText()}
            </span>
            <Show when={connectionStatus().action}>
              {(action) => (
                <button
                  type="button"
                  class="composer-status-action"
                  onClick={() => openConnectionStatusAction(action())}
                >
                  {t(`connection.action.${action()}`)}
                </button>
              )}
            </Show>
          </output>
          <Attachments
            ref={(api) => {
              attachmentsApi = api;
            }}
            onChange={(items) => setAttachmentCount(items.length)}
          />
          <Composer
            onSend={sendMessage}
            onInterrupt={() => void interrupt()}
            inFlight={running()}
            hasExtraContent={() => attachmentCount() > 0}
            onAttachClick={handleAttachClick}
            slashCommands={composerSlashCommands()}
          />
        </div>
      </section>

      {/* Refresh devices when nothing has loaded yet — runs once on mount. */}
      <Show when={!effectiveDeviceId()}>
        <RefreshOnMount onMount={() => void refetchDevices()} />
      </Show>

      {/* Always mounted — subscribes to the active device's approval
          space and pops a modal when claude requests a tool. */}
      <ApprovalModal deviceId={effectiveDeviceId()} />
    </section>
  );
};

function bytesToMiB(bytes: number): number {
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

const RefreshOnMount: Component<{ onMount: () => void }> = (props) => {
  props.onMount();
  return null;
};
