import { buildHandoffArchive, type HandoffArchive } from '../../shared/device-handoff';

const sea = {
  sign: jest.fn(async (data: string, pair: { pub: string }) => `signed:${pair.pub}:${data}`),
  verify: jest.fn(async (sig: string, pub: string) => {
    const prefix = `signed:${pub}:`;
    return sig.startsWith(prefix) ? sig.slice(prefix.length) : undefined;
  }),
  secret: jest.fn(async (peerEpub: string, pair: { epub: string }) => [pair.epub, peerEpub].sort().join('+')),
  encrypt: jest.fn(async (data: string, secret: string) => `enc:${secret}:${data}`),
  decrypt: jest.fn(async (ciphertext: string, secret: string) => {
    const prefix = `enc:${secret}:`;
    return ciphertext.startsWith(prefix) ? ciphertext.slice(prefix.length) : undefined;
  }),
};

jest.mock('../../web/sea-gun', () => ({
  getSEA: () => sea,
}));

import { WebDeviceHandoffService } from '../../web/services/web-device-handoff-service';

type Pair = { pub: string; priv: string; epub: string; epriv: string };

/** A shared in-memory Gun-like store so two service instances (sender + receiver) can
 * exchange records exactly like they would over the real shared graph. */
function sharedGunStore() {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn(async (path: string) => {
      if (!store.has(path)) throw new Error('not found');
      return store.get(path);
    }),
    put: jest.fn(async (path: string, data: unknown) => {
      store.set(path, data);
    }),
    raw: store,
  };
}

function gunServiceFor(pair: Pair, store: ReturnType<typeof sharedGunStore>) {
  return {
    getStoredPair: () => pair,
    get: store.get,
    put: store.put,
  };
}

const SENDER: Pair = { pub: 'sender.pub', priv: 'sender.priv', epub: 'sender.epub', epriv: 'sender.epriv' };
const RECEIVER: Pair = { pub: 'receiver.pub', priv: 'receiver.priv', epub: 'receiver.epub', epriv: 'receiver.epriv' };
const OTHER: Pair = { pub: 'other.pub', priv: 'other.priv', epub: 'other.epub', epriv: 'other.epriv' };

