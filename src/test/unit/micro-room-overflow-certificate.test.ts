import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  microRoomControlScopeId,
  microRoomLaneIndex,
} from '../../shared/micro-room-assignment';
import {
  createMicroRoomControlPresence,
  type MicroRoomControlPresence,
} from '../../shared/micro-room-control-presence';
import {
  applyMicroRoomOverflowCertificateChain,
  createMicroRoomOverflowCertificate,
  verifyMicroRoomOverflowCertificate,
} from '../../shared/micro-room-overflow-certificate';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('OPEN-40 bounded micro-room overflow certificates', () => {
  const baseGridRoomId = 'region_32.71_-117.17_room_0';
  const createdAt = new Date('2026-10-07T12:00:00.000Z');
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 3,
    manifestSequence: 7,
    manifestHash: 'a'.repeat(64),
    chatroomCapacity: 3,
  };

  async function witnessesForLane(
    generation: number,
    laneIndex: number,
    count = checkpoint.chatroomCapacity + 1,
  ): Promise<MicroRoomControlPresence[]> {
    const laneCount = 2 ** generation;
    const witnesses: MicroRoomControlPresence[] = [];
    while (witnesses.length < count) {
      const pair = await SEA.pair() as SeaSigningPair;
      if (microRoomLaneIndex(pair.pub, baseGridRoomId, laneCount) !== laneIndex) continue;
      witnesses.push(await createMicroRoomControlPresence({
        userId: `witness-${generation}-${laneIndex}-${witnesses.length}`,
        pair,
        baseGridRoomId,
        splitGeneration: generation,
        laneIndex,
        checkpoint,
        now: createdAt,
      }));
    }
    return witnesses;
  }

  it('accepts C+1 distinct signed presences from one lane', async () => {
    const certificate = createMicroRoomOverflowCertificate({
      baseGridRoomId,
      fromSplitGeneration: 0,
      fromLaneIndex: 0,
      checkpoint,
      witnesses: await witnessesForLane(0, 0),
      createdAt: createdAt.toISOString(),
    });

    await expect(verifyMicroRoomOverflowCertificate(certificate, {
      baseGridRoomId,
      expectedCheckpoint: checkpoint,
      now: new Date('2027-01-01T00:00:00.000Z'),
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      certificate: expect.objectContaining({
        controlScopeId: microRoomControlScopeId(baseGridRoomId),
        fromSplitGeneration: 0,
        toSplitGeneration: 1,
      }),
    }));
  });

  it('rejects a duplicated identity, so one writer cannot fill a certificate', async () => {
    const witnesses = await witnessesForLane(0, 0, 1);
    const certificate = createMicroRoomOverflowCertificate({
      baseGridRoomId,
      fromSplitGeneration: 0,
      fromLaneIndex: 0,
      checkpoint,
      witnesses: Array.from({ length: checkpoint.chatroomCapacity + 1 }, () => witnesses[0]!),
      createdAt: createdAt.toISOString(),
    });

    await expect(verifyMicroRoomOverflowCertificate(certificate, {
      baseGridRoomId,
      expectedCheckpoint: checkpoint,
      now: createdAt,
    })).resolves.toEqual({ ok: false, reason: 'duplicate overflow witness identity' });
  });

  it('rejects undersized, cross-lane, tampered, and far-future certificates', async () => {
    const witnesses = await witnessesForLane(1, 0);
    const certificate = createMicroRoomOverflowCertificate({
      baseGridRoomId,
      fromSplitGeneration: 1,
      fromLaneIndex: 0,
      checkpoint,
      witnesses,
      createdAt: createdAt.toISOString(),
    });

    await expect(verifyMicroRoomOverflowCertificate({
      ...certificate,
      witnesses: witnesses.slice(1),
    }, { baseGridRoomId, expectedCheckpoint: checkpoint, now: createdAt }))
      .resolves.toEqual({
        ok: false,
        reason: 'overflow certificate must contain exactly capacity plus one witnesses',
      });

    const wrongLaneWitnesses = await witnessesForLane(1, 1);
    await expect(verifyMicroRoomOverflowCertificate({
      ...certificate,
      witnesses: wrongLaneWitnesses,
    }, { baseGridRoomId, expectedCheckpoint: checkpoint, now: createdAt }))
      .resolves.toEqual({
        ok: false,
        reason: 'overflow witness belongs to another room or checkpoint',
      });

    await expect(verifyMicroRoomOverflowCertificate({
      ...certificate,
      witnesses: [{ ...witnesses[0]!, pub: 'tampered' }, ...witnesses.slice(1)],
    }, { baseGridRoomId, expectedCheckpoint: checkpoint, now: createdAt }))
      .resolves.toEqual({
        ok: false,
        reason: 'invalid overflow witness: malformed micro-room control presence',
      });

    await expect(verifyMicroRoomOverflowCertificate({
      ...certificate,
      createdAt: new Date(createdAt.getTime() + 5 * 60_000 + 1).toISOString(),
    }, { baseGridRoomId, expectedCheckpoint: checkpoint, now: createdAt }))
      .resolves.toEqual({ ok: false, reason: 'micro-room overflow certificate is from the future' });
  });

  it('advances only through a contiguous historical chain and never rolls back', async () => {
    const first = createMicroRoomOverflowCertificate({
      baseGridRoomId,
      fromSplitGeneration: 0,
      fromLaneIndex: 0,
      checkpoint,
      witnesses: await witnessesForLane(0, 0),
      createdAt: createdAt.toISOString(),
    });
    const second = createMicroRoomOverflowCertificate({
      baseGridRoomId,
      fromSplitGeneration: 1,
      fromLaneIndex: 0,
      checkpoint,
      witnesses: await witnessesForLane(1, 0),
      createdAt: createdAt.toISOString(),
    });
    const now = new Date('2027-01-01T00:00:00.000Z');

    await expect(applyMicroRoomOverflowCertificateChain({
      identity: 'pub-newcomer',
      baseGridRoomId,
      currentSplitGeneration: 0,
      checkpoint,
      certificates: [second],
      now,
    })).resolves.toEqual(expect.objectContaining({
      assignment: expect.objectContaining({ splitGeneration: 0, laneCount: 1 }),
      accepted: [],
    }));

    const advanced = await applyMicroRoomOverflowCertificateChain({
      identity: 'pub-newcomer',
      baseGridRoomId,
      currentSplitGeneration: 0,
      checkpoint,
      certificates: [second, first],
      now,
    });
    expect(advanced.accepted).toHaveLength(2);
    expect(advanced.assignment).toEqual(expect.objectContaining({
      splitGeneration: 2,
      laneCount: 4,
    }));

    const retained = await applyMicroRoomOverflowCertificateChain({
      identity: 'pub-newcomer',
      baseGridRoomId,
      currentSplitGeneration: 2,
      checkpoint,
      certificates: [first],
      now,
    });
    expect(retained.assignment.splitGeneration).toBe(2);
  });
});
