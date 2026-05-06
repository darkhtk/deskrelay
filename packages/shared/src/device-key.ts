// device-key — Ed25519 key backend interface + software implementation
// + DPoP-style request signing/verification.
//
// The site only ever holds a device's public key; the private key
// stays on the PC. Each request to the site that needs to prove "I am
// device X" carries a DPoP proof in a header. The server verifies the
// signature with the stored public key, the URL/method match the
// actual request, the timestamp is within the freshness window, and
// the jti (nonce) hasn't been seen recently.

const ENCODER = new TextEncoder();

// ---- backend interface -----------------------------------------------

export interface DeviceKeyHandle {
  /** Opaque id chosen by the backend; stays on disk. */
  keyHandle: string;
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
}

export interface DeviceKeyBackend {
  /** Generate a new key pair, return the public key + an opaque handle
   *  the backend will use to sign with the matching private key. */
  generate(): Promise<DeviceKeyHandle>;
  /** Sign a message with the private key matching `keyHandle`. */
  sign(keyHandle: string, message: Uint8Array): Promise<Uint8Array>;
  /** Best-effort wipe (used on unpair). Idempotent. */
  destroy(keyHandle: string): Promise<void>;
}

// ---- software backend (WebCrypto Ed25519) ----------------------------

export interface SoftwareKeyStorage {
  /** Persist the encoded private key for later sign() lookups. The
   *  storage layer is responsible for keeping this confidential. */
  put(keyHandle: string, encodedPrivate: Uint8Array): Promise<void>;
  get(keyHandle: string): Promise<Uint8Array | undefined>;
  remove(keyHandle: string): Promise<void>;
}

export class InMemorySoftwareKeyStorage implements SoftwareKeyStorage {
  readonly #keys = new Map<string, Uint8Array>();
  async put(keyHandle: string, key: Uint8Array): Promise<void> {
    this.#keys.set(keyHandle, key);
  }
  async get(keyHandle: string): Promise<Uint8Array | undefined> {
    return this.#keys.get(keyHandle);
  }
  async remove(keyHandle: string): Promise<void> {
    this.#keys.delete(keyHandle);
  }
}

export interface SoftwareKeyBackendOptions {
  storage?: SoftwareKeyStorage;
  /** Source of randomness for keyHandle generation. Default crypto.getRandomValues. */
  randomBytes?: (n: number) => Uint8Array;
}

export class SoftwareKeyBackend implements DeviceKeyBackend {
  readonly #storage: SoftwareKeyStorage;
  readonly #random: (n: number) => Uint8Array;

  constructor(options: SoftwareKeyBackendOptions = {}) {
    this.#storage = options.storage ?? new InMemorySoftwareKeyStorage();
    this.#random =
      options.randomBytes ??
      ((n: number) => {
        const out = new Uint8Array(n);
        crypto.getRandomValues(out);
        return out;
      });
  }

  async generate(): Promise<DeviceKeyHandle> {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey("raw", pair.publicKey);
    const privatePkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    const keyHandle = bytesToHex(this.#random(8));
    await this.#storage.put(keyHandle, new Uint8Array(privatePkcs8));
    return { keyHandle, publicKey: new Uint8Array(publicJwk) };
  }

  async sign(keyHandle: string, message: Uint8Array): Promise<Uint8Array> {
    const pkcs8 = await this.#storage.get(keyHandle);
    if (!pkcs8) throw new Error(`SoftwareKeyBackend: unknown key ${keyHandle}`);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "Ed25519",
      key,
      message.buffer.slice(
        message.byteOffset,
        message.byteOffset + message.byteLength,
      ) as ArrayBuffer,
    );
    return new Uint8Array(sig);
  }

  async destroy(keyHandle: string): Promise<void> {
    await this.#storage.remove(keyHandle);
  }
}

// ---- DPoP-style proof ------------------------------------------------
//
// Wire format: a compact JWT-like string `<header>.<payload>.<sig>` where
//   header  = { typ: "cr-dpop+ed25519", kid: "<deviceId>" }
//   payload = { htm: "POST", htu: "https://site/...", iat: <epoch>, jti: "<nonce>" }
//   sig     = ed25519(headerB64u + "." + payloadB64u)
//
// The header carries the deviceId so the server can look up the public
// key. We don't embed the public key directly (unlike the OAuth DPoP
// spec) because the server already has it — saves ~50 bytes per request
// and prevents key-rebinding attacks.

const PROOF_TYP = "cr-dpop+ed25519";
const FRESHNESS_WINDOW_SECONDS = 120;

export interface DpopProofHeader {
  typ: typeof PROOF_TYP;
  /** deviceId — the server uses this to look up the public key. */
  kid: string;
}

