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
      get: jest.fn().mockResolvedValue({
        version: 1,
        clustersJson: JSON.stringify([stored]),
        updatedAt: '2026-08-13T22:00:01.000Z',
      }),
      put: jest.fn().mockResolvedValue(undefined),
    };

    mirrorIncomingTalkClustersToLocalGun(
      gunService as any,
      'receiver-id',
      [cluster],
      { p2pClientTalkMirror: true } as any,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gunService.put).not.toHaveBeenCalled();
  });

  it('persists a batch of incoming talks with one owner-envelope write', async () => {
    let envelope: any = null;
    const emptyMap = { map: () => ({ once: () => undefined, off: () => undefined }) };
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      get: jest.fn(async () => envelope),
      put: jest.fn(async (_soul: string, value: unknown) => { envelope = value; }),
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
    expect(gunService.put).toHaveBeenCalledTimes(1);
    expect(JSON.parse(envelope.clustersJson)).toHaveLength(2);
  });
});
