import {
  buildPeerTalkOfferKey,
  clusterFromPeerTalkOffer,
  createPeerTalkOfferWire,
  expandTalkDataFromGunWire,
  gunSafeTalkDataRecord,
  mergeIncomingTalkCluster,
  parsePeerTalkOfferKey,
  peerTalkOfferSigningPayload,
} from '../../shared/peer-talk-delivery';
import { publishPeerTalkOffer } from '../../web/services/client-peer-talk-delivery';
import {
  createSignedP2PEnvelopeProof,
  resolveP2PRuntimeFlags,
  shouldSkipServerGunPersist,
  usesDirectTalkDelivery,
  verifySignedP2PEnvelopeProof,
} from '../../shared/p2p-runtime';
import SEA from 'gun/sea';

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

  it('creates reference-only peer offer wires by default', () => {
    const offer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      senderEpub: 'epub-s1',
      talkData: { title: 'T', type: 'tag', language: 'en' },
    });
    expect(offer.talkData).toBeUndefined();
    expect(offer.senderEpub).toBe('epub-s1');
    expect(offer.talkRef).toEqual({
      root: 'peerTalkCatalog',
      authorId: 's1',
      talkId: 't1',
    });
  });

  it('signs peer offer metadata and rejects tampered offers', async () => {
    const pair = await SEA.pair();
    const baseOffer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      senderPub: pair.pub,
      senderEpub: pair.epub,
      talkData: { title: 'T', type: 'tag', language: 'en' },
      now: new Date('2026-06-04T12:00:00.000Z'),
    });
    const proof = await createSignedP2PEnvelopeProof({
      pair,
      payload: peerTalkOfferSigningPayload(baseOffer),
      timestamp: '2026-06-04T12:00:00.000Z',
      nonce: 'nonce_offer',
    });
    const signedOffer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      senderPub: pair.pub,
      senderEpub: pair.epub,
      proof,
      talkData: { title: 'T', type: 'tag', language: 'en' },
      now: new Date('2026-06-04T12:00:00.000Z'),
    });

    await expect(
      verifySignedP2PEnvelopeProof({
        proof: {
          peerId: signedOffer.senderPeerId!,
          pub: signedOffer.senderPub!,
          timestamp: signedOffer.timestamp!,
          nonce: signedOffer.nonce!,
          payloadHash: signedOffer.payloadHash!,
          signature: signedOffer.signature!,
        },
        payload: peerTalkOfferSigningPayload(signedOffer),
        now: new Date('2026-06-04T12:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifySignedP2PEnvelopeProof({
        proof: {
          peerId: signedOffer.senderPeerId!,
          pub: signedOffer.senderPub!,
          timestamp: signedOffer.timestamp!,
          nonce: signedOffer.nonce!,
          payloadHash: signedOffer.payloadHash!,
          signature: signedOffer.signature!,
        },
        payload: peerTalkOfferSigningPayload({ ...signedOffer, senderName: 'Mallory' }),
        now: new Date('2026-06-04T12:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: false, reason: 'payload hash mismatch' });
  });

  it('publishes signed peer offers with the exact timestamp that was signed', async () => {
    const pair = await SEA.pair();
    let storedOffer: ReturnType<typeof createPeerTalkOfferWire> | null = null;
    const gunService = {
      getStoredPair: () => pair,
      getGun: () => ({
        get: () => ({
          get: () => ({
            get: () => ({
              put: (value: ReturnType<typeof createPeerTalkOfferWire>) => {
                storedOffer = value;
              },
            }),
          }),
        }),
      }),
    };

    await publishPeerTalkOffer(gunService as any, 'receiver', {
      talkId: 't1',
      senderId: 'sender',
      senderName: 'Sender',
      talkData: { title: 'T', type: 'tag', language: 'en' },
    });

    expect(storedOffer).toBeTruthy();
    await expect(
      verifySignedP2PEnvelopeProof({
        proof: {
          peerId: storedOffer!.senderPeerId!,
          pub: storedOffer!.senderPub!,
          timestamp: storedOffer!.timestamp!,
          nonce: storedOffer!.nonce!,
          payloadHash: storedOffer!.payloadHash!,
          signature: storedOffer!.signature!,
        },
        payload: peerTalkOfferSigningPayload(storedOffer!),
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('verifies peer offers after Gun stores nested talk references as links', async () => {
    const pair = await SEA.pair();
    const baseOffer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      senderPub: pair.pub,
      senderEpub: pair.epub,
      talkData: { title: 'T', type: 'tag', language: 'en' },
      now: new Date('2026-06-04T12:00:00.000Z'),
    });
    const proof = await createSignedP2PEnvelopeProof({
      pair,
      payload: peerTalkOfferSigningPayload(baseOffer),
      timestamp: '2026-06-04T12:00:00.000Z',
      nonce: 'nonce_offer_gun_meta',
    });
    const signedOffer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      senderPub: pair.pub,
      senderEpub: pair.epub,
      proof,
      talkData: { title: 'T', type: 'tag', language: 'en' },
      now: new Date('2026-06-04T12:00:00.000Z'),
    });
    const gunAnnotatedOffer = {
      ...signedOffer,
      talkRef: { '#': 'peerTalkOffers/receiver/s1::t1/talkRef' },
    };

    await expect(
      verifySignedP2PEnvelopeProof({
        proof: {
          peerId: gunAnnotatedOffer.senderPeerId!,
          pub: gunAnnotatedOffer.senderPub!,
          timestamp: gunAnnotatedOffer.timestamp!,
          nonce: gunAnnotatedOffer.nonce!,
          payloadHash: gunAnnotatedOffer.payloadHash!,
          signature: gunAnnotatedOffer.signature!,
        },
        payload: peerTalkOfferSigningPayload(gunAnnotatedOffer as unknown as typeof signedOffer),
        now: new Date('2026-06-04T12:00:01.000Z'),
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('creates cluster from hydrated peer offer wire', () => {
    const offer = createPeerTalkOfferWire({
      talkId: 't1',
      senderId: 's1',
      senderName: 'Sender',
      talkData: { title: 'T', type: 'tag', language: 'en' },
      includeTalkData: true,
    });
    const cluster = clusterFromPeerTalkOffer(offer);
    expect(cluster.senders.s1?.senderName).toBe('Sender');
  });

  it('serializes nested arrays for Gun-safe mesh offers', () => {
    const raw = {
      title: 'Mesh',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Hi', answers: [] }],
    };
    const safe = gunSafeTalkDataRecord(raw);
    expect(safe.questions).toBeUndefined();
    expect(typeof safe.questionsJson).toBe('string');
    const expanded = expandTalkDataFromGunWire(safe);
    expect(Array.isArray(expanded.questions)).toBe(true);
    expect((expanded.questions as { text: string }[])[0]?.text).toBe('Hi');
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
    expect(shouldSkipServerGunPersist(['peerTalkCatalog', 'alice', 't1'], flags)).toBe(true);
    expect(shouldSkipServerGunPersist(['chatrooms', 'global', 'talks', 'k1'], flags)).toBe(true);
    expect(shouldSkipServerGunPersist(['chatrooms', 'global', 'announcements', 'k1'], flags)).toBe(true);
  });

  it('allows P0 relay mirror writes only behind the explicit legacy compatibility flag', () => {
    const flags = resolveP2PRuntimeFlags({ STAR_SERVER_PERSISTENCE: 'ephemeral' });
    const prev = process.env.IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY;
    try {
      delete process.env.IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY;
      expect(
        shouldSkipServerGunPersist(['peerTalkOffers', 'bob', 'alice::t1'], flags, {
          relayP0TalkDelivery: true,
        }),
      ).toBe(true);
      process.env.IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY = '1';
      expect(
        shouldSkipServerGunPersist(['peerTalkOffers', 'bob', 'alice::t1'], flags, {
          relayP0TalkDelivery: true,
        }),
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY;
      else process.env.IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY = prev;
    }
  });
});
