import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base64UrlEncode } from "@deskrelay/shared/device-key";
import {
  DiskSoftwareKeyStorage,
  pairWithSite,
  readDeviceIdentity,
  removeDeviceIdentity,
  writeDeviceIdentity,
} from "../src/device-identity.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "cr-identity-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("DiskSoftwareKeyStorage", () => {
  test("put / get round-trip", async () => {
    const s = new DiskSoftwareKeyStorage(join(tmp, "keys"));
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await s.put("h1", data);
    const back = await s.get("h1");
    expect(back).toEqual(data);
  });

  test("get missing returns undefined", async () => {
    const s = new DiskSoftwareKeyStorage(join(tmp, "keys"));
    expect(await s.get("nope")).toBeUndefined();
  });

  test("remove is idempotent", async () => {
    const s = new DiskSoftwareKeyStorage(join(tmp, "keys"));
    await s.remove("nope");
    await s.put("h1", new Uint8Array([1]));
    await s.remove("h1");
    expect(await s.get("h1")).toBeUndefined();
  });
});

describe("readDeviceIdentity / writeDeviceIdentity", () => {
  test("write + read round-trip", async () => {
    const path = join(tmp, "identity.json");
    const id = {
      deviceId: "dev_abc",
      siteUrl: "https://site.example",
      publicKey: "pk-base64u",
      keyHandle: "kh-1",
      pairedAt: "2026-01-01T00:00:00Z",
      label: "Test PC",
    };
    await writeDeviceIdentity(id, path);
    expect(await readDeviceIdentity(path)).toEqual(id);
  });

  test("read missing file returns undefined", async () => {
    expect(await readDeviceIdentity(join(tmp, "missing.json"))).toBeUndefined();
  });

  test("read malformed JSON returns undefined", async () => {
    const path = join(tmp, "bad.json");
    await Bun.write(path, "{not json");
    expect(await readDeviceIdentity(path)).toBeUndefined();
  });

  test("read missing required fields returns undefined", async () => {
    const path = join(tmp, "incomplete.json");
    await Bun.write(path, JSON.stringify({ deviceId: "x" }));
    expect(await readDeviceIdentity(path)).toBeUndefined();
  });
});

describe("pairWithSite", () => {
  test("happy path: POSTs to /api/pairing/complete + persists identity", async () => {
    let postedBody: unknown;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      expect(url).toContain("/api/pairing/complete");
      postedBody = JSON.parse((init?.body as string) ?? "{}");
      return Response.json({
        deviceId: "dev_returned-id",
        registeredAt: "2026-01-02T00:00:00Z",
        label: "from-server",
      });
    }) as unknown as typeof fetch;

    const result = await pairWithSite({
      siteUrl: "https://site.example/",
      code: "ABC123",
      label: "My PC",
      identityDir: tmp,
      fetchImpl: fakeFetch,
    });

    expect(result.identity.deviceId).toBe("dev_returned-id");
    expect(result.identity.siteUrl).toBe("https://site.example/");
    expect(result.identity.label).toBe("from-server");
    expect(typeof result.identity.publicKey).toBe("string");
    expect(typeof result.identity.keyHandle).toBe("string");

    // Disk: identity.json + the private key file under keys/.
    const disk = await readDeviceIdentity(join(tmp, "identity.json"));
    expect(disk?.deviceId).toBe("dev_returned-id");

    const ks = new DiskSoftwareKeyStorage(join(tmp, "keys"));
    expect(await ks.get(result.identity.keyHandle)).toBeDefined();

    // Verify the body shape we sent.
    expect((postedBody as { code?: string }).code).toBe("ABC123");
    expect(typeof (postedBody as { publicKey?: string }).publicKey).toBe("string");
    expect((postedBody as { label?: string }).label).toBe("My PC");
  });

  test("server error throws and cleans up the orphaned key", async () => {
    const fakeFetch = (async () =>
      Response.json({ error: "bad code" }, { status: 404 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await pairWithSite({
        siteUrl: "https://site.example",
        code: "WRONG",
        identityDir: tmp,
        fetchImpl: fakeFetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/bad code/);

    // No identity file should be written.
    expect(await readDeviceIdentity(join(tmp, "identity.json"))).toBeUndefined();
  });

  test("non-JSON server response throws", async () => {
    const fakeFetch = (async () =>
      new Response("html garbage", { status: 502 })) as unknown as typeof fetch;
    await expect(
      pairWithSite({
        siteUrl: "https://site.example",
        code: "X",
        identityDir: tmp,
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/non-JSON/);
  });
});

// Sanity: base64UrlEncode round-trip — the protocol relies on it.
describe("base64UrlEncode (regression)", () => {
  test("32-byte key encodes to 43-char base64url", () => {
    const k = new Uint8Array(32).fill(0xff);
    const enc = base64UrlEncode(k);
    expect(enc.length).toBe(43); // 32 bytes → ceil(32 * 4 / 3) = 43 (no padding)
  });
});

describe("removeDeviceIdentity", () => {
  test("removes identity.json + the referenced key file and reports both", async () => {
    const identityPath = join(tmp, "identity.json");
    const keysDir = join(tmp, "keys");
    const storage = new DiskSoftwareKeyStorage(keysDir);
    await storage.put("kh-1", new Uint8Array([1, 2, 3]));
    await writeDeviceIdentity(
      {
        deviceId: "dev_xyz",
        siteUrl: "https://site.example",
        publicKey: "pk-base64u",
        keyHandle: "kh-1",
        pairedAt: "2026-04-30T00:00:00Z",
      },
      identityPath,
    );

    const r = await removeDeviceIdentity({ identityPath, keysDir });
    expect(r.identityRemoved).toBe(true);
    expect(r.keyRemoved).toBe(true);
    expect(r.previousDeviceId).toBe("dev_xyz");
    expect(await readDeviceIdentity(identityPath)).toBeUndefined();
    expect(await storage.get("kh-1")).toBeUndefined();
  });

  test("idempotent — second call after a clean unpair reports nothing-to-remove", async () => {
    const identityPath = join(tmp, "identity.json");
    const keysDir = join(tmp, "keys");
    // First call on an empty dir should already succeed without throwing.
    const r1 = await removeDeviceIdentity({ identityPath, keysDir });
    expect(r1.identityRemoved).toBe(false);
    expect(r1.keyRemoved).toBe(false);
    expect(r1.previousDeviceId).toBeUndefined();
    // And again — same answer.
    const r2 = await removeDeviceIdentity({ identityPath, keysDir });
    expect(r2.identityRemoved).toBe(false);
    expect(r2.keyRemoved).toBe(false);
  });

  test("missing key file but present identity.json: identityRemoved=true, keyRemoved=false", async () => {
    const identityPath = join(tmp, "identity.json");
    const keysDir = join(tmp, "keys");
    await writeDeviceIdentity(
      {
        deviceId: "dev_orphan",
        siteUrl: "https://site.example",
        publicKey: "pk",
        keyHandle: "kh-missing",
        pairedAt: "2026-04-30T00:00:00Z",
      },
      identityPath,
    );
    // Don't create any key file.
    const r = await removeDeviceIdentity({ identityPath, keysDir });
    expect(r.identityRemoved).toBe(true);
    expect(r.keyRemoved).toBe(false);
    expect(r.previousDeviceId).toBe("dev_orphan");
  });
});
