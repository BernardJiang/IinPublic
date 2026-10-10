import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import {
  applyNearbyOverflowCertificateChain,
  createNearbyOverflowCertificate,
  verifyNearbyOverflowCertificate,
} from '../../shared/nearby-overflow-certificate';
import { deriveNearbyRoomAssignment, type NearbyRoomAssignment } from '../../shared/nearby-rooms';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { GPSCoordinate } from '../../shared/types';

describe('OPEN-40 geographic Nearby overflow certificates', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');
  const location: GPSCoordinate = {
    latitude: 32.7157,
    longitude: -117.1611,
    accuracy: 5,
    timestamp: now,
  };
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 1,
    manifestSequence: 1,
    manifestHash: 'd'.repeat(64),
    chatroomCapacity: 2,
  };
  const root = (identity = 'root'): NearbyRoomAssignment => deriveNearbyRoomAssignment({
    location,
    mode: 'neighborhood',
    identity,
  });

  async function witnesses(
    assignment: NearbyRoomAssignment,
    rootAssignment: NearbyRoomAssignment,
  ) {
    return Promise.all(Array.from({ length: checkpoint.chatroomCapacity + 1 }, async (_, index) => {
      const pair = await SEA.pair() as SeaSigningPair;
      return createNearbyControlPresence({
        userId: `witness-${assignment.requestedSplitGeneration}-${index}`,
        pair,
        rootRoomId: rootAssignment.roomId,
        assignment,
        checkpoint,
        now,
      });
    }));
  }

  it('proves C+1 occupants of one opaque room without publishing coordinates', async () => {
    const rootAssignment = root();
    const certificate = createNearbyOverflowCertificate({
      rootRoomId: rootAssignment.roomId,
      fromRoomId: rootAssignment.roomId,
      fromRequestedSplitGeneration: 0,
      checkpoint,
      witnesses: await witnesses(rootAssignment, rootAssignment),
      createdAt: now.toISOString(),
    });
    const verified = await verifyNearbyOverflowCertificate(certificate, {
      expectedCheckpoint: checkpoint,
      now,
    });
    expect(verified.ok).toBe(true);
    expect(JSON.stringify(certificate)).not.toContain(String(location.latitude));
    expect(JSON.stringify(certificate)).not.toContain(String(location.longitude));
  });

  it('rejects duplicate identities and a witness from another room', async () => {
    const rootAssignment = root();
    const valid = await witnesses(rootAssignment, rootAssignment);
    const duplicate = createNearbyOverflowCertificate({
      rootRoomId: rootAssignment.roomId,
      fromRoomId: rootAssignment.roomId,
      fromRequestedSplitGeneration: 0,
      checkpoint,
      witnesses: [valid[0]!, valid[0]!, valid[1]!],
      createdAt: now.toISOString(),
    });
    await expect(verifyNearbyOverflowCertificate(duplicate, { expectedCheckpoint: checkpoint, now }))
      .resolves.toEqual({ ok: false, reason: 'duplicate overflow witness identity' });

    const otherAssignment = deriveNearbyRoomAssignment({
      location: { ...location, longitude: -118 },
      mode: 'neighborhood',
      identity: 'other',
    });
    const foreign = (await witnesses(otherAssignment, rootAssignment))[0]!;
    const mixed = createNearbyOverflowCertificate({
      rootRoomId: rootAssignment.roomId,
      fromRoomId: rootAssignment.roomId,
      fromRequestedSplitGeneration: 0,
      checkpoint,
      witnesses: [valid[0]!, valid[1]!, foreign],
      createdAt: now.toISOString(),
    });
    await expect(verifyNearbyOverflowCertificate(mixed, { expectedCheckpoint: checkpoint, now }))
      .resolves.toEqual({
        ok: false,
        reason: 'overflow witness belongs to another Nearby room or generation',
      });
  });

  it('follows only the local geographic child and stops when that child has no certificate', async () => {
    const identity = 'newcomer';
    const rootAssignment = root(identity);
    const first = createNearbyOverflowCertificate({
      rootRoomId: rootAssignment.roomId,
      fromRoomId: rootAssignment.roomId,
      fromRequestedSplitGeneration: 0,
      checkpoint,
      witnesses: await witnesses(rootAssignment, rootAssignment),
      createdAt: now.toISOString(),
    });
    const localChild = deriveNearbyRoomAssignment({
      location,
      mode: 'neighborhood',
      identity,
      requestedSplitGeneration: 1,
    });
    const remoteChild = deriveNearbyRoomAssignment({
      location: { ...location, longitude: location.longitude + 0.02 },
      mode: 'neighborhood',
      identity,
      requestedSplitGeneration: 1,
    });
    const wrongBranch = createNearbyOverflowCertificate({
      rootRoomId: rootAssignment.roomId,
      fromRoomId: remoteChild.roomId,
      fromRequestedSplitGeneration: 1,
      checkpoint,
      witnesses: await witnesses(remoteChild, rootAssignment),
      createdAt: now.toISOString(),
    });
    const result = await applyNearbyOverflowCertificateChain({
      identity,
      location,
      mode: 'neighborhood',
      rootAssignment,
      checkpoint,
      certificates: [wrongBranch, first],
      now,
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.assignment.roomId).toBe(localChild.roomId);
    expect(result.assignment.requestedSplitGeneration).toBe(1);
  });

  it('keeps sparse widening while following a later capacity split', async () => {
    const identity = 'widened-newcomer';
    const rootAssignment = deriveNearbyRoomAssignment({
      location,
      mode: 'neighborhood',
      identity,
      wideningLevel: 2,
    });
    const certificate = createNearbyOverflowCertificate({
      rootRoomId: rootAssignment.roomId,
      fromRoomId: rootAssignment.roomId,
      fromRequestedSplitGeneration: 0,
      checkpoint,
      witnesses: await witnesses(rootAssignment, rootAssignment),
      createdAt: now.toISOString(),
    });
    const result = await applyNearbyOverflowCertificateChain({
      identity,
      location,
      mode: 'neighborhood',
      rootAssignment,
      checkpoint,
      certificates: [certificate],
      now,
    });
    expect(result.assignment.wideningLevel).toBe(2);
    expect(result.assignment.widenedPrecisionMeters).toBe(4_000);
    expect(result.assignment.requestedSplitGeneration).toBe(1);
    expect(result.assignment.roomId).toMatch(/_p1000_w2_g1_/);
  });
});
