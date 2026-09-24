import {
  FAQ_ENTRIES_ROOT,
  faqEntryOf,
  faqEntryRecordPath,
  faqEntrySigningPayload,
  isFaqEntryRollback,
  signFaqEntry,
  verifyFaqEntry,
  type SignedFaqEntry,
} from '../../shared/techsupport-faq-entry';
import { buildSupportFaqEntry, supportQuestionKey, type SupportFaqEntry } from '../../shared/techsupport-faq';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import { signDelegateGrant } from '../../shared/techsupport-delegate';
import { signRecoveryAnchor } from '../../shared/techsupport-recovery';
import SEA from 'gun/sea';
import {
  describeWithRealTechSupportPair,
  describeWithRealTechSupportRecoveryPair,
} from '../support/techsupport-real-pair';

function entry(question: string, answer: string, answeredAt = '2026-07-26T00:00:00.000Z', by?: string): SupportFaqEntry {
  const built = buildSupportFaqEntry({ question, answer, answeredAt, ...(by ? { answeredByDelegate: by } : {}) });
  if (!built) throw new Error('expected a valid entry');
  return built;
}

describeWithRealTechSupportPair('techsupport-faq-entry (docs/TODO.md OPEN-31)', (DEV_PAIR) => {
  it('signs and verifies one entry, and the record is flat (no nested object or array)', async () => {
    const signed = await signFaqEntry(entry('How do I log in?', 'Use Settings.'), DEV_PAIR);
    for (const value of Object.values(signed)) expect(typeof value === 'object').toBe(false);
    const verified = await verifyFaqEntry(signed);
    expect(verified).toEqual(signed);
    expect(verified?.authorPub).toBe(TECHSUPPORT_PUB);
    expect(faqEntryOf(verified!)).toEqual(entry('How do I log in?', 'Use Settings.'));
  });

  it('is addressed by questionKey under its own root', () => {
    expect(faqEntryRecordPath('abc')).toEqual([FAQ_ENTRIES_ROOT, 'abc']);
  });

  it('signing is O(1): the signed payload covers this entry only, never any other answer', async () => {
    const a = await signFaqEntry(entry('q1', 'a1'), DEV_PAIR);
    const b = await signFaqEntry(entry('q2', 'a2'), DEV_PAIR);
    expect(faqEntrySigningPayload(a)).not.toContain('a2');
    expect(faqEntrySigningPayload(b)).not.toContain('a1');
  });

  it('drops unknown extra fields from the verified result', async () => {
    const signed = await signFaqEntry(entry('q', 'a'), DEV_PAIR);
    const verified = await verifyFaqEntry({ ...signed, injected: 'x' });
    expect(verified).not.toBeNull();
    expect(verified).not.toHaveProperty('injected');
  });

  it('rejects an entry signed by an untrusted key', async () => {
    const stranger = await SEA.pair();
    expect(await verifyFaqEntry(await signFaqEntry(entry('q', 'a'), stranger))).toBeNull();
  });

  it('rejects a tampered answer, question, timestamp or delegate attribution', async () => {
    const signed = await signFaqEntry(entry('q', 'a'), DEV_PAIR);
    expect(await verifyFaqEntry({ ...signed, answer: 'different' })).toBeNull();
    expect(await verifyFaqEntry({ ...signed, answeredAt: '2027-01-01T00:00:00.000Z' })).toBeNull();
    expect(await verifyFaqEntry({ ...signed, answeredByDelegate: 'someone' })).toBeNull();
  });

  it('rejects a validly-signed entry whose questionKey is not the hash of its canonicalQuestion', async () => {
    const real = entry('q', 'a');
    const forged = await signFaqEntry({ ...real, questionKey: supportQuestionKey('some other question') }, DEV_PAIR);
    expect(await verifyFaqEntry(forged)).toBeNull();
  });

  it('rejects a signature copied from a different entry', async () => {
    const a = await signFaqEntry(entry('q1', 'a1'), DEV_PAIR);
    const b = await signFaqEntry(entry('q2', 'a2'), DEV_PAIR);
    expect(await verifyFaqEntry({ ...a, signature: b.signature })).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    for (const bad of [null, undefined, 'x', 1, {}, { version: 1 }, { version: 1, questionKey: 'k' }]) {
      expect(await verifyFaqEntry(bad)).toBeNull();
    }
    const signed = await signFaqEntry(entry('q', 'a'), DEV_PAIR);
    expect(await verifyFaqEntry({ ...signed, answer: '' })).toBeNull();
    expect(await verifyFaqEntry({ ...signed, answeredByDelegate: 5 })).toBeNull();
  });

  describe('rollback', () => {
    let older: SignedFaqEntry;
    let newer: SignedFaqEntry;
    beforeAll(async () => {
      older = await signFaqEntry(entry('q', 'old answer', '2026-01-01T00:00:00.000Z'), DEV_PAIR);
      newer = await signFaqEntry(entry('q', 'new answer', '2026-02-01T00:00:00.000Z'), DEV_PAIR);
    });
    it('an older record may not replace a newer one for the same question', () => {
      expect(isFaqEntryRollback(newer, older)).toBe(true);
      expect(isFaqEntryRollback(older, newer)).toBe(false);
    });
    it('an identical timestamp is an idempotent re-publish, not a rollback', () => {
      expect(isFaqEntryRollback(newer, newer)).toBe(false);
    });
    it('different questions never conflict', async () => {
      const other = await signFaqEntry(entry('other', 'x', '2020-01-01T00:00:00.000Z'), DEV_PAIR);
      expect(isFaqEntryRollback(newer, other)).toBe(false);
    });
  });

  describe('K7 delegate-signed entries', () => {
    it('rejects a delegate entry with no fetchGrant, accepts it with a valid grant, rejects an expired one', async () => {
      const delegate = await SEA.pair();
      const good = await signDelegateGrant(
        { delegatePub: delegate.pub, delegateUserId: 'u', label: 'A', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        DEV_PAIR,
      );
      const expired = await signDelegateGrant(
        { delegatePub: delegate.pub, delegateUserId: 'u', label: 'A', expiresAt: new Date(Date.now() - 1000).toISOString() },
        DEV_PAIR,
      );
      const signed = await signFaqEntry(entry('q', 'a', undefined, delegate.pub), delegate);
      expect(await verifyFaqEntry(signed)).toBeNull();
      expect((await verifyFaqEntry(signed, { fetchGrant: async () => good }))?.answeredByDelegate).toBe(delegate.pub);
      expect(await verifyFaqEntry(signed, { fetchGrant: async () => expired })).toBeNull();
      expect(await verifyFaqEntry(signed, { fetchGrant: async () => null })).toBeNull();
    });
  });

  describeWithRealTechSupportRecoveryPair('recovery override (docs/TODO.md OPEN-29)', (RECOVERY_PAIR) => {
    it('rejects an entry from a master pub recovery has revoked', async () => {
      const signed = await signFaqEntry(entry('q', 'a'), DEV_PAIR);
      const recovery = await signRecoveryAnchor({ reason: 'compromised', revokedDmPubs: [TECHSUPPORT_PUB] }, RECOVERY_PAIR);
      expect(await verifyFaqEntry(signed, { recovery })).toBeNull();
      expect(await verifyFaqEntry(signed)).not.toBeNull();
    });
  });
});
