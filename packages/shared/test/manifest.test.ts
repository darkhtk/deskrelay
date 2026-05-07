import { describe, expect, test } from "bun:test";
import { type BehaviorManifest, validateManifest } from "../src/manifest.ts";

const valid: BehaviorManifest = {
  name: "remote-claude",
  version: "1.2.3",
  runtime: "pc",
  entry: "./dist/index.js",
  permissions: ["filesystem:read:user.home", "shell:exec:claude"],
  ipc: "jsonrpc-2.0",
  minConnectorVersion: "1.0.0",
  license: "Apache-2.0",
  publisher: {
    id: "deskrelay",
    name: "Claude Remote",
    key: "did:web:deskrelay.local",
  },
  displayName: "Claude Code",
  description: "Run claude CLI sessions from a browser.",
  categories: ["coding-agent", "claude"],
};

describe("validateManifest", () => {
  test("accepts a valid manifest", () => {
    expect(validateManifest(valid)).toEqual(valid);
  });

  test("rejects non-objects", () => {
    expect(() => validateManifest(null)).toThrow();
    expect(() => validateManifest("nope")).toThrow();
  });

  test("rejects invalid name (uppercase) — error names the field", () => {
    expect(() => validateManifest({ ...valid, name: "RemoteClaude" })).toThrow(/manifest\.name/);
  });

  test("rejects invalid version (non-semver)", () => {
    expect(() => validateManifest({ ...valid, version: "1.2" })).toThrow(/manifest\.version/);
  });

  test("rejects unknown runtime", () => {
    expect(() => validateManifest({ ...valid, runtime: "wasm" })).toThrow(/manifest\.runtime/);
  });

  test("rejects empty entry", () => {
    expect(() => validateManifest({ ...valid, entry: "" })).toThrow(/manifest\.entry/);
  });

  test("rejects malformed permission — error includes index", () => {
    expect(() =>
      validateManifest({ ...valid, permissions: ["valid:read:x", "filesystem"] }),
    ).toThrow(/permissions\[1\]/);
  });

  test("rejects unsupported ipc", () => {
    expect(() => validateManifest({ ...valid, ipc: "grpc" })).toThrow(/manifest\.ipc/);
  });

  test("rejects publisher with missing id — error names the subfield", () => {
    expect(() =>
      validateManifest({
        ...valid,
        publisher: { id: undefined, name: "Y", key: "did:web:y" },
      }),
    ).toThrow(/publisher\.id/);
  });

  test("rejects bad category — error includes index", () => {
    expect(() => validateManifest({ ...valid, categories: ["ok", 42] })).toThrow(/categories\[1\]/);
  });

  test("accepts manifest with i18n entries", () => {
    const result = validateManifest({
      ...valid,
      i18n: {
        ko: { displayName: "클로드 코드", description: "브라우저에서 claude" },
      },
    });
    expect(result.i18n?.ko?.displayName).toBe("클로드 코드");
  });

  test("accepts manifest with metered: compose", () => {
    const result = validateManifest({ ...valid, metered: { kind: "compose" } });
    expect(result.metered?.kind).toBe("compose");
  });

  test("accepts manifest with metered: free (explicit)", () => {
    const result = validateManifest({ ...valid, metered: { kind: "free" } });
    expect(result.metered?.kind).toBe("free");
  });

  test("rejects metered with unknown kind", () => {
    expect(() => validateManifest({ ...valid, metered: { kind: "premium" } })).toThrow(
      /metered\.kind/,
    );
  });

  test("rejects metered that is not an object", () => {
    expect(() => validateManifest({ ...valid, metered: "compose" })).toThrow(/metered/);
  });
});
