// Space identifiers — the kernel addresses pub/sub topics with these strings.
//
// A SpaceId follows the form `{behavior}.{kind}:{id}` where `{behavior}` is
// the publishing behavior's slug (e.g. "remote-claude"), `{kind}` is the
// scope inside that behavior (e.g. "machine", "session", "run"), and `{id}`
// is an opaque identifier.
//
// Examples:
//   remote-claude.machine:home-pc
//   remote-claude.session:01HQ...
//   remote-claude.run:rmojvlgk8_dukkql
//   remote-codex.thread:abc123
//
// Behavior + kind allow `[a-z][a-z0-9_-]*` so kebab-case package names
// (the actual convention across packages/behaviors/*) work; the id part
// is permissive (alphanumeric + ._-) since it's caller-defined.
//
// SpaceId is a branded string so we can't accidentally pass a raw string
// where a validated SpaceId is required.

declare const SpaceIdBrand: unique symbol;
export type SpaceId = string & { readonly [SpaceIdBrand]: true };

const SPACE_ID_PATTERN = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/;

export function isSpaceId(value: unknown): value is SpaceId {
  return typeof value === "string" && SPACE_ID_PATTERN.test(value);
}

export function asSpaceId(value: string): SpaceId {
  if (!isSpaceId(value)) {
    throw new Error(`Invalid SpaceId: ${JSON.stringify(value)}`);
  }
  return value;
}

export function makeSpaceId(behavior: string, kind: string, id: string): SpaceId {
  const candidate = `${behavior}.${kind}:${id}`;
  return asSpaceId(candidate);
}

export interface ParsedSpaceId {
  behavior: string;
  kind: string;
  id: string;
}

export function parseSpaceId(spaceId: SpaceId): ParsedSpaceId {
  const colonIndex = spaceId.indexOf(":");
  const dotIndex = spaceId.indexOf(".");
  const behavior = spaceId.slice(0, dotIndex);
  const kind = spaceId.slice(dotIndex + 1, colonIndex);
  const id = spaceId.slice(colonIndex + 1);
  return { behavior, kind, id };
}
