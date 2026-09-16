import {
  delegateGrantSigningPayload,
  delegateGrantPath,
  signDelegateGrant,
  verifyDelegateGrant,
  verifyValidDelegateGrant,
  isValidDelegateGrant,
  isTrustedTechSupportAuthorPub,
  type TechSupportDelegateGrant,
} from '../../shared/techsupport-delegate';
import { TECHSUPPORT_PUB, type TechSupportSeaPair } from '../../shared/techsupport';
import SEA from 'gun/sea';
import { describeWithRealTechSupportPair } from '../support/techsupport-real-pair';

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function issuer(devPair: TechSupportSeaPair) {
  return async function issueGrant(overrides: Partial<{ delegatePub: string; delegateUserId: string; label: string; expiresAt: string; revokedAt: string | null }> = {}): Promise<TechSupportDelegateGrant> {
    const delegatePair = await SEA.pair();
    return signDelegateGrant(
      {
        delegatePub: delegatePair.pub,
        delegateUserId: 'user-alice',
        label: "Alice's phone",
        expiresAt: FUTURE,
        ...overrides,
      },
      devPair,
    );
  };
}

describeWithRealTechSupportPair('techsupport-delegate (docs/TODO.md K7)', (devPair) => {
  const issueGrant = issuer(devPair);

  it('signDelegateGrant + verifyDelegateGrant round-trips', async () => {
    const grant = await issueGrant();
    const verified = await verifyDelegateGrant(grant);
    expect(verified).not.toBeNull();
    expect(verified?.masterPub).toBe(TECHSUPPORT_PUB);
    expect(isValidDelegateGrant(verified)).toBe(true);
  });

  it('rejects a grant signed by an untrusted key', async () => {
    const stranger = await SEA.pair();
    const grant = await signDelegateGrant(
      { delegatePub: 'someone', delegateUserId: 'user-x', label: 'x', expiresAt: FUTURE },
      stranger,
    );
    expect(await verifyDelegateGrant(grant)).toBeNull();
  });

  it('rejects a tampered grant even though the signature field is untouched', async () => {
    const grant = await issueGrant();
    const tampered: TechSupportDelegateGrant = { ...grant, label: 'a different label' };
    expect(await verifyDelegateGrant(tampered)).toBeNull();
  });

  it('rejects a signature that does not match the payload', async () => {
    const a = await issueGrant({ delegateUserId: 'user-a' });
    const b = await issueGrant({ delegateUserId: 'user-b' });
    expect(await verifyDelegateGrant({ ...a, signature: b.signature })).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifyDelegateGrant(null)).toBeNull();
    expect(await verifyDelegateGrant(undefined)).toBeNull();
    expect(await verifyDelegateGrant('a string')).toBeNull();
    expect(await verifyDelegateGrant({})).toBeNull();
  });

  it('isValidDelegateGrant rejects an expired grant even with a valid signature', async () => {
    const grant = await issueGrant({ expiresAt: PAST });
    const verified = await verifyDelegateGrant(grant);
    expect(verified).not.toBeNull();
    expect(isValidDelegateGrant(verified)).toBe(false);
  });

  it('isValidDelegateGrant rejects a revoked grant even before its expiry', async () => {
    const grant = await issueGrant({ revokedAt: new Date().toISOString() });
    const verified = await verifyDelegateGrant(grant);
    expect(verified).not.toBeNull();
    expect(isValidDelegateGrant(verified)).toBe(false);
  });

  it('verifyValidDelegateGrant combines signature and validity in one call', async () => {
    const valid = await issueGrant();
    const expired = await issueGrant({ expiresAt: PAST });
    expect(await verifyValidDelegateGrant(valid)).not.toBeNull();
    expect(await verifyValidDelegateGrant(expired)).toBeNull();
  });

  it('isTrustedTechSupportAuthorPub trusts the master anchor without calling fetchGrant', async () => {
    const fetchGrant = jest.fn();
    expect(await isTrustedTechSupportAuthorPub(TECHSUPPORT_PUB, fetchGrant)).toBe(true);
    expect(fetchGrant).not.toHaveBeenCalled();
  });

  it('isTrustedTechSupportAuthorPub trusts a pub with a currently-valid grant', async () => {
    const grant = await issueGrant();
    expect(await isTrustedTechSupportAuthorPub(grant.delegatePub, async () => grant)).toBe(true);
  });

  it('isTrustedTechSupportAuthorPub rejects a pub with an expired grant', async () => {
    const grant = await issueGrant({ expiresAt: PAST });
    expect(await isTrustedTechSupportAuthorPub(grant.delegatePub, async () => grant)).toBe(false);
  });

  it('isTrustedTechSupportAuthorPub rejects a pub with a revoked grant', async () => {
    const grant = await issueGrant({ revokedAt: new Date().toISOString() });
    expect(await isTrustedTechSupportAuthorPub(grant.delegatePub, async () => grant)).toBe(false);
  });

  it('isTrustedTechSupportAuthorPub rejects an untrusted pub with no grant', async () => {
    expect(await isTrustedTechSupportAuthorPub('nobody', async () => null)).toBe(false);
  });

  it('isTrustedTechSupportAuthorPub never throws when fetchGrant rejects', async () => {
    const fetchGrant = async () => { throw new Error('network down'); };
    expect(await isTrustedTechSupportAuthorPub('someone', fetchGrant)).toBe(false);
  });

  it('delegateGrantSigningPayload is deterministic for the same logical grant', () => {
    const base = { delegatePub: 'p', delegateUserId: 'u', label: 'l', issuedAt: 'i', expiresAt: FUTURE, revokedAt: null, masterPub: TECHSUPPORT_PUB };
    expect(delegateGrantSigningPayload(base)).toBe(delegateGrantSigningPayload({ ...base }));
  });

  it('delegateGrantPath produces the expected Gun path', () => {
    expect(delegateGrantPath('abc')).toEqual(['techsupport-delegates', 'abc']);
  });
});
