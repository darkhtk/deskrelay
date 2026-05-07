import { InProcessSubscriptionBroker } from "@deskrelay/core";
import { describe, expect, test } from "bun:test";
import {
  APPROVALS_SPACE,
  APPROVAL_TIMEOUT_MS,
  ApprovalQueue,
  type PendingApproval,
} from "../src/approvals.ts";

describe("ApprovalQueue", () => {
  test("publishes the daemon-side expiry deadline with pending approvals", async () => {
    const broker = new InProcessSubscriptionBroker();
    const queue = new ApprovalQueue(broker);

    const request = queue.request({
      tool_name: "Bash",
      tool_input: { command: "echo test" },
      session_id: "sess_1",
    });

    const [env] = broker.backlog(APPROVALS_SPACE);
    expect(env?.kind).toBe("approval.pending");
    const content = env?.content as PendingApproval | undefined;
    expect(content?.id).toMatch(/^apr_/);
    expect(content?.payload.tool_name).toBe("Bash");
    expect(typeof content?.createdAt).toBe("string");
    expect(typeof content?.expiresAt).toBe("string");
    expect(Date.parse(content!.expiresAt) - Date.parse(content!.createdAt)).toBe(
      APPROVAL_TIMEOUT_MS,
    );

    expect(queue.resolve(content!.id, { decision: "allow" })).toBe(true);
    await expect(request).resolves.toEqual({ continue: true, decision: "approve" });
  });
});
