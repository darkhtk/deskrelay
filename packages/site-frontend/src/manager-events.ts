import type { ManagerEvent } from "@deskrelay/shared";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { api } from "./api.ts";

export type ManagerEventConnectionState = "connecting" | "connected" | "reconnecting" | "error";

interface ManagerEventSubscriptionOptions {
  enabled?: Accessor<boolean>;
  onEvent: (event: ManagerEvent) => void;
  onState?: (state: ManagerEventConnectionState, detail?: string) => void;
}

export function createManagerEventSubscription(options: ManagerEventSubscriptionOptions): void {
  createEffect(() => {
    if (options.enabled && !options.enabled()) return;

    let disposed = false;
    let retryTimer: number | undefined;
    let lastSeq = 0;
    let retryMs = 1_000;
    const abort = new AbortController();

    const waitBeforeReconnect = () =>
      new Promise<void>((resolve) => {
        retryTimer = window.setTimeout(resolve, retryMs);
      });

    const run = async () => {
      while (!disposed) {
        options.onState?.(lastSeq > 0 ? "reconnecting" : "connecting");
        try {
          for await (const event of api.streamManagerEvents({
            afterSeq: lastSeq,
            signal: abort.signal,
            onOpen: () => options.onState?.("connected"),
          })) {
            if (disposed) return;
            lastSeq = Math.max(lastSeq, event.seq);
            retryMs = 1_000;
            options.onEvent(event);
          }
          if (!disposed) {
            retryMs = 1_000;
          }
        } catch (error) {
          if (disposed || (error as Error).name === "AbortError") return;
          options.onState?.("error", error instanceof Error ? error.message : String(error));
        }
        if (!disposed) {
          await waitBeforeReconnect();
          retryMs = Math.min(retryMs * 2, 10_000);
        }
      }
    };

    void run();

    onCleanup(() => {
      disposed = true;
      abort.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    });
  });
}

export function isManagerOrchestrationEvent(event: ManagerEvent): boolean {
  return (
    event.type === "snapshot" ||
    event.type === "project.created" ||
    event.type === "project.updated" ||
    event.type === "round.created" ||
    event.type === "round.updated" ||
    event.type === "agent.created" ||
    event.type === "agent.updated" ||
    event.type === "task.created" ||
    event.type === "task.updated"
  );
}
