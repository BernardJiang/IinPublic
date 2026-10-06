import {
  createDelegateInvite,
  encodeDelegateInviteCode,
  decodeDelegateInviteCode,
  isDelegateInviteExpired,
  buildDelegateRequest,
  verifyDelegateRequest,
  delegateRequestMatchesInvite,
  delegateRequestPath,
  DELEGATE_INVITE_TTL_MS,
  signTargetedDelegateInvite,
  verifyTargetedDelegateInvite,
  delegateRequestMatchesTargetedInvite,
  targetedDelegateInvitePath,
  TARGETED_DELEGATE_INVITE_TTL_MS,
  type DelegateInvitePayload,
} from '../../shared/techsupport-delegate-invite';
import SEA from 'gun/sea';

function randomSecret(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

describe('techsupport-delegate-invite (K7 follow-on)', () => {
  it('createDelegateInvite + encode/decode round-trips', () => {
    const now = Date.now();
    const payload = createDelegateInvite(randomSecret, now);
    expect(payload.expiresAt).toBe(now + DELEGATE_INVITE_TTL_MS);
    const code = encodeDelegateInviteCode(payload);
    expect(decodeDelegateInviteCode(code)).toEqual(payload);
  });

  it('decodeDelegateInviteCode rejects malformed codes without throwing', () => {
    expect(decodeDelegateInviteCode('not-base64!!')).toBeNull();
    expect(decodeDelegateInviteCode(encodeDelegateInviteCode({ version: 1, requestId: 'short', secret: 'alsoshort', expiresAt: Date.now() }))).toBeNull();
  });

  it('decodeDelegateInviteCode rejects an unsupported version', () => {
    const bogus = Buffer.from(JSON.stringify([2, 'a'.repeat(10), 'b'.repeat(10), Date.now() + 1000])).toString('base64url');
    expect(decodeDelegateInviteCode(bogus)).toBeNull();
  });

  it('isDelegateInviteExpired reflects the expiry boundary', () => {
    const payload: DelegateInvitePayload = { version: 1, requestId: 'r'.repeat(10), secret: 's'.repeat(10), expiresAt: 1000 };
    expect(isDelegateInviteExpired(payload, 999)).toBe(false);
    expect(isDelegateInviteExpired(payload, 1001)).toBe(true);
  });

  it('a delegate-invite code is never accepted as a device-link pairing code and vice versa', () => {
    // identity-linking.ts's PairingPayload has a 5-element array shape (with `pub`);
    // ours is 4 elements (no `pub`) — cross-decoding must fail closed, not throw.
    const invite = createDelegateInvite(randomSecret);
    const pairingShapedCode = Buffer.from(
      JSON.stringify([1, invite.requestId, 'somePubKey', invite.secret, invite.expiresAt]),
    ).toString('base64url');
    expect(decodeDelegateInviteCode(pairingShapedCode)).toBeNull();
  });

  it('buildDelegateRequest + verifyDelegateRequest round-trips, signed by the candidate', async () => {
    const candidate = await SEA.pair();
    const invite = createDelegateInvite(randomSecret);
    const request = await buildDelegateRequest(
      { requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-bob' },
      candidate,
    );
    const verified = await verifyDelegateRequest(request);
    expect(verified).not.toBeNull();
    expect(verified?.candidatePub).toBe(candidate.pub);
    expect(verified?.candidateUserId).toBe('user-bob');
  });

  it('verifyDelegateRequest rejects a tampered request even though the signature field is untouched', async () => {
    const candidate = await SEA.pair();
    const invite = createDelegateInvite(randomSecret);
    const request = await buildDelegateRequest(
      { requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-bob' },
      candidate,
    );
    const tampered = { ...request, candidateUserId: 'user-mallory' };
    expect(await verifyDelegateRequest(tampered)).toBeNull();
  });

  it('verifyDelegateRequest rejects a signature that does not match the payload', async () => {
    const candidate = await SEA.pair();
    const invite = createDelegateInvite(randomSecret);
    const a = await buildDelegateRequest({ requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-a' }, candidate);
    const b = await buildDelegateRequest({ requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-b' }, candidate);
    expect(await verifyDelegateRequest({ ...a, signature: b.signature })).toBeNull();
  });

  it('verifyDelegateRequest rejects malformed input without throwing', async () => {
    expect(await verifyDelegateRequest(null)).toBeNull();
    expect(await verifyDelegateRequest(undefined)).toBeNull();
    expect(await verifyDelegateRequest('a string')).toBeNull();
    expect(await verifyDelegateRequest({})).toBeNull();
  });

  it('two different invite secrets produce different secretHash values (binds request to its invite)', async () => {
    const candidate = await SEA.pair();
    const inviteA = createDelegateInvite(randomSecret);
    const inviteB = createDelegateInvite(randomSecret);
    const requestA = await buildDelegateRequest({ requestId: inviteA.requestId, secret: inviteA.secret, candidateUserId: 'user-bob' }, candidate);
    const requestB = await buildDelegateRequest({ requestId: inviteB.requestId, secret: inviteB.secret, candidateUserId: 'user-bob' }, candidate);
    expect(requestA.secretHash).not.toBe(requestB.secretHash);
  });

  it('delegateRequestMatchesInvite confirms a request came from this exact invite', async () => {
    const candidate = await SEA.pair();
    const invite = createDelegateInvite(randomSecret);
    const request = await buildDelegateRequest({ requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-bob' }, candidate);
    expect(await delegateRequestMatchesInvite(request, invite)).toBe(true);
  });

  it('delegateRequestMatchesInvite rejects a request bound to a different invite secret', async () => {
    const candidate = await SEA.pair();
    const invite = createDelegateInvite(randomSecret);
    const otherInvite = createDelegateInvite(randomSecret);
    const request = await buildDelegateRequest({ requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-bob' }, candidate);
    // Same requestId, forged secretHash from a different secret — must still fail.
    expect(await delegateRequestMatchesInvite(request, { requestId: invite.requestId, secret: otherInvite.secret })).toBe(false);
  });

  it('delegateRequestPath produces the expected Gun path', () => {
    expect(delegateRequestPath('abc')).toEqual(['techsupport-delegate-requests', 'abc']);
  });

  describe('targeted (remote) invites', () => {
    it('sign + verify round-trips with a 7-day expiry', async () => {
      const master = await SEA.pair();
      const candidate = await SEA.pair();
      const now = Date.now();
      const invite = await signTargetedDelegateInvite({ targetPub: candidate.pub, targetUserId: 'user-bob', randomSecret, now }, master);
      expect(invite.expiresAt).toBe(now + TARGETED_DELEGATE_INVITE_TTL_MS);
      expect(invite.masterPub).toBe(master.pub);
      expect(await verifyTargetedDelegateInvite(JSON.parse(JSON.stringify(invite)))).toEqual(invite);
    });

    it('rejects a tampered target or a signature by another key', async () => {
      const master = await SEA.pair();
      const other = await SEA.pair();
      const candidate = await SEA.pair();
      const invite = await signTargetedDelegateInvite({ targetPub: candidate.pub, targetUserId: 'user-bob', randomSecret }, master);
      expect(await verifyTargetedDelegateInvite({ ...invite, targetPub: other.pub })).toBeNull();
      expect(await verifyTargetedDelegateInvite({ ...invite, masterPub: other.pub })).toBeNull();
      expect(await verifyTargetedDelegateInvite(null)).toBeNull();
      expect(await verifyTargetedDelegateInvite({ ...invite, version: 2 })).toBeNull();
    });

    it('matches only a request signed by the invited identity, even if the secret leaked', async () => {
      const master = await SEA.pair();
      const candidate = await SEA.pair();
      const attacker = await SEA.pair();
      const invite = await signTargetedDelegateInvite({ targetPub: candidate.pub, targetUserId: 'user-bob', randomSecret }, master);
      const genuine = await buildDelegateRequest({ requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-bob' }, candidate);
      const hijack = await buildDelegateRequest({ requestId: invite.requestId, secret: invite.secret, candidateUserId: 'user-eve' }, attacker);
      expect(await delegateRequestMatchesTargetedInvite(genuine, invite)).toBe(true);
      expect(await delegateRequestMatchesTargetedInvite(hijack, invite)).toBe(false);
    });

    it('targetedDelegateInvitePath is one slot per invited identity', () => {
      expect(targetedDelegateInvitePath('pubX')).toEqual(['techsupport-delegate-invites', 'pubX']);
    });
  });
});
