/** OPEN-91 P4: what a decrypted mailbox envelope holds. */
import {
  classifyMailboxPayload,
  dispatchMailboxPayload,
  mailboxSenderId,
  type MailboxPayloadHandlers,
} from '../../core/mailbox-envelope';
import { BLOCK_SIGNAL_PAYLOAD_KIND } from '../../shared/block-signal';
import { TALK_WAKE_PAYLOAD_KIND } from '../../shared/talk-wake';

describe('mailbox envelopes', () => {
  function handlers(overrides: Partial<MailboxPayloadHandlers> = {}): MailboxPayloadHandlers {
    return {
      ingestConversationMessage: jest.fn(async () => undefined),
      ingestAttachmentShare: jest.fn(async () => undefined),
      ingestSupportQuestion: jest.fn(async () => true),
      ingestBlockSignal: jest.fn(async () => undefined),
      ...overrides,
    };
  }

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

  it.each([
    ['conversation-message-v1', 'ingestConversationMessage'],
    ['ipfs-conversation-share-v1', 'ingestAttachmentShare'],
    [BLOCK_SIGNAL_PAYLOAD_KIND, 'ingestBlockSignal'],
  ] as const)('routes %s through its host capability before acknowledging', async (kind, handlerName) => {
    const ports = handlers();
    const payload = { kind };

    await expect(dispatchMailboxPayload(payload, ports)).resolves.toBe('acknowledge');

    expect(ports[handlerName]).toHaveBeenCalledWith(payload);
  });

  it('retains a support question until the host confirms durable ingestion', async () => {
    const rejectedPorts = handlers({ ingestSupportQuestion: jest.fn(async () => false) });
    const acceptedPorts = handlers({ ingestSupportQuestion: jest.fn(async () => true) });
    const payload = { kind: 'support-question-v1', questionKey: 'q1' };

    await expect(dispatchMailboxPayload(payload, rejectedPorts)).resolves.toBe('retain');
    await expect(dispatchMailboxPayload(payload, acceptedPorts)).resolves.toBe('acknowledge');
  });

  it.each([
    { kind: TALK_WAKE_PAYLOAD_KIND },
    { talkData: {} },
    { retractedAt: 5 },
    { responseId: 'old-response' },
  ])('acknowledges passive or retired payloads without a host effect: %p', async (payload) => {
    const ports = handlers();

    await expect(dispatchMailboxPayload(payload, ports)).resolves.toBe('acknowledge');

    expect(ports.ingestConversationMessage).not.toHaveBeenCalled();
    expect(ports.ingestAttachmentShare).not.toHaveBeenCalled();
    expect(ports.ingestSupportQuestion).not.toHaveBeenCalled();
    expect(ports.ingestBlockSignal).not.toHaveBeenCalled();
  });

  it('propagates handler failure so the host can retry the envelope', async () => {
    const error = new Error('storage unavailable');
    const ports = handlers({ ingestConversationMessage: jest.fn(async () => { throw error; }) });

    await expect(dispatchMailboxPayload({ kind: 'conversation-message-v1' }, ports)).rejects.toBe(error);
  });
});
