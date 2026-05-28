import { canonicalSerialize, computeCIDv1, computeCIDv1Sync } from '../../shared/cid';

describe('canonicalSerialize', () => {
  it('produces deterministic output regardless of key insertion order', () => {
    const a = canonicalSerialize({ z: 1, a: 2, m: 3 });
    const b = canonicalSerialize({ m: 3, z: 1, a: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  it('omits null values', () => {
    const result = canonicalSerialize({ a: 1, b: null, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
    expect(result).not.toContain('"b"');
  });

  it('omits undefined values', () => {
    const result = canonicalSerialize({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
    expect(result).not.toContain('"b"');
  });

  it('sorts nested object keys recursively', () => {
    const result = canonicalSerialize({ z: { b: 2, a: 1 }, a: { y: 9, x: 8 } });
    expect(result).toBe('{"a":{"x":8,"y":9},"z":{"a":1,"b":2}}');
  });

  it('preserves array order', () => {
    const result = canonicalSerialize({ arr: [3, 1, 2] });
    expect(result).toBe('{"arr":[3,1,2]}');
  });

  it('filters null/undefined entries from arrays', () => {
    const result = canonicalSerialize({ arr: [1, null, 3, undefined, 5] });
    // undefined and null elements are removed by sortedReplace
    expect(result).toBe('{"arr":[1,3,5]}');
  });

  it('handles primitive values directly', () => {
    expect(canonicalSerialize(42)).toBe('42');
    expect(canonicalSerialize('hello')).toBe('"hello"');
    expect(canonicalSerialize(true)).toBe('true');
  });

  it('returns undefined for null/undefined top-level input (JSON.stringify behaviour)', () => {
    // JSON.stringify(undefined) returns undefined (not a string)
    expect(canonicalSerialize(null)).toBeUndefined();
    expect(canonicalSerialize(undefined)).toBeUndefined();
  });

  it('same content always yields same string', () => {
    const obj = { kind: 'TALK_CREATED', seq: 1, talkId: 'abc123', userId: 'u1' };
    expect(canonicalSerialize(obj)).toBe(canonicalSerialize({ ...obj }));
  });
});

describe('computeCIDv1', () => {
  it('returns a string starting with "b" (base32 multibase prefix)', async () => {
    const cid = await computeCIDv1({ kind: 'TEST', value: 42 });
    expect(typeof cid).toBe('string');
    expect(cid.startsWith('b')).toBe(true);
  });

  it('same object always produces same CID', async () => {
    const obj = { kind: 'TALK_CREATED', seq: 1, talkId: 'abc', userId: 'u1' };
    const cid1 = await computeCIDv1(obj);
    const cid2 = await computeCIDv1({ ...obj });
    expect(cid1).toBe(cid2);
  });

  it('field insertion order does not affect CID', async () => {
    const cid1 = await computeCIDv1({ z: 1, a: 2 });
    const cid2 = await computeCIDv1({ a: 2, z: 1 });
    expect(cid1).toBe(cid2);
  });

  it('different content produces different CIDs', async () => {
    const cid1 = await computeCIDv1({ kind: 'TALK_CREATED', seq: 1 });
    const cid2 = await computeCIDv1({ kind: 'TALK_CREATED', seq: 2 });
    expect(cid1).not.toBe(cid2);
  });

  it('null fields are excluded from CID computation', async () => {
    const cid1 = await computeCIDv1({ a: 1, b: null });
    const cid2 = await computeCIDv1({ a: 1 });
    expect(cid1).toBe(cid2);
  });

  it('produces a CID of reasonable length (≥36 chars)', async () => {
    const cid = await computeCIDv1({ x: 1 });
    // base32 of ~38 bytes (1+2+2+32) → ~62 chars + 'b' prefix
    expect(cid.length).toBeGreaterThanOrEqual(36);
  });
});

describe('computeCIDv1Sync', () => {
  it('returns a string starting with "bsync"', () => {
    const cid = computeCIDv1Sync({ kind: 'TEST' });
    expect(cid.startsWith('bsync')).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const obj = { kind: 'MATCH_CREATED', talkId: 'xyz' };
    expect(computeCIDv1Sync(obj)).toBe(computeCIDv1Sync({ ...obj }));
  });

  it('produces different outputs for different inputs', () => {
    expect(computeCIDv1Sync({ a: 1 })).not.toBe(computeCIDv1Sync({ a: 2 }));
  });

  it('is unaffected by key order', () => {
    expect(computeCIDv1Sync({ z: 1, a: 2 })).toBe(computeCIDv1Sync({ a: 2, z: 1 }));
  });
});
