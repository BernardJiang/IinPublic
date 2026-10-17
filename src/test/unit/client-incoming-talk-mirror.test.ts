import type { IncomingTalkClusterWire } from '../../shared/peer-talk-delivery';
import {
  mirrorIncomingTalkClustersToLocalGun,
  upsertLocalIncomingTalkClusters,
} from '../../web/services/client-incoming-talk-mirror';

describe('client incoming talk mirror', () => {
  it('does not rewrite an unchanged owner envelope during a UI refresh', async () => {
    const cluster: IncomingTalkClusterWire = {
      identityKey: 'tag:coffee',
      title: 'Coffee',
      type: 'tag',
      language: 'en',
      senders: {},
      talkIds: {},
      questionCount: 0,
      latestTalkId: 'talk-coffee',
      updatedAt: '2026-08-13T22:00:00.000Z',
      identityAliases: { 'tag:coffee': true },
    };
    const stored = {
      identityKey: cluster.identityKey,
      title: cluster.title,
      type: cluster.type,
      language: cluster.language,
      questionCount: cluster.questionCount,
      latestTalkId: cluster.latestTalkId,
      updatedAt: cluster.updatedAt,
      sendersJson: '{}',
      talkIdsJson: '{}',
      identityAliasesJson: JSON.stringify(cluster.identityAliases),
    };
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      getPrivateLocal: jest.fn().mockResolvedValue({
        version: 1,
        clustersJson: JSON.stringify([stored]),
        updatedAt: '2026-08-13T22:00:01.000Z',
      }),
      putPrivate: jest.fn().mockResolvedValue(undefined),
    };

    mirrorIncomingTalkClustersToLocalGun(
      gunService as any,
      'receiver-id',
      [cluster],
      { p2pClientTalkMirror: true } as any,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gunService.putPrivate).not.toHaveBeenCalled();
  });

  it('persists a batch of incoming talks with one owner-envelope write', async () => {
    let envelope: any = null;
    const emptyMap = { map: () => ({ once: () => undefined, off: () => undefined }) };
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      get: jest.fn().mockRejectedValue(new Error('missing legacy envelope')),
      getPrivateLocal: jest.fn(async () => envelope),
      putPrivate: jest.fn(async (_key: string, value: unknown) => { envelope = value; }),
      getGun: jest.fn(() => ({ get: () => ({ get: () => emptyMap }) })),
    };

    const clusters = await upsertLocalIncomingTalkClusters(
      gunService as any,
      'receiver-id',
      ['coffee', 'tea'].map((title) => ({
        talkId: `talk-${title}`,
        talkData: { id: `talk-${title}`, title, type: 'tag', questions: [] },
        senderId: `sender-${title}`,
        senderName: title,
      })),
      { p2pClientTalkMirror: true } as any,
    );

    expect(clusters).toHaveLength(2);
    expect(gunService.putPrivate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(envelope.clustersJson)).toHaveLength(2);
  });

  it('first incoming talk on a fresh device never waits on the peered private-graph probe', async () => {
    // getPrivate() falls back to a 4 s peered-graph probe when a key is missing locally. This key
    // was born local-only, so that probe can never find anything; it used to cost every fresh
    // install ~8 s on its first incoming Talk (read before the write, then the read-back).
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      let envelope: any = null;
      const emptyMap = { map: () => ({ once: () => undefined, off: () => undefined }) };
      const gunService = {
        getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
        get: jest.fn().mockRejectedValue(new Error('missing legacy envelope')),
        getPrivate: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve(envelope), 4_000))),
        getPrivateLocal: jest.fn(async () => envelope),
        putPrivate: jest.fn(async (_key: string, value: unknown) => { envelope = value; }),
        getGun: jest.fn(() => ({ get: () => ({ get: () => emptyMap }) })),
      };
      let settled = false;
      const delivery = upsertLocalIncomingTalkClusters(
        gunService as any,
        'receiver-id',
        [{ talkId: 'talk-coffee', talkData: { id: 'talk-coffee', title: 'Coffee', type: 'tag', questions: [] }, senderId: 'sender', senderName: 'Sender' }],
        { p2pClientTalkMirror: true } as any,
      ).then((clusters) => { settled = true; return clusters; });
      for (let i = 0; i < 20 && !settled; i += 1) await jest.advanceTimersByTimeAsync(50);

      expect(settled).toBe(true);
      expect(gunService.getPrivate).not.toHaveBeenCalled();
      expect(JSON.parse(envelope.clustersJson)).toHaveLength(1);
      await delivery;
    } finally {
      jest.useRealTimers();
    }
  });

  it('imports the old plaintext owner envelope into private local Gun without rewriting it publicly', async () => {
    const legacyEnvelope = {
      version: 1,
      clustersJson: JSON.stringify([]),
      updatedAt: '2026-08-13T22:00:01.000Z',
    };
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      getPrivateLocal: jest.fn().mockResolvedValue(null),
      get: jest.fn().mockResolvedValue(legacyEnvelope),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      put: jest.fn().mockResolvedValue(undefined),
    };

    await upsertLocalIncomingTalkClusters(
      gunService as any,
      'receiver-id',
      [],
      { p2pClientTalkMirror: true } as any,
    );

    expect(gunService.get).toHaveBeenCalledWith('users/receiver-sea-pub/incomingTalkClusters');
    expect(gunService.putPrivate).toHaveBeenCalledWith('incomingTalkClusters', legacyEnvelope);
    expect(gunService.put).not.toHaveBeenCalled();
  });
});
