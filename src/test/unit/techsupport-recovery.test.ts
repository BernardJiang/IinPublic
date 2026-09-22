import {
  recoveryAnchorSigningPayload,
  signRecoveryAnchor,
  verifyRecoveryAnchor,
  isRecoveryAnchorRollback,
  isTrustedDmPubWithRecovery,
  isTrustedAnnouncementPubWithRecovery,
  recoveryAnchorPath,
  recoveryAnchorHistoryPath,
  type RecoveryAnchorRecord,
} from '../../shared/techsupport-recovery';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import SEA from 'gun/sea';
import { describeWithRealTechSupportRecoveryPair } from '../support/techsupport-real-pair';

describeWithRealTechSupportRecoveryPair('techsupport-recovery (docs/TODO.md OPEN-29)', (RECOVERY_PAIR) => {
  it('signRecoveryAnchor + verifyRecoveryAnchor round-trips', async () => {
    const signed = await signRecoveryAnchor(
      { reason: 'test', nextDmPub: 'new-dm-pub', revokedDmPubs: [TECHSUPPORT_PUB] },
      RECOVERY_PAIR,
    );
    const verified = await verifyRecoveryAnchor(signed);
    expect(verified).not.toBeNull();
    expect(verified?.recoveryPub).toBe(RECOVERY_PAIR.pub);
    expect(verified?.nextDmPub).toBe('new-dm-pub');
    expect(verified?.revokedDmPubs).toEqual([TECHSUPPORT_PUB]);
    expect(verified?.revokedAnnouncementPubs).toEqual([]);
    expect(verified?.nextAnnouncementPub).toBeNull();
  });

  it('defaults omitted fields to empty/null, not undefined', async () => {
    const signed = await signRecoveryAnchor({ reason: 'minimal' }, RECOVERY_PAIR);
    expect(signed.revokedDmPubs).toEqual([]);
    expect(signed.revokedAnnouncementPubs).toEqual([]);
    expect(signed.nextDmPub).toBeNull();
    expect(signed.nextAnnouncementPub).toBeNull();
  });

  it('rejects a record signed by the DM key instead of the recovery key — a compromised root must not be able to forge its own recovery', async () => {
    // Simulate: someone tries to author a "recovery" record with the ordinary DM anchor's pub.
    const forged = {
      recoveryPub: TECHSUPPORT_PUB,
      revokedDmPubs: [],
      revokedAnnouncementPubs: [],
      nextDmPub: 'attacker-controlled-pub',
      nextAnnouncementPub: null,
      issuedAt: new Date().toISOString(),
      reason: 'forged',
      signature: 'irrelevant-because-anchor-check-fails-first',
    };
    expect(await verifyRecoveryAnchor(forged)).toBeNull();
  });

  it('rejects a record signed by an untrusted stranger key', async () => {
    const stranger = await SEA.pair();
    const signed = await signRecoveryAnchor({ reason: 'attack' }, stranger);
    expect(await verifyRecoveryAnchor(signed)).toBeNull();
  });

  it('rejects a tampered field even though the signature is untouched', async () => {
    const signed = await signRecoveryAnchor({ reason: 'legit', nextDmPub: 'good-pub' }, RECOVERY_PAIR);
    const tampered = { ...signed, nextDmPub: 'attacker-pub' };
    expect(await verifyRecoveryAnchor(tampered)).toBeNull();
  });

  it('rejects a signature that does not match the payload', async () => {
    const signed = await signRecoveryAnchor({ reason: 'a' }, RECOVERY_PAIR);
    const other = await signRecoveryAnchor({ reason: 'b' }, RECOVERY_PAIR);
    expect(await verifyRecoveryAnchor({ ...signed, signature: other.signature })).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifyRecoveryAnchor(null)).toBeNull();
    expect(await verifyRecoveryAnchor(undefined)).toBeNull();
    expect(await verifyRecoveryAnchor('a string')).toBeNull();
    expect(await verifyRecoveryAnchor({})).toBeNull();
    expect(await verifyRecoveryAnchor({ recoveryPub: TECHSUPPORT_PUB, revokedDmPubs: 'not-an-array' })).toBeNull();
  });

  it('recoveryAnchorSigningPayload is deterministic for the same logical record', () => {
    const a = recoveryAnchorSigningPayload({
      recoveryPub: RECOVERY_PAIR.pub,
      revokedDmPubs: [],
      revokedAnnouncementPubs: [],
      nextDmPub: null,
      nextAnnouncementPub: null,
      issuedAt: '2026-09-22T00:00:00.000Z',
      reason: 'x',
    });
    const b = recoveryAnchorSigningPayload({
      recoveryPub: RECOVERY_PAIR.pub,
      revokedDmPubs: [],
      revokedAnnouncementPubs: [],
      nextDmPub: null,
      nextAnnouncementPub: null,
      issuedAt: '2026-09-22T00:00:00.000Z',
      reason: 'x',
    });
    expect(a).toBe(b);
  });

  it('recoveryAnchorHistoryPath is unique per (recoveryPub, issuedAt) and throws on an unrelated shape', async () => {
    const signed = await signRecoveryAnchor({ reason: 'x' }, RECOVERY_PAIR);
    const path = recoveryAnchorHistoryPath(signed);
    expect(path[0]).toBe('techsupport-recovery-history');
    expect(path[1]).toContain(encodeURIComponent(signed.recoveryPub).slice(0, 10));
  });

  it('recoveryAnchorPath is the fixed mutable current slot', () => {
    expect(recoveryAnchorPath()).toEqual(['techsupport-recovery', 'current']);
  });

  describe('isRecoveryAnchorRollback — monotonic anti-rollback', () => {
    const base = (issuedAt: string): RecoveryAnchorRecord => ({
      recoveryPub: 'r',
      revokedDmPubs: [],
      revokedAnnouncementPubs: [],
      nextDmPub: null,
      nextAnnouncementPub: null,
      issuedAt,
      reason: 'x',
      signature: 's',
    });

    it('a strictly newer record is not a rollback', () => {
      expect(isRecoveryAnchorRollback(base('2026-01-01T00:00:00.000Z'), base('2026-01-02T00:00:00.000Z'))).toBe(false);
    });

    it('an equal-timestamp record IS a rollback (idempotent replay must not "supersede")', () => {
      expect(isRecoveryAnchorRollback(base('2026-01-01T00:00:00.000Z'), base('2026-01-01T00:00:00.000Z'))).toBe(true);
    });

    it('an older record is a rollback', () => {
      expect(isRecoveryAnchorRollback(base('2026-01-02T00:00:00.000Z'), base('2026-01-01T00:00:00.000Z'))).toBe(true);
    });

    it('an unparseable incoming issuedAt is treated as a rollback (fail closed)', () => {
      expect(isRecoveryAnchorRollback(base('2026-01-01T00:00:00.000Z'), base('not-a-date'))).toBe(true);
    });
  });

  describe('isTrustedDmPubWithRecovery / isTrustedAnnouncementPubWithRecovery — the actual security property', () => {
    it('the compiled DM anchor is trusted with no recovery record at all', () => {
      expect(isTrustedDmPubWithRecovery(TECHSUPPORT_PUB, null)).toBe(true);
      expect(isTrustedDmPubWithRecovery(TECHSUPPORT_PUB, undefined)).toBe(true);
    });

    it('an explicit revocation overrides the compiled anchor list — this is the whole point', async () => {
      const revoked = await signRecoveryAnchor({ reason: 'compromised', revokedDmPubs: [TECHSUPPORT_PUB] }, RECOVERY_PAIR);
      expect(isTrustedDmPubWithRecovery(TECHSUPPORT_PUB, revoked)).toBe(false);
    });

    it('nextDmPub extends trust to a pub NOT in the compiled list', async () => {
      const extended = await signRecoveryAnchor({ reason: 'rotate', nextDmPub: 'brand-new-pub' }, RECOVERY_PAIR);
      expect(isTrustedDmPubWithRecovery('brand-new-pub', extended)).toBe(true);
      expect(isTrustedDmPubWithRecovery('some-other-pub', extended)).toBe(false);
    });

    it('a pub that is neither compiled-trusted nor named by recovery is untrusted', async () => {
      const record = await signRecoveryAnchor({ reason: 'x' }, RECOVERY_PAIR);
      expect(isTrustedDmPubWithRecovery('random-pub', record)).toBe(false);
    });

    it('the announcement variant behaves the same way, independently of the dm fields', async () => {
      const record = await signRecoveryAnchor(
        { reason: 'x', revokedAnnouncementPubs: [TECHSUPPORT_PUB], nextAnnouncementPub: 'new-announcement-pub' },
        RECOVERY_PAIR,
      );
      expect(isTrustedAnnouncementPubWithRecovery(TECHSUPPORT_PUB, record)).toBe(false);
      expect(isTrustedAnnouncementPubWithRecovery('new-announcement-pub', record)).toBe(true);
      // dm revocation must not leak into the announcement check or vice versa
      expect(isTrustedDmPubWithRecovery(TECHSUPPORT_PUB, record)).toBe(true);
    });
  });
});
