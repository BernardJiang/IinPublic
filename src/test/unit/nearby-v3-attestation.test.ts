/**
 * Nearby v3 daily beacon and identity-age rule (§3.7 "Ranking"): the hub signs an unpredictable
 * beacon per UTC day and the day it first saw each key; phones mix the beacon into their order and,
 * in dense ties, rank keys seen before today first. A key ground against today's beacon is new
 * today, so it ranks behind everyone who already existed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateKeyPairSync } from 'crypto';
import {
  nearbyBeaconString,
  verifyNearbyAgeProof,
  verifyNearbyBeacon,
  type NearbyAgeProof,
} from '../../shared/nearby-v3-attestation';
import { createNearbyCard, parseNearbyCard, verifyNearbyCard, type NearbyCard } from '../../shared/nearby-v3-card';
import { NEARBY_V3_DEFAULTS, nearbyV3AttestorKeysFromManifest } from '../../shared/nearby-v3-config';
import { parseNearbyGossipMessage } from '../../shared/nearby-v3-gossip';
import { NearbyList } from '../../shared/nearby-v3-list';
import { nearbyRankTie } from '../../shared/nearby-v3-ranking';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { snapPublicLocation } from '../../shared/public-location';
import { NearbyAttestor } from '../../server/services/nearby-attestor';
import { NEARBY_V3_ATTESTATION_STORAGE_KEY, NearbyV3Service, type NearbyV3Link } from '../../core/nearby-v3-service';

const DAY1 = Date.parse('2026-10-19T12:00:00Z');
const DAY2 = Date.parse('2026-10-20T12:00:00Z');
const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);

function pair(): SeaSigningPair {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
  return { pub: `${jwk.x}.${jwk.y}`, priv: jwk.d } as SeaSigningPair;
}

function card(owner: SeaSigningPair, input: { point?: typeof SD; age?: NearbyAgeProof | null; nowMs: number }): Promise<NearbyCard> {
  return createNearbyCard({
    userId: `user-${owner.pub.slice(0, 6)}`,
    pair: owner,
    point: input.point ?? SD,
    lifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs,
    age: input.age ?? null,
    now: new Date(input.nowMs),
  });
}

describe('NearbyAttestor', () => {
  it('signs one unpredictable beacon per UTC day, the same after a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearby-attestor-'));
    const attestor = new NearbyAttestor({ dir });
    const day1 = await attestor.beacon(DAY1);
    const again = await attestor.beacon(DAY1 + 3_600_000);
    const day2 = await attestor.beacon(DAY2);
    expect(day1.day).toBe('2026-10-19');
    expect(again.value).toBe(day1.value);
    expect(day2.value).not.toBe(day1.value);
    expect(await verifyNearbyBeacon(day1, [attestor.key])).toEqual(day1);

    const restarted = new NearbyAttestor({ dir });
    expect(restarted.key).toEqual(attestor.key);
    expect((await restarted.beacon(DAY1)).value).toBe(day1.value);

    // Another hub's key, or a changed value, does not verify.
    const other = new NearbyAttestor({ dir: null });
    expect(await verifyNearbyBeacon(day1, [other.key])).toBeNull();
    expect(await verifyNearbyBeacon({ ...day1, value: day2.value }, [attestor.key])).toBeNull();
  });

  it('remembers the day it first saw each key across restarts, without storing the key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearby-attestor-'));
    const attestor = new NearbyAttestor({ dir });
    const alice = pair();
    const first = await attestor.ageProof(alice.pub, DAY1);
    const later = await new NearbyAttestor({ dir }).ageProof(alice.pub, DAY2);
    expect(first.since).toBe('2026-10-19');
    expect(later.since).toBe('2026-10-19');
    expect(await verifyNearbyAgeProof(later, alice.pub, [attestor.key])).toBe('2026-10-19');
    // Bound to its key: it does not vouch for anyone else.
    expect(await verifyNearbyAgeProof(later, pair().pub, [attestor.key])).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'first-seen.log'), 'utf8')).not.toContain(alice.pub);
  });
});

describe('cards with an age proof', () => {
  it('signs the proof into the card, so it cannot be stripped or swapped', async () => {
    const attestor = new NearbyAttestor({ dir: null });
    const alice = pair();
    const age = await attestor.ageProof(alice.pub, DAY1);
    const signed = await card(alice, { age, nowMs: DAY2 });
    expect(signed.age).toEqual(age);
    const now = new Date(DAY2);
    expect((await verifyNearbyCard(signed, { maxLifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs, now })).ok).toBe(true);
    const { age: _dropped, ...stripped } = signed;
    expect((await verifyNearbyCard(stripped, { maxLifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs, now })).ok).toBe(false);
    // Someone else's proof does not even parse on this card.
    const bobAge = await attestor.ageProof(pair().pub, DAY1);
    expect(parseNearbyCard({ ...signed, age: bobAge })).toBeNull();
  });
});

describe('ranking with the identity-age rule', () => {
  const viewer = 'viewer-pub';
  const beacon = 'beacon:2026-10-20:00';

  it('puts keys seen before today first among equals; distance still comes first', async () => {
    // Find a newcomer key whose hash order would rank it ahead of the established one.
    const established = pair();
    let newcomer = pair();
    while (nearbyRankTie(viewer, newcomer.pub, beacon) > nearbyRankTie(viewer, established.pub, beacon)) newcomer = pair();
    const oldCard = await card(established, { nowMs: DAY2 });
    const newCard = await card(newcomer, { nowMs: DAY2 });
    const farOld = await card(pair(), { point: LA, nowMs: DAY2 });

    const plain = new NearbyList({ pub: viewer, point: SD, scope: 'nearby', beacon }, { capacity: 10 });
    plain.merge([oldCard, newCard], DAY2);
    expect(plain.entries().map((entry) => entry.card.pub)).toEqual([newcomer.pub, established.pub]);

    const aged = new Set([established.pub, farOld.pub]);
    const list = new NearbyList({
      pub: viewer, point: SD, scope: 'nearby', beacon, isEstablished: (c) => aged.has(c.pub),
    }, { capacity: 10 });
    list.merge([farOld, newCard, oldCard], DAY2);
    expect(list.entries().map((entry) => entry.card.pub)).toEqual([established.pub, newcomer.pub, farOld.pub]);
  });

  it('falls back to the UTC date while no beacon for today is known', () => {
    expect(nearbyBeaconString(null, DAY2)).toBe('utc-day:2026-10-20');
    const yesterday = { version: 1, kind: 'nearby-beacon', day: '2026-10-19', value: 'a'.repeat(64), keyId: 'k', signature: 's' } as const;
    expect(nearbyBeaconString(yesterday, DAY2)).toBe('utc-day:2026-10-20');
    expect(nearbyBeaconString({ ...yesterday, day: '2026-10-20' }, DAY2)).toBe(`beacon:2026-10-20:${'a'.repeat(64)}`);
  });

  it('reads pinned attestor keys from the manifest extension', () => {
    const attestor = new NearbyAttestor({ dir: null });
    expect(nearbyV3AttestorKeysFromManifest({ extensions: { 'nearby-v3': { attestorKeys: [attestor.key, { keyId: 'x', publicKey: 'y' }] } } }))
      .toEqual([attestor.key]);
    expect(nearbyV3AttestorKeysFromManifest(null)).toEqual([]);
  });
});

describe('NearbyV3Service with the hub attestor', () => {
  function phone(input: {
    owner: SeaSigningPair;
    attestor: NearbyAttestor;
    now: () => number;
    link: NearbyV3Link;
    hubDown?: () => boolean;
    introductions?: () => NearbyCard[];
    pinned?: () => Array<{ keyId: string; publicKey: string }>;
  }) {
    const storage = new Map<string, string>();
    const service = new NearbyV3Service({
      config: () => NEARBY_V3_DEFAULTS,
      identity: () => ({ userId: `user-${input.owner.pub.slice(0, 6)}`, pair: input.owner }),
      position: () => ({ point: SD, traveler: false, scope: 'nearby' }),
      hub: {
        async heartbeat(signed) {
          if (input.hubDown?.()) throw new Error('hub unreachable');
          const [beacon, age] = await Promise.all([input.attestor.beacon(input.now()), input.attestor.ageProof(signed.pub, input.now())]);
          return { beacon, age, attestor: input.attestor.key };
        },
        async introductions() {
          if (input.hubDown?.()) throw new Error('hub unreachable');
          return input.introductions?.() ?? [];
        },
      },
      link: input.link,
      ...(input.pinned ? { pinnedAttestorKeys: input.pinned } : {}),
      storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
      now: input.now,
      random: () => 0,
      log: () => undefined,
    });
    return { service, storage };
  }

  it('learns the key, the beacon and its own age from the hub, and signs the age into its next card', async () => {
    let nowMs = DAY1;
    const attestor = new NearbyAttestor({ dir: null });
    const owner = pair();
    const { service, storage } = phone({ owner, attestor, now: () => nowMs, link: { request: async () => null } });
    await service.tick();
    // The first card went out before the hub answered; the next tick reissues it with the age.
    await service.tick();
    expect(service.card()?.age?.since).toBe('2026-10-19');
    const saved = JSON.parse(storage.get(NEARBY_V3_ATTESTATION_STORAGE_KEY)!);
    expect(saved.keys).toEqual([attestor.key]);
    expect(saved.beacon.day).toBe('2026-10-19');
    nowMs = DAY2;
    await service.tick();
    expect(service.card()?.age?.since).toBe('2026-10-19');
  });

  it('ignores a hub key the manifest does not pin', async () => {
    const attestor = new NearbyAttestor({ dir: null });
    const pinned = new NearbyAttestor({ dir: null });
    const { service, storage } = phone({
      owner: pair(), attestor, now: () => DAY1, link: { request: async () => null }, pinned: () => [pinned.key],
    });
    await service.tick();
    await service.tick();
    expect(service.card()?.age).toBeUndefined();
    expect(storage.get(NEARBY_V3_ATTESTATION_STORAGE_KEY)).toBeUndefined();
  });

  it('ranks a key ground today behind an established one, and answers swaps with the beacon', async () => {
    let nowMs = DAY1;
    const attestor = new NearbyAttestor({ dir: null });
    const viewerPair = pair();
    const oldPair = pair();
    // Yesterday the hub saw the established key.
    const oldAge = await attestor.ageProof(oldPair.pub, DAY1);
    nowMs = DAY2;
    const beacon = nearbyBeaconString(await attestor.beacon(DAY2), DAY2);
    // An attacker grinds a key that today's order ranks first for the viewer.
    let ground = pair();
    while (nearbyRankTie(viewerPair.pub, ground.pub, beacon) > nearbyRankTie(viewerPair.pub, oldPair.pub, beacon)) ground = pair();
    const groundAge = await attestor.ageProof(ground.pub, DAY2);
    const cards = [await card(ground, { age: groundAge, nowMs }), await card(oldPair, { age: oldAge, nowMs })];

    const phones = new Map<string, NearbyV3Service>();
    const link: NearbyV3Link = {
      async request(to, message) {
        const target = phones.get(to.pub);
        // The other two are alive but busy: a swap must not drop them.
        if (!target) return { kind: 'nearby-gossip-busy', version: 1, retryAfterMs: 1_000 };
        const from = (message as { card?: NearbyCard }).card?.pub ?? '';
        return target.handleMessage(from, JSON.parse(JSON.stringify(message)));
      },
    };
    const viewer = phone({ owner: viewerPair, attestor, now: () => nowMs, link, introductions: () => cards });
    phones.set(viewerPair.pub, viewer.service);
    await viewer.service.tick();
    await viewer.service.tick();
    expect(viewer.service.entries().map((entry) => entry.card.pub)).toEqual([oldPair.pub, ground.pub]);

    // The reply to a swap carries today's beacon.
    const asker = pair();
    const reply = parseNearbyGossipMessage(await viewer.service.handleMessage(asker.pub, {
      kind: 'nearby-gossip-request',
      version: 1,
      card: await card(asker, { nowMs }),
      digest: { version: 1, at: nowMs, entries: '' },
    }));
    expect(reply?.kind === 'nearby-gossip-reply' ? reply.beacon?.day : null).toBe('2026-10-20');
  });

  it('a phone that cannot reach the hub today takes today\'s beacon from a swap', async () => {
    let nowMs = DAY1;
    let down = false;
    const attestor = new NearbyAttestor({ dir: null });
    const offlinePair = pair();
    const offline = phone({ owner: offlinePair, attestor, now: () => nowMs, link: { request: async () => null }, hubDown: () => down });
    await offline.service.tick();
    await offline.service.tick();
    nowMs = DAY2;
    down = true;
    const partner = pair();
    await offline.service.handleMessage(partner.pub, {
      kind: 'nearby-gossip-request',
      version: 1,
      card: await card(partner, { nowMs }),
      digest: { version: 1, at: nowMs, entries: '' },
      beacon: await attestor.beacon(DAY2),
    });
    const saved = JSON.parse(offline.storage.get(NEARBY_V3_ATTESTATION_STORAGE_KEY)!);
    expect(saved.beacon.day).toBe('2026-10-20');
    // A forged beacon is not taken.
    const forged = new NearbyAttestor({ dir: null });
    nowMs = DAY2 + 86_400_000;
    await offline.service.handleMessage(partner.pub, {
      kind: 'nearby-gossip-request',
      version: 1,
      card: await card(partner, { nowMs }),
      digest: { version: 1, at: nowMs, entries: '' },
      beacon: { ...(await forged.beacon(nowMs)), keyId: attestor.key.keyId },
    });
    expect(JSON.parse(offline.storage.get(NEARBY_V3_ATTESTATION_STORAGE_KEY)!).beacon.day).toBe('2026-10-20');
  });
});
