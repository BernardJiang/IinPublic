/**
 * Found on real phones 2026-10-18 (native-app/39 measurement run): after a mesh reconnect, a pair
 * stayed "connected" with an open DataChannel but could never exchange a frame. The previous
 * channel's handshake was still waiting on the contact-key lookup when the reconnect reset the
 * encrypted session; it then finished, derived a key from the OLD remote offer and the NEW local
 * one, and the real new handshake was ignored (`if (this.secureSessionKey) return`). The two
 * phones held different session ids, no secure-confirm ever matched, every mesh send timed out,
 * and the mesh flagged the neighbor reconnected every second for minutes.
 *
 * These tests drive two real sessions (real SEA keys, real handshake crypto) over an in-memory
 * DataChannel whose delivery the test controls.
 */
import SEA from 'gun/sea';
import {
  P2PConversationSession,
  setP2PContactIdentityResolver,
} from '../../web/services/p2p-webrtc-session';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

type Handler = ((event?: { data: string }) => void) | null;

/** One end of an in-memory DataChannel; messages queue until the test flushes them. */
class FakeChannel {
  readyState: 'open' | 'closed' = 'open';
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  peer: FakeChannel | null = null;
  readonly outbox: string[] = [];
  send(data: string): void { this.outbox.push(data); }
  close(): void { this.readyState = 'closed'; }
  /** Deliver everything this end has sent so far to the other end. */
  flush(): number {
    const pending = this.outbox.splice(0);
    for (const data of pending) this.peer?.onmessage?.({ data });
    return pending.length;
  }
}

function channelPair(): [FakeChannel, FakeChannel] {
  const a = new FakeChannel();
  const b = new FakeChannel();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Internals = {
  dc: FakeChannel | null;
  secureSessionId: string | null;
  secureSessionConfirmed: boolean;
  connectPromise: Promise<void> | null;
  attachDataChannel(channel: FakeChannel): void;
  resetSecureSession(): void;
  failSecureHandshake(reason: string): void;
  getState(): string;
};
const internals = (session: P2PConversationSession) => session as unknown as Internals;

async function settle(rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Open a fresh channel on both sides, as a new RTCPeerConnection would. */
function openChannel(a: P2PConversationSession, b: P2PConversationSession): [FakeChannel, FakeChannel] {
  const [ca, cb] = channelPair();
  for (const [session, channel] of [[a, ca], [b, cb]] as const) {
    internals(session).dc = channel;
    internals(session).attachDataChannel(channel);
  }
  ca.onopen?.();
  cb.onopen?.();
  return [ca, cb];
}

async function pump(ca: FakeChannel, cb: FakeChannel, rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await settle(5);
    ca.flush();
    cb.flush();
  }
  await settle();
}

describe('P2P session encrypted handshake across a reconnect', () => {
  let alicePair: SeaSigningPair;
  let bobPair: SeaSigningPair;

  beforeAll(async () => {
    alicePair = await SEA.pair() as SeaSigningPair;
    bobPair = await SEA.pair() as SeaSigningPair;
  });

  afterEach(() => setP2PContactIdentityResolver(null));

  function sessions(): [P2PConversationSession, P2PConversationSession] {
    const common = { apiBase: 'http://127.0.0.1:1', conversationId: 'mesh:race-test', gun: undefined } as any;
    const alice = new P2PConversationSession({
      ...common,
      localUserId: 'alice',
      localPub: alicePair.pub,
      localPair: alicePair,
      otherUserId: 'bob',
      otherPub: bobPair.pub,
      isInitiator: true,
    });
    const bob = new P2PConversationSession({
      ...common,
      localUserId: 'bob',
      localPub: bobPair.pub,
      localPair: bobPair,
      otherUserId: 'alice',
      otherPub: alicePair.pub,
      isInitiator: false,
    });
    return [alice, bob];
  }

  it('agrees on one session on a fresh channel', async () => {
    const [alice, bob] = sessions();
    const [ca, cb] = openChannel(alice, bob);
    await pump(ca, cb);
    expect(internals(alice).secureSessionId).toBeTruthy();
    expect(internals(alice).secureSessionId).toBe(internals(bob).secureSessionId);
    expect(internals(alice).secureSessionConfirmed).toBe(true);
    expect(internals(bob).secureSessionConfirmed).toBe(true);
  });

  it('drops a handshake from the previous channel that finishes after the reconnect', async () => {
    const [alice, bob] = sessions();
    // Alice's first contact-key lookup hangs, as a slow lookup on a phone does.
    let releaseFirstLookup: () => void = () => undefined;
    let lookups = 0;
    setP2PContactIdentityResolver((localUserId) => {
      if (localUserId !== 'alice') return undefined;
      lookups += 1;
      if (lookups > 1) return undefined;
      return new Promise<undefined>((resolve) => { releaseFirstLookup = () => resolve(undefined); });
    });

    // First channel: Bob's handshake reaches Alice and sits in the slow lookup.
    const [oldA, oldB] = openChannel(alice, bob);
    await pump(oldA, oldB, 5);
    expect(lookups).toBe(1);

    // Reconnect: both sides get a new channel (closeTransport + start reset the secure session).
    oldA.close();
    oldB.close();
    internals(alice).resetSecureSession();
    internals(bob).resetSecureSession();
    const [newA, newB] = openChannel(alice, bob);
    await settle();
    newA.flush(); // Alice's new handshake reaches Bob.
    await settle();
    // The old lookup finishes before Bob's new handshake reaches Alice.
    releaseFirstLookup();
    await settle();
    await pump(newA, newB);

    expect(internals(alice).secureSessionId).toBeTruthy();
    expect(internals(alice).secureSessionId).toBe(internals(bob).secureSessionId);
    expect(internals(alice).secureSessionConfirmed).toBe(true);
    expect(internals(bob).secureSessionConfirmed).toBe(true);
  });

  it.each(['changed pin', 'unavailable private store'])('rejects a handshake with %s', async (reason) => {
    setP2PContactIdentityResolver((localUserId) => {
      if (localUserId !== 'alice') return undefined;
      if (reason === 'unavailable private store') throw new Error('private store unavailable');
      return 'a-different-pinned-key';
    });
    const [alice, bob] = sessions();
    const [ca, cb] = openChannel(alice, bob);
    await pump(ca, cb);
    expect(alice.getState()).toBe('failed');
    expect(internals(alice).secureSessionConfirmed).toBe(false);
    alice.dispose();
    bob.dispose();
  });

  it('fails the session when the handshake is never confirmed, so it is rebuilt', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      const [alice, bob] = sessions();
      openChannel(alice, bob); // Nothing is ever delivered: no handshake can complete.
      await settle();
      expect(internals(alice).getState()).toBe('connected');
      jest.advanceTimersByTime(20_000);
      await settle();
      expect(internals(alice).getState()).toBe('failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed session never hands back its old connect promise', async () => {
    const [alice] = sessions();
    internals(alice).connectPromise = Promise.resolve();
    internals(alice).failSecureHandshake('test');
    expect(internals(alice).connectPromise).toBeNull();
  });
});
