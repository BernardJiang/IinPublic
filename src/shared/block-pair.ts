import { portableSha256Hex } from './portable-sha256';

/**
 * Non-reversible key for a block relationship between two users, used in place of the old
 * open `user-blocks/<blocker>/<target>` / `user-blocked-by/<target>/<blocker>` maps, which let
 * the server (and any Gun peer) enumerate a user's entire block list via `.map()`.
 *
 * Sorting the pair before hashing makes the key direction-agnostic — the SAME key is used to
 * store/read the relationship regardless of which side is the blocker. Direction (`blocked` vs
 * `blockedBy`) is recovered from the `blockerId`/`targetId` fields stored IN the node value at
 * that key, not from the key itself. A reader who does not already know BOTH ids cannot derive
 * this key and cannot enumerate "all of X's blocks" — they would need to hash X against every
 * other known user id one at a time. This intentionally does not hide a specific pair's block
 * status from someone who already knows both ids (the server still needs to answer that, to
 * enforce the profile-visibility gate and block-status API) — only bulk enumeration is removed.
 */
export function blockPairHash(userIdA: string, userIdB: string): string {
  const [first, second] = [String(userIdA || ''), String(userIdB || '')].sort();
  return portableSha256Hex(`block-pair-v1::${first}::${second}`);
}
