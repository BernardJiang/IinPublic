/**
 * Nearby v3 phase 2: the peer link. Lists are one-sided — Adam can have Eve on his list while Eve
 * does not have Adam — so Adam's swap must work although Eve's phone would never open the link by
 * itself. Adam knocks (signed, on Eve's own channel); Eve's gate opens her side; the swap runs over
 * the mesh as `nearby-gossip` frames; the link closes when the pins expire.
 */
import SEA from 'gun/sea';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import { PeerMeshService } from '../../web/services/peer-mesh-service';
import type { WebGunService } from '../../web/services/web-gun-service';
import { createNearbyKnock, verifyNearbyKnock } from '../../shared/nearby-v3-knock';
import { NearbyKnockGate, NearbyV3MeshLink } from '../../web/services/nearby-v3-link';
import { NearbyV3Service } from '../../web/services/nearby-v3-service';
import { NEARBY_V3_DEFAULTS, type NearbyV3Config } from '../../shared/nearby-v3-config';
import type { NearbyCard } from '../../shared/nearby-v3-card';
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';

const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);

function fakeNetwork() {
  const sessions = new Map<string, Array<{ localUserId: string; hook?: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void> }>>();
  const opened: string[] = [];
  return {
    opened,
    createSession(params: { conversationId: string; localUserId: string; otherUserId: string; onRemoteMeshFrame: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void> }) {
      const record: { localUserId: string; hook?: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void> } = {
        localUserId: params.localUserId, hook: params.onRemoteMeshFrame,
      };
      sessions.set(params.conversationId, [...(sessions.get(params.conversationId) ?? []), record]);
      opened.push(`${params.localUserId}->${params.otherUserId}`);
      return {
        ensureConnected: async () => {
          // A link is up only when both ends opened their session.
          if ((sessions.get(params.conversationId) ?? []).length < 2) throw new Error('other side has no session');
        },
        getState: () => ((sessions.get(params.conversationId) ?? []).length >= 2 ? 'connected' : 'connecting'),
        setOnRemoteMeshFrame: (hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => { record.hook = hook; },
        sendMeshFrame: async (frame: P2PMeshFrame) => {
          for (const remote of sessions.get(params.conversationId) ?? []) {
            if (remote.localUserId !== params.localUserId) await remote.hook?.(params.localUserId, frame);
          }
        },
        dispose: () => {
          sessions.set(params.conversationId, (sessions.get(params.conversationId) ?? []).filter((entry) => entry !== record));
        },
      };
    },
  };
}

const fakeSign = async (input: { userId: string; pair: SeaSigningPair; point: PublicLocation; scope?: NearbyCard['scope']; lifetimeMs: number; now?: Date }): Promise<NearbyCard> => {
  const now = input.now ?? new Date();
  return {
    version: 1, kind: 'nearby-card', userId: input.userId, pub: input.pair.pub, point: input.point, traveler: false,
    scope: input.scope ?? 'nearby', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + input.lifetimeMs).toISOString(),
    proof: { pub: input.pair.pub, timestamp: now.toISOString() } as NearbyCard['proof'],
  };
};

describe('Nearby v3 knock', () => {
  it('verifies a knock only for its addressee, while fresh, with the knocker\'s own card', async () => {
    const adam = await SEA.pair() as SeaSigningPair;
    const eve = await SEA.pair() as SeaSigningPair;
    const now = new Date('2026-10-19T12:00:00Z');
    const card = await fakeSign({ userId: 'adam', pair: adam, point: SD, lifetimeMs: 60_000, now });
    const knock = await createNearbyKnock({ fromUserId: 'adam', pair: adam, toPub: eve.pub, card, now });
    expect((await verifyNearbyKnock(knock, { localPub: eve.pub, now })).ok).toBe(true);
    expect((await verifyNearbyKnock(knock, { localPub: adam.pub, now })).ok).toBe(false);
    expect((await verifyNearbyKnock(knock, { localPub: eve.pub, now: new Date(now.getTime() + 61_000) })).ok).toBe(false);
    expect((await verifyNearbyKnock({ ...knock, fromUserId: 'mallory' }, { localPub: eve.pub, now })).ok).toBe(false);
    const stolen = await fakeSign({ userId: 'eve', pair: eve, point: SD, lifetimeMs: 60_000, now });
    expect((await verifyNearbyKnock(await createNearbyKnock({ fromUserId: 'adam', pair: adam, toPub: eve.pub, card: stolen, now }), { localPub: eve.pub, now })).ok)
      .toBe(false);
  });

  it('opens the link for a knock, skips blocked people and stops at the incoming limit', async () => {
    const eve = await SEA.pair() as SeaSigningPair;
    const pins: string[] = [];
    const gate = new NearbyKnockGate({
      localPub: () => eve.pub,
      mesh: { pinPeer: (userId) => { pins.push(userId); }, isPinned: (userId) => pins.includes(userId) },
      incomingLimit: () => 1,
      isBlocked: (userId) => userId === 'mallory',
    });
    const knock = async (userId: string) => {
      const pair = await SEA.pair() as SeaSigningPair;
      return gate.receive(await createNearbyKnock({ fromUserId: userId, pair, toPub: eve.pub, card: null }));
    };
    expect(await knock('mallory')).toBe('rejected');
    expect(await knock('adam')).toBe('accepted');
    expect(await knock('bob')).toBe('busy');
    expect(pins).toEqual(['adam']);
  });
});

