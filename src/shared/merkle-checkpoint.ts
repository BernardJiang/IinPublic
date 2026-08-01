/**
 * src/shared/merkle-checkpoint.ts
 *
 * Shared Merkle-tree primitives for TODO.md §S (docs/design/
 * section-s-merkle-checkpoint-pruning-design-note.md, Item 0) — one implementation used by
 * both the interaction-ledger checkpoint (SRS §28.9.2) and the conversation-message
 * checkpoint (SRS §28.9.4), since the tree math is identical for both; only what gets
 * hashed into the leaves differs (ledger: event CIDv1 strings; messages: msgId +
 * ciphertext-hash pairs).
 *
 * Deliberately pure and dependency-free (no Gun, no SEA) — mirrors the existing
 * src/shared/cid.ts convention so this is trivially unit-testable without a browser or
 * Gun server.
 *
 * Spec note: SRS §9.2's literal "root = SHA-256(JSON.stringify(ordered))" formula is a
 * single flat hash over the whole sorted array, which cannot support the O(log N) proof
 * §9.3 requires (verifying it needs the entire array, not a handful of sibling hashes).
 * This module implements an actual binary Merkle tree (pairwise SHA-256 up the levels,
 * odd levels padded by duplicating the last node — the standard Bitcoin-style
 * construction) so the O(log N) proof claim is actually true. The design note flags this
 * spec inconsistency explicitly; treat this file as the corrected implementation.
 *
 * Uses globalThis.crypto.subtle (Web Crypto API) — available in Node 18+ and all modern
 * browsers, no additional dependencies (same as cid.ts).
 */

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(digestBuffer));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deterministic leaf ordering — the same rule every peer must apply so two honest peers
 * computing "the same" checkpoint agree on the root. Plain lexicographic sort on the raw
 * strings (JS default `Array.sort()`, UTF-16 code unit order) — never locale-aware
 * collation, which is not guaranteed stable across environments/ICU versions.
 */
export function sortedLeaves(ids: string[]): string[] {
  return [...ids].sort();
}

async function hashLeaf(leaf: string): Promise<string> {
  return sha256Hex(leaf);
}

/**
 * Hashes of a sibling pair are always fixed-width 64-hex-char SHA-256 digests, so plain
 * concatenation (no separator) is unambiguous. If this module is ever changed to hash a
 * different-width digest, this concatenation must gain a separator or length prefix.
 */
async function hashPair(left: string, right: string): Promise<string> {
  return sha256Hex(left + right);
}

/**
 * All levels of the tree, bottom-up: `levels[0]` is the leaf-hash row (one hash per
 * sorted input, in sorted order), `levels[levels.length - 1]` is `[root]`. Odd-length
 * levels are padded by pairing the last node with itself, matching the input array
 * lexicographic order for at least one input.
 */
async function buildTreeLevels(ids: string[]): Promise<string[][]> {
  const sorted = sortedLeaves(ids);
  if (sorted.length === 0) throw new Error('merkle tree requires at least one leaf');

  let level = await Promise.all(sorted.map(hashLeaf));
  const levels: string[][] = [level];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left; // odd level: pad with self
      next.push(await hashPair(left, right));
    }
    level = next;
    levels.push(level);
  }
  return levels;
}

/** SHA-256-based Merkle root over the sorted leaf set (SRS §28.9.2's `merkleRoot` field). */
export async function computeMerkleRoot(ids: string[]): Promise<string> {
  const levels = await buildTreeLevels(ids);
  return levels[levels.length - 1][0];
}

/** One step of an inclusion proof: the sibling hash and which side it sits on. */
export type MerkleProofStep = { sibling: string; side: 'left' | 'right' };

/**
 * Builds an O(log N) inclusion proof for `leaf` within `ids` — SRS §9.3's "merkle proof
 * path" (7 steps for N=100, 10 for N=1,000). Throws if `leaf` is not present in `ids`;
 * callers must have already confirmed the leaf belongs to this set (e.g. checked it
 * against the checkpoint's own retained leaf array — see the design note's Item 3/4 risk
 * notes on why that array must be retained even after the underlying data is pruned).
 */
export async function buildMerkleProof(ids: string[], leaf: string): Promise<MerkleProofStep[]> {
  const sorted = sortedLeaves(ids);
  const leafIndex = sorted.indexOf(leaf);
  if (leafIndex === -1) throw new Error(`buildMerkleProof: leaf not present in the provided id set`);

  const levels = await buildTreeLevels(ids);
  const proof: MerkleProofStep[] = [];
  let index = leafIndex;
  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;
    // Odd level, last (unpaired) node: its sibling is itself (matches buildTreeLevels'
    // self-pairing padding).
    const sibling = siblingIndex < level.length ? level[siblingIndex] : level[index];
    proof.push({ sibling, side: isRightChild ? 'left' : 'right' });
    index = Math.floor(index / 2);
  }
  return proof;
}

/**
 * Recomputes the root from `leaf` + `proof` and compares against `root`. Returns false
 * (never throws) for any mismatch, including a tampered leaf, a tampered proof step, or a
 * tampered root — the caller (delta-sync ingest) must treat any false as "reject this
 * proof," not as an error to recover from.
 */
export async function verifyMerkleProof(
  root: string,
  leaf: string,
  proof: MerkleProofStep[],
): Promise<boolean> {
  try {
    let hash = await hashLeaf(leaf);
    for (const step of proof) {
      hash = step.side === 'left'
        ? await hashPair(step.sibling, hash)
        : await hashPair(hash, step.sibling);
    }
    return hash === root;
  } catch {
    return false;
  }
}
