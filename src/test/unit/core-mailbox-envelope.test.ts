/** OPEN-91 P4: what a decrypted mailbox envelope holds. */
import { classifyMailboxPayload, mailboxSenderId } from '../../core/mailbox-envelope';
import { BLOCK_SIGNAL_PAYLOAD_KIND } from '../../shared/block-signal';
import { TALK_WAKE_PAYLOAD_KIND } from '../../shared/talk-wake';

describe('mailbox envelopes', () => {
  it('names each kind; Talk payloads are told apart by their fields', () => {
    expect(classifyMailboxPayload({ kind: TALK_WAKE_PAYLOAD_KIND })).toBe('wake');
    expect(classifyMailboxPayload({ kind: 'conversation-message-v1' })).toBe('conversation-message');
    expect(classifyMailboxPayload({ kind: 'ipfs-conversation-share-v1' })).toBe('attachment-share');
    expect(classifyMailboxPayload({ kind: 'support-question-v1' })).toBe('support-question');
    expect(classifyMailboxPayload({ kind: BLOCK_SIGNAL_PAYLOAD_KIND })).toBe('block-signal');
    expect(classifyMailboxPayload({ talkData: {} })).toBe('talk-body');
    expect(classifyMailboxPayload({ retractedAt: 5 })).toBe('talk-retraction');
    expect(classifyMailboxPayload({ responseId: 'r' })).toBe('talk-response');
  });

  it('finds the sender in any kind', () => {
    expect(mailboxSenderId({ senderId: ' ann ' })).toBe('ann');
    expect(mailboxSenderId({ responderId: 'bob' })).toBe('bob');
    expect(mailboxSenderId({ authorId: 'cy' })).toBe('cy');
    expect(mailboxSenderId({})).toBe('');
  });
});
