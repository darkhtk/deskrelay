// EventEnvelope — the canonical event shape carried by the kernel broker.
//
// Every event in the system flows through this shape:
//   - id: monotonic per-space sequence (stringified bigint, room for 2^63)
//   - cursor: same as id; subscribers reconnect with `Last-Event-ID: <cursor>`
//             to receive everything strictly after that point
//   - spaceId: the topic the event was published to
//   - createdAt: ISO 8601 with ms precision, set by the broker at publish time
//   - actor: optional principal who caused the event (user, behavior, system)
//   - kind: behavior-defined event type (e.g. "claude.event", "chat.request")
//   - content: behavior-defined payload (must be JSON-serializable)
//
// The broker sets `id`, `cursor`, and `createdAt`. Behaviors set the rest.

import type { SpaceId } from "./space.ts";

export type EventCursor = string;

export type ActorKind = "user" | "behavior" | "system" | "device";

export interface Actor {
  kind: ActorKind;
  /** stable identifier (user id, behavior slug, device id, etc.) */
  id: string;
  /** human label for logs / UI */
  name?: string;
}

export interface EventEnvelope<TContent = unknown> {
  /** monotonic per-space sequence (also exposed as `cursor`) */
  id: EventCursor;
  /** alias of `id`; the value SSE clients send back as Last-Event-ID */
  cursor: EventCursor;
  spaceId: SpaceId;
  /** ISO 8601 with milliseconds, e.g. "2026-04-27T13:07:37.012Z" */
  createdAt: string;
  /** behavior-defined event type, e.g. "claude.event", "chat.request" */
  kind: string;
  /** behavior-defined payload — must be JSON-serializable */
  content: TContent;
  actor?: Actor;
}

/** Inputs a publisher provides; broker fills in id/cursor/createdAt. */
export type EventInput<TContent = unknown> = Omit<
  EventEnvelope<TContent>,
  "id" | "cursor" | "createdAt"
>;

/** Type guard — useful at network boundaries (SSE, fetch, etc.). */
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.cursor === "string" &&
    typeof v.spaceId === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.kind === "string" &&
    "content" in v
  );
}
