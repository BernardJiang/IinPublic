/**
 * OPEN-122: a DM counted as delivered once the data channel took the frame, so one sent into a link
 * whose far end had just closed never went to the mailbox. The receiver now acknowledges each DM on
 * arrival ('dm-ack'), and the sender waits for that (with a timeout) before calling it delivered.
 */
import { P2PConversationSession } from '../../web/services/p2p-webrtc-session';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Internals = {
  messages: Array<{ id: string }>;
  ledgerReady: boolean;
  receiveDm(message: Record<string, unknown>): Promise<void>;
  sendChannelFrame(frame: Record<string, unknown>): Promise<void>;
  noteDmAck(id: string): void;
  waitForDmAck(id: string, timeoutMs: number): Promise<boolean>;
};

function session(localUserId: string, otherUserId: string): Internals {
  return new P2PConversationSession({
    apiBase: 'http://127.0.0.1:1',
    conversationId: 'conv_pair_alice_bob',
    gun: undefined,
    localUserId,
    localPub: `${localUserId}-pub`,
    otherUserId,
    otherPub: `${otherUserId}-pub`,
    isInitiator: localUserId === 'alice',
  } as any) as unknown as Internals;
}

const dm = { id: 'msg_1', senderId: 'alice', text: 'hello', timestamp: '2026-11-27T00:00:00.000Z', channel: 'public' };

describe('DM acknowledgement', () => {
  it('the receiver acknowledges a DM as it arrives, and keeps it', async () => {
    const bob = session('bob', 'alice');
    bob.ledgerReady = true;
    const sent: Array<Record<string, unknown>> = [];
    bob.sendChannelFrame = async (frame) => { sent.push(frame); };
    await bob.receiveDm(dm);
    expect(bob.messages.map((m) => m.id)).toEqual(['msg_1']);
    expect(sent).toEqual([{ type: 'dm-ack', id: 'msg_1' }]);
  });

  it('the sender sees the ack, also one that came before it started waiting', async () => {
    const alice = session('alice', 'bob');
    const waiting = alice.waitForDmAck('msg_1', 5_000);
    alice.noteDmAck('msg_1');
    await expect(waiting).resolves.toBe(true);
    alice.noteDmAck('msg_2');
    await expect(alice.waitForDmAck('msg_2', 10)).resolves.toBe(true);
  });

  it('no ack within the time is reported as not acknowledged', async () => {
    const alice = session('alice', 'bob');
    await expect(alice.waitForDmAck('msg_3', 20)).resolves.toBe(false);
  });
});
