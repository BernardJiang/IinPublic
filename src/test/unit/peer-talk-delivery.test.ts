import {
  buildPeerTalkOfferKey,
  clusterFromPeerTalkOffer,
  createPeerTalkOfferWire,
  mergeIncomingTalkCluster,
  parsePeerTalkOfferKey,
} from '../../shared/peer-talk-delivery';
import { resolveP2PRuntimeFlags, shouldSkipServerGunPersist, usesDirectTalkDelivery } from '../../shared/p2p-runtime';

describe('peer-talk-delivery', () => {
  it('builds stable offer keys', () => {
    expect(buildPeerTalkOfferKey('alice', 'qa_abc12345')).toBe('alice::qa_abc12345');
    expect(parsePeerTalkOfferKey('alice::qa_abc12345')).toEqual({
      senderId: 'alice',
      talkId: 'qa_abc12345',
    });
  });

  it('merges incoming cluster for a new sender/talk', () => {
    const cluster = mergeIncomingTalkCluster(null, {
      talkId: 'qa_deadbeef',
      senderId: 'alice',
      senderName: 'Alice',
      talkData: {
        title: 'Hello',
        type: 'flow',
        language: 'en',
        questions: [{ text: 'Q1', answers: [{ id: 'a1', text: 'Yes' }] }],
      },
    });
    expect(cluster.title).toBe('Hello');
    expect(cluster.senders.alice?.lastTalkId).toBe('qa_deadbeef');
    expect(cluster.talkIds['qa_deadbeef']).toBeTruthy();
    expect(cluster.questionsJson).toContain('Q1');
  });

  it('creates cluster from peer offer wire', () => {
    const offer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      talkData: { title: 'T', type: 'tag', language: 'en' },
    });
    const cluster = clusterFromPeerTalkOffer(offer);
    expect(cluster.senders.s1?.senderName).toBe('Sender');
  });
});

describe('P0 direct talk delivery flags', () => {
  it('enables direct talk delivery when P0_DIRECT_TALK_DELIVERY or RELAY_ONLY_HUB', () => {
    expect(usesDirectTalkDelivery(resolveP2PRuntimeFlags({}))).toBe(false);
    expect(usesDirectTalkDelivery(resolveP2PRuntimeFlags({ P0_DIRECT_TALK_DELIVERY: '1' }))).toBe(true);
    expect(usesDirectTalkDelivery(resolveP2PRuntimeFlags({ RELAY_ONLY_HUB: '1' }))).toBe(true);
  });

  it('skips server persist for talks and peer offers when ephemeral', () => {
    const flags = resolveP2PRuntimeFlags({ STAR_SERVER_PERSISTENCE: 'ephemeral' });
    expect(shouldSkipServerGunPersist(['talks', 'qa_abc'], flags)).toBe(true);
    expect(shouldSkipServerGunPersist(['peerTalkOffers', 'bob', 'alice::t1'], flags)).toBe(true);
    expect(shouldSkipServerGunPersist(['incomingTalksByUser', 'bob', 'ik1'], flags)).toBe(true);
  });
});
