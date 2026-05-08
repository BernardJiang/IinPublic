/** Parse env-style comma/semicolon/newline-separated blocked phrases for server-wide delivery moderation. */
export function parseServerBlockedTermList(raw: string | undefined | null): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((t) => t.length >= 2 && t.length <= 64);
  return [...new Set(parts)].slice(0, 200);
}
