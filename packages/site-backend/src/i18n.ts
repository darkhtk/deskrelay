// i18n — minimal backend translator for user-visible error messages.
//
// Frontend ships full per-locale dictionaries; backend keeps a slim
// inline dict for the ~20 error messages that surface to UI. Saves us
// from importing the 4×30KB JSON files into every Worker isolate.
//
// pickLocale() reads the Accept-Language header (RFC 4647 simple
// matching, first 2 chars) and falls back to "en" when nothing matches.
// loc(headers, key, params?) does a one-shot lookup + slot interpolation.
//
// Keep keys in sync with the be.* rows of docs/LOCALIZATION-STRINGS.md.
// When a key isn't in this dict, we return the key string itself so a
// missing entry surfaces visibly during development.

export const BACKEND_LOCALES = ["en", "ko", "ja", "ru"] as const;
export type BackendLocaleId = (typeof BACKEND_LOCALES)[number];

const DICT: Record<BackendLocaleId, Record<string, string>> = {
  en: {
    "be.quota.exhausted": "request limit reached",
    "be.daemon.offline":
      "device offline — start the connector daemon on that PC so the site can reach it",
    "be.daemon.fetch-failed": "cannot reach daemon: {error}",
    "be.device.duplicate": "device already registered: {url}",
    "be.device.invalid-url": "invalid daemonUrl: {url}",
    "be.device.scheme": "daemonUrl must be http:// or https://",
    "be.pairing.invalid-code": "invalid or expired pairing code",
    "be.auth.unauth": "unauthenticated",
    "be.auth.unknown-provider": "unknown provider: {id}",
    "be.ws.upgrade-required": "expected WebSocket upgrade",
    "be.ws.no-device-id": "deviceId is required",
    "be.ws.unknown-device": "unknown device",
    "be.rate-limit": "rate limit exceeded — slow down",
    "be.invalid-json": "invalid JSON body",
    "be.label.empty": "label must not be empty",
    "be.label.too-long": "label is too long (max 80 chars)",
  },
  ko: {
    "be.quota.exhausted": "요청 한도 초과",
    "be.daemon.offline": "디바이스 오프라인 — 해당 PC 에서 connector daemon 을 실행하세요",
    "be.daemon.fetch-failed": "daemon 도달 실패: {error}",
    "be.device.duplicate": "이미 등록된 디바이스: {url}",
    "be.device.invalid-url": "잘못된 daemonUrl: {url}",
    "be.device.scheme": "daemonUrl 은 http:// 또는 https:// 여야 합니다",
    "be.pairing.invalid-code": "잘못되었거나 만료된 페어링 코드",
    "be.auth.unauth": "인증되지 않음",
    "be.auth.unknown-provider": "알 수 없는 provider: {id}",
    "be.ws.upgrade-required": "WebSocket upgrade 필요",
    "be.ws.no-device-id": "deviceId 필수",
    "be.ws.unknown-device": "알 수 없는 디바이스",
    "be.rate-limit": "요청 한도 초과 — 잠시 기다리세요",
    "be.invalid-json": "잘못된 JSON 본문",
    "be.label.empty": "라벨이 비어 있을 수 없습니다",
    "be.label.too-long": "라벨이 너무 깁니다 (최대 80자)",
  },
  ja: {
    "be.quota.exhausted": "リクエスト上限に到達しました",
    "be.daemon.offline": "デバイスがオフライン — その PC で connector daemon を起動してください",
    "be.daemon.fetch-failed": "daemon に到達できません: {error}",
    "be.device.duplicate": "すでに登録済みのデバイス: {url}",
    "be.device.invalid-url": "不正な daemonUrl: {url}",
    "be.device.scheme": "daemonUrl は http:// または https:// である必要があります",
    "be.pairing.invalid-code": "不正または期限切れのペアリングコード",
    "be.auth.unauth": "未認証",
    "be.auth.unknown-provider": "不明な provider: {id}",
    "be.ws.upgrade-required": "WebSocket upgrade が必要",
    "be.ws.no-device-id": "deviceId が必要です",
    "be.ws.unknown-device": "不明なデバイス",
    "be.rate-limit": "リクエスト上限を超過しました — 少しお待ちください",
    "be.invalid-json": "不正な JSON ボディ",
    "be.label.empty": "ラベルは空にできません",
    "be.label.too-long": "ラベルが長すぎます (最大 80 文字)",
  },
  ru: {
    "be.quota.exhausted": "Достигнут лимит запросов",
    "be.daemon.offline": "Устройство офлайн — запустите connector daemon на том ПК",
    "be.daemon.fetch-failed": "Не удаётся связаться с daemon: {error}",
    "be.device.duplicate": "Устройство уже зарегистрировано: {url}",
    "be.device.invalid-url": "Некорректный daemonUrl: {url}",
    "be.device.scheme": "daemonUrl должен быть http:// или https://",
    "be.pairing.invalid-code": "Некорректный или просроченный код сопряжения",
    "be.auth.unauth": "Не аутентифицирован",
    "be.auth.unknown-provider": "Неизвестный provider: {id}",
    "be.ws.upgrade-required": "Требуется WebSocket upgrade",
    "be.ws.no-device-id": "Требуется deviceId",
    "be.ws.unknown-device": "Неизвестное устройство",
    "be.rate-limit": "Превышен лимит запросов — подождите",
    "be.invalid-json": "Некорректное JSON-тело",
    "be.label.empty": "Метка не может быть пустой",
    "be.label.too-long": "Метка слишком длинная (макс. 80 символов)",
  },
};

/** Pick the best matching backend locale from an Accept-Language
 *  header. Looks at the first 2 chars of the highest-quality entry. */
export function pickLocale(acceptLanguage: string | null | undefined): BackendLocaleId {
  if (!acceptLanguage) return "en";
  // Quality-aware sort: "ko-KR,ko;q=0.9,en;q=0.8" → ["ko","en"].
  const candidates = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...rest] = part.split(";");
      const qStr = rest
        .find((s) => s.trim().startsWith("q="))
        ?.trim()
        .slice(2);
      const q = qStr ? Number(qStr) : 1;
      return { tag: (tag ?? "").trim().toLowerCase().slice(0, 2), q };
    })
    .filter((x) => x.tag.length === 2)
    .sort((a, b) => b.q - a.q);
  for (const c of candidates) {
    if ((BACKEND_LOCALES as readonly string[]).includes(c.tag)) {
      return c.tag as BackendLocaleId;
    }
  }
  return "en";
}

/** Lookup + slot interpolation. Falls back to en, then to the key
 *  itself so missing translations surface during development. */
export function loc(
  acceptLanguage: string | null | undefined,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const locale = pickLocale(acceptLanguage);
  const tpl = DICT[locale][key] ?? DICT.en[key] ?? key;
  if (!tpl.includes("{")) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, slot: string) => {
    const v = params[slot];
    return v === undefined ? `{${slot}}` : String(v);
  });
}
