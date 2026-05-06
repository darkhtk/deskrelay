import { describe, expect, test } from "bun:test";
import { type EventEnvelope, isEventEnvelope } from "../src/event.ts";

describe("isEventEnvelope", () => {
  const validEnvelope: EventEnvelope<{ message: string }> = {
    id: "1",
    cursor: "1",
    spaceId: "remote_claude.session:abc" as never,
    createdAt: "2026-04-27T13:07:37.012Z",
    kind: "claude.event",
    content: { message: "hi" },
  };

  test("accepts a complete envelope", () => {
    expect(isEventEnvelope(validEnvelope)).toBe(true);
  });

  test("rejects missing fields", () => {
    const noKind = { ...validEnvelope, kind: undefined };
    expect(isEventEnvelope(noKind)).toBe(false);
  });

  test("rejects null / non-objects", () => {
    expect(isEventEnvelope(null)).toBe(false);
    expect(isEventEnvelope("event")).toBe(false);
    expect(isEventEnvelope(42)).toBe(false);
  });

  test("accepts envelope with optional actor", () => {
    const withActor: EventEnvelope = {
      ...validEnvelope,
      actor: { kind: "user", id: "user-1", name: "alice" },
    };
    expect(isEventEnvelope(withActor)).toBe(true);
  });
});
