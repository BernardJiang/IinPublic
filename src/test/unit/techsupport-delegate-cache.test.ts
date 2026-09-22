/** @jest-environment jsdom */

import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import {
  readCachedDelegateGrant,
  reconcileVerifiedDelegateGrant,
} from '../../web/services/techsupport-delegate-cache';

function grant(
  issuedAt: string,
  revokedAt: string | null = null,
): TechSupportDelegateGrant {
  return {
    delegatePub: 'delegate-pub',
    delegateUserId: 'delegate-user',
    label: 'Support phone',
    issuedAt,
    expiresAt: '2026-12-01T00:00:00.000Z',
    revokedAt,
    masterPub: 'root-pub',
    signature: `signature-${issuedAt}-${revokedAt || 'active'}`,
  };
}

describe('TechSupport delegate monotonic cache (OPEN-27)', () => {
  beforeEach(() => localStorage.clear());

  it('retains a seen revocation when an older signed active record is replayed through Gun', () => {
    const active = grant('2026-09-20T00:00:00.000Z');
    const revoked = grant('2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z');

    expect(reconcileVerifiedDelegateGrant(active)).toEqual(active);
    expect(reconcileVerifiedDelegateGrant(revoked)).toEqual(revoked);
    expect(reconcileVerifiedDelegateGrant(active)).toEqual(revoked);
    expect(readCachedDelegateGrant(active.delegatePub)).toEqual(revoked);
  });

  it('accepts an explicitly newer re-issue after a prior grant was revoked', () => {
    const revoked = grant('2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
    const reissued = grant('2026-09-22T00:00:00.000Z');

    reconcileVerifiedDelegateGrant(revoked);
    expect(reconcileVerifiedDelegateGrant(reissued)).toEqual(reissued);
    expect(readCachedDelegateGrant(reissued.delegatePub)).toEqual(reissued);
  });
});
