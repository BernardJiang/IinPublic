import SEA from 'gun/sea';
import {
  CONVERSATION_WAKEUP_TTL_MS,
  createConversationWakeup,
  verifyConversationWakeup,
} from '../../shared/conversation-wakeup';

describe('conversation wake-up control records', () => {
  test('binds the encrypted wake-up to its sender and intended recipient', async () => {
    const sender = await SEA.pair();
    const recipient = await SEA.pair();
    const now = new Date('2026-10-09T12:00:00.000Z');
    const record = await createConversationWakeup({
      conversationId: 'conv_pair_alice_bob',
      senderUserId: 'alice',
      recipientUserId: 'bob',
      recipientPub: recipient.pub,
      ciphertext: 'SEA{encrypted-metadata}',
      pair: sender,
      now,
    });

    await expect(verifyConversationWakeup(record, {
      recipientUserId: 'bob',
      recipientPub: recipient.pub,
      now: new Date(now.getTime() + 1_000),
    })).resolves.toMatchObject({ ok: true });
    await expect(verifyConversationWakeup(record, {
      recipientUserId: 'mallory',
      recipientPub: recipient.pub,
      now,
    })).resolves.toEqual({ ok: false, reason: 'wrong conversation wake-up recipient' });
  });

  test('rejects tampering and expiry', async () => {
    const sender = await SEA.pair();
    const recipient = await SEA.pair();
    const now = new Date('2026-10-09T12:00:00.000Z');
    const record = await createConversationWakeup({
      conversationId: 'conv_pair_alice_bob',
      senderUserId: 'alice',
      recipientUserId: 'bob',
      recipientPub: recipient.pub,
      ciphertext: 'SEA{encrypted-metadata}',
      pair: sender,
      now,
    });

    await expect(verifyConversationWakeup({ ...record, ciphertext: 'changed' }, {
      recipientUserId: 'bob', recipientPub: recipient.pub, now,
    })).resolves.toMatchObject({ ok: false });
    await expect(verifyConversationWakeup(record, {
      recipientUserId: 'bob',
      recipientPub: recipient.pub,
      now: new Date(now.getTime() + CONVERSATION_WAKEUP_TTL_MS + 1),
    })).resolves.toEqual({ ok: false, reason: 'expired conversation wake-up' });
  });
});