describe('WebDeviceHandoffService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishEpub writes a signed pub→epub record', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    await sender.publishEpub();
    expect(store.put).toHaveBeenCalledWith(
      'identity-epub/sender.pub',
      expect.objectContaining({ pub: SENDER.pub, epub: SENDER.epub, sig: expect.any(String) }),
    );
  });

  it('resolveEpub returns null when nothing has been published', async () => {
    const store = sharedGunStore();
    const receiver = new WebDeviceHandoffService(gunServiceFor(RECEIVER, store) as any);
    await expect(receiver.resolveEpub(SENDER.pub)).resolves.toBeNull();
  });

  it('resolveEpub rejects a record whose signature does not verify', async () => {
    const store = sharedGunStore();
    // Someone (not the sender) writes a bogus epub record to the sender's own path.
    store.raw.set('identity-epub/sender.pub', { pub: SENDER.pub, epub: 'attacker.epub', issuedAt: 1, sig: 'bogus' });
    const receiver = new WebDeviceHandoffService(gunServiceFor(RECEIVER, store) as any);
    await expect(receiver.resolveEpub(SENDER.pub)).resolves.toBeNull();
  });

  it('sendHandoffArchive returns no-epub when the receiver has not published one', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    const archive = buildHandoffArchive({ fromPub: SENDER.pub });
    await expect(sender.sendHandoffArchive(RECEIVER.pub, archive)).resolves.toBe('no-epub');
    expect(store.put).not.toHaveBeenCalledWith(expect.stringContaining('handoff/'), expect.anything());
  });

  it('full round trip: send → read → decrypt on the receiver', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    const receiver = new WebDeviceHandoffService(gunServiceFor(RECEIVER, store) as any);
    // Both sides publish their epub — the receiver needs the sender's to decrypt
    // (SEA.secret's ECDH result depends on both parties' epubs), same as the sender
    // needed the receiver's to encrypt.
    await sender.publishEpub();
    await receiver.publishEpub();

    const archive: HandoffArchive = buildHandoffArchive({
      fromPub: SENDER.pub,
      contacts: [{ id: 'c1', nickname: 'Alice' }],
      myTalks: { t1: { title: 'Selling a bike' } },
    });
    await expect(sender.sendHandoffArchive(RECEIVER.pub, archive)).resolves.toBe('sent');
    expect(store.put).toHaveBeenCalledWith(
      'handoff/receiver.pub/sender.pub',
      expect.objectContaining({ fromPub: SENDER.pub, toPub: RECEIVER.pub, ciphertext: expect.any(String) }),
    );

    const decrypted = await receiver.readIncomingHandoff(SENDER.pub);
    expect(decrypted).toEqual(archive);
  });

  it('a third party cannot decrypt an archive addressed to someone else', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    const receiver = new WebDeviceHandoffService(gunServiceFor(RECEIVER, store) as any);
    const eavesdropper = new WebDeviceHandoffService(gunServiceFor(OTHER, store) as any);
    await receiver.publishEpub();
    await eavesdropper.publishEpub();

    const archive = buildHandoffArchive({ fromPub: SENDER.pub, contacts: [{ id: 'c1' }] });
    await sender.sendHandoffArchive(RECEIVER.pub, archive);

    // The eavesdropper has no record at handoff/other.pub/sender.pub — nothing to read.
    await expect(eavesdropper.readIncomingHandoff(SENDER.pub)).resolves.toBeNull();
  });

  it('readIncomingHandoff rejects a record whose ciphertext was tampered with', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    const receiver = new WebDeviceHandoffService(gunServiceFor(RECEIVER, store) as any);
    await receiver.publishEpub();
    await sender.sendHandoffArchive(RECEIVER.pub, buildHandoffArchive({ fromPub: SENDER.pub }));

    const key = 'handoff/receiver.pub/sender.pub';
    const stored = store.raw.get(key) as any;
    store.raw.set(key, { ...stored, ciphertext: stored.ciphertext + 'tampered' });

    await expect(receiver.readIncomingHandoff(SENDER.pub)).resolves.toBeNull();
  });

  it('acknowledgeHandoff + waitForHandoffAck: sender observes the receiver\'s signed ack', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    const receiver = new WebDeviceHandoffService(gunServiceFor(RECEIVER, store) as any);

    await receiver.acknowledgeHandoff(SENDER.pub);
    await expect(sender.waitForHandoffAck(RECEIVER.pub, 5_000, 10)).resolves.toBe(true);
    expect(store.put).toHaveBeenCalledWith(
      'handoff-ack/sender.pub/receiver.pub',
      expect.objectContaining({ fromPub: RECEIVER.pub, toPub: SENDER.pub, sig: expect.any(String) }),
    );
  });

  it('waitForHandoffAck times out (returns false, never true) when no ack ever arrives', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    await expect(sender.waitForHandoffAck(RECEIVER.pub, 30, 10)).resolves.toBe(false);
  });

  it('the sender cannot forge its own ack — a self-written record fails verification', async () => {
    const store = sharedGunStore();
    const sender = new WebDeviceHandoffService(gunServiceFor(SENDER, store) as any);
    // The sender writes a record shaped like an ack, but signed by itself (SENDER), not
    // the receiver — waitForHandoffAck must not treat this as a real acknowledgement.
    store.raw.set('handoff-ack/sender.pub/receiver.pub', {
      fromPub: RECEIVER.pub,
      toPub: SENDER.pub,
      ackedAt: Date.now(),
      sig: `signed:${SENDER.pub}:handoff-ack|${RECEIVER.pub}|${SENDER.pub}|123`,
    });
    await expect(sender.waitForHandoffAck(RECEIVER.pub, 30, 10)).resolves.toBe(false);
  });
});
