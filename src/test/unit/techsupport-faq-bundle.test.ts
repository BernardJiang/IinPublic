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
import { signDelegateGrant } from '../../shared/techsupport-delegate';
import { signRecoveryAnchor } from '../../shared/techsupport-recovery';
import SEA from 'gun/sea';
import {
  describeWithRealTechSupportPair,
  describeWithRealTechSupportRecoveryPair,
} from '../support/techsupport-real-pair';

function entry(question: string, answer: string): SupportFaqEntry {
  const built = buildSupportFaqEntry({ question, answer, answeredAt: '2026-07-26T00:00:00.000Z' });
  if (!built) throw new Error('expected a valid entry');
  return built;
}

describeWithRealTechSupportPair('techsupport-faq-bundle (docs/TODO.md K5)', (DEV_PAIR) => {
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

  describe('K7 delegate-aware verification', () => {
    it('rejects a bundle signed by a delegate when no fetchGrant is supplied (unchanged default behavior)', async () => {
      const delegatePair = await SEA.pair();
      const signed = await signFaqBundle([entry('q', 'a')], delegatePair);
      expect(await verifyFaqBundle(signed)).toBeNull();
    });

    it('accepts a bundle signed by a currently-valid delegate when fetchGrant resolves the grant', async () => {
      const delegatePair = await SEA.pair();
      const grant = await signDelegateGrant(
        { delegatePub: delegatePair.pub, delegateUserId: 'user-alice', label: 'Alice', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        DEV_PAIR,
      );
      const signed = await signFaqBundle([entry('q', 'a')], delegatePair);
      const verified = await verifyFaqBundle(signed, { fetchGrant: async () => grant });
      expect(verified).not.toBeNull();
      expect(verified?.authorPub).toBe(delegatePair.pub);
    });

    it('rejects a bundle signed by a delegate whose grant has expired', async () => {
      const delegatePair = await SEA.pair();
      const grant = await signDelegateGrant(
        { delegatePub: delegatePair.pub, delegateUserId: 'user-alice', label: 'Alice', expiresAt: new Date(Date.now() - 1000).toISOString() },
        DEV_PAIR,
      );
      const signed = await signFaqBundle([entry('q', 'a')], delegatePair);
      expect(await verifyFaqBundle(signed, { fetchGrant: async () => grant })).toBeNull();
    });

    it('rejects a bundle signed by a pub with no grant at all', async () => {
      const stranger = await SEA.pair();
      const signed = await signFaqBundle([entry('q', 'a')], stranger);
      expect(await verifyFaqBundle(signed, { fetchGrant: async () => null })).toBeNull();
    });

    it('still accepts a master-signed bundle when fetchGrant is supplied (anchor short-circuits the grant lookup)', async () => {
      const signed = await signFaqBundle([entry('q', 'a')], DEV_PAIR);
      const fetchGrant = jest.fn().mockResolvedValue(null);
      const verified = await verifyFaqBundle(signed, { fetchGrant });
      expect(verified).not.toBeNull();
      expect(fetchGrant).not.toHaveBeenCalled();
    });
  });

  describeWithRealTechSupportRecoveryPair('verifyFaqBundle + recovery override (docs/TODO.md OPEN-29)', (RECOVERY_PAIR) => {
    it('rejects a master-signed bundle once recovery has revoked that master pub, even with no fetchGrant', async () => {
      const signed = await signFaqBundle([entry('q', 'a')], DEV_PAIR);
      const recovery = await signRecoveryAnchor({ reason: 'compromised', revokedDmPubs: [TECHSUPPORT_PUB] }, RECOVERY_PAIR);
      expect(await verifyFaqBundle(signed, { recovery })).toBeNull();
      // Sanity: the exact same bundle verifies fine without the revocation.
      expect(await verifyFaqBundle(signed)).not.toBeNull();
    });

    it('rejects a master-signed bundle once recovery has revoked that master pub, even WITH fetchGrant supplied (the bug this session found and fixed: the delegate-grant fallback must not silently bypass a recovery revocation)', async () => {
      const signed = await signFaqBundle([entry('q', 'a')], DEV_PAIR);
      const recovery = await signRecoveryAnchor({ reason: 'compromised', revokedDmPubs: [TECHSUPPORT_PUB] }, RECOVERY_PAIR);
      const fetchGrant = jest.fn().mockResolvedValue(null);
      expect(await verifyFaqBundle(signed, { fetchGrant, recovery })).toBeNull();
    });

    it('accepts a bundle signed by a NEW pub recovery names as the next DM anchor, though it is not in the compiled list', async () => {
      const nextDmPair = await SEA.pair();
      const recovery = await signRecoveryAnchor({ reason: 'rotate', nextDmPub: nextDmPair.pub }, RECOVERY_PAIR);
      const signed = await signFaqBundle([entry('q', 'a')], nextDmPair);
      const verified = await verifyFaqBundle(signed, { recovery });
      expect(verified).not.toBeNull();
      expect(verified?.authorPub).toBe(nextDmPair.pub);
    });

    it('a delegate grant issued by a since-revoked master no longer authorizes that delegate', async () => {
      const delegatePair = await SEA.pair();
      const grant = await signDelegateGrant(
        { delegatePub: delegatePair.pub, delegateUserId: 'user-alice', label: 'Alice', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        DEV_PAIR, // issued by the now-compromised master
      );
      const signed = await signFaqBundle([entry('q', 'a')], delegatePair);
      const recovery = await signRecoveryAnchor({ reason: 'compromised', revokedDmPubs: [TECHSUPPORT_PUB] }, RECOVERY_PAIR);
      // Without recovery, the delegate's grant is still perfectly valid.
      expect(await verifyFaqBundle(signed, { fetchGrant: async () => grant })).not.toBeNull();
      // With recovery's revocation of the issuing master, that same grant no longer authorizes anything.
      expect(await verifyFaqBundle(signed, { fetchGrant: async () => grant, recovery })).toBeNull();
    });

    it('rejects a rolled-back (older) recovery record, and the newer revocation still applies', async () => {
      const older = await signRecoveryAnchor({ reason: 'first', issuedAt: '2026-01-01T00:00:00.000Z' }, RECOVERY_PAIR);
      const newer = await signRecoveryAnchor(
        { reason: 'second', revokedDmPubs: [TECHSUPPORT_PUB], issuedAt: '2026-01-02T00:00:00.000Z' },
        RECOVERY_PAIR,
      );
      const signed = await signFaqBundle([entry('q', 'a')], DEV_PAIR);
      // Verifying against the older record (as if a stale cache never saw the newer one) still lets it through —
      // this is exactly why the client-side cache's monotonic reconciliation (techsupport-recovery-cache.ts) exists.
      expect(await verifyFaqBundle(signed, { recovery: older })).not.toBeNull();
      expect(await verifyFaqBundle(signed, { recovery: newer })).toBeNull();
    });
  });
});
