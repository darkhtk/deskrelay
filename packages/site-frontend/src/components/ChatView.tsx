// ChatView -- full DeskRelay chat experience.
//
// Layout: sidebar (device picker, sessions, profile) + main (transcript +
// composer). The class names + structure mirror the index.html shell
// from the original browser prototype so styles.css (also ported
// from there) styles them correctly.

import type { ManagerAssistantChatContext } from "@deskrelay/shared";
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
  type ClaudeInstructionScope,
  type ClaudeInstructionSource,
  type ClaudeSessionSummary,
  type ClaudeSessionTranscript,
  type ClaudeStreamEvent,
  type Device,
  api,
} from "../api.ts";
import {
  SESSION_TRANSCRIPT_CACHE_TTL_MS,
  clearDeskRelayBrowserCache,
  clearSessionTranscriptCache,
  readBrowserCacheValue,
  sessionTranscriptCacheKey,
  writeBrowserCacheValue,
} from "../browser-cache.ts";
import {
  claudeEventForTranscript,
  describeCliActionFromEnvelope,
  isApprovalWaitingAction,
} from "../claude/cli-action.ts";
import {
  type RuntimeSlashCommands,
  isKnownClaudeCommandName,
  mergeRuntimeSlashCommands,
  normalizeSlashCommandName,
} from "../claude/slash-commands.ts";
import {
  CLAUDE_PERMISSION_MODES,
  CLAUDE_PERMISSION_MODE_VALUES,
  type ClaudePermissionMode,
} from "../claude/stream-contract.ts";
import {
  type ConnectionStatusAction,
  type ConnectionStatusTone,
  deriveConnectionStatus,
} from "../connection-status.ts";
import type { ConversationExportSnapshot } from "../conversation-export.ts";
import { deviceDisplayName } from "../device-display.ts";
import {
  getDeviceClaudeModel,
  getDeviceDefaultCwd,
  getDeviceSecurityProfile,
  isSafeClaudeModel,
  setDeviceClaudeModel,
} from "../device-prefs.ts";
import {
  confirmPermissionModeState,
  createPermissionModeState,
  markPermissionModePending,
  markPermissionModeUnknown,
  permissionModeAlert,
  resetConfirmedPermissionModeState,
  setNextPermissionModeState,
} from "../domain/permission-mode-state.ts";
import { t } from "../i18n.ts";
import {
  applyTemporaryInstructionsToMessage,
  chatTranscriptEventLimit,
  newChatCwdBrowseMode,
  scrollToBottomOnSend,
} from "../ui-prefs.ts";
import { ApprovalModal } from "./ApprovalModal.tsx";
import { Attachments, type AttachmentsAPI, imagesFromClipboard } from "./Attachments.tsx";
import { CapabilitiesBadge } from "./CapabilitiesBadge.tsx";
import { Composer } from "./Composer.tsx";
import {
  type InstructionEditorHeaderState,
  InstructionsWorkspace,
} from "./InstructionsWorkspace.tsx";
import { ManagerAssistant } from "./ManagerAssistant.tsx";
import { NewChatCard } from "./NewChatCard.tsx";
import { OfflineHint, daemonOfflineBannerMessage, isDaemonOfflineMessage } from "./OfflineHint.tsx";
import { PermissionModePicker } from "./PermissionModePicker.tsx";
import { type SessionEntry, type SessionGroupDeleteProgress, SessionList } from "./SessionList.tsx";
import { SettingsScopeLabel, SettingsScopeLabels } from "./SettingsScopeLabel.tsx";
import { Transcript } from "./Transcript.tsx";

const SESSION_LIMIT = 200;
const SESSION_READ_MAX_BYTES = 8 * 1024 * 1024;
const SESSION_NOTICE_AUTO_DISMISS_MS = 5000;
const BEHAVIOR_READY_RETRY_MS = 1000;
const BEHAVIOR_READY_MAX_RETRIES = 15;
const DEVICE_OFFLINE_REFETCH_MS = 1500;
const STREAM_OPEN_GRACE_MS = 2500;
const CONTEXT_USAGE_POLL_MS = 5 * 60 * 1000;
const CONTEXT_USAGE_CACHE_TTL_MS = 60 * 1000;
const USAGE_LIMITS_CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_CACHE_KEY_PREFIX = "cr.usage-cache";
const DEFAULT_NEW_CHAT_CWD = "C:\\Users\\";
const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 32;
const SIDEBAR_WIDTH_STORAGE_KEY = "cr.sidebar-width";
const ASSISTANT_WIDTH_STORAGE_KEY = "cr.assistant-width";
const CHAT_SELECTED_DEVICE_STORAGE_KEY = "cr.chat-selected-device-id";
const CHAT_SELECTED_SESSIONS_STORAGE_KEY = "cr.chat-selected-sessions";
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = SIDEBAR_MIN_WIDTH * 2;
const SIDEBAR_COLLAPSE_DRAG_THRESHOLD = 32;
const SIDEBAR_RESIZE_KEYBOARD_STEP = 20;
const ASSISTANT_MIN_WIDTH = 320;
const ASSISTANT_MAX_WIDTH = ASSISTANT_MIN_WIDTH * 2;
const ASSISTANT_COLLAPSE_DRAG_THRESHOLD = 32;
const ASSISTANT_RESIZE_KEYBOARD_STEP = 20;

interface StoredChatDeviceSelection {
  id?: string;
  label?: string;
  daemonUrl?: string;
}

interface StoredChatSessionSelection {
  sessionId?: string;
  cwd?: string;
  modifiedAt?: string;
}

type StoredChatSessionSelections = Record<string, StoredChatSessionSelection>;

function latestTranscriptEvents(events: ClaudeStreamEvent[]): ClaudeStreamEvent[] {
  const limit = chatTranscriptEventLimit();
  return events.length > limit ? events.slice(-limit) : events;
}

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_MIN_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

function readSidebarWidth(): number {
  if (typeof localStorage === "undefined") return SIDEBAR_MIN_WIDTH;
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return clampSidebarWidth(stored);
  } catch {
    return SIDEBAR_MIN_WIDTH;
  }
}

function writeSidebarWidth(value: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(value)));
  } catch {
    // Ignore private-mode/localStorage failures; the in-memory width still works.
  }
}

function clampAssistantWidth(value: number): number {
  if (!Number.isFinite(value)) return 380;
  return Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, Math.round(value)));
}

function readAssistantWidth(): number {
  if (typeof localStorage === "undefined") return 380;
  try {
    const stored = Number(localStorage.getItem(ASSISTANT_WIDTH_STORAGE_KEY));
    return clampAssistantWidth(stored);
  } catch {
    return 380;
  }
}

function writeAssistantWidth(value: number) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, String(clampAssistantWidth(value)));
  } catch {
    // Ignore private-mode/localStorage failures; the in-memory width still works.
  }
}

function cleanStoredDeviceSelection(
  selection: StoredChatDeviceSelection,
): StoredChatDeviceSelection | null {
  const next: StoredChatDeviceSelection = {};
  if (typeof selection.id === "string" && selection.id.trim()) next.id = selection.id.trim();
  if (typeof selection.label === "string" && selection.label.trim()) {
    next.label = selection.label.trim();
  }
  if (typeof selection.daemonUrl === "string" && selection.daemonUrl.trim()) {
    next.daemonUrl = selection.daemonUrl.trim();
  }
  return next.id || next.label || next.daemonUrl ? next : null;
}

function normalizeStoredDeviceUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function deviceSelectionFromDevice(device: Device): StoredChatDeviceSelection {
  return {
    id: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
  };
}

function sameStoredDeviceSelection(
  a: StoredChatDeviceSelection | null,
  b: StoredChatDeviceSelection | null,
): boolean {
  const left = a ? cleanStoredDeviceSelection(a) : null;
  const right = b ? cleanStoredDeviceSelection(b) : null;
  return (
    (left?.id ?? "") === (right?.id ?? "") &&
    (left?.label ?? "") === (right?.label ?? "") &&
    normalizeStoredDeviceUrl(left?.daemonUrl) === normalizeStoredDeviceUrl(right?.daemonUrl)
  );
}

function resolveStoredDeviceSelection(
  selection: StoredChatDeviceSelection | null,
  list: Device[] | undefined,
): Device | null {
  const stored = selection ? cleanStoredDeviceSelection(selection) : null;
  if (!stored || !list?.length) return null;
  if (stored.id) {
    const byId = list.find((device) => device.id === stored.id);
    if (byId) return byId;
  }
  const storedUrl = normalizeStoredDeviceUrl(stored.daemonUrl);
  if (storedUrl) {
    const byUrl = list.find((device) => normalizeStoredDeviceUrl(device.daemonUrl) === storedUrl);
    if (byUrl) return byUrl;
  }
  if (stored.label) {
    const byLabel = list.find((device) => device.label === stored.label);
    if (byLabel) return byLabel;
  }
  return null;
}

function readStoredChatDeviceSelection(): StoredChatDeviceSelection | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(CHAT_SELECTED_DEVICE_STORAGE_KEY)?.trim();
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") {
        return cleanStoredDeviceSelection(parsed as StoredChatDeviceSelection);
      }
    } catch {
      // Older builds stored just the device id as a plain string.
    }
    return cleanStoredDeviceSelection({ id: value });
  } catch {
    return null;
  }
}