export interface DpopProofPayload {
  /** HTTP method (uppercase). */
  htm: string;
  /** Full request URL. */
  htu: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Nonce to defeat replay (random base64url, ≥16 bytes). */
  jti: string;
}

export interface CreateDpopProofOptions {
  backend: DeviceKeyBackend;
  keyHandle: string;
  deviceId: string;
  method: string;
  url: string;
  /** Override now() for tests. */
  nowSeconds?: () => number;
  /** Override jti for tests. */
  jti?: string;
}

export async function createDpopProof(options: CreateDpopProofOptions): Promise<string> {
  const header: DpopProofHeader = { typ: PROOF_TYP, kid: options.deviceId };
  const payload: DpopProofPayload = {
    htm: options.method.toUpperCase(),
    htu: options.url,
    iat: options.nowSeconds ? options.nowSeconds() : Math.floor(Date.now() / 1000),
    jti:
      options.jti ??
      bytesToBase64Url(
        (() => {
          const b = new Uint8Array(16);
          crypto.getRandomValues(b);
          return b;
        })(),
      ),
  };
  const headerB64 = base64UrlEncode(ENCODER.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await options.backend.sign(options.keyHandle, ENCODER.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

export interface DpopVerifyOptions {
  /** The proof string from the request header. */
  proof: string;
  /** Look up the device's public key by deviceId. Returns undefined if unknown. */
  resolvePublicKey(deviceId: string): Promise<Uint8Array | undefined>;
  /** Mark a (deviceId, jti) as seen; returns false if already seen (replay). */
  recordJti(deviceId: string, jti: string): Promise<boolean>;
  /** Expected request method (uppercase). */
  expectedMethod: string;
  /** Expected request URL (absolute, including query string). */
  expectedUrl: string;
  /** Override now() for tests. */
  nowSeconds?: () => number;
}

export type DpopVerifyResult = { ok: true; deviceId: string } | { ok: false; reason: string };

export async function verifyDpopProof(options: DpopVerifyOptions): Promise<DpopVerifyResult> {
  const parts = options.proof.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed proof" };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: DpopProofHeader;
  let payload: DpopProofPayload;
  try {
    header = JSON.parse(decodeBase64UrlString(headerB64)) as DpopProofHeader;
    payload = JSON.parse(decodeBase64UrlString(payloadB64)) as DpopProofPayload;
  } catch {
    return { ok: false, reason: "header/payload not valid JSON" };
  }

  if (header.typ !== PROOF_TYP) return { ok: false, reason: `unexpected typ: ${header.typ}` };
  if (typeof header.kid !== "string" || header.kid.length === 0) {
    return { ok: false, reason: "header.kid missing" };
  }
  if (typeof payload.htm !== "string" || typeof payload.htu !== "string") {
    return { ok: false, reason: "payload.htm/htu missing" };
  }
  if (payload.htm !== options.expectedMethod.toUpperCase()) {
    return { ok: false, reason: "method mismatch" };
  }
  if (payload.htu !== options.expectedUrl) {
    return { ok: false, reason: "url mismatch" };
  }
  if (typeof payload.iat !== "number" || typeof payload.jti !== "string") {
    return { ok: false, reason: "payload.iat/jti missing" };
  }
  const now = options.nowSeconds ? options.nowSeconds() : Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.iat) > FRESHNESS_WINDOW_SECONDS) {
    return { ok: false, reason: "iat outside freshness window" };
  }

  const publicKey = await options.resolvePublicKey(header.kid);
  if (!publicKey) return { ok: false, reason: "unknown device" };

  const signingInput = ENCODER.encode(`${headerB64}.${payloadB64}`);
  let sig: Uint8Array;
  try {
    sig = decodeBase64Url(sigB64);
  } catch {
    return { ok: false, reason: "signature not base64url" };
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKey.buffer.slice(
      publicKey.byteOffset,
      publicKey.byteOffset + publicKey.byteLength,
    ) as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    cryptoKey,
    sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
    signingInput.buffer.slice(
      signingInput.byteOffset,
      signingInput.byteOffset + signingInput.byteLength,
    ) as ArrayBuffer,
  );
  if (!ok) return { ok: false, reason: "bad signature" };

  const fresh = await options.recordJti(header.kid, payload.jti);
  if (!fresh) return { ok: false, reason: "replay (jti reused)" };

  return { ok: true, deviceId: header.kid };
}

// ---- helpers ---------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    s += b.toString(16).padStart(2, "0");
  }
  return s;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(s: string): Uint8Array {
  const padded = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeBase64UrlString(s: string): string {
  return new TextDecoder().decode(decodeBase64Url(s));
}