describe('Nearby v3 swap over the mesh with one-sided lists', () => {
  it('lets Adam swap with Eve although Eve does not have Adam on her list, then closes the link', async () => {
    const net = fakeNetwork();
    const config: NearbyV3Config = { ...NEARBY_V3_DEFAULTS, capacity: 8 };
    const pairs = { adam: await SEA.pair() as SeaSigningPair, eve: await SEA.pair() as SeaSigningPair };
    let nowMs = Date.parse('2026-10-19T12:00:00Z');
    const phones: Record<string, { mesh: PeerMeshService; service: NearbyV3Service; gate: NearbyKnockGate }> = {};
    const hubCards: NearbyCard[] = [];
    for (const name of ['adam', 'eve'] as const) {
      const pair = pairs[name];
      const gun = { getStoredPair: () => pair, getPublicUser: async () => undefined } as unknown as WebGunService;
      const mesh = new PeerMeshService(gun, {
        apiBase: 'http://127.0.0.1:1',
        localUserId: name,
        localStageName: name,
        personalRoster: true,
        createSession: net.createSession as never,
        knockPeer: async (peer) => {
          const other = phones[peer.userId]!;
          await other.gate.receive(await createNearbyKnock({ fromUserId: name, pair, toPub: peer.pub, card: phones[name]!.service.card() }));
        },
        onNearbyGossip: (_fromUserId, fromPub, message) => phones[name]!.service.handleMessage(fromPub, message),
      });
      const service = new NearbyV3Service({
        config: () => config,
        identity: () => ({ userId: name, pair }),
        position: () => ({ point: SD, traveler: false, scope: 'nearby' }),
        hub: {
          heartbeat: async (card) => { hubCards.push(card); },
          // Eve asks the hub first, when it knows nobody; Adam asks after Eve's heartbeat.
          introductions: async (input) => hubCards.filter((card) => card.pub !== input.excludePub),
        },
        link: new NearbyV3MeshLink(mesh),
        sign: fakeSign as never,
        verify: async () => true,
        now: () => nowMs,
        log: () => undefined,
      });
      const gate = new NearbyKnockGate({ localPub: () => pair.pub, mesh, incomingLimit: () => config.incomingConnections });
      phones[name] = { mesh, service, gate };
      await mesh.joinRoom('nearby-v3', [], { replace: true });
    }
    const { adam, eve } = phones as Record<'adam' | 'eve', (typeof phones)[string]>;
    // Eve's list must stay empty until the swap: stop her re-asking the hub.
    await eve!.service.tick();
    hubCards.splice(0);
    hubCards.push(eve!.service.card()!);
    expect(eve!.service.entries()).toHaveLength(0);

    await adam!.service.tick();
    expect(adam!.service.entries().map((entry) => entry.card.pub)).toEqual([pairs.eve.pub]);
    // Adam's first tick ran the swap: Eve learned Adam's card through it.
    expect(eve!.service.entries().map((entry) => entry.card.pub)).toEqual([pairs.adam.pub]);
    expect(net.opened).toEqual(expect.arrayContaining(['adam->eve', 'eve->adam']));

    // Once the pins expire, both sides close the link.
    nowMs += 120_000;
    adam!.mesh.unpinPeer('eve');
    eve!.mesh.unpinPeer('adam');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adam!.mesh.getDiagnostics().neighborCount).toBe(0);
    expect(eve!.mesh.getDiagnostics().neighborCount).toBe(0);
    adam!.mesh.leaveRoom();
    eve!.mesh.leaveRoom();
  });
});

