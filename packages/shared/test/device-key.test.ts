import { describe, expect, test } from "bun:test";
import {
  InMemorySoftwareKeyStorage,
  SoftwareKeyBackend,
  createDpopProof,
  verifyDpopProof,
} from "../src/device-key.ts";

describe("SoftwareKeyBackend", () => {
  test("generate returns 32-byte public key + handle, sign produces verifiable signature", async () => {
    const backend = new SoftwareKeyBackend();
    const handle = await backend.generate();
    expect(handle.publicKey.length).toBe(32);
    expect(handle.keyHandle.length).toBeGreaterThan(0);
    const message = new TextEncoder().encode("hello");
    const sig = await backend.sign(handle.keyHandle, message);
    // Ed25519 signatures are always 64 bytes.
    expect(sig.length).toBe(64);
    // Verify with WebCrypto using the public key.
    const key = await crypto.subtle.importKey(
      "raw",
      handle.publicKey.buffer.slice(
        handle.publicKey.byteOffset,
        handle.publicKey.byteOffset + handle.publicKey.byteLength,
      ) as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
      message.buffer.slice(
        message.byteOffset,
        message.byteOffset + message.byteLength,
      ) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  test("sign with unknown handle throws", async () => {
    const backend = new SoftwareKeyBackend();
    await expect(backend.sign("nope", new Uint8Array([1, 2, 3]))).rejects.toThrow(/unknown key/);
  });

  test("destroy removes the key (subsequent sign throws)", async () => {
    const backend = new SoftwareKeyBackend();
    const h = await backend.generate();
    await backend.destroy(h.keyHandle);
    await expect(backend.sign(h.keyHandle, new Uint8Array([1]))).rejects.toThrow(/unknown key/);
  });

  test("storage is injectable", async () => {
    const storage = new InMemorySoftwareKeyStorage();
    const a = new SoftwareKeyBackend({ storage });
    const h = await a.generate();
    // Same storage → second backend can sign with the same handle.
    const b = new SoftwareKeyBackend({ storage });
    const sig = await b.sign(h.keyHandle, new TextEncoder().encode("x"));
    expect(sig.length).toBe(64);
  });
});

describe("createDpopProof + verifyDpopProof — happy path", () => {
  test("round-trips through sign + verify", async () => {
    const backend = new SoftwareKeyBackend();
    const { keyHandle, publicKey } = await backend.generate();
    const deviceId = "dev_abc";
    const url = "https://site/api/devices/list";
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId,
      method: "GET",
      url,
    });

    const seen = new Set<string>();
    const result = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: url,
      resolvePublicKey: async (id) => (id === deviceId ? publicKey : undefined),
      recordJti: async (_d, jti) => {
        if (seen.has(jti)) return false;
        seen.add(jti);
        return true;
      },
    });
    if (!result.ok) throw new Error(`verify failed: ${result.reason}`);
    expect(result.deviceId).toBe(deviceId);
  });
});

describe("verifyDpopProof — error paths", () => {
  async function setup() {
    const backend = new SoftwareKeyBackend();
    const { keyHandle, publicKey } = await backend.generate();
    const deviceId = "dev_z";
    const seen = new Set<string>();
    const recordJti = async (_d: string, jti: string) => {
      if (seen.has(jti)) return false;
      seen.add(jti);
      return true;
    };
    return { backend, keyHandle, publicKey, deviceId, recordJti };
  }

  test("malformed proof string", async () => {
    const { publicKey, deviceId, recordJti } = await setup();
    const r = await verifyDpopProof({
      proof: "not.a.valid.dpop",
      expectedMethod: "GET",
      expectedUrl: "x",
      resolvePublicKey: async () => publicKey,
      recordJti,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/malformed/);
    void deviceId;
  });

  test("method mismatch", async () => {
    const { backend, keyHandle, publicKey, deviceId, recordJti } = await setup();
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId,
      method: "GET",
      url: "https://x/y",
    });
    const r = await verifyDpopProof({
      proof,
      expectedMethod: "POST",
      expectedUrl: "https://x/y",
      resolvePublicKey: async () => publicKey,
      recordJti,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/method/);
  });

  test("url mismatch", async () => {
    const { backend, keyHandle, publicKey, deviceId, recordJti } = await setup();
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId,
      method: "GET",
      url: "https://x/a",
    });
    const r = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: "https://x/b",
      resolvePublicKey: async () => publicKey,
      recordJti,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/url/);
  });

  test("stale iat outside freshness window", async () => {
    const { backend, keyHandle, publicKey, deviceId, recordJti } = await setup();
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId,
      method: "GET",
      url: "https://x/y",
      nowSeconds: () => 1000,
    });
    const r = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: "https://x/y",
      resolvePublicKey: async () => publicKey,
      recordJti,
      nowSeconds: () => 1000 + 200,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/freshness/);
  });

  test("unknown device", async () => {
    const { backend, keyHandle, recordJti } = await setup();
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId: "dev_other",
      method: "GET",
      url: "https://x/y",
    });
    const r = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: "https://x/y",
      resolvePublicKey: async () => undefined,
      recordJti,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown device/);
  });

  test("bad signature (different key)", async () => {
    const { backend, keyHandle, deviceId, recordJti } = await setup();
    const otherBackend = new SoftwareKeyBackend();
    const other = await otherBackend.generate();
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId,
      method: "GET",
      url: "https://x/y",
    });
    const r = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: "https://x/y",
      // Resolve to the WRONG public key.
      resolvePublicKey: async () => other.publicKey,
      recordJti,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/bad signature/);
  });

  test("replay (same jti twice) is rejected", async () => {
    const { backend, keyHandle, publicKey, deviceId, recordJti } = await setup();
    const proof = await createDpopProof({
      backend,
      keyHandle,
      deviceId,
      method: "GET",
      url: "https://x/y",
      jti: "fixed-nonce",
    });
    const first = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: "https://x/y",
      resolvePublicKey: async () => publicKey,
      recordJti,
    });
    expect(first.ok).toBe(true);
    const second = await verifyDpopProof({
      proof,
      expectedMethod: "GET",
      expectedUrl: "https://x/y",
      resolvePublicKey: async () => publicKey,
      recordJti,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/replay/);
  });
});
