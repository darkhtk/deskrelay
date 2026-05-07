// Echo — the platform's hello-world behavior.
//
// Three request methods:
//   echo            { message: string }                → { ok, length }
//   explode         {}                                  → throws (for error e2e tests)
//   publish-to      { space, kind, content }            → { ok }
//
// All requests publish at least one event into the kernel broker so the
// connector / browser can observe them.

import { runBehavior } from "@deskrelay/behavior-sdk/runtime";
import type { BehaviorManifest } from "@deskrelay/shared/manifest";
import manifest from "../manifest.json" with { type: "json" };

await runBehavior({
  manifest: manifest as BehaviorManifest,
  async start(ctx) {
    ctx.logger.info("echo behavior started", { instanceId: ctx.settings.instanceId });

    ctx.onRequest("echo", async (params: { message: string }) => {
      ctx.emit("echoed", { message: params.message });
      return { ok: true, length: params.message.length };
    });

    ctx.onRequest("explode", async () => {
      throw new Error("intentional failure");
    });

    ctx.onRequest(
      "publish-to",
      async (params: { space: string; kind: string; content: unknown }) => {
        ctx.publish({
          kind: params.kind,
          content: params.content,
          spaceId: params.space as never,
        });
        return { ok: true };
      },
    );
  },
  async stop(ctx) {
    ctx.logger.info("echo behavior stopping");
  },
});
