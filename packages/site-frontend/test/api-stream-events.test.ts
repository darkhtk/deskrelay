import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../src/api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api.streamEvents", () => {
  test("marks the stream open on daemon comment frames and parses CRLF data frames", async () => {
    const encoder = new TextEncoder();
    let opened = false;
    vi.stubGlobal("fetch", async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(": connected\r\n\r\n"));
            controller.enqueue(
              encoder.encode('id: 1\r\nevent: event\r\ndata: {"kind":"run.started"}\r\n\r\n'),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });

    const events: unknown[] = [];
    for await (const env of api.streamEvents("dev_1", "remote-claude.run:r1", {
      onOpen: () => {
        opened = true;
      },
    })) {
      events.push(env);
    }

    expect(opened).toBe(true);
    expect(events).toEqual([{ kind: "run.started" }]);
  });

  test("joins multi-line data fields before JSON parsing", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"kind":\n'));
            controller.enqueue(encoder.encode('data: "run.finished"}\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });

    const events: unknown[] = [];
    for await (const env of api.streamEvents("dev_1", "remote-claude.run:r1")) {
      events.push(env);
    }

    expect(events).toEqual([{ kind: "run.finished" }]);
  });
});
