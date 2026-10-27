/**
 * Found on real phones 2026-10-27 (native-app/37 on P30 + PH-1, 1.0.197): Alice's DM reached Bob
 * over WebRTC, but Bob never showed it. The receiver dropped every DM until the ledger handshake
 * finished, and a phone builds its ledger delta from the device core one record at a time, so the
 * DM arrived first and was lost. A delta that failed left the link waiting for good.
 */
import { P2PConversationSession } from '../../web/services/p2p-webrtc-session';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Internals = {
  ledgerReady: boolean;
  ledgerLocalSent: boolean;
  messages: Array<{ id: string; text: string }>;
  receiveDm(message: Record<string, unknown>): Promise<void>;
  handleLedgerState(feeds: Record<string, number>): Promise<void>;
  markLedgerReady(): void;
};

function bobSession(hooks: Record<string, unknown>): Internals {
  const session = new P2PConversationSession({
    apiBase: 'http://127.0.0.1:1',
    conversationId: 'conv_pair_alice_bob',
    gun: undefined,
    localUserId: 'bob',
    localPub: 'bob-pub',
    otherUserId: 'alice',
    otherPub: 'alice-pub',
    isInitiator: false,
    getLedgerState: () => ({ bob: 40 }),
    ...hooks,
  } as any);
  return session as unknown as Internals;
}

const dm = { id: 'msg_1', senderId: 'alice', text: 'hello from Alice', timestamp: '2026-10-27T00:00:00.000Z', channel: 'public' };

describe('a DM that arrives during the ledger handshake', () => {
  it('is kept: taken once the handshake finishes', async () => {
    const bob = bobSession({});
    const received = bob.receiveDm(dm);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(bob.messages).toHaveLength(0);
    bob.markLedgerReady();
    await received;
    expect(bob.messages.map((m) => m.text)).toEqual(['hello from Alice']);
  });

  it('is kept when the handshake never finishes (after the same wait the sender gives it)', async () => {
    const bob = bobSession({});
    await bob.receiveDm(dm);
    expect(bob.messages.map((m) => m.id)).toEqual(['msg_1']);
    expect(bob.ledgerReady).toBe(true);
  });

  it('a failed ledger delta still finishes the handshake', async () => {
    const bob = bobSession({ getLedgerDelta: async () => { throw new Error('core unreachable'); } });
    bob.ledgerLocalSent = true;
    await expect(bob.handleLedgerState({ alice: 3 })).rejects.toThrow('core unreachable');
    expect(bob.ledgerReady).toBe(true);
  });
});
