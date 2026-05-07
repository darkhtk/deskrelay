// Test fixture — minimal echo behavior. Used by host-runtime.e2e.test.ts.
import { runBehavior } from "@deskrelay/behavior-sdk/runtime";
import manifest from "./manifest.json" with { type: "json" };

await runBehavior({
  manifest: manifest as never,
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
