/** @jest-environment jsdom */

import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import {
  readCachedDelegateGrant,
  reconcileVerifiedDelegateGrant,
  publishDelegateGrantToServer,
  fetchDelegateGrantsFromServer,
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

describe('TechSupport delegate grant publication', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('waits for the signed grant to be accepted by the server', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 } as Response));
    global.fetch = fetchMock as typeof fetch;
    const signed = grant('2026-10-31T00:00:00.000Z');

    await publishDelegateGrantToServer('http://localhost:3001', signed);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/support/delegate-grants',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(signed) }),
    );
  });

  it('reports a failed server write', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 } as Response)) as typeof fetch;
    await expect(publishDelegateGrantToServer('http://localhost:3001', grant('2026-10-31T00:00:00.000Z')))
      .rejects.toThrow('Delegate grant storage returned 503');
  });
});

describe('TechSupport delegate roster availability (OPEN-107)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('distinguishes an authoritative empty roster from a failed lookup', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ grants: [], revocations: [] }),
    } as unknown as Response)) as typeof fetch;
    await expect(fetchDelegateGrantsFromServer('http://localhost:3001')).resolves.toEqual([]);

    global.fetch = jest.fn(async () => ({ ok: false, status: 503 } as Response)) as typeof fetch;
    await expect(fetchDelegateGrantsFromServer('http://localhost:3001'))
      .rejects.toThrow('Delegate grant roster returned 503');
  });

  it('does not turn a transport exception into an empty roster', async () => {
    global.fetch = jest.fn(async () => { throw new Error('hub request aborted'); }) as typeof fetch;
    await expect(fetchDelegateGrantsFromServer('http://localhost:3001'))
      .rejects.toThrow('hub request aborted');
  });
});
