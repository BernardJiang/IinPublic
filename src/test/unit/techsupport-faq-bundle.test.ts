import {
  faqBundleSigningPayload,
  faqBundlePath,
  faqEntryPath,
  signFaqBundle,
  verifyFaqBundle,
  type SignedFaqBundle,
} from '../../shared/techsupport-faq-bundle';
import { buildSupportFaqEntry, type SupportFaqEntry } from '../../shared/techsupport-faq';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import SEA from 'gun/sea';

const DEV_PAIR = {
  pub: 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ',
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

function entry(question: string, answer: string): SupportFaqEntry {
  const built = buildSupportFaqEntry({ question, answer, answeredAt: '2026-07-26T00:00:00.000Z' });
  if (!built) throw new Error('expected a valid entry');
  return built;
}

describe('techsupport-faq-bundle (docs/TODO.md K5)', () => {
  it('signFaqBundle + verifyFaqBundle round-trips for an empty bundle', async () => {
    const signed = await signFaqBundle([], DEV_PAIR);
    const verified = await verifyFaqBundle(signed);
    expect(verified).not.toBeNull();
    expect(verified?.entries).toEqual([]);
    expect(verified?.authorPub).toBe(TECHSUPPORT_PUB);
  });

  it('signFaqBundle + verifyFaqBundle round-trips for a populated bundle', async () => {
    const entries = [entry('How do I log in?', 'Use the Settings tab.'), entry('What is a talk?', 'A structured Q&A.')];
    const signed = await signFaqBundle(entries, DEV_PAIR);
    const verified = await verifyFaqBundle(signed);
    expect(verified).not.toBeNull();
    expect(verified?.entries).toEqual(entries);
  });

  it('rejects a bundle signed by an untrusted key', async () => {
    const strangerPair = await SEA.pair();
    const signed = await signFaqBundle([entry('q', 'a')], strangerPair);
    expect(await verifyFaqBundle(signed)).toBeNull();
  });

  it('rejects a tampered entries array even though the signature field is untouched', async () => {
    const signed = await signFaqBundle([entry('q1', 'a1')], DEV_PAIR);
    const tampered: SignedFaqBundle = { ...signed, entries: [...signed.entries, entry('q2', 'a2')] };
    expect(await verifyFaqBundle(tampered)).toBeNull();
  });

  it('rejects a tampered answer within an existing entry (bundleCid catches it, not just the signature)', async () => {
    const signed = await signFaqBundle([entry('q1', 'a1')], DEV_PAIR);
    const tampered: SignedFaqBundle = {
      ...signed,
      entries: [{ ...signed.entries[0], answer: 'a completely different answer' }],
    };
    expect(await verifyFaqBundle(tampered)).toBeNull();
  });

  it('rejects a signature that does not match the payload', async () => {
    const signed = await signFaqBundle([entry('q', 'a')], DEV_PAIR);
    const other = await signFaqBundle([entry('q2', 'a2')], DEV_PAIR);
    expect(await verifyFaqBundle({ ...signed, signature: other.signature })).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifyFaqBundle(null)).toBeNull();
    expect(await verifyFaqBundle(undefined)).toBeNull();
    expect(await verifyFaqBundle('a string')).toBeNull();
    expect(await verifyFaqBundle({})).toBeNull();
    expect(await verifyFaqBundle({ version: 1, entries: [], authorPub: TECHSUPPORT_PUB })).toBeNull();
  });

  it('faqBundleSigningPayload is deterministic for the same logical bundle', () => {
    const a = faqBundleSigningPayload({ version: 1, entries: [entry('q', 'a')], authorPub: TECHSUPPORT_PUB, bundleCid: 'x' });
    const b = faqBundleSigningPayload({ version: 1, entries: [entry('q', 'a')], authorPub: TECHSUPPORT_PUB, bundleCid: 'x' });
    expect(a).toBe(b);
  });

  it('faqBundlePath and faqEntryPath produce the expected Gun paths', () => {
    expect(faqBundlePath()).toEqual(['techsupport-faq', 'bundle']);
    expect(faqEntryPath('abc123')).toEqual(['techsupport-faq', 'abc123']);
  });
});
