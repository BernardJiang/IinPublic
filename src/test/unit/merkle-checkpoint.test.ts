/**
 * TODO §S Item 6: unit coverage for the shared Merkle-checkpoint module
 * (src/shared/merkle-checkpoint.ts) — proof correctness and forgery rejection, the two
 * properties the whole pruning design depends on (a checkpoint is only as trustworthy as
 * its proof verification is strict).
 */
import {
  computeMerkleRoot,
  buildMerkleProof,
  verifyMerkleProof,
  sortedLeaves,
} from '../../shared/merkle-checkpoint';

describe('merkle-checkpoint', () => {
  const ids100 = Array.from({ length: 100 }, (_, i) => `event-${String(i).padStart(3, '0')}`);

  it('sorts leaves lexicographically regardless of input order', () => {
    expect(sortedLeaves(['b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(sortedLeaves(['event-099', 'event-001', 'event-050'])).toEqual([
      'event-001', 'event-050', 'event-099',
    ]);
  });

  it('produces the same root regardless of input insertion order', async () => {
    const shuffled = [...ids100].reverse();
    const rootA = await computeMerkleRoot(ids100);
    const rootB = await computeMerkleRoot(shuffled);
    expect(rootA).toBe(rootB);
    expect(rootA).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('every real leaf verifies its inclusion proof against the root, for a 100-leaf set', async () => {
    const root = await computeMerkleRoot(ids100);
    for (const leaf of [ids100[0], ids100[37], ids100[99]]) {
      const proof = await buildMerkleProof(ids100, leaf);
      expect(proof.length).toBeGreaterThan(0);
      expect(proof.length).toBeLessThanOrEqual(7); // O(log2 100) ~= 7 steps, per SRS §9.3
      await expect(verifyMerkleProof(root, leaf, proof)).resolves.toBe(true);
    }
  });

  it('rejects a proof for a leaf that was never in the set', async () => {
    const root = await computeMerkleRoot(ids100);
    // Build a real proof for a real leaf, but verify a DIFFERENT (absent) leaf against it.
    const proof = await buildMerkleProof(ids100, ids100[10]);
    await expect(verifyMerkleProof(root, 'event-does-not-exist', proof)).resolves.toBe(false);
  });

  it('rejects a forged proof: tampering with any single sibling hash', async () => {
    const root = await computeMerkleRoot(ids100);
    const leaf = ids100[42];
    const proof = await buildMerkleProof(ids100, leaf);
    const tampered = proof.map((step, i) => (i === 0 ? { ...step, sibling: `${step.sibling}ff` } : step));
    await expect(verifyMerkleProof(root, leaf, tampered)).resolves.toBe(false);
  });

  it('rejects a forged proof: flipping a step\'s side', async () => {
    const root = await computeMerkleRoot(ids100);
    const leaf = ids100[42];
    const proof = await buildMerkleProof(ids100, leaf);
    const flipped = proof.map((step, i) =>
      i === 0 ? { ...step, side: step.side === 'left' ? 'right' as const : 'left' as const } : step);
    await expect(verifyMerkleProof(root, leaf, flipped)).resolves.toBe(false);
  });

  it('rejects a forged proof: tampering with the claimed root', async () => {
    const root = await computeMerkleRoot(ids100);
    const leaf = ids100[42];
    const proof = await buildMerkleProof(ids100, leaf);
    const forgedRoot = `${root.slice(0, -2)}ff`;
    await expect(verifyMerkleProof(forgedRoot, leaf, proof)).resolves.toBe(false);
  });

  it('throws when asked to build a proof for a leaf not in the set', async () => {
    await expect(buildMerkleProof(ids100, 'not-a-real-id')).rejects.toThrow();
  });

  it('handles odd-length leaf sets, including the self-paired last node', async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `odd-${i}`);
    const root = await computeMerkleRoot(ids);
    for (const leaf of ids) {
      const proof = await buildMerkleProof(ids, leaf);
      await expect(verifyMerkleProof(root, leaf, proof)).resolves.toBe(true);
    }
  });

  it('handles a single-leaf set: root is the leaf hash, proof is empty', async () => {
    const ids = ['solo-event'];
    const root = await computeMerkleRoot(ids);
    const proof = await buildMerkleProof(ids, 'solo-event');
    expect(proof).toEqual([]);
    await expect(verifyMerkleProof(root, 'solo-event', proof)).resolves.toBe(true);
  });

  it('handles a two-leaf set', async () => {
    const ids = ['alpha', 'beta'];
    const root = await computeMerkleRoot(ids);
    for (const leaf of ids) {
      const proof = await buildMerkleProof(ids, leaf);
      await expect(verifyMerkleProof(root, leaf, proof)).resolves.toBe(true);
    }
  });

  it('rejects an empty proof against a multi-leaf root (no shortcut to skip verification)', async () => {
    const root = await computeMerkleRoot(ids100);
    await expect(verifyMerkleProof(root, ids100[0], [])).resolves.toBe(false);
  });
});
