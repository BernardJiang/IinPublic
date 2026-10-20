/**
 * Found 2026-10-19 by phone-path J-PLACE-04: knocks went only to Gun's `p2p-signal`, which a phone's
 * embedded node never sends to the hub (it reaches the hub over HTTP). A newcomer in a Place whose
 * members did not have them on their lists could not open a single link. The hub now keeps knocks
 * in a mailbox each phone long-polls.
 */
import SEA from 'gun/sea';
import express from 'express';
import request from 'supertest';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { createNearbyKnock, nearbyKnockChannel, NEARBY_KNOCK_LIFETIME_MS } from '../../shared/nearby-v3-knock';
import { NearbyKnockMailbox, NEARBY_KNOCK_MAILBOX_PER_CHANNEL } from '../../server/services/nearby-knock-mailbox';
import { registerNearbyV3Routes, hubNearbyV3Config } from '../../server/routes/nearby-v3-routes';
import { NearbyV3Hub } from '../../server/services/nearby-v3-hub';

describe('Nearby knock mailbox', () => {
  let alice: SeaSigningPair;
  let bob: SeaSigningPair;
  beforeAll(async () => {
    alice = await SEA.pair() as SeaSigningPair;
    bob = await SEA.pair() as SeaSigningPair;
  });

  it('holds a verified knock for its recipient and wakes a waiting reader', async () => {
    const mailbox = new NearbyKnockMailbox();
    const channel = nearbyKnockChannel(alice.pub);
    const waiting = mailbox.read(channel, 0, 5_000);
    const knock = await createNearbyKnock({ fromUserId: 'bob', pair: bob, toPub: alice.pub, card: null });
    await mailbox.post(knock);
    const first = await waiting;
    expect(first.knocks).toEqual([knock]);
    // The cursor moves past it: the next read waits for a newer one.
    expect((await mailbox.read(channel, first.cursor, 0)).knocks).toEqual([]);
    // Nobody else's channel sees it.
    expect((await mailbox.read(nearbyKnockChannel(bob.pub), 0, 0)).knocks).toEqual([]);
  });

  it('refuses forged or stale knocks and keeps a bounded, short-lived mailbox', async () => {
    let nowMs = Date.now();
    const mailbox = new NearbyKnockMailbox(() => nowMs);
    const knock = await createNearbyKnock({ fromUserId: 'bob', pair: bob, toPub: alice.pub, card: null, now: new Date(nowMs) });
    await expect(mailbox.post({ ...knock, fromUserId: 'mallory' })).rejects.toThrow();
    await expect(mailbox.post(await createNearbyKnock({
      fromUserId: 'bob', pair: bob, toPub: alice.pub, card: null, now: new Date(nowMs - 2 * NEARBY_KNOCK_LIFETIME_MS),
    }))).rejects.toThrow();

    for (let i = 0; i < NEARBY_KNOCK_MAILBOX_PER_CHANNEL + 5; i += 1) {
      await mailbox.post(await createNearbyKnock({ fromUserId: 'bob', pair: bob, toPub: alice.pub, card: null, now: new Date(nowMs) }));
    }
    const channel = nearbyKnockChannel(alice.pub);
    expect((await mailbox.read(channel, 0, 0)).knocks).toHaveLength(NEARBY_KNOCK_MAILBOX_PER_CHANNEL);
    nowMs += NEARBY_KNOCK_LIFETIME_MS;
    expect((await mailbox.read(channel, 0, 0)).knocks).toEqual([]);
  });

  it('serves the mailbox over HTTP, and a phone node forwards it to the hub', async () => {
    const hubApp = express();
    hubApp.use(express.json());
    const mailbox = new NearbyKnockMailbox();
    registerNearbyV3Routes(hubApp, { hub: new NearbyV3Hub(hubNearbyV3Config()), knocks: mailbox, relay: async () => false });
    const knock = await createNearbyKnock({ fromUserId: 'bob', pair: bob, toPub: alice.pub, card: null });

    // A phone node: no state of its own, forwards both calls to the hub (long-poll timeout included).
    const forwarded: Array<{ path: string; timeoutMs: number | undefined }> = [];
    const phoneApp = express();
    phoneApp.use(express.json());
    registerNearbyV3Routes(phoneApp, {
      hub: new NearbyV3Hub(hubNearbyV3Config()),
      knocks: new NearbyKnockMailbox(),
      relay: async (res, path, method, body, timeoutMs) => {
        forwarded.push({ path, timeoutMs });
        const relayed = method === 'POST' ? await request(hubApp).post(path).send(body as object) : await request(hubApp).get(path);
        res.status(relayed.status).json(relayed.body);
        return true;
      },
    });

    expect((await request(phoneApp).post('/api/nearby/v3/knocks').send({ knock })).status).toBe(200);
    const read = await request(phoneApp).get(`/api/nearby/v3/knocks/${nearbyKnockChannel(alice.pub)}?after=0&waitMs=1000`);
    expect(read.status).toBe(200);
    expect(read.body.knocks).toEqual([knock]);
    expect(forwarded[1]).toEqual({ path: expect.stringContaining('waitMs=1000'), timeoutMs: 6_000 });
    expect((await request(hubApp).get('/api/nearby/v3/knocks/not-a-channel')).status).toBe(400);
  });
});