function writeStoredChatDeviceSelection(selection: StoredChatDeviceSelection | null) {
  if (typeof localStorage === "undefined") return;
  try {
    const next = selection ? cleanStoredDeviceSelection(selection) : null;
    if (next) {
      localStorage.setItem(CHAT_SELECTED_DEVICE_STORAGE_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(CHAT_SELECTED_DEVICE_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory selection even when browser storage is unavailable.
  }
}

function cleanStoredSessionSelection(
  selection: StoredChatSessionSelection,
): StoredChatSessionSelection | null {
  const sessionId = selection.sessionId?.trim();
  if (!sessionId) return null;
  const next: StoredChatSessionSelection = { sessionId };
  if (selection.cwd?.trim()) next.cwd = selection.cwd.trim();
  if (selection.modifiedAt?.trim()) next.modifiedAt = selection.modifiedAt.trim();
  return next;
}

function sessionSelectionFromSummary(summary: ClaudeSessionSummary): StoredChatSessionSelection {
  return {
    sessionId: summary.sessionId,
    cwd: summary.cwd,
    modifiedAt: summary.modifiedAt,
  };
}

function readStoredChatSessionSelections(): StoredChatSessionSelections {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = localStorage.getItem(CHAT_SELECTED_SESSIONS_STORAGE_KEY)?.trim();
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: StoredChatSessionSelections = {};
    for (const [deviceId, rawSelection] of Object.entries(parsed as Record<string, unknown>)) {
      if (!deviceId.trim() || !rawSelection || typeof rawSelection !== "object") continue;
      const selection = cleanStoredSessionSelection(rawSelection as StoredChatSessionSelection);
      if (selection) next[deviceId.trim()] = selection;
    }
    return next;
  } catch {
    return {};
  }
}

function writeStoredChatSessionSelections(selections: StoredChatSessionSelections) {
  if (typeof localStorage === "undefined") return;
  try {
    const next: StoredChatSessionSelections = {};
    for (const [deviceId, selection] of Object.entries(selections)) {
      const cleanDeviceId = deviceId.trim();
      const cleanSelection = cleanStoredSessionSelection(selection);
      if (cleanDeviceId && cleanSelection) next[cleanDeviceId] = cleanSelection;
    }
    if (Object.keys(next).length) {
      localStorage.setItem(CHAT_SELECTED_SESSIONS_STORAGE_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(CHAT_SELECTED_SESSIONS_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory selection even when browser storage is unavailable.
  }
}

function readStoredChatSessionSelection(
  deviceId: string | null,
): StoredChatSessionSelection | null {
  if (!deviceId) return null;
  return readStoredChatSessionSelections()[deviceId] ?? null;
}

function writeStoredChatSessionSelection(
  deviceId: string | null,
  selection: StoredChatSessionSelection | null,
) {
  if (!deviceId) return;
  const selections = readStoredChatSessionSelections();
  const cleanSelection = selection ? cleanStoredSessionSelection(selection) : null;
  if (cleanSelection) {
    selections[deviceId] = cleanSelection;
  } else {
    delete selections[deviceId];
  }
  writeStoredChatSessionSelections(selections);
}

function resolveStoredSessionSelection(
  selection: StoredChatSessionSelection | null,
  list: ClaudeSessionSummary[] | undefined,
): ClaudeSessionSummary | null {
  const stored = selection ? cleanStoredSessionSelection(selection) : null;
  if (!stored || !list?.length) return null;
  if (stored.cwd) {
    const exact = list.find(
      (summary) => summary.sessionId === stored.sessionId && summary.cwd === stored.cwd,
    );
    if (exact) return exact;
  }
  return list.find((summary) => summary.sessionId === stored.sessionId) ?? null;
}

function runErrorMessage(content: unknown): string | null {
  if (typeof content !== "object" || content === null) return null;
  const message = (content as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

function isMissingSessionFileError(message: string): boolean {
  return /\bENOENT\b/.test(message) && /\.jsonl\b/i.test(message);
}

export interface ContextUsageSnapshot {
  remainingPercent: number | null;
  usedPercent: number | null;
  source: "event" | "text";
  resetAt?: string;
  rateLimitType?: string;
  status?: string;
}

export interface ContextUsageOverview {
  ctx: ContextUsageSnapshot | null;
  session: ContextUsageSnapshot | null;
  week: ContextUsageSnapshot | null;
}

interface ContextUsageResult {
  usage: ContextUsageSnapshot | null;
  eventCount: number;
  checkedAt: string;
}

interface UsageLimitsResult {
  session: ContextUsageSnapshot | null;
  week: ContextUsageSnapshot | null;
  sonnetWeek?: ContextUsageSnapshot | null;
  checkedAt: string;
}

interface ClaudeAccountInfo {
  status: "logged_in" | "not_logged_in";
  source: "oauth" | "env" | "none";
  checkedAt: string;
  accountId?: string;
  displayName?: string;
  email?: string;
  subscriptionType?: string;
  error?: string;
}

export function latestContextUsageSnapshot(
  events: ClaudeStreamEvent[],
): ContextUsageSnapshot | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const snapshot = contextUsageFromEvent(events[i]);
    if (snapshot) return snapshot;
  }
  return null;
}

function latestRateLimitUsageSnapshot(
  events: ClaudeStreamEvent[],
  target: "five_hour" | "weekly",
): ContextUsageSnapshot | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const snapshot = rateLimitUsageFromEvent(events[i], target);
    if (snapshot) return snapshot;
  }
  return null;
}

function rateLimitUsageFromEvent(
  event: unknown,
  target: "five_hour" | "weekly",
): ContextUsageSnapshot | null {
  const record = asRecord(event);
  if (!record || record.type !== "rate_limit_event") return null;
  const info = asRecord(record.rate_limit_info);
  if (!info) return null;
  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : "";
  const normalizedType = rateLimitType.toLowerCase().replace(/[-\s]+/g, "_");
  const isTarget =
    target === "five_hour"
      ? normalizedType === "five_hour" || normalizedType === "session"
      : normalizedType === "weekly" || normalizedType === "week";
  if (!isTarget) return null;

  const usedPercent = firstPercent(info, ["used_percentage", "usedPercentage", "used_percent"]);
  const resetsAt = numericValue(info.resetsAt);
  const resetAt =
    resetsAt !== null && resetsAt > 0 ? new Date(resetsAt * 1000).toISOString() : undefined;
  const status = typeof info.status === "string" ? info.status : undefined;
  return {
    remainingPercent: usedPercent === null ? null : clampPercent(100 - usedPercent),
    usedPercent,
    source: "event",
    rateLimitType,
    ...(resetAt ? { resetAt } : {}),
    ...(status ? { status } : {}),
  };
}

function contextUsageFromEvent(event: unknown): ContextUsageSnapshot | null {
  const record = asRecord(event);
  if (!record) return null;
  const message = asRecord(record.message);
  const candidates = [
    record,
    asRecord(record.usage),
    asRecord(record.context),
    asRecord(record.result),
    message,
    message ? asRecord(message.usage) : null,
    message ? asRecord(message.context) : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const snapshot = contextUsageFromRecord(candidate);
    if (snapshot) return snapshot;
  }
  for (const text of contextTextFields(record)) {
    const snapshot = contextUsageFromText(text);
    if (snapshot) return snapshot;
  }
  return null;
}

function contextUsageFromRecord(record: Record<string, unknown>): ContextUsageSnapshot | null {
  const remaining = firstPercent(record, [
    "context_remaining_percent",
    "contextRemainingPercent",
    "remaining_context_percent",
    "remainingContextPercent",
    "remaining_percent",
    "remainingPercent",
  ]);
  if (remaining !== null) return usageFromRemaining(remaining, "event");

  const used = firstPercent(record, [
    "context_usage_percent",
    "contextUsagePercent",
    "context_used_percent",
    "contextUsedPercent",
    "used_percent",
    "usedPercent",
    "percent_used",
    "percentUsed",
  ]);
  if (used !== null) return usageFromUsed(used, "event");

  const maxTokens = firstNumber(record, [
    "context_window",
    "contextWindow",
    "context_window_tokens",
    "contextWindowTokens",
    "max_context_tokens",
    "maxContextTokens",
    "max_tokens",
    "maxTokens",
    "limit",
  ]);
  if (!maxTokens || maxTokens <= 0) return null;

  const remainingTokens = firstNumber(record, [
    "remaining_tokens",
    "remainingTokens",
    "context_remaining_tokens",
    "contextRemainingTokens",
  ]);
  if (remainingTokens !== null)
    return usageFromRemaining((remainingTokens / maxTokens) * 100, "event");

  const usedTokens = firstNumber(record, [
    "used_tokens",
    "usedTokens",
    "context_used_tokens",
    "contextUsedTokens",
    "input_tokens",
    "inputTokens",
    "total_tokens",
    "totalTokens",
  ]);
  return usedTokens !== null ? usageFromUsed((usedTokens / maxTokens) * 100, "event") : null;
}

function contextUsageFromText(text: string): ContextUsageSnapshot | null {
  if (!text || !/\bcontext\b/i.test(text) || !/%/.test(text)) return null;
  const normalized = text.replace(/\s+/g, " ");

  const freeSpaceMatch = normalized.match(
    /\|\s*Free space\s*\|[^|]*\|\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\|/i,
  );
  if (freeSpaceMatch?.[1]) return usageFromRemaining(Number(freeSpaceMatch[1]), "text");

  const claudeContextTokensMatch = normalized.match(
    /\*\*Tokens:\*\*\s*[^()]*\((\d{1,3}(?:\.\d+)?)\s*%\)/i,
  );
  if (claudeContextTokensMatch?.[1]) {
    return usageFromUsed(Number(claudeContextTokensMatch[1]), "text");
  }

  const remainingMatch =
    normalized.match(/(?:remaining|left|available|free)[^0-9%]{0,48}(\d{1,3}(?:\.\d+)?)\s*%/i) ??
    normalized.match(/(\d{1,3}(?:\.\d+)?)\s*%[^.]{0,48}(?:remaining|left|available|free)/i);
  if (remainingMatch?.[1]) return usageFromRemaining(Number(remainingMatch[1]), "text");

  const usedMatch =
    normalized.match(/(?:used|usage|full)[^0-9%]{0,48}(\d{1,3}(?:\.\d+)?)\s*%/i) ??
    normalized.match(/(\d{1,3}(?:\.\d+)?)\s*%[^.]{0,48}(?:used|usage|full)/i);
  return usedMatch?.[1] ? usageFromUsed(Number(usedMatch[1]), "text") : null;
}

function contextTextFields(record: Record<string, unknown>): string[] {
  const fields = [messageText(record)];
  if (typeof record.result === "string") fields.push(record.result);
  if (typeof record.content === "string") fields.push(record.content);
  if (typeof record.text === "string") fields.push(record.text);
  return fields.filter((field) => field.trim().length > 0);
}

function messageText(record: Record<string, unknown>): string {
  const message = asRecord(record.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const item = asRecord(block);
      return typeof item?.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstPercent(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numericValue(record[key]);
    if (value !== null) return clampPercent(value);
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numericValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/%$/, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function usageFromRemaining(
  value: number,
  source: ContextUsageSnapshot["source"],
): ContextUsageSnapshot {
  const remainingPercent = clampPercent(value);
  return {
    remainingPercent,
    usedPercent: clampPercent(100 - remainingPercent),
    source,
  };
}

function usageFromUsed(
  value: number,
  source: ContextUsageSnapshot["source"],
): ContextUsageSnapshot {
  const usedPercent = clampPercent(value);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    source,
  };
}

function encodedUsageCachePart(value: string | null | undefined): string {
  return encodeURIComponent(value?.trim() || "-");
}

function contextUsageCacheKey(input: {
  deviceId: string;
  instanceId: string;
  cwd: string;
  sessionId: string | null;
  permissionMode: ClaudePermissionMode;
  model: string | null;
}): string {
  return [
    USAGE_CACHE_KEY_PREFIX,
    "ctx",
    encodedUsageCachePart(input.deviceId),
    encodedUsageCachePart(input.instanceId),
    encodedUsageCachePart(input.cwd),
    encodedUsageCachePart(input.sessionId),
    encodedUsageCachePart(input.permissionMode),
    encodedUsageCachePart(input.model),
  ].join(":");
}

function usageLimitsCacheKey(deviceId: string, instanceId: string): string {
  return [
    USAGE_CACHE_KEY_PREFIX,
    "limits",
    encodedUsageCachePart(deviceId),
    encodedUsageCachePart(instanceId),
  ].join(":");
}

function readUsageCache<T>(key: string, ttlMs: number): T | undefined {
  return readBrowserCacheValue<T>(key, ttlMs);
}

function writeUsageCache<T>(key: string, value: T): void {
  writeBrowserCacheValue(key, value);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
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
  tab?: "general" | "devices" | "assistant" | "diagnostics" | "instructions";
  deviceId?: string | null;
};

type DeviceSelectionRequest = {
  id: string | null;
  seq: number;
};

type SidebarTab = "sessions" | "permissions" | "instructions" | "skills";

interface PermissionSourceSummary {
  label: string;
  path: string;
  exists: boolean;
  allow: string[];
  deny: string[];
  ask: string[];
  defaultMode?: string;
  error?: string;
}

interface PermissionsInspectResult {
  sources: PermissionSourceSummary[];
}

interface PermissionsUpdateResult {
  source: PermissionSourceSummary;
}

interface PermissionsInspectViewResult extends PermissionsInspectResult {
  error?: string;
}

interface RuntimeSkillView {
  name: string;
  kind: "builtin" | "added";
  description: string;
  path?: string;
  removable: boolean;
}

interface SkillInspectSummary {
  name: string;
  description?: string;
  path?: string;
  source: "user" | "project" | "runtime";
  removable: boolean;
}

interface SkillsInspectResult {
  skills: SkillInspectSummary[];
}

interface SkillDeleteResult {
  deleted: boolean;
  skill: SkillInspectSummary;
}

interface InstructionsInspectViewResult {
  cwd: string;
  sources: ClaudeInstructionSource[];
  error?: string;
}

const ALL_PERMISSION_ENTRY = "*";
const AVAILABLE_PERMISSION_TOOLS = [
  "Bash",
  "Grep",
  "Glob",
  "LS",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookRead",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
];
const WORKSPACE_INSTRUCTION_SCOPES: ClaudeInstructionScope[] = [
  "project",
  "projectClaude",
  "local",
];

function permissionToolEntry(tool: string): string {
  return `${tool}(*)`;
}

function permissionEntryLabel(entry: string): string {
  return entry === ALL_PERMISSION_ENTRY ? "All" : entry;
}

function uniquePermissionList(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const entry = item.trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function samePermissionList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function updatePermissionSourceResult(
  current: PermissionsInspectViewResult | null | undefined,
  updated: PermissionSourceSummary,
): PermissionsInspectViewResult {
  if (!current || current.error) return { sources: [updated] };
  return {
    ...current,
    sources: current.sources.map((source) => (source.path === updated.path ? updated : source)),
  };
}

function sameInstructionContent(a: string, b: string): boolean {
  return a === b;
}

function instructionScopeLabel(scope: ClaudeInstructionScope): string {
  if (scope === "project") return t("chat.sidebar.instructions.source.project");
  if (scope === "projectClaude") return t("chat.sidebar.instructions.source.project-claude");
  if (scope === "local") return t("chat.sidebar.instructions.source.local");
  if (scope === "user") return t("chat.sidebar.instructions.source.user");
  return t("chat.sidebar.instructions.source.managed");
}

function instructionPathForScope(scope: ClaudeInstructionScope, cwd: string): string {
  if (scope === "user") return "~/.claude/CLAUDE.md";
  if (scope === "managed") return t("instructions.path.managed");
  const sep = cwd.includes("\\") ? "\\" : "/";
  const base = cwd.replace(/[\\/]+$/, "");
  if (scope === "project") return `${base}${sep}CLAUDE.md`;
  if (scope === "projectClaude") return `${base}${sep}.claude${sep}CLAUDE.md`;
  return `${base}${sep}CLAUDE.local.md`;
}

function fallbackWorkspaceInstructionSource(
  scope: ClaudeInstructionScope,
  cwd: string,
): ClaudeInstructionSource {
  return {
    scope,
    label: instructionScopeLabel(scope),
    path: instructionPathForScope(scope, cwd),
    readonly: false,
    exists: false,
    content: "",
  };
}

function completeWorkspaceInstructionSources(
  sources: ClaudeInstructionSource[],
  cwd: string,
): ClaudeInstructionSource[] {
  const byScope = new Map(sources.map((source) => [source.scope, source]));
  return WORKSPACE_INSTRUCTION_SCOPES.map(
    (scope) => byScope.get(scope) ?? fallbackWorkspaceInstructionSource(scope, cwd),
  );
}

function instructionExpectedHash(source: ClaudeInstructionSource): { expectedHash?: string } {
  if (!source.exists) return { expectedHash: "missing" };
  return source.hash ? { expectedHash: source.hash } : {};
}

function formatInstructionLoadError(err: unknown): string {
  const message = (err as Error).message || String(err);
  const normalized = message.toLowerCase();
  if (
    normalized === "not found" ||
    normalized.includes("http 404") ||
    normalized.includes("404 not found")
  ) {
    return `${message} - 실행 중인 DeskRelay 서버 또는 선택한 디바이스 connector가 지침 API를 지원하지 않는 오래된 코드입니다. 서버와 connector를 최신 코드로 재시작하세요.`;
  }
  return message;
}

function updateInstructionSourceResult(
  current: InstructionsInspectViewResult | null | undefined,
  updated: ClaudeInstructionSource,
  cwd: string,
): InstructionsInspectViewResult {
  const sources = completeWorkspaceInstructionSources(current?.sources ?? [], cwd).map((source) =>
    source.scope === updated.scope ? updated : source,
  );
  return { cwd, sources };
}

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
  onContextUsageChange?: (usage: ContextUsageOverview) => void;
  onActiveWorkspaceChange?: (workspace: { deviceId: string | null; cwd: string }) => void;
  onConversationExportChange?: (snapshot: ConversationExportSnapshot | null) => void;
  showContextUsageMeter?: boolean;
}

interface ComposerGuidance {
  tone: ConnectionStatusTone | "context";
  main: string;
  detail?: string | undefined;
  action?: ConnectionStatusAction;
}

interface QueueUpdatedEnvelope {
  runId?: unknown;
  status?: unknown;
  pendingCount?: unknown;
  activeRunId?: unknown;
}

function createDraftConversationId(): string {
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

  const initialDeviceSelection = readStoredChatDeviceSelection();
  const [storedDeviceSelection, setStoredDeviceSelection] =
    createSignal<StoredChatDeviceSelection | null>(initialDeviceSelection);
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | null>(
    initialDeviceSelection?.id ?? null,
  );
  const [appliedDeviceSelectionSeq, setAppliedDeviceSelectionSeq] = createSignal<number | null>(
    null,
  );
  const effectiveDeviceId = () => {
    const selected = selectedDeviceId();
    const list = devices();
    if (selected && (!list || list.some((device) => device.id === selected))) return selected;
    return resolveStoredDeviceSelection(storedDeviceSelection(), list)?.id ?? defaultDeviceId(list);
  };
  const [selectedClaudeModel, setSelectedClaudeModel] = createSignal<string | null>(null);
  const [mainPanelMode, setMainPanelMode] = createSignal<"chat" | "instructions">("chat");
  const [instructionEditorHeaderState, setInstructionEditorHeaderState] =
    createSignal<InstructionEditorHeaderState | null>(null);

  function selectDeviceId(deviceId: string | null) {
    const device = deviceId ? (devices() ?? []).find((d) => d.id === deviceId) : null;
    const nextSelection = device
      ? deviceSelectionFromDevice(device)
      : deviceId
        ? ({ id: deviceId } satisfies StoredChatDeviceSelection)
        : null;
    setSelectedDeviceId(deviceId);
    setStoredDeviceSelection(nextSelection);
    writeStoredChatDeviceSelection(nextSelection);
  }

  createEffect(() => {
    const request = props.requestedDeviceSelection;
    if (!request || request.seq <= 0 || appliedDeviceSelectionSeq() === request.seq) return;
    if (!request.id) {
      selectDeviceId(null);
      setAppliedDeviceSelectionSeq(request.seq);
      return;
    }
    const list = devices();
    if (!list?.some((device) => device.id === request.id)) return;
    selectDeviceId(request.id);
    setAppliedDeviceSelectionSeq(request.seq);
  });

  createEffect(() => {
    const selected = selectedDeviceId();
    const list = devices();
    if (!list) return;
    const stored = storedDeviceSelection();
    const resolved = resolveStoredDeviceSelection(stored, list);
    if (resolved) {
      if (selected !== resolved.id) setSelectedDeviceId(resolved.id);
      const canonical = deviceSelectionFromDevice(resolved);
      if (!sameStoredDeviceSelection(stored, canonical)) {
        setStoredDeviceSelection(canonical);
        writeStoredChatDeviceSelection(canonical);
      }
      return;
    }
    if (!selected) return;
    const selectedDevice = list.find((d) => d.id === selected);
    if (selectedDevice) {
      const canonical = deviceSelectionFromDevice(selectedDevice);
      if (!sameStoredDeviceSelection(stored, canonical)) {
        setStoredDeviceSelection(canonical);
        writeStoredChatDeviceSelection(canonical);
      }
      return;
    }
    selectDeviceId(null);
    setSelectedSession(null);
    setTranscript([]);
    clearContextUsage();
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

  const [cliAccount] = createResource(
    () => {
      const deviceId = effectiveDeviceId();
      const instanceId = remoteClaudeInstance();
      if (!deviceId || !instanceId) return null;
      return { deviceId, instanceId };
    },
    async (input) => {
      if (!input) return null;
      try {
        const res = await api.callBehavior<ClaudeAccountInfo>(
          input.deviceId,
          input.instanceId,
          "account.info",
          {},
        );
        if (res.error) {
          return {
            status: "not_logged_in",
            source: "none",
            checkedAt: new Date().toISOString(),
            error: res.error.message,
          } satisfies ClaudeAccountInfo;
        }
        return res.result ?? null;
      } catch (err) {
        return {
          status: "not_logged_in",
          source: "none",
          checkedAt: new Date().toISOString(),
          error: (err as Error).message,
        } satisfies ClaudeAccountInfo;
      }
    },
  );

  const cliAccountText = () => {
    if (!effectiveDeviceId()) return t("chat.sidebar.cli-account.no-device");
    if (!remoteClaudeInstance()) return t("chat.sidebar.cli-account.not-ready");
    if (cliAccount.loading) return t("chat.sidebar.cli-account.loading");
    const account = cliAccount();
    if (!account || account.status !== "logged_in") {
      return t("chat.sidebar.cli-account.signed-out");
    }
    const cleanPart = (value?: string) => {
      const trimmed = value?.trim();
      if (!trimmed) return null;
      if (trimmed === "logged_in" || trimmed === "로그인됨") return null;
      return trimmed;
    };
    const cleanPlan = (value?: string) => {
      const trimmed = value?.trim();
      if (!trimmed) return null;
      if (trimmed.toLowerCase().startsWith("default_claude_")) return null;
      return trimmed.replace(/^claude[_-]/i, "");
    };
    const identity =
      cleanPart(account.email) ?? cleanPart(account.accountId) ?? cleanPart(account.displayName);
    const plan = cleanPlan(account.subscriptionType);
    const parts = [identity, plan].filter(Boolean);
    return parts.length ? parts.join(" · ") : t("chat.sidebar.cli-account.unavailable");
  };

  createEffect(() => {
    const dev = effectiveDeviceId();
    setSelectedClaudeModel(dev ? getDeviceClaudeModel(dev) : null);
  });

  const [runtimeSlashCommands, { refetch: refetchRuntimeSlashCommands }] = createResource(
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
  const runtimeSkills = () =>
    (runtimeSlashCommands()?.skills ?? []).filter(
      (skill): skill is string => typeof skill === "string" && skill.trim().length > 0,
    );
  const [skillDetails, { refetch: refetchSkillDetails, mutate: mutateSkillDetails }] =
    createResource(
      () => {
        const d = effectiveDeviceId();
        const i = remoteClaudeInstance();
        if (!d || !i) return null;
        return {
          deviceId: d,
          instanceId: i,
          cwd: cwd().trim() || getDeviceDefaultCwd(d) || ".",
          skills: runtimeSkills(),
        };
      },
      async (input) => {
        if (!input) return null;
        try {
          const res = await api.callBehavior<SkillsInspectResult>(
            input.deviceId,
            input.instanceId,
            "skills.inspect",
            { cwd: input.cwd, skills: input.skills },
          );
          if (res.error) return null;
          return res.result ?? null;
        } catch {
          return null;
        }
      },
    );

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
  const [selectedSidebarTab, setSelectedSidebarTab] = createSignal<SidebarTab>("sessions");
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

  const preferredSessionGroupCwd = () =>
    selectedSession()?.cwd ?? readStoredChatSessionSelection(effectiveDeviceId())?.cwd ?? null;

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
  const [probedContextUsage, setProbedContextUsage] = createSignal<ContextUsageSnapshot | null>(
    null,
  );
  const [probedUsageLimits, setProbedUsageLimits] = createSignal<{
    session: ContextUsageSnapshot | null;
    week: ContextUsageSnapshot | null;
  }>({ session: null, week: null });
  const contextUsage = createMemo<ContextUsageOverview>(() => ({
    ctx: probedContextUsage() ?? latestContextUsageSnapshot(transcript()),
    session: probedUsageLimits().session ?? latestRateLimitUsageSnapshot(transcript(), "five_hour"),
    week: probedUsageLimits().week ?? latestRateLimitUsageSnapshot(transcript(), "weekly"),
  }));
  let contextUsageRequestSeq = 0;
  let usageLimitsRequestSeq = 0;
  function clearContextUsage() {
    contextUsageRequestSeq += 1;
    usageLimitsRequestSeq += 1;
    setProbedContextUsage(null);
    setProbedUsageLimits({ session: null, week: null });
  }

  const [cwd, setCwd] = createSignal<string>("");
  const [permissionModeState, setPermissionModeState] = createSignal(
    createPermissionModeState(CLAUDE_PERMISSION_MODES.DEFAULT),
  );
  const requestedPermissionMode = () => permissionModeState().requested;
  const confirmedPermissionMode = () => permissionModeState().confirmed;
  const [running, setRunning] = createSignal(false);
  const [cliAction, setCliAction] = createSignal<string | null>(null);
  const [queuedRunCount, setQueuedRunCount] = createSignal(0);
  const clientRunIds = new Set<string>();
  const [error, setError] = createSignal<string | null>(null);
  const [sessionNotice, setSessionNotice] = createSignal<string | null>(null);
  let sessionNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    props.onContextUsageChange?.(contextUsage());
  });

  createEffect(() => {
    const deviceId = effectiveDeviceId();
    const activeCwd = deviceId ? cwd().trim() || getDeviceDefaultCwd(deviceId) || "" : "";
    props.onActiveWorkspaceChange?.({ deviceId, cwd: activeCwd });
  });

  createEffect(() => {
    const events = transcript();
    const deviceId = effectiveDeviceId();
    if (!deviceId || events.length === 0) {
      props.onConversationExportChange?.(null);
      return;
    }
    const session = selectedSession();
    const device = activeDevice();
    props.onConversationExportChange?.({
      deviceId,
      deviceLabel: device ? deviceDisplayName(device) : null,
      sessionId: session?.sessionId ?? null,
      title: session?.fullTitle || session?.title || null,
      cwd: cwd().trim() || session?.cwd || getDeviceDefaultCwd(deviceId) || "",
      events: [...events],
      generatedAt: new Date().toISOString(),
    });
  });

  onCleanup(() => {
    props.onContextUsageChange?.({ ctx: null, session: null, week: null });
    props.onActiveWorkspaceChange?.({ deviceId: null, cwd: "" });
    props.onConversationExportChange?.(null);
  });

  function setTransientSessionNotice(message: string) {
    if (sessionNoticeTimer) clearTimeout(sessionNoticeTimer);
    setSessionNotice(message);
    sessionNoticeTimer = setTimeout(() => {
      if (sessionNotice() === message) setSessionNotice(null);
      sessionNoticeTimer = null;
    }, SESSION_NOTICE_AUTO_DISMISS_MS);
  }

  function resetConfirmedPermissionMode() {
    setPermissionModeState(resetConfirmedPermissionModeState);
  }

  function setNextPermissionMode(next: ClaudePermissionMode) {
    setPermissionModeState((state) => setNextPermissionModeState(state, next));
  }

  function confirmPermissionMode(
    actual: ClaudePermissionMode,
    requested: ClaudePermissionMode | null,
  ) {
    setPermissionModeState((state) => confirmPermissionModeState(state, actual, requested));
  }

  function markRunPermissionModePending(requested: ClaudePermissionMode) {
    setPermissionModeState((state) => markPermissionModePending(state, requested));
  }

  function markRunPermissionModeUnknown(requested: ClaudePermissionMode) {
    setPermissionModeState((state) => markPermissionModeUnknown(state, requested));
  }

  function permissionModeAlertText(): string | null {
    const alert = permissionModeAlert(permissionModeState());
    return alert ? t(alert.key, alert.params) : null;
  }

  const [cliPermissions, { refetch: refetchCliPermissions, mutate: mutateCliPermissions }] =
    createResource(
      () => {
        if (selectedSidebarTab() !== "permissions") return null;
        const d = effectiveDeviceId();
        const i = remoteClaudeInstance();
        if (!d || !i) return null;
        return { deviceId: d, instanceId: i, cwd: cwd().trim() || getDeviceDefaultCwd(d) || "." };
      },
      async (input) => {
        if (!input) return null;
        try {
          const res = await api.callBehavior<PermissionsInspectResult>(
            input.deviceId,
            input.instanceId,
            "permissions.inspect",
            { cwd: input.cwd },
          );
          if (res.error) return { error: res.error.message, sources: [] };
          return res.result ?? { sources: [] };
        } catch (err) {
          return { error: (err as Error).message, sources: [] };
        }
      },
    );

  const permissionEntryCount = (source: PermissionSourceSummary): number =>
    source.allow.length + source.deny.length + source.ask.length + (source.defaultMode ? 1 : 0);
  const cliPermissionsResult = () => cliPermissions() as PermissionsInspectViewResult | null;
  const cliPermissionSources = () => cliPermissionsResult()?.sources ?? [];
  const cliPermissionsError = () => cliPermissionsResult()?.error ?? null;
  const [permissionDrafts, setPermissionDrafts] = createSignal<Record<string, string[]>>({});
  const [savingPermissionPath, setSavingPermissionPath] = createSignal<string | null>(null);
  const [permissionEditStatus, setPermissionEditStatus] = createSignal<{
    path: string;
    kind: "success" | "error";
    message: string;
  } | null>(null);
  createEffect(() => {
    const result = cliPermissionsResult();
    if (!result || result.error) return;
    const next: Record<string, string[]> = {};
    for (const source of result.sources) {
      next[source.path] = [...source.allow];
    }
    setPermissionDrafts(next);
  });
  const permissionDraftAllow = (source: PermissionSourceSummary): string[] =>
    permissionDrafts()[source.path] ?? source.allow;
  const permissionDraftDirty = (source: PermissionSourceSummary): boolean =>
    !samePermissionList(permissionDraftAllow(source), source.allow);
  const setPermissionDraftAllow = (source: PermissionSourceSummary, allow: string[]) => {
    setPermissionEditStatus(null);
    setPermissionDrafts((current) => ({
      ...current,
      [source.path]: uniquePermissionList(allow),
    }));
  };
  const addPermissionTool = (source: PermissionSourceSummary, tool: string) => {
    const entry = permissionToolEntry(tool);
    const current = permissionDraftAllow(source);
    if (current.includes(ALL_PERMISSION_ENTRY) || current.includes(entry)) return;
    setPermissionDraftAllow(source, [...current, entry]);
  };
  const removePermissionEntry = (source: PermissionSourceSummary, entry: string) => {
    setPermissionDraftAllow(
      source,
      permissionDraftAllow(source).filter((item) => item !== entry),
    );
  };
  const replacePermissionWithAll = (source: PermissionSourceSummary) => {
    setPermissionDraftAllow(source, [ALL_PERMISSION_ENTRY]);
  };
  const clearPermissionAllow = (source: PermissionSourceSummary) => {
    setPermissionDraftAllow(source, []);
  };
  const resetPermissionDraft = (source: PermissionSourceSummary) => {
    setPermissionEditStatus(null);
    setPermissionDraftAllow(source, source.allow);
  };
  const savePermissionSource = async (source: PermissionSourceSummary) => {
    const deviceId = effectiveDeviceId();
    const instanceId = remoteClaudeInstance();
    if (!deviceId || !instanceId) return;
    setSavingPermissionPath(source.path);
    setPermissionEditStatus(null);
    try {
      const res = await api.callBehavior<PermissionsUpdateResult>(
        deviceId,
        instanceId,
        "permissions.update",
        {
          cwd: cwd().trim() || getDeviceDefaultCwd(deviceId) || ".",
          path: source.path,
          allow: permissionDraftAllow(source),
        },
      );
      if (res.error) throw new Error(res.error.message);
      const updated = res.result?.source;
      if (updated) {
        mutateCliPermissions((current) => updatePermissionSourceResult(current, updated));
      }
      await refetchCliPermissions();
      setPermissionEditStatus({
        path: source.path,
        kind: "success",
        message: t("chat.sidebar.permissions.saved"),
      });
    } catch (err) {
      setPermissionEditStatus({
        path: source.path,
        kind: "error",
        message: (err as Error).message,
      });
    } finally {
      setSavingPermissionPath(null);
    }
  };

  const selectedSessionCwd = () => selectedSession()?.cwd?.trim() ?? "";
  const [
    workspaceInstructions,
    { refetch: refetchWorkspaceInstructions, mutate: mutateWorkspaceInstructions },
  ] = createResource(
    () => {
      if (selectedSidebarTab() !== "instructions" && mainPanelMode() !== "instructions") {
        return null;
      }
      const deviceId = effectiveDeviceId();
      const currentCwd = selectedSessionCwd();
      if (!deviceId) return null;
      return { deviceId, cwd: currentCwd };
    },
    async (input) => {
      if (!input) return null;
      try {
        const snapshot = await api.instructions(input.deviceId, input.cwd);
        return {
          cwd: snapshot.cwd ?? input.cwd,
          sources: completeWorkspaceInstructionSources(snapshot.sources ?? [], input.cwd),
        };
      } catch (err) {
        return {
          cwd: input.cwd,
          sources: completeWorkspaceInstructionSources([], input.cwd),
          error: formatInstructionLoadError(err),
        };
      }
    },
  );
  const workspaceInstructionsResult = () =>
    workspaceInstructions() as InstructionsInspectViewResult | null;
  const workspaceInstructionSources = () => workspaceInstructionsResult()?.sources ?? [];
  const workspaceInstructionsError = () => workspaceInstructionsResult()?.error ?? null;
  const [instructionDrafts, setInstructionDrafts] = createSignal<Record<string, string>>({});
  const [savingInstructionScope, setSavingInstructionScope] =
    createSignal<ClaudeInstructionScope | null>(null);
  const [instructionEditStatus, setInstructionEditStatus] = createSignal<{
    scope: ClaudeInstructionScope;
    kind: "success" | "error";
    message: string;
  } | null>(null);
  createEffect(() => {
    const result = workspaceInstructionsResult();
    if (!result || result.error) return;
    const next: Record<string, string> = {};
    for (const source of result.sources) {
      next[source.scope] = source.content;
    }
    setInstructionDrafts(next);
  });
  const instructionDraft = (source: ClaudeInstructionSource): string =>
    instructionDrafts()[source.scope] ?? source.content;
  const instructionDraftDirty = (source: ClaudeInstructionSource): boolean =>
    !sameInstructionContent(instructionDraft(source), source.content);
  const setInstructionDraft = (source: ClaudeInstructionSource, content: string) => {
    setInstructionEditStatus(null);
    setInstructionDrafts((current) => ({ ...current, [source.scope]: content }));
  };
  const resetInstructionDraft = (source: ClaudeInstructionSource) => {
    setInstructionEditStatus(null);
    setInstructionDraft(source, source.content);
  };
  const saveWorkspaceInstructionSource = async (source: ClaudeInstructionSource) => {
    const deviceId = effectiveDeviceId();
    const currentCwd = selectedSessionCwd();
    if (!deviceId || source.readonly) return;
    if (source.scope !== "user" && !currentCwd) return;
    setSavingInstructionScope(source.scope);
    setInstructionEditStatus(null);
    try {
      const updated = await api.writeInstruction(deviceId, source.scope, {
        ...(currentCwd ? { cwd: currentCwd } : {}),
        content: instructionDraft(source),
        ...instructionExpectedHash(source),
      });
      mutateWorkspaceInstructions((current) =>
        updateInstructionSourceResult(current, updated, currentCwd),
      );
      await refetchWorkspaceInstructions();
      setInstructionEditStatus({
        scope: source.scope,
        kind: "success",
        message: t("chat.sidebar.instructions.saved"),
      });
    } catch (err) {
      setInstructionEditStatus({
        scope: source.scope,
        kind: "error",
        message: formatInstructionLoadError(err),
      });
    } finally {
      setSavingInstructionScope(null);
    }
  };
  const deleteWorkspaceInstructionSource = async (source: ClaudeInstructionSource) => {
    const deviceId = effectiveDeviceId();
    const currentCwd = selectedSessionCwd();
    if (!deviceId || source.readonly || !source.exists) return;
    if (source.scope !== "user" && !currentCwd) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("chat.sidebar.instructions.delete.confirm", { label: source.label }))
    ) {
      return;
    }
    setSavingInstructionScope(source.scope);
    setInstructionEditStatus(null);
    try {
      const updated = await api.deleteInstruction(deviceId, source.scope, {
        ...(currentCwd ? { cwd: currentCwd } : {}),
        ...instructionExpectedHash(source),
      });
      mutateWorkspaceInstructions((current) =>
        updateInstructionSourceResult(current, updated, currentCwd),
      );
      setInstructionDraft(updated, updated.content);
      await refetchWorkspaceInstructions();
      setInstructionEditStatus({
        scope: source.scope,
        kind: "success",
        message: t("chat.sidebar.instructions.deleted"),
      });
    } catch (err) {
      setInstructionEditStatus({
        scope: source.scope,
        kind: "error",
        message: formatInstructionLoadError(err),
      });
    } finally {
      setSavingInstructionScope(null);
    }
  };
  const [armedSkillKey, setArmedSkillKey] = createSignal<string | null>(null);
  const [deletingSkillKeys, setDeletingSkillKeys] = createSignal<Record<string, boolean>>({});
  let skillArmTimer: ReturnType<typeof setTimeout> | null = null;
  const skillDetailsByName = () => {
    const map = new Map<string, SkillInspectSummary>();
    for (const skill of skillDetails()?.skills ?? []) {
      map.set(skillNameKey(skill.name), skill);
    }
    return map;
  };
  const skillHintByName = () => {
    const map = new Map<string, string>();
    for (const command of composerSlashCommands()) {
      const key = skillCommandKey(command.name);
      if (key) map.set(key, command.hint);
    }
    return map;
  };
  const runtimeSkillItems = (): RuntimeSkillView[] =>
    runtimeSkills().map((name) => {
      const details = skillDetailsByName().get(skillNameKey(name));
      const hint = skillHintByName().get(skillCommandKey(name) ?? "");
      const known = isKnownClaudeCommandName(name);
      return {
        name,
        kind: known ? "builtin" : "added",
        description:
          details?.description ??
          hint ??
          (known
            ? t("chat.sidebar.skills.default-builtin-description")
            : t("chat.sidebar.skills.default-added-description")),
        ...(details?.path ? { path: details.path } : {}),
        removable: Boolean(details?.removable),
      };
    });

  function skillNameKey(name: string): string {
    return name.trim().replace(/^\/+/, "").toLowerCase();
  }

  function skillCommandKey(name: string): string | null {
    return normalizeSlashCommandName(name)?.toLowerCase() ?? null;
  }

  function skillDeleteKey(skill: RuntimeSkillView): string {
    return skill.path ?? skillNameKey(skill.name);
  }

  function setSkillDeleting(key: string, deleting: boolean) {
    setDeletingSkillKeys((current) => {
      const next = { ...current };
      if (deleting) next[key] = true;
      else delete next[key];
      return next;
    });
  }

  function clearSkillArm() {
    setArmedSkillKey(null);
    if (skillArmTimer) {
      clearTimeout(skillArmTimer);
      skillArmTimer = null;
    }
  }

  function armSkillDelete(key: string) {
    clearSkillArm();
    setArmedSkillKey(key);
    skillArmTimer = setTimeout(() => {
      setArmedSkillKey(null);
      skillArmTimer = null;
    }, 3000);
  }

  async function handleSkillDelete(skill: RuntimeSkillView) {
    if (!skill.removable) return;
    const key = skillDeleteKey(skill);
    if (deletingSkillKeys()[key]) return;
    if (armedSkillKey() !== key) {
      armSkillDelete(key);
      return;
    }
    clearSkillArm();
    const deviceId = effectiveDeviceId();
    const instanceId = remoteClaudeInstance();
    if (!deviceId || !instanceId) return;
    setSkillDeleting(key, true);
    setError(null);
    try {
      const res = await api.callBehavior<SkillDeleteResult>(deviceId, instanceId, "skills.delete", {
        cwd: cwd().trim() || getDeviceDefaultCwd(deviceId) || ".",
        name: skill.name,
        ...(skill.path ? { path: skill.path } : {}),
      });
      if (res.error) throw new Error(res.error.message);
      mutateSkillDetails((current) =>
        current
          ? {
              skills: current.skills.filter(
                (item) =>
                  skillNameKey(item.name) !== skillNameKey(skill.name) ||
                  (skill.path && item.path && item.path !== skill.path),
              ),
            }
          : current,
      );
      await refetchRuntimeSlashCommands();
      await refetchSkillDetails();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSkillDeleting(key, false);
    }
  }

  onCleanup(() => {
    if (sessionNoticeTimer) clearTimeout(sessionNoticeTimer);
    if (skillArmTimer) clearTimeout(skillArmTimer);
  });

  const [showNewChat, setShowNewChat] = createSignal(false);
  const [activeRunId, setActiveRunId] = createSignal<string | null>(null);
  const [draftConversationId, setDraftConversationId] = createSignal(createDraftConversationId());
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = createSignal(false);
  const [mainChatOpen, setMainChatOpen] = createSignal(true);
  const [assistantOpen, setAssistantOpen] = createSignal(false);
  const [mobileChatViewport, setMobileChatViewport] = createSignal(isMobileSidebarViewport());
  const [sidebarWidth, setSidebarWidth] = createSignal(readSidebarWidth());
  const [sidebarResizing, setSidebarResizing] = createSignal(false);
  const [sidebarResizeWillCollapse, setSidebarResizeWillCollapse] = createSignal(false);
  const [assistantWidth, setAssistantWidth] = createSignal(readAssistantWidth());
  const [assistantResizing, setAssistantResizing] = createSignal(false);
  const [assistantResizeWillClose, setAssistantResizeWillClose] = createSignal(false);
  const [transcriptAtBottom, setTranscriptAtBottom] = createSignal(true);
  let transcriptScroller!: HTMLDivElement;
  let deviceSelect: HTMLSelectElement | undefined;
  let sidebarResizeCleanup: (() => void) | undefined;
  let assistantResizeCleanup: (() => void) | undefined;
  let lastSelectedSessionDeviceId: string | null = effectiveDeviceId();

  function markClientRunStarted(runId: string) {
    clientRunIds.add(runId);
    setRunning(true);
  }

  function markClientRunFinished(runId: string) {
    clientRunIds.delete(runId);
    const stillRunning = clientRunIds.size > 0;
    setRunning(stillRunning);
    if (!stillRunning) {
      setCliAction(null);
      setQueuedRunCount(0);
    }
  }

  function oldestClientRunId(): string | null {
    for (const runId of clientRunIds) return runId;
    return null;
  }

  function applyQueueUpdated(content: unknown, localRunId: string) {
    if (!content || typeof content !== "object") return;
    const queue = content as QueueUpdatedEnvelope;
    const count =
      typeof queue.pendingCount === "number" && Number.isFinite(queue.pendingCount)
        ? Math.max(0, Math.floor(queue.pendingCount))
        : 0;
    setQueuedRunCount(count);
    if (
      queue.status === "running" &&
      (queue.runId === localRunId || queue.activeRunId === localRunId)
    ) {
      setActiveRunId(localRunId);
    }
  }

  function clearStoredSessionForActiveDevice() {
    writeStoredChatSessionSelection(effectiveDeviceId(), null);
  }

  function resetSelectedSessionState(options: { clearStored?: boolean } = {}) {
    if (options.clearStored) clearStoredSessionForActiveDevice();
    setSelectedSession(null);
    setTranscript([]);
    setCwd("");
    resetConfirmedPermissionMode();
    setDraftConversationId(createDraftConversationId());
  }

  createEffect(() => {
    const deviceId = effectiveDeviceId();
    if (deviceId === lastSelectedSessionDeviceId) return;
    lastSelectedSessionDeviceId = deviceId;
    resetSelectedSessionState();
    clearContextUsage();
    setError(null);
  });

  createEffect(() => {
    const deviceId = effectiveDeviceId();
    const instance = remoteClaudeInstance();
    const list = sessions();
    if (!deviceId || !instance || !list || sessions.loading) return;

    const current = selectedSession();
    if (current) {
      const stillListed = list.some(
        (summary) => summary.sessionId === current.sessionId && summary.cwd === current.cwd,
      );
      if (stillListed) return;
      const stored = readStoredChatSessionSelection(deviceId);
      if (stored?.sessionId === current.sessionId) writeStoredChatSessionSelection(deviceId, null);
      resetSelectedSessionState();
      return;
    }

    if (showNewChat() || cwd().trim()) return;
    const stored = readStoredChatSessionSelection(deviceId);
    if (!stored) return;
    const restored = resolveStoredSessionSelection(stored, list);
    if (!restored) {
      if (list.length > 0) writeStoredChatSessionSelection(deviceId, null);
      return;
    }
    void selectSession(restored.sessionId, undefined, { persist: true });
  });

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

  function contextUsageCwd(deviceId: string): string {
    return cwd().trim() || getDeviceDefaultCwd(deviceId) || ".";
  }

  async function refreshContextUsage(
    deviceId: string,
    instanceId: string,
    options: { force?: boolean } = {},
  ) {
    const seq = ++contextUsageRequestSeq;
    const selected = selectedSession();
    const cwdForProbe = contextUsageCwd(deviceId);
    const permissionMode = confirmedPermissionMode() ?? requestedPermissionMode();
    const model = selectedClaudeModel();
    const cacheKey = contextUsageCacheKey({
      deviceId,
      instanceId,
      cwd: cwdForProbe,
      sessionId: selected?.sessionId ?? null,
      permissionMode,
      model: model ?? null,
    });
    if (!options.force) {
      const cached = readUsageCache<ContextUsageSnapshot | null>(
        cacheKey,
        CONTEXT_USAGE_CACHE_TTL_MS,
      );
      if (cached !== undefined && cached !== null) {
        if (seq === contextUsageRequestSeq) setProbedContextUsage(cached);
        return;
      }
    }
    try {
      const res = await api.callBehavior<ContextUsageResult>(
        deviceId,
        instanceId,
        "context.usage",
        {
          cwd: cwdForProbe,
          permissionMode,
          ...(selected?.sessionId ? { sessionId: selected.sessionId } : {}),
          ...(model ? { model } : {}),
        },
      );
      if (seq !== contextUsageRequestSeq) return;
      if (res.error) return;
      const usage = res.result?.usage ?? null;
      if (usage) writeUsageCache(cacheKey, usage);
      setProbedContextUsage(usage);
    } catch {
      if (seq === contextUsageRequestSeq) setProbedContextUsage(null);
    }
  }

  async function refreshUsageLimits(
    deviceId: string,
    instanceId: string,
    options: { force?: boolean } = {},
  ) {
    const seq = ++usageLimitsRequestSeq;
    const cacheKey = usageLimitsCacheKey(deviceId, instanceId);
    if (!options.force) {
      const cached = readUsageCache<{
        session: ContextUsageSnapshot | null;
        week: ContextUsageSnapshot | null;
      }>(cacheKey, USAGE_LIMITS_CACHE_TTL_MS);
      if (cached !== undefined && (cached.session || cached.week)) {
        if (seq === usageLimitsRequestSeq) setProbedUsageLimits(cached);
        return;
      }
    }
    try {
      const res = await api.callBehavior<UsageLimitsResult>(deviceId, instanceId, "usage.limits");
      if (seq !== usageLimitsRequestSeq) return;
      if (res.error) return;
      const usage = {
        session: res.result?.session ?? null,
        week: res.result?.week ?? null,
      };
      if (usage.session || usage.week) writeUsageCache(cacheKey, usage);
      setProbedUsageLimits(usage);
    } catch {
      if (seq === usageLimitsRequestSeq) setProbedUsageLimits({ session: null, week: null });
    }
  }

  createEffect(() => {
    if (devices.loading || behaviors.loading) return;
    const deviceId = effectiveDeviceId();
    const instanceId = remoteClaudeInstance();
    if (!deviceId || !instanceId) {
      clearContextUsage();
      return;
    }
    void refreshContextUsage(deviceId, instanceId);
    void refreshUsageLimits(deviceId, instanceId);
    const timer = setInterval(() => {
      const currentDeviceId = effectiveDeviceId();
      const currentInstanceId = remoteClaudeInstance();
      if (!currentDeviceId || !currentInstanceId) return;
      void refreshContextUsage(currentDeviceId, currentInstanceId);
      void refreshUsageLimits(currentDeviceId, currentInstanceId);
    }, CONTEXT_USAGE_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  function handleScrollToBottomClick() {
    scrollTranscriptToBottom("smooth");
  }

  createEffect(() => {
    if (transcript().length === 0) setTranscriptAtBottom(true);
  });

  // Mobile drawer toggle ??the CSS rules at @media (max-width: 720px)
  // key off body.sidebar-open (so the sibling backdrop selector +
  // body-scroll-lock both work from the same hook). Sync the body
  // class with the signal here. Without this the drawer never slid
  // in at all on mobile despite the signal flipping.
  createEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("sidebar-open", sidebarOpen());
    document.body.classList.toggle("sidebar-collapsed", desktopSidebarCollapsed());
    document.body.classList.toggle("sidebar-resizing", sidebarResizing());
    document.body.classList.toggle("assistant-resizing", assistantResizing());
  });
  onCleanup(() => {
    sidebarResizeCleanup?.();
    assistantResizeCleanup?.();
    if (typeof document !== "undefined") {
      document.body.classList.remove("sidebar-open");
      document.body.classList.remove("sidebar-collapsed");
      document.body.classList.remove("sidebar-resizing");
      document.body.classList.remove("assistant-resizing");
    }
  });

  function isMobileSidebarViewport(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 720px)").matches
    );
  }

  function toggleSidebar() {
    if (isMobileSidebarViewport()) {
      setSidebarOpen((v) => !v);
      return;
    }
    setDesktopSidebarCollapsed((v) => !v);
  }

  const showAssistantInChat = () => assistantOpen() && mobileChatViewport();
  const showAssistantDock = () => assistantOpen() && !mobileChatViewport();
  const chatPanelCollapsed = () =>
    !mainChatOpen() && showAssistantDock() && mainPanelMode() === "chat";
  const mainChatHidden = () => chatPanelCollapsed() || showAssistantInChat();

  function toggleMainChatPanel() {
    if (mobileChatViewport()) {
      const nextAssistantOpen = !assistantOpen();
      setMainChatOpen(!nextAssistantOpen);
      setAssistantOpen(nextAssistantOpen);
      setMainPanelMode("chat");
      if (nextAssistantOpen) setSidebarOpen(false);
      return;
    }
    if (chatPanelCollapsed()) {
      setMainChatOpen(true);
      return;
    }
    setMainPanelMode("chat");
    setMainChatOpen(false);
    if (!assistantOpen()) setAssistantOpen(true);
  }

  function toggleManagerAssistant() {
    const next = !assistantOpen();
    setAssistantOpen(next);
    if (!next) {
      setMainChatOpen(true);
      return;
    }
    setMainPanelMode("chat");
    if (isMobileSidebarViewport()) setSidebarOpen(false);
  }

  createEffect(() => {
    if (!showAssistantDock() && !mobileChatViewport()) setMainChatOpen(true);
  });

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia("(max-width: 720px)");
    const updateMobileViewport = () => setMobileChatViewport(media.matches);
    updateMobileViewport();
    media.addEventListener("change", updateMobileViewport);
    onCleanup(() => media.removeEventListener("change", updateMobileViewport));
  }

  function commitSidebarWidth(value: number) {
    const next = clampSidebarWidth(value);
    setSidebarWidth(next);
    writeSidebarWidth(next);
  }

  function clearSidebarResizeListeners() {
    sidebarResizeCleanup?.();
    sidebarResizeCleanup = undefined;
  }

  function commitAssistantWidth(value: number) {
    const next = clampAssistantWidth(value);
    setAssistantWidth(next);
    writeAssistantWidth(next);
  }

  function clearAssistantResizeListeners() {
    assistantResizeCleanup?.();
    assistantResizeCleanup = undefined;
  }

  function beginSidebarResize(event: PointerEvent) {
    if (isMobileSidebarViewport()) return;
    event.preventDefault();
    setDesktopSidebarCollapsed(false);
    clearSidebarResizeListeners();

    const startX = event.clientX;
    const startWidth = sidebarWidth();
    let rawWidth = startWidth;
    let collapsedDuringDrag = false;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      rawWidth = startWidth + moveEvent.clientX - startX;
      if (rawWidth < SIDEBAR_MIN_WIDTH - SIDEBAR_COLLAPSE_DRAG_THRESHOLD) {
        collapsedDuringDrag = true;
        commitSidebarWidth(SIDEBAR_MIN_WIDTH);
        setDesktopSidebarCollapsed(true);
        setSidebarResizing(false);
        setSidebarResizeWillCollapse(false);
        clearSidebarResizeListeners();
        return;
      }
      setDesktopSidebarCollapsed(false);
      setSidebarResizeWillCollapse(false);
      setSidebarWidth(clampSidebarWidth(rawWidth));
    };

    const handleUp = () => {
      clearSidebarResizeListeners();
      setSidebarResizing(false);
      setSidebarResizeWillCollapse(false);
      if (collapsedDuringDrag) return;
      if (rawWidth < SIDEBAR_MIN_WIDTH - SIDEBAR_COLLAPSE_DRAG_THRESHOLD) {
        commitSidebarWidth(SIDEBAR_MIN_WIDTH);
        setDesktopSidebarCollapsed(true);
        return;
      }
      commitSidebarWidth(rawWidth);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleUp, { once: true });
    sidebarResizeCleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    setSidebarResizing(true);
    setSidebarResizeWillCollapse(false);
  }

  function beginAssistantResize(event: PointerEvent) {
    if (isMobileSidebarViewport()) return;
    event.preventDefault();
    setAssistantOpen(true);
    clearAssistantResizeListeners();

    const startX = event.clientX;
    const startWidth = assistantWidth();
    let rawWidth = startWidth;
    let closedDuringDrag = false;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      rawWidth = startWidth + startX - moveEvent.clientX;
      if (rawWidth < ASSISTANT_MIN_WIDTH - ASSISTANT_COLLAPSE_DRAG_THRESHOLD) {
        closedDuringDrag = true;
        commitAssistantWidth(ASSISTANT_MIN_WIDTH);
        setAssistantOpen(false);
        setAssistantResizing(false);
        setAssistantResizeWillClose(false);
        clearAssistantResizeListeners();
        return;
      }
      setAssistantResizeWillClose(false);
      setAssistantWidth(clampAssistantWidth(rawWidth));
    };

    const handleUp = () => {
      clearAssistantResizeListeners();
      setAssistantResizing(false);
      setAssistantResizeWillClose(false);
      if (closedDuringDrag) return;
      if (rawWidth < ASSISTANT_MIN_WIDTH - ASSISTANT_COLLAPSE_DRAG_THRESHOLD) {
        commitAssistantWidth(ASSISTANT_MIN_WIDTH);
        setAssistantOpen(false);
        return;
      }
      commitAssistantWidth(rawWidth);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleUp, { once: true });
    assistantResizeCleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    setAssistantResizing(true);
    setAssistantResizeWillClose(false);
  }

  function handleSidebarResizeKeyDown(event: KeyboardEvent) {
    if (isMobileSidebarViewport()) return;
    const step = event.shiftKey ? SIDEBAR_RESIZE_KEYBOARD_STEP * 2 : SIDEBAR_RESIZE_KEYBOARD_STEP;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (sidebarWidth() <= SIDEBAR_MIN_WIDTH) {
        commitSidebarWidth(SIDEBAR_MIN_WIDTH);
        setDesktopSidebarCollapsed(true);
        return;
      }
      setDesktopSidebarCollapsed(false);
      commitSidebarWidth(sidebarWidth() - step);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setDesktopSidebarCollapsed(false);
      commitSidebarWidth(sidebarWidth() + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      commitSidebarWidth(SIDEBAR_MIN_WIDTH);
      setDesktopSidebarCollapsed(false);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      commitSidebarWidth(SIDEBAR_MAX_WIDTH);
      setDesktopSidebarCollapsed(false);
    }
  }

  function handleAssistantResizeKeyDown(event: KeyboardEvent) {
    if (isMobileSidebarViewport()) return;
    const step = event.shiftKey
      ? ASSISTANT_RESIZE_KEYBOARD_STEP * 2
      : ASSISTANT_RESIZE_KEYBOARD_STEP;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (assistantWidth() <= ASSISTANT_MIN_WIDTH) {
        commitAssistantWidth(ASSISTANT_MIN_WIDTH);
        setAssistantOpen(false);
        return;
      }
      commitAssistantWidth(assistantWidth() - step);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commitAssistantWidth(assistantWidth() + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      commitAssistantWidth(ASSISTANT_MIN_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      commitAssistantWidth(ASSISTANT_MAX_WIDTH);
    }
  }

  function openSidebarForDevicePick() {
    if (isMobileSidebarViewport()) {
      setSidebarOpen(true);
      return;
    }
    setDesktopSidebarCollapsed(false);
  }

  function openInstructionsWorkspace() {
    setAssistantOpen(false);
    setMainPanelMode("instructions");
    if (isMobileSidebarViewport()) setSidebarOpen(false);
  }

  createEffect(() => {
    if (mainPanelMode() !== "instructions") setInstructionEditorHeaderState(null);
  });

  const activeDevice = () => {
    const id = effectiveDeviceId();
    if (!id) return null;
    return (devices() ?? []).find((d) => d.id === id) ?? null;
  };

  const managerAssistantContext = createMemo<ManagerAssistantChatContext | null>(() => {
    const context: ManagerAssistantChatContext = {};
    const deviceId = effectiveDeviceId();
    const device = activeDevice();
    const session = selectedSession();
    const currentCwd = selectedSessionCwd() || cwd().trim();
    if (deviceId) context.deviceId = deviceId;
    if (device) {
      context.deviceLabel = deviceDisplayName(device);
      if (device.connectionState) context.deviceConnectionState = device.connectionState;
    }
    if (session?.sessionId) context.sessionId = session.sessionId;
    if (session?.fullTitle || session?.title)
      context.sessionTitle = session.fullTitle || session.title;
    if (currentCwd) context.cwd = currentCwd;
    return Object.keys(context).length ? context : null;
  });

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
  const infrastructureStatus = createMemo(() =>
    deriveConnectionStatus({
      devices: devices(),
      devicesLoading: devices.loading,
      activeDevice: activeDevice(),
      behaviorsLoading: behaviors.loading,
      hasRemoteClaude: Boolean(remoteClaudeInstance()),
      running: false,
      activityLabel: null,
      approvalWaiting: false,
      hasError: false,
    }),
  );

  const infrastructureStatusDetail = () =>
    infrastructureStatus().detailOverride ?? t(infrastructureStatus().detailKey);
  const headerStatusText = () =>
    `${t(infrastructureStatus().mainKey)} · ${infrastructureStatusDetail()}`;
  const headerStatusTitle = () =>
    [sessionNotice(), headerStatusText()]
      .filter((part): part is string => Boolean(part))
      .join(" · ");

  const deviceStatusTone = () => {
    const device = activeDevice();
    if (!device) return "none";
    const status = infrastructureStatus();
    if (status.tone === "ok") return "online";
    if (status.tone === "offline") return "offline";
    if (status.tone === "pending" || status.tone === "warning") return "pending";
    return "action";
  };

  const deviceStatusLabel = () => {
    const device = activeDevice();
    if (!device) return t("chat.sidebar.device.status.none");
    return `${deviceDisplayName(device)}: ${t(infrastructureStatus().mainKey)} - ${infrastructureStatusDetail()}`;
  };

  const composerGuidance = createMemo<ComposerGuidance | null>(() => {
    const status = connectionStatus();
    const queued = queuedRunCount();
    const queuedDetail = queued > 0 ? t("chat.queue.pending", { count: queued }) : undefined;
    if (status.kind === "approval_waiting") {
      return {
        tone: status.tone,
        main: "권한 승인 대기",
        detail: status.detailOverride ?? "승인 창 확인",
        ...(status.action ? { action: status.action } : {}),
      };
    }
    if (status.kind === "tool_running" || status.kind === "streaming") {
      return {
        tone: status.tone,
        main: status.detailOverride ?? t(status.mainKey),
        detail: queuedDetail ? `${queuedDetail} · Esc 중지` : "Esc 중지",
      };
    }
    if (queuedDetail) {
      return {
        tone: "pending",
        main: t("chat.queue.running"),
        detail: queuedDetail,
      };
    }
    if (
      status.kind === "not_installed" ||
      status.kind === "selected_device_offline" ||
      status.kind === "behavior_not_ready" ||
      status.kind === "site_connecting"
    ) {
      return {
        tone: status.tone,
        main:
          status.kind === "selected_device_offline" || status.kind === "not_installed"
            ? status.kind === "not_installed"
              ? "디바이스 등록 필요"
              : "디바이스 오프라인"
            : status.kind === "behavior_not_ready"
              ? "Claude 모듈 준비 중"
              : "연결 확인 중",
        detail:
          status.kind === "not_installed"
            ? "디바이스 등록"
            : status.kind === "selected_device_offline"
              ? "Connector 실행 필요"
              : undefined,
        ...(status.action ? { action: status.action } : {}),
      };
    }
    if (error()) {
      return {
        tone: "warning",
        main: "오류 발생",
        detail: "오류 확인 후 재시도",
        ...(status.action ? { action: status.action } : {}),
      };
    }
    const permissionAlert = permissionModeAlertText();
    if (permissionAlert) {
      return {
        tone: "warning",
        main: permissionAlert,
      };
    }
    if (showNewChat() || (cwd().trim() && !selectedSession())) {
      return null;
    }
    if (selectedSession()) {
      return null;
    }
    return {
      tone: "context",
      main: "세션 선택 필요",
    };
  });

  const showComposerStatus = () => Boolean(composerGuidance());

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
    const storedSession = readStoredChatSessionSelection(dev);
    if (storedSession?.sessionId === id) writeStoredChatSessionSelection(dev, null);
    if (selectedSession()?.sessionId === id) {
      resetSelectedSessionState();
    }
    clearSessionTranscriptCache(dev, id);
    void clearDeskRelayBrowserCache();
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
      resetSelectedSessionState();
    }
    const storedSession = readStoredChatSessionSelection(dev);
    if (storedSession?.cwd === cwdToDelete) writeStoredChatSessionSelection(dev, null);
    clearSessionTranscriptCache(dev);
    void clearDeskRelayBrowserCache();
    mutateSessions((current) => (current ?? []).filter((session) => session.cwd !== cwdToDelete));
    try {
      await refetchSessions();
    } catch (err) {
      setError(t("chat.error.delete-folder", { error: (err as Error).message }));
    } finally {
      setSessionGroupDeleteProgress(cwdToDelete, undefined);
    }
  }

  async function selectSession(
    id: string,
    _entry: SessionEntry | undefined,
    options: { persist?: boolean } = {},
  ) {
    const summary = (sessions() ?? []).find((s) => s.sessionId === id) ?? null;
    setSelectedSession(summary);
    setDraftConversationId(createDraftConversationId());
    setError(null);
    setShowNewChat(false);
    setSidebarOpen(false);
    const dev = effectiveDeviceId();
    if (options.persist !== false) {
      writeStoredChatSessionSelection(dev, summary ? sessionSelectionFromSummary(summary) : null);
    }
    if (!summary) {
      setTranscript([]);
      return;
    }
    setCwd(summary.cwd);
    setProbedContextUsage(null);
    resetConfirmedPermissionMode();
    const inst = remoteClaudeInstance();
    if (!dev || !inst) return;
    const eventLimit = chatTranscriptEventLimit();
    const transcriptCacheKey = sessionTranscriptCacheKey({
      deviceId: dev,
      instanceId: inst,
      cwd: summary.cwd,
      sessionId: summary.sessionId,
      eventLimit,
    });
    const applyTranscriptResult = (
      result: ClaudeSessionTranscript,
      options: { showTruncationNotice?: boolean } = {},
    ) => {
      const rawEvents = (result.events ?? []) as ClaudeStreamEvent[];
      const latestRawEvents = latestTranscriptEvents(rawEvents);
      const latestWindowPermissionMode = latestRawEvents.reduce<ClaudePermissionMode | null>(
        (mode, event) => permissionModeFromSystemInit(event) ?? mode,
        null,
      );
      const transcriptPermissionMode =
        normalizePermissionMode(result.permissionMode) ?? latestWindowPermissionMode;
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
      void refreshContextUsage(dev, inst);
      void refreshUsageLimits(dev, inst);
      if (options.showTruncationNotice === false) return;
      if (result.eventsTruncated || locallyEventsTruncated) {
        setTransientSessionNotice(t("chat.error.session-event-limited", { count: eventLimit }));
      } else if (result.truncated) {
        setTransientSessionNotice(
          t("chat.error.session-truncated", { mb: bytesToMiB(SESSION_READ_MAX_BYTES) }),
        );
      }
    };
    let appliedCachedTranscript = false;
    const cachedTranscript = readBrowserCacheValue<ClaudeSessionTranscript>(
      transcriptCacheKey,
      SESSION_TRANSCRIPT_CACHE_TTL_MS,
    );
    if (cachedTranscript) {
      applyTranscriptResult(cachedTranscript, { showTruncationNotice: false });
      appliedCachedTranscript = true;
    }
    try {
      const res = await api.callBehavior<ClaudeSessionTranscript>(dev, inst, "sessions.read", {
        cwd: summary.cwd,
        sessionId: summary.sessionId,
        maxBytes: SESSION_READ_MAX_BYTES,
        eventLimit,
      });
      if (res.error) throw new Error(res.error.message);
      const transcriptResult: ClaudeSessionTranscript = res.result ?? {
        sessionId: summary.sessionId,
        cwd: summary.cwd,
        events: [],
      };
      writeBrowserCacheValue(transcriptCacheKey, transcriptResult);
      applyTranscriptResult(transcriptResult);
    } catch (err) {
      const message = (err as Error).message;
      if (isMissingSessionFileError(message)) {
        clearSessionTranscriptCache(dev, summary.sessionId);
        resetSelectedSessionState({ clearStored: true });
        void refetchSessions();
        setTransientSessionNotice(t("chat.error.session-missing"));
        return;
      }
      if (appliedCachedTranscript) return;
      setError(message);
      setTranscript([]);
    }
  }

  let previousTranscriptEventLimit = chatTranscriptEventLimit();
  createEffect(() => {
    const nextLimit = chatTranscriptEventLimit();
    const current = selectedSession();
    if (nextLimit === previousTranscriptEventLimit) return;
    previousTranscriptEventLimit = nextLimit;
    if (!current) return;
    void selectSession(current.sessionId, undefined, { persist: false });
  });

  function openNewChat() {
    // The NewChatCard renders INSIDE the sidebar (cwd picker + start
    // button), so we explicitly keep the sidebar open here ??closing it
    // would hide the very surface the user just clicked into. The
    // drawer closes when the cwd is confirmed (startSession) instead.
    clearStoredSessionForActiveDevice();
    setShowNewChat(true);
    setSelectedSession(null);
    setTranscript([]);
    clearContextUsage();
    setError(null);
    resetConfirmedPermissionMode();
    setDraftConversationId(createDraftConversationId());
  }

  /** Opening Settings while the mobile drawer is open leaves the drawer
   *  rendered behind the modal, so collapse the drawer first. */
  function openSettingsOverlay(options: SettingsOpenOptions = {}) {
    setSidebarOpen(false);
    props.onOpenSettings(options);
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
    clearStoredSessionForActiveDevice();
    setCwd(input.cwd);
    setNextPermissionMode(input.permissionMode);
    setShowNewChat(false);
    setTranscript([]);
    setError(null);
    setSelectedSession(null);
    resetConfirmedPermissionMode();
    setDraftConversationId(createDraftConversationId());
    // User has committed to a chat ??collapse the drawer so the
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
        `Queued messages: ${queuedRunCount()}`,
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
        name: att.name,
        size: att.size,
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

    const runId = `r${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    markClientRunStarted(runId);
    setCliAction(t("cli.action.starting"));
    const requestedModeForRun = requestedPermissionMode();
    const cwdForRun = cwd();
    const modelForRun = selectedClaudeModel();
    const messageForRun = applyTemporaryInstructionsToMessage(message);
    const selectedSessionForRun = selectedSession();
    const conversationIdForRun = selectedSessionForRun?.sessionId ? null : draftConversationId();
    const space = `remote-claude.run:${runId}`;
    const abort = new AbortController();
    markRunPermissionModePending(requestedModeForRun);

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
          if (e.kind === "queue.updated") {
            applyQueueUpdated(e.content, runId);
          }
          const action = describeCliActionFromEnvelope(e.kind, e.content);
          if (action) setCliAction(action);
          if (e.kind === "run.started") {
            setActiveRunId(runId);
          }
          if (
            e.kind === "run.started" ||
            e.kind === "claude.event" ||
            e.kind === "run.finished" ||
            e.kind === "run.error" ||
            e.kind === "run.cancelled"
          ) {
            streamSawRun = true;
          }
          if (e.kind === "claude.event" && e.content) {
            if (isClaudeSystemInit(e.content)) {
              streamSawSystemInit = true;
              const actualMode = permissionModeFromSystemInit(e.content);
              if (actualMode) {
                confirmPermissionMode(actualMode, requestedModeForRun);
              } else {
                markRunPermissionModeUnknown(requestedModeForRun);
              }
            }
            const transcriptEvent = claudeEventForTranscript(e.content);
            if (transcriptEvent) appendTranscriptEvent(transcriptEvent);
          } else if (e.kind === "run.error") {
            setError(runErrorMessage(e.content) ?? t("cli.action.error"));
            abort.abort();
            return;
          } else if (e.kind === "run.cancelled") {
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
          cwd: cwdForRun,
          message: messageForRun,
          attachments: pendingAttachments,
          runId,
          permissionMode: requestedModeForRun,
          ...(modelForRun ? { model: modelForRun } : {}),
          // Per-device fail-policy hint for the PreToolUse hook. Persisted
          // in localStorage via Settings ??Devices ??device-prefs.
          securityProfile: getDeviceSecurityProfile(dev),
          ...(selectedSessionForRun?.sessionId
            ? { sessionId: selectedSessionForRun.sessionId }
            : {}),
          ...(conversationIdForRun ? { conversationId: conversationIdForRun } : {}),
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
        markRunPermissionModeUnknown(requestedModeForRun);
      }
      if (chatAccepted) {
        void refreshContextUsage(dev, inst, { force: true });
        void refreshUsageLimits(dev, inst, { force: true });
      }
      abort.abort();
      if (activeRunId() === runId) setActiveRunId(null);
      markClientRunFinished(runId);
      attachmentsApi?.clear();
      void refetchSessions();
    }
  }

  async function interrupt() {
    const dev = effectiveDeviceId();
    const inst = remoteClaudeInstance();
    const runId = activeRunId() ?? oldestClientRunId();
    if (!dev || !inst || !runId) {
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

  function syncDeviceSelectValue() {
    if (!deviceSelect) return;
    const id = effectiveDeviceId() ?? "";
    queueMicrotask(() => {
      if (deviceSelect && deviceSelect.value !== id) deviceSelect.value = id;
    });
  }

  createEffect(() => {
    effectiveDeviceId();
    devices();
    syncDeviceSelectValue();
  });

  return (
    <section
      class="signed-in"
      classList={{
        "assistant-panel-open": showAssistantDock(),
        "main-chat-collapsed": chatPanelCollapsed(),
      }}
      id="signed-in-pane"
      style={{
        "--sidebar-width": `${sidebarWidth()}px`,
        "--assistant-width": `${assistantWidth()}px`,
      }}
    >
      <Show when={sidebarOpen()}>
        <button
          type="button"
          class="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label={t("chat.sidebar.close")}
        />
      </Show>

      <aside class={`sidebar${sidebarOpen() ? " sidebar-open" : ""}`}>
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
              ref={(el) => {
                deviceSelect = el;
                syncDeviceSelectValue();
              }}
              class="text-input"
              style={{ flex: "1" }}
              value={effectiveDeviceId() ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === "__settings__") {
                  openSettingsOverlay({ tab: "devices", deviceId: effectiveDeviceId() });
                  e.currentTarget.value = effectiveDeviceId() ?? "";
                } else {
                  selectDeviceId(v || null);
                  setSelectedSession(null);
                  setTranscript([]);
                  clearContextUsage();
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
          <Show when={effectiveDeviceId()}>
            <p
              class="sidebar-cli-account"
              title={cliAccount()?.error ?? cliAccountText()}
              aria-live="polite"
            >
              {cliAccountText()}
            </p>
          </Show>
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

        <div class="sidebar-tabs" role="tablist" aria-label={t("chat.sidebar.tabs.aria")}>
          <button
            type="button"
            role="tab"
            aria-selected={selectedSidebarTab() === "sessions"}
            class="sidebar-tab"
            classList={{ "is-active": selectedSidebarTab() === "sessions" }}
            onClick={() => setSelectedSidebarTab("sessions")}
          >
            {t("chat.sidebar.tab.sessions")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedSidebarTab() === "permissions"}
            class="sidebar-tab"
            classList={{ "is-active": selectedSidebarTab() === "permissions" }}
            onClick={() => setSelectedSidebarTab("permissions")}
          >
            {t("chat.sidebar.tab.permissions")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedSidebarTab() === "instructions"}
            class="sidebar-tab"
            classList={{ "is-active": selectedSidebarTab() === "instructions" }}
            onClick={() => setSelectedSidebarTab("instructions")}
          >
            {t("chat.sidebar.tab.instructions")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedSidebarTab() === "skills"}
            class="sidebar-tab"
            classList={{ "is-active": selectedSidebarTab() === "skills" }}
            onClick={() => setSelectedSidebarTab("skills")}
          >
            {t("chat.sidebar.tab.skills")}
          </button>
        </div>

        <Show when={selectedSidebarTab() === "sessions"}>
          <div class="sidebar-section">
            <span class="sidebar-label sidebar-label-with-scope">
              <span>{t("chat.sidebar.tab.sessions")}</span>
              <SettingsScopeLabel scope="current device" />
            </span>
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
                cwdBrowseMode={newChatCwdBrowseMode()}
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
              onDeleteGroup={(cwdToDelete, rows) =>
                void handleSessionGroupDelete(cwdToDelete, rows)
              }
              deletingGroups={deletingSessionGroups()}
              groupByCwd={true}
              preferredExpandedCwd={preferredSessionGroupCwd()}
              expandAllGroups={Boolean(sessionSearch().trim())}
              groupStateKey={effectiveDeviceId()}
            />
          </div>
        </Show>

        <Show when={selectedSidebarTab() === "permissions"}>
          <div class="sidebar-section sidebar-section-list sidebar-tab-panel">
            <span class="sidebar-label sidebar-label-with-scope">
              <span>{t("chat.sidebar.permissions.title")}</span>
              <SettingsScopeLabels scopes={["current device", "current session"]} />
            </span>
            <Show
              when={effectiveDeviceId() && remoteClaudeInstance()}
              fallback={<p class="sidebar-empty">{t("chat.sidebar.panel.not-ready")}</p>}
            >
              <Show
                when={!cliPermissions.loading}
                fallback={<p class="sidebar-empty">{t("chat.sidebar.panel.loading")}</p>}
              >
                <Show
                  when={!cliPermissionsError()}
                  fallback={<p class="sidebar-empty">{cliPermissionsError()}</p>}
                >
                  <div class="sidebar-flat-list">
                    <For each={cliPermissionSources()}>
                      {(source) => (
                        <div class="sidebar-info-block sidebar-permission-source">
                          <div class="sidebar-info-title">
                            <span class="sidebar-info-title-main">
                              <span>{source.label}</span>
                              <SettingsScopeLabel
                                scope={
                                  source.label === "User settings"
                                    ? "current device"
                                    : "current session"
                                }
                              />
                            </span>
                            <span class="sidebar-info-count">
                              {source.exists
                                ? t("chat.sidebar.permissions.count", {
                                    count: String(permissionEntryCount(source)),
                                  })
                                : t("chat.sidebar.permissions.missing")}
                            </span>
                          </div>
                          <div class="sidebar-info-path" title={source.path}>
                            {source.path}
                          </div>
                          <Show when={source.error}>
                            <p class="sidebar-empty">{source.error}</p>
                          </Show>
                          <Show when={source.exists && permissionEntryCount(source) === 0}>
                            <p class="sidebar-empty">{t("chat.sidebar.permissions.empty")}</p>
                          </Show>
                          <Show when={source.defaultMode}>
                            <div class="sidebar-permission-row">
                              <span class="sidebar-permission-kind">mode</span>
                              <span>{source.defaultMode}</span>
                            </div>
                          </Show>
                          <div class="sidebar-permission-actions">
                            <button
                              type="button"
                              class="sidebar-inline-button"
                              onClick={() => replacePermissionWithAll(source)}
                              disabled={savingPermissionPath() === source.path}
                            >
                              {t("chat.sidebar.permissions.all")}
                            </button>
                            <button
                              type="button"
                              class="sidebar-inline-button"
                              onClick={() => clearPermissionAllow(source)}
                              disabled={
                                savingPermissionPath() === source.path ||
                                permissionDraftAllow(source).length === 0
                              }
                            >
                              {t("chat.sidebar.permissions.clear")}
                            </button>
                          </div>
                          <Show
                            when={permissionDraftAllow(source).length > 0}
                            fallback={
                              <p class="sidebar-empty">
                                {t("chat.sidebar.permissions.allow-empty")}
                              </p>
                            }
                          >
                            <For each={permissionDraftAllow(source)}>
                              {(item) => (
                                <div class="sidebar-permission-row editable">
                                  <span class="sidebar-permission-kind">allow</span>
                                  <span title={item}>{permissionEntryLabel(item)}</span>
                                  <button
                                    type="button"
                                    class="sidebar-icon-button"
                                    onClick={() => removePermissionEntry(source, item)}
                                    disabled={savingPermissionPath() === source.path}
                                    aria-label={t("chat.sidebar.permissions.remove", {
                                      item: permissionEntryLabel(item),
                                    })}
                                    title={t("chat.sidebar.permissions.remove", {
                                      item: permissionEntryLabel(item),
                                    })}
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                            </For>
                          </Show>
                          <For each={source.ask}>
                            {(item) => (
                              <div class="sidebar-permission-row">
                                <span class="sidebar-permission-kind">ask</span>
                                <span>{item}</span>
                              </div>
                            )}
                          </For>
                          <For each={source.deny}>
                            {(item) => (
                              <div class="sidebar-permission-row">
                                <span class="sidebar-permission-kind">deny</span>
                                <span>{item}</span>
                              </div>
                            )}
                          </For>
                          <div class="sidebar-permission-add">
                            <span class="sidebar-info-count">
                              {t("chat.sidebar.permissions.add")}
                            </span>
                            <div class="sidebar-token-list">
                              <For each={AVAILABLE_PERMISSION_TOOLS}>
                                {(tool) => {
                                  const entry = permissionToolEntry(tool);
                                  const added = () =>
                                    permissionDraftAllow(source).includes(ALL_PERMISSION_ENTRY) ||
                                    permissionDraftAllow(source).includes(entry);
                                  return (
                                    <button
                                      type="button"
                                      class="sidebar-token-button"
                                      classList={{ "is-added": added() }}
                                      onClick={() => addPermissionTool(source, tool)}
                                      disabled={savingPermissionPath() === source.path || added()}
                                    >
                                      {tool}
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </div>
                          <Show when={permissionEditStatus()?.path === source.path}>
                            <p
                              classList={{
                                "sidebar-empty": permissionEditStatus()?.kind !== "error",
                                "settings-error": permissionEditStatus()?.kind === "error",
                                "settings-success": permissionEditStatus()?.kind === "success",
                              }}
                            >
                              {permissionEditStatus()?.message}
                            </p>
                          </Show>
                          <Show when={permissionDraftDirty(source)}>
                            <div class="sidebar-permission-actions">
                              <button
                                type="button"
                                class="sidebar-inline-button"
                                onClick={() => resetPermissionDraft(source)}
                                disabled={savingPermissionPath() === source.path}
                              >
                                {t("chat.sidebar.permissions.revert")}
                              </button>
                              <button
                                type="button"
                                class="sidebar-inline-button primary"
                                onClick={() => void savePermissionSource(source)}
                                disabled={savingPermissionPath() === source.path}
                              >
                                {savingPermissionPath() === source.path
                                  ? t("chat.sidebar.permissions.saving")
                                  : t("chat.sidebar.permissions.save")}
                              </button>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={selectedSidebarTab() === "instructions"}>
          <div class="sidebar-section sidebar-section-list sidebar-tab-panel">
            <span class="sidebar-label sidebar-label-with-scope">
              <span>{t("chat.sidebar.instructions.title")}</span>
              <SettingsScopeLabel scope="current session" />
            </span>
            <Show
              when={effectiveDeviceId()}
              fallback={<p class="sidebar-empty">{t("chat.sidebar.panel.not-ready")}</p>}
            >
              <Show
                when={!workspaceInstructions.loading}
                fallback={<p class="sidebar-empty">{t("chat.sidebar.panel.loading")}</p>}
              >
                <Show
                  when={!workspaceInstructionsError()}
                  fallback={<p class="sidebar-empty">{workspaceInstructionsError()}</p>}
                >
                  <div class="sidebar-flat-list">
                    <div class="sidebar-info-block">
                      <div class="sidebar-info-title">
                        <span class="sidebar-info-title-main">
                          <span>{t("instructions.workspace.current")}</span>
                          <SettingsScopeLabel scope="current session" />
                        </span>
                      </div>
                      <div class="sidebar-info-path" title={selectedSessionCwd()}>
                        {selectedSessionCwd() || t("instructions.workspace.no-cwd")}
                      </div>
                    </div>
                    <Show
                      when={selectedSessionCwd()}
                      fallback={
                        <p class="sidebar-empty">{t("chat.sidebar.instructions.select-session")}</p>
                      }
                    >
                      <For each={workspaceInstructionSources()}>
                        {(source) => (
                          <div class="sidebar-info-block">
                            <div class="sidebar-info-title">
                              <span class="sidebar-info-title-main">
                                <span>{source.label}</span>
                                <SettingsScopeLabel scope="current session" />
                              </span>
                              <span class="sidebar-info-count">
                                {source.exists
                                  ? t("chat.sidebar.instructions.exists")
                                  : source.error === "cwd is not selected"
                                    ? t("instructions.source.cwd-required")
                                    : t("chat.sidebar.instructions.missing")}
                              </span>
                            </div>
                            <div class="sidebar-info-path" title={source.path}>
                              {source.path || t("instructions.path.none")}
                            </div>
                          </div>
                        )}
                      </For>
                      <button
                        type="button"
                        class="sidebar-inline-button primary"
                        onClick={openInstructionsWorkspace}
                      >
                        {t("instructions.workspace.open")}
                      </button>
                    </Show>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={selectedSidebarTab() === "skills"}>
          <div class="sidebar-section sidebar-section-list sidebar-tab-panel sidebar-skills-panel">
            <span class="sidebar-label sidebar-label-with-scope">
              <span>{t("chat.sidebar.skills.title")}</span>
              <SettingsScopeLabels scopes={["current device", "current session"]} />
            </span>
            <Show
              when={effectiveDeviceId() && remoteClaudeInstance()}
              fallback={<p class="sidebar-empty">{t("chat.sidebar.panel.not-ready")}</p>}
            >
              <Show
                when={!runtimeSlashCommands.loading}
                fallback={<p class="sidebar-empty">{t("chat.sidebar.panel.loading")}</p>}
              >
                <div class="sidebar-flat-list">
                  <div class="sidebar-info-block">
                    <div class="sidebar-info-title">
                      <span>{t("chat.sidebar.skills.claude")}</span>
                      <span class="sidebar-info-count">{runtimeSkills().length}</span>
                    </div>
                    <Show
                      when={runtimeSkillItems().length > 0}
                      fallback={<p class="sidebar-empty">{t("chat.sidebar.skills.empty")}</p>}
                    >
                      <div class="sidebar-skill-list">
                        <For each={runtimeSkillItems()}>
                          {(skill) => {
                            const deleteKey = () => skillDeleteKey(skill);
                            const isArmed = () => armedSkillKey() === deleteKey();
                            const isDeleting = () => Boolean(deletingSkillKeys()[deleteKey()]);
                            return (
                              <div
                                class="sidebar-skill-row"
                                classList={{
                                  "skill-builtin": skill.kind === "builtin",
                                  "skill-added": skill.kind === "added",
                                  "sidebar-skill-row-armed": isArmed(),
                                  "sidebar-skill-row-deleting": isDeleting(),
                                }}
                                title={skill.description}
                                data-full-description={skill.description}
                              >
                                <span class="sidebar-skill-name">{skill.name}</span>
                                <span class="sidebar-skill-description" title={skill.description}>
                                  {skill.description}
                                </span>
                                <Show when={skill.removable}>
                                  <button
                                    type="button"
                                    class="sidebar-skill-delete"
                                    classList={{
                                      "sidebar-skill-delete-armed": isArmed(),
                                      "sidebar-skill-delete-deleting": isDeleting(),
                                    }}
                                    aria-label={
                                      isDeleting()
                                        ? t("chat.sidebar.skills.delete-progress")
                                        : isArmed()
                                          ? t("chat.sidebar.skills.delete-confirm", {
                                              name: skill.name,
                                            })
                                          : t("chat.sidebar.skills.delete", { name: skill.name })
                                    }
                                    title={
                                      isDeleting()
                                        ? t("chat.sidebar.skills.delete-progress")
                                        : t("chat.sidebar.skills.delete", { name: skill.name })
                                    }
                                    disabled={isDeleting()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleSkillDelete(skill);
                                    }}
                                  >
                                    {isDeleting()
                                      ? t("chat.sidebar.skills.delete-progress")
                                      : isArmed()
                                        ? t("chat.sidebar.skills.delete-label")
                                        : "×"}
                                  </button>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <div class="sidebar-info-block">
                    <div class="sidebar-info-title">
                      <span>{t("chat.sidebar.skills.commands")}</span>
                      <span class="sidebar-info-count">{composerSlashCommands().length}</span>
                    </div>
                    <div class="sidebar-command-list">
                      <For each={composerSlashCommands()}>
                        {(command) => (
                          <div
                            class="sidebar-command-row"
                            title={command.hint}
                            data-full-description={command.hint}
                          >
                            <span class="sidebar-command-name">{command.name}</span>
                            <small class="sidebar-command-hint" title={command.hint}>
                              {command.hint}
                            </small>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        </Show>

        <div class="sidebar-section sidebar-section-bottom">
          <PermissionModePicker
            value={requestedPermissionMode()}
            onChange={setNextPermissionMode}
          />
          <CapabilitiesBadge events={transcript()} permissionMode={confirmedPermissionMode()} />
        </div>

        <div
          class="sidebar-resize-handle"
          classList={{
            "is-dragging": sidebarResizing(),
            "will-collapse": sidebarResizeWillCollapse(),
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("chat.sidebar.resize")}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth()}
          tabIndex={0}
          onPointerDown={beginSidebarResize}
          onKeyDown={handleSidebarResizeKeyDown}
        />
      </aside>

      <section
        class="chat"
        classList={{ "chat-collapsed": chatPanelCollapsed() }}
        onPaste={handlePaste}
      >
        <div class="chat-header">
          <Show
            when={instructionEditorHeaderState()}
            fallback={
              <>
                <button
                  type="button"
                  class="hamburger"
                  aria-label={t("chat.toggle-sidebar")}
                  aria-expanded={
                    isMobileSidebarViewport() ? sidebarOpen() : !desktopSidebarCollapsed()
                  }
                  onClick={toggleSidebar}
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
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <line x1="9" y1="4" x2="9" y2="20" />
                  </svg>
                </button>
                <output
                  class={`chat-header-status chat-header-status-${infrastructureStatus().tone}`}
                  aria-live="polite"
                  title={headerStatusTitle()}
                >
                  <Show when={sessionNotice()}>
                    {(message) => <span class="chat-header-notice">{message()}</span>}
                  </Show>
                  <span class="chat-header-current-status">{headerStatusText()}</span>
                </output>
                <button
                  type="button"
                  class="chat-ai-assistant-button"
                  classList={{ active: mainChatHidden() }}
                  onClick={toggleMainChatPanel}
                  aria-pressed={mainChatHidden()}
                  aria-label={mainChatHidden() ? "기본 채팅창 열기" : "기본 채팅창 숨기기"}
                  title={mainChatHidden() ? "기본 채팅창 열기" : "기본 채팅창 숨기기"}
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
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="chat-ai-assistant-button"
                  classList={{ active: assistantOpen() }}
                  onClick={toggleManagerAssistant}
                  aria-pressed={assistantOpen()}
                  aria-label={t("chat.manager-assistant.open")}
                  title={t("chat.manager-assistant.open")}
                >
                  AI
                </button>
              </>
            }
          >
            {(editor) => (
              <div
                class="chat-header-instruction-actions"
                aria-label={t("instructions.workspace.editor")}
              >
                <Show when={editor().source.exists}>
                  <button
                    type="button"
                    class="sidebar-inline-button danger"
                    onClick={editor().onDelete}
                    disabled={!editor().canDelete}
                  >
                    {t("chat.sidebar.instructions.delete")}
                  </button>
                </Show>
                <button
                  type="button"
                  class="sidebar-inline-button"
                  onClick={editor().onReset}
                  disabled={!editor().canReset}
                >
                  {t("chat.sidebar.instructions.revert")}
                </button>
                <button
                  type="button"
                  class="sidebar-inline-button primary"
                  onClick={editor().onSave}
                  disabled={!editor().canSave}
                >
                  {editor().saving
                    ? t("chat.sidebar.instructions.saving")
                    : t("chat.sidebar.instructions.save")}
                </button>
                <button type="button" class="sidebar-inline-button" onClick={editor().onClose}>
                  {t("instructions.workspace.close")}
                </button>
              </div>
            )}
          </Show>
        </div>

        <Show
          when={chatPanelCollapsed()}
          fallback={
            <Show
              when={mainPanelMode() === "instructions"}
              fallback={
                <Show
                  when={showAssistantInChat()}
                  fallback={
                    <>
                      <div
                        ref={transcriptScroller}
                        class="transcript"
                        onScroll={updateTranscriptBottomState}
                      >
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
                            <Transcript
                              events={transcript()}
                              deviceId={effectiveDeviceId()}
                              cwd={cwd()}
                            />
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
                              onPickDevice={openSidebarForDevicePick}
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
                        <Show when={showComposerStatus()}>
                          <output
                            class={`composer-status composer-status-${composerGuidance()?.tone ?? "context"}`}
                            aria-live="polite"
                          >
                            <Show when={composerGuidance()}>
                              {(guidance) => (
                                <>
                                  <span class="composer-status-main">{guidance().main}</span>
                                  <Show when={guidance().detail}>
                                    {(detail) => (
                                      <span class="composer-status-detail">{detail()}</span>
                                    )}
                                  </Show>
                                </>
                              )}
                            </Show>
                            <Show when={composerGuidance()?.action}>
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
                        </Show>
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
                          contextRemainingPercent={
                            props.showContextUsageMeter === false
                              ? undefined
                              : (contextUsage().ctx?.remainingPercent ?? null)
                          }
                        />
                      </div>
                    </>
                  }
                >
                  <div class="chat-assistant-mobile">
                    <ManagerAssistant context={managerAssistantContext()} />
                  </div>
                </Show>
              }
            >
              <InstructionsWorkspace
                cwd={workspaceInstructionsResult()?.cwd ?? selectedSessionCwd()}
                sources={workspaceInstructionSources()}
                loading={workspaceInstructions.loading}
                error={workspaceInstructionsError()}
                draft={instructionDraft}
                dirty={instructionDraftDirty}
                savingScope={savingInstructionScope()}
                status={instructionEditStatus()}
                onInput={setInstructionDraft}
                onReset={resetInstructionDraft}
                onSave={(source) => void saveWorkspaceInstructionSource(source)}
                onDelete={(source) => void deleteWorkspaceInstructionSource(source)}
                onReload={() => void refetchWorkspaceInstructions()}
                onBack={() => setMainPanelMode("chat")}
                onEditorHeaderStateChange={setInstructionEditorHeaderState}
              />
            </Show>
          }
        >
          <div class="chat-collapsed-placeholder" aria-hidden="true" />
        </Show>
      </section>

      <Show when={showAssistantDock()}>
        <aside class="chat-assistant-dock" aria-label={t("chat.manager-assistant.open")}>
          <button
            type="button"
            class="chat-ai-assistant-button assistant-dock-chat-toggle"
            classList={{ active: mainChatHidden() }}
            onClick={toggleMainChatPanel}
            aria-pressed={mainChatHidden()}
            aria-label={mainChatHidden() ? "기본 채팅창 열기" : "기본 채팅창 숨기기"}
            title={mainChatHidden() ? "기본 채팅창 열기" : "기본 채팅창 숨기기"}
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
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          </button>
          <div
            class="assistant-resize-handle"
            classList={{
              "is-dragging": assistantResizing(),
              "will-close": assistantResizeWillClose(),
            }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Assistant 창 크기 조절"
            aria-valuemin={ASSISTANT_MIN_WIDTH}
            aria-valuemax={ASSISTANT_MAX_WIDTH}
            aria-valuenow={assistantWidth()}
            tabIndex={0}
            onPointerDown={beginAssistantResize}
            onKeyDown={handleAssistantResizeKeyDown}
          />
          <ManagerAssistant context={managerAssistantContext()} />
        </aside>
      </Show>

      {/* Refresh devices when nothing has loaded yet ??runs once on mount. */}
      <Show when={!effectiveDeviceId()}>
        <RefreshOnMount onMount={() => void refetchDevices()} />
      </Show>

      {/* Always mounted ??subscribes to the active device's approval
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
