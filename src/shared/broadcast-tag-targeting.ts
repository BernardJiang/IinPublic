/**
 * Normalize a tag/title string for overlap checks (broadcast preamble vs profile interests).
 */
export function normalizeTagToken(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** Union of preamble selections and talk-authored tags for targeting signals. */
export function buildTargetingTokenSet(
  broadcastTargetTags: readonly string[],
  talkTags?: ReadonlyArray<{ name?: string | null }>,
): Set<string> {
  const set = new Set<string>();
  for (const raw of broadcastTargetTags) {
    const n = normalizeTagToken(raw);
    if (n.length > 0) set.add(n);
  }
  if (talkTags && Array.isArray(talkTags)) {
    for (const t of talkTags) {
      const n = normalizeTagToken(t?.name);
      if (n.length > 0) set.add(n);
    }
  }
  return set;
}

/**
 * When `broadcastTargetTags` is non-empty, receivers with **any** declared profile interests must
 * share at least one normalized token with the targeting set (preamble ∪ talk.tags).
 *
 * Receivers with **no** interests stored are treated as eligible (backward-compatible and avoids
 * mass-dropping recipients while profiles may be incomplete).
 */
export function receiverPassesBroadcastTagTargeting(args: {
  broadcastTargetTags: readonly string[];
  talkTags?: ReadonlyArray<{ name?: string | null }>;
  receiverInterestTokens: readonly string[];
}): boolean {
  const { broadcastTargetTags, talkTags, receiverInterestTokens } = args;
  if (!broadcastTargetTags.length) return true;
  const targets = buildTargetingTokenSet(broadcastTargetTags, talkTags);
  if (targets.size === 0) return true;
  if (!receiverInterestTokens.length) return true;
  for (const r of receiverInterestTokens) {
    const n = normalizeTagToken(r);
    if (!n || !targets.has(n)) continue;
    return true;
  }
  return false;
}
