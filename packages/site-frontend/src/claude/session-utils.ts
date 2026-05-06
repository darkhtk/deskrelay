// session-utils — pure helpers for SessionList rendering. Same surface as
// claude-remote/public/session-list.js (cwdBasename + formatAgo) so test
// fixtures can be reused.

export function cwdBasename(cwd: unknown): string {
  if (!cwd) return "—";
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? String(cwd);
}

export function formatAgo(updatedAtMs: number | undefined, nowMs: number = Date.now()): string {
  if (!updatedAtMs) return "";
  const diff = nowMs - Number(updatedAtMs);
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}
