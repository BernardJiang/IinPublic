/**
 * Pure, dependency-free version comparison (docs/TODO.md OPEN-33's update-reminder banner).
 * Not full SemVer 2.0 (no prerelease/build-metadata precedence) — this project's own versions
 * are plain `major.minor.patch` (root `package.json`, synced to native builds by
 * `scripts/sync-app-version.mjs`), and that's the only shape either side of this comparison ever
 * actually produces. Malformed/missing segments are treated as `0`, never thrown — a compare
 * feeding a UI reminder should degrade to "no update" on bad input, not crash the caller.
 */

/** Parses "1.0.57" -> [1, 0, 57]. A non-numeric or missing segment becomes 0. */
function parseVersionParts(version: string): number[] {
  return String(version ?? '')
    .trim()
    .split('.')
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

/** -1 if a < b, 0 if equal, 1 if a > b — compares every segment, including trailing segments
 * one side has and the other doesn't (e.g. "1.2" vs "1.2.1" -> -1, the shorter one is older). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** True only when `candidate` is a real, strictly newer version than `current` — the exact
 * question an update-reminder banner needs answered. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