describe('Nearby v3 knocks back', () => {
  it('knocks back after a stale knock, never after a fresh one', async () => {
    // Found by web e2e 02-multi-user-headcount: a returning user read knocks sent while it was away,
    // took them for "they are opening their side", never knocked back, and nobody answered.
    const net = fakeNetwork();
    const knocked: string[] = [];
    const pair = await SEA.pair() as SeaSigningPair;
    const gun = { getStoredPair: () => pair, getPublicUser: async () => undefined, getPrivate: async () => null, putPrivate: async () => undefined } as unknown as WebGunService;
    const eve = new PeerMeshService(gun, {
      apiBase: 'http://127.0.0.1:1',
      localUserId: 'eve',
      localStageName: 'eve',
      createSession: net.createSession as never,
      knockPeer: async (peer) => { knocked.push(peer.userId); },
    });
    await eve.joinRoom('nearby-v3', [], { replace: true, personal: true });
    const [adam, bob] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    eve.pinPeer('adam', adam!.pub, 60_000, { fromKnock: true, knockedAtMs: Date.now() - 30_000 });
    eve.pinPeer('bob', bob!.pub, 60_000, { fromKnock: true, knockedAtMs: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(knocked).toContain('adam');
    expect(knocked).not.toContain('bob');
    eve.leaveRoom();
  });
});

describe('Nearby v3 broadcast loop', () => {
  it('delivers a Talk to everyone on the list, opening links a few at a time, although nobody lists the sender', async () => {
    const net = fakeNetwork();
    const names = ['adam', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
    const pairs = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await SEA.pair() as SeaSigningPair])));
    const privateStore = () => {
      const values = new Map<string, unknown>();
      return { getPrivate: async (key: string) => values.get(key) ?? null, putPrivate: async (key: string, value: unknown) => { values.set(key, value); } };
    };
    const meshes: Record<string, PeerMeshService> = {};
    const gates: Record<string, NearbyKnockGate> = {};
    const delivered: string[] = [];
    let mostLinks = 0;
    for (const name of names) {
      const pair = pairs[name]!;
      const gun = { getStoredPair: () => pair, getPublicUser: async () => undefined, ...privateStore() } as unknown as WebGunService;
      meshes[name] = new PeerMeshService(gun, {
        apiBase: 'http://127.0.0.1:1',
        localUserId: name,
        localStageName: name,
        ackTimeoutMs: 2_000,
        authoritativeDirectTalkDelivery: true,
        personalConcurrency: () => ({ initial: 2, max: 3 }),
        createSession: net.createSession as never,
        knockPeer: async (peer) => {
          await gates[peer.userId]!.receive(await createNearbyKnock({ fromUserId: name, pair, toPub: peer.pub, card: null }));
        },
        onTalkBody: (body) => { delivered.push(name); expect(body.talkId).toBe('loop-talk'); },
      });
      gates[name] = new NearbyKnockGate({ localPub: () => pair.pub, mesh: meshes[name]!, incomingLimit: () => 8 });
    }
    // Adam's list holds the six; each receiver's own list is empty (one-sided).
    const list = names.slice(1).map((name) => ({ userId: name, stageName: name, pub: pairs[name]!.pub }));
    await meshes.adam!.joinRoom('nearby-v3', list, { replace: true, personal: true });
    for (const name of names.slice(1)) await meshes[name]!.joinRoom('nearby-v3', [], { replace: true, personal: true });
    const watch = setInterval(() => { mostLinks = Math.max(mostLinks, meshes.adam!.getDiagnostics().neighborCount); }, 5);

    await meshes.adam!.broadcastTalk({ id: 'loop-talk', authorId: 'adam', title: 'Loop', type: 'tag', questions: [] }, { roomBroadcast: true });
    const deadline = Date.now() + 10_000;
    while (delivered.length < 6 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    clearInterval(watch);
    expect([...delivered].sort()).toEqual(names.slice(1));
    expect(mostLinks).toBeLessThanOrEqual(3);
    expect(meshes.adam!.getPersonalConcurrency()).toBe(3);
    for (const mesh of Object.values(meshes)) mesh.leaveRoom();
  }, 20_000);

  it('opens the author\'s link to send an answer, though the author is not on the list', async () => {
    // Found by web e2e find-similar (mailbox off): an answer went only over links already open,
    // and in personal mode none was open to the author.
    const net = fakeNetwork();
    const pairs = { adam: await SEA.pair() as SeaSigningPair, carol: await SEA.pair() as SeaSigningPair };
    const answers: string[] = [];
    const gates: Record<string, NearbyKnockGate> = {};
    const meshes: Record<string, PeerMeshService> = {};
    for (const name of ['adam', 'carol'] as const) {
      const pair = pairs[name];
      const values = new Map<string, unknown>();
      const gun = {
        getStoredPair: () => pair,
        getPublicUser: async (userId: string) => (userId === 'adam' ? { id: 'adam', pub: pairs.adam.pub } : undefined),
        getPrivate: async (key: string) => values.get(key) ?? null,
        putPrivate: async (key: string, value: unknown) => { values.set(key, value); },
      } as unknown as WebGunService;
      meshes[name] = new PeerMeshService(gun, {
        apiBase: 'http://127.0.0.1:1',
        localUserId: name,
        localStageName: name,
        ackTimeoutMs: 2_000,
        createSession: net.createSession as never,
        knockPeer: async (peer) => {
          await gates[peer.userId]!.receive(await createNearbyKnock({ fromUserId: name, pair, toPub: peer.pub, card: null }));
        },
        onTalkResponse: (payload) => { answers.push(`${payload.responderId}->${name}`); },
      });
      gates[name] = new NearbyKnockGate({ localPub: () => pair.pub, mesh: meshes[name]!, incomingLimit: () => 8 });
      await meshes[name]!.joinRoom('nearby-v3', [], { replace: true, personal: true });
    }
    const at = new Date().toISOString();
    const acknowledged = await meshes.carol!.sendTalkResponse({
      responseId: 'r1', talkId: 't1', authorId: 'adam', responderId: 'carol', submittedAt: at, respondedAt: at,
      version: 1, encryption: 'sea-ecdh-v1', payloadCiphertext: 'x', transportMode: 'mesh-p2p',
    } as never);
    expect(answers).toEqual(['carol->adam']);
    expect(acknowledged).toBe(true);
    for (const mesh of Object.values(meshes)) mesh.leaveRoom();
  }, 20_000);

  it('reaches a chosen recipient who is not on the Nearby list (a contact group)', async () => {
    // Found by web e2e isolated-02: the loop opened links only to listed people, so a Talk for
    // anyone else waited in the outbox for good.
    const net = fakeNetwork();
    const pairs = { adam: await SEA.pair() as SeaSigningPair, carol: await SEA.pair() as SeaSigningPair };
    const delivered: string[] = [];
    const gates: Record<string, NearbyKnockGate> = {};
    const meshes: Record<string, PeerMeshService> = {};
    for (const name of ['adam', 'carol'] as const) {
      const pair = pairs[name];
      const values = new Map<string, unknown>();
      const gun = {
        getStoredPair: () => pair,
        // The hub's public record: how the mesh learns a contact's key.
        getPublicUser: async (userId: string) => (userId === 'carol' ? { id: 'carol', pub: pairs.carol.pub } : undefined),
        getPrivate: async (key: string) => values.get(key) ?? null,
        putPrivate: async (key: string, value: unknown) => { values.set(key, value); },
      } as unknown as WebGunService;
      meshes[name] = new PeerMeshService(gun, {
        apiBase: 'http://127.0.0.1:1',
        localUserId: name,
        localStageName: name,
        ackTimeoutMs: 2_000,
        authoritativeDirectTalkDelivery: true,
        createSession: net.createSession as never,
        knockPeer: async (peer) => {
          await gates[peer.userId]!.receive(await createNearbyKnock({ fromUserId: name, pair, toPub: peer.pub, card: null }));
        },
        onTalkBody: () => { delivered.push(name); },
      });
      gates[name] = new NearbyKnockGate({ localPub: () => pair.pub, mesh: meshes[name]!, incomingLimit: () => 8 });
      await meshes[name]!.joinRoom('nearby-v3', [], { replace: true, personal: true });
    }
    await meshes.adam!.broadcastTalk({ id: 'contact-talk', authorId: 'adam', title: 'Friends', type: 'tag', questions: [] }, { recipientUserIds: ['carol'] });
    const deadline = Date.now() + 10_000;
    while (!delivered.includes('carol') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(delivered).toEqual(['carol']);
    for (const mesh of Object.values(meshes)) mesh.leaveRoom();
  }, 20_000);
});

