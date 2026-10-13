import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  createNearbyCohortSeatClaim,
  type NearbyCohortSeatClaim,
} from '../../shared/nearby-cohort-admission';
import {
  deriveNearbyCohortCapacityArtifact,
  verifyNearbyCohortCapacityArtifact,
  type NearbyCohortPeerSyncPayload,
} from '../../shared/nearby-cohort-peer-sync';
import { nearbyCohortRootGroup } from '../../shared/nearby-cohort-protocol';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { NearbyCohortPeerSyncController } from '../../web/services/nearby-cohort-peer-sync-controller';
import type { NearbyCohortTraversalContext } from '../../web/services/nearby-cohort-traversal-client';

const checkpoint: RoomProtocolCheckpoint = {
  networkId: 'iinpublic-peer-split-test',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: '9'.repeat(64),
  chatroomCapacity: 3,
};
const now = new Date('2026-10-12T12:00:00.000Z');

async function fixtures(): Promise<Array<{
  pair: SeaSigningPair;
  context: NearbyCohortTraversalContext;
  claim: NearbyCohortSeatClaim;
}>> {
  const root = nearbyCohortRootGroup(checkpoint);
  const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
  return Promise.all(pairs.map(async (pair, index) => {
    const context: NearbyCohortTraversalContext = {
      checkpoint,
      userId: `phone-${index + 1}`,
      pair,
      privacyMode: 'regional',
      defaultGroup: root,
    };
    return {
      pair,
      context,
      claim: await createNearbyCohortSeatClaim({
        checkpoint,
        pair,
        userId: context.userId,
        privacyMode: context.privacyMode,
        group: root,
        generation: 1,
        now: new Date(now.getTime() + index),
      }),
    };
  }));
}

describe('serverless Nearby cohort split', () => {
  it('derives one self-verifying decision from C+1 signed claims regardless of arrival order', async () => {
    const users = await fixtures();
    const root = nearbyCohortRootGroup(checkpoint);
    const claims = users.map((user) => user.claim);
    const forward = await deriveNearbyCohortCapacityArtifact({ checkpoint, fromGroup: root, claims, now });
    const reverse = await deriveNearbyCohortCapacityArtifact({
      checkpoint,
      fromGroup: root,
      claims: [...claims].reverse(),
      now,
    });
    expect(forward).not.toBeNull();
    expect(reverse?.transition).toEqual(forward?.transition);
    await expect(verifyNearbyCohortCapacityArtifact(forward, checkpoint, now))
      .resolves.toMatchObject({ ok: true });

    const tampered = {
      ...forward!,
      transition: { ...forward!.transition, evidenceHash: '0'.repeat(64) },
    };
    await expect(verifyNearbyCohortCapacityArtifact(tampered, checkpoint, now))
      .resolves.toMatchObject({ ok: false });
  });

  it('lets four independent phones converge without electing a phone or contacting a server', async () => {
    const users = await fixtures();
    const root = nearbyCohortRootGroup(checkpoint);
    const decisions: Array<{ phone: string; transitionId: string; targetRoomId: string }> = [];
    const controllers = users.map((user) => new NearbyCohortPeerSyncController({
      now: () => now,
      send: async () => undefined,
      applyAutomaticTransition: async ({ targetGroup, artifact }) => {
        decisions.push({
          phone: user.context.userId,
          transitionId: artifact.transition.transitionId,
          targetRoomId: targetGroup.roomId,
        });
      },
    }));
    await Promise.all(controllers.map((controller, index) =>
      controller.activate(users[index]!.context, root, users[index]!.claim)));
    const payload: NearbyCohortPeerSyncPayload = {
      version: 1,
      kind: 'nearby-cohort-peer-sync',
      checkpoint,
      claims: users.map((user) => user.claim),
      artifacts: [],
    };
    await Promise.all(controllers.map((controller) => controller.ingest(payload)));

    expect(decisions).toHaveLength(4);
    expect(new Set(decisions.map((decision) => decision.transitionId)).size).toBe(1);
    expect(new Set(decisions.map((decision) => decision.targetRoomId)).size).toBeGreaterThanOrEqual(1);
    expect(decisions.every((decision) => decision.targetRoomId !== root.roomId)).toBe(true);
    expect(controllers.every((controller) => controller.diagnostics().appliedTransitionCount === 1)).toBe(true);
  });
});
