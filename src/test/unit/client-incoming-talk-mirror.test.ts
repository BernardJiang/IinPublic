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
      getPrivate: jest.fn().mockResolvedValue({
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

  it('treats a stored cluster with its keys in another order as unchanged', async () => {
    const cluster: IncomingTalkClusterWire = {
      identityKey: 'tag:tea',
      title: 'Tea',
      type: 'tag',
      language: 'en',
      senders: { s1: { name: 'S1' } } as any,
      talkIds: { t1: true } as any,
      questionCount: 1,
      latestTalkId: 'talk-tea',
      updatedAt: '2026-10-20T10:00:00.000Z',
      identityAliases: { 'tag:tea': true },
    };
    const stored = {
      updatedAt: cluster.updatedAt,
      latestTalkId: cluster.latestTalkId,
      sendersJson: JSON.stringify(cluster.senders),
      identityKey: cluster.identityKey,
      questionCount: 1,
      talkIdsJson: JSON.stringify(cluster.talkIds),
      title: 'Tea',
      language: 'en',
      type: 'tag',
      identityAliasesJson: JSON.stringify(cluster.identityAliases),
    };
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      getPrivate: jest.fn().mockResolvedValue({ version: 1, clustersJson: JSON.stringify([stored]), updatedAt: 'x' }),
      putPrivate: jest.fn().mockResolvedValue(undefined),
    };
    mirrorIncomingTalkClustersToLocalGun(gunService as any, 'receiver-id', [cluster], { p2pClientTalkMirror: true } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gunService.putPrivate).not.toHaveBeenCalled();
  });

  it('folds saves that arrive while a rewrite is running into one next rewrite', async () => {
    // find-similar-people: one queued rewrite per Talk fell 155 s behind under six browsers.
    let envelope: any = null;
    let releaseFirst: (() => void) | null = null;
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      getPrivate: jest.fn(async () => envelope),
      putPrivate: jest.fn(async (_key: string, value: unknown) => {
        if (!releaseFirst && gunService.putPrivate.mock.calls.length === 1) {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        envelope = value;
      }),
    };
    const cluster = (title: string): IncomingTalkClusterWire => ({
      identityKey: `tag:${title}`,
      title,
      type: 'tag',
      language: 'en',
      senders: {},
      talkIds: {},
      questionCount: 0,
      latestTalkId: `talk-${title}`,
      updatedAt: '2026-10-20T10:00:00.000Z',
      identityAliases: {},
    });
    const flags = { p2pClientTalkMirror: true } as any;
    mirrorIncomingTalkClustersToLocalGun(gunService as any, 'receiver-id', [cluster('first')], flags);
    for (let i = 0; i < 25; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gunService.putPrivate).toHaveBeenCalledTimes(1);
    const titles = Array.from({ length: 20 }, (_, i) => `t${i}`);
    mirrorIncomingTalkClustersToLocalGun(gunService as any, 'receiver-id', titles.map(cluster), flags);
    (releaseFirst as unknown as () => void)();
    for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gunService.putPrivate).toHaveBeenCalledTimes(2);
    expect(JSON.parse(envelope.clustersJson)).toHaveLength(21);
  });

  it('persists a batch of incoming talks with one owner-envelope write', async () => {
    let envelope: any = null;
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      getPrivate: jest.fn(async () => envelope),
      putPrivate: jest.fn(async (_key: string, value: unknown) => { envelope = value; }),
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

  it('reads and writes only the encrypted local store, never the peered graph (OPEN-78)', async () => {
    let envelope: any = null;
    const peered = () => { throw new Error('peered graph used'); };
    const gunService = {
      getStoredPair: jest.fn(() => ({ pub: 'receiver-sea-pub' })),
      getPrivate: jest.fn(async () => envelope),
      putPrivate: jest.fn(async (_key: string, value: unknown) => { envelope = value; }),
      get: jest.fn(peered),
      put: jest.fn(peered),
      getGun: jest.fn(peered),
    };

    await upsertLocalIncomingTalkClusters(
      gunService as any,
      'receiver-id',
      [{ talkId: 'talk-coffee', talkData: { id: 'talk-coffee', title: 'Coffee', type: 'tag', questions: [] }, senderId: 'sender', senderName: 'Sender' }],
      { p2pClientTalkMirror: true } as any,
    );

    expect(JSON.parse(envelope.clustersJson)).toHaveLength(1);
    expect(gunService.get).not.toHaveBeenCalled();
    expect(gunService.put).not.toHaveBeenCalled();
    expect(gunService.getGun).not.toHaveBeenCalled();
  });
});
