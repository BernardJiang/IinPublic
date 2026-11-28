import {
  AttachmentShareEffects,
  type AttachmentShareEffectsPorts,
  type MailboxAttachmentSharePayload,
} from '../../core/attachment-share-effects';
import {
  attachmentShareMessageId,
  attachmentSharePayload,
  formatAttachmentShareMessageText,
} from '../../core/attachment-share';
import type { IpfsAttachment } from '../../shared/types';

const attachment = (cid: string): IpfsAttachment => ({
  cid,
  name: `${cid}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 12,
  enc: 'sea-pair',
});

const inboxPayload = (overrides: Partial<MailboxAttachmentSharePayload> = {}): MailboxAttachmentSharePayload => {
  const share = attachmentSharePayload({
    conversationId: 'conversation-1',
    talkId: 'talk-1',
    authorId: 'sender-1',
    attachment: attachment('cid-inbox'),
  }, 'encrypted-key', '2026-11-27T12:00:00.000Z');
  return {
    kind: 'ipfs-conversation-share-v1',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderId: 'sender-1',
    senderName: 'Sender',
    recipientId: 'recipient-1',
    recipientName: 'Recipient',
    text: formatAttachmentShareMessageText(share),
    timestamp: '2026-11-27T12:00:00.000Z',
    ...overrides,
  };
};

function createPorts(overrides: Partial<AttachmentShareEffectsPorts> = {}) {
  const processed = new Set<string>();
  const fetched = new Map<string, Uint8Array>();
  const ports: AttachmentShareEffectsPorts = {
    currentUser: jest.fn(() => ({ id: 'author-1', stageName: 'Author' })),
    isBlockedEitherWay: jest.fn(async () => false),
    hasProcessed: jest.fn((messageId) => processed.has(messageId)),
    markProcessed: jest.fn((messageId) => { processed.add(messageId); }),
    persistProcessed: jest.fn(),
    buildPayload: jest.fn(async (params) => attachmentSharePayload(
      params,
      `cipher:${params.attachment.cid}`,
      params.sharedAt,
    )),
    sendConversationMessage: jest.fn(async () => undefined),
    postMailbox: jest.fn(async () => undefined),
    ingestConversationMessage: jest.fn(async () => undefined),
    hasFetched: jest.fn((cid) => fetched.has(cid)),
    canDecryptAttachments: jest.fn(() => true),
    resolveSenderEpub: jest.fn(async () => 'sender-epub'),
    verifyKeyCiphertext: jest.fn(async () => true),
    requestAttachment: jest.fn(async () => undefined),
    fetchAttachmentBytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
    storeFetched: jest.fn((cid, bytes) => { fetched.set(cid, bytes); }),
    attachmentFetched: jest.fn(),
    sleep: jest.fn(async () => undefined),
    now: jest.fn(() => new Date('2026-11-27T12:00:00.000Z')),
    onFailure: jest.fn(),
    ...overrides,
  };
  return { ports, processed, fetched };
}

describe('AttachmentShareEffects', () => {
  it('applies the author, empty-list and block gates before host effects', async () => {
    const wrongAuthor = createPorts();
    const wrongAuthorEffects = new AttachmentShareEffects(wrongAuthor.ports);
    await expect(wrongAuthorEffects.autoShareMatchedTalkAttachments({
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'someone-else',
      responderId: 'recipient-1',
      responderName: 'Recipient',
      attachments: [attachment('cid-1')],
    })).resolves.toBe(0);
    expect(wrongAuthor.ports.isBlockedEitherWay).not.toHaveBeenCalled();

    const empty = createPorts();
    await new AttachmentShareEffects(empty.ports).autoShareMatchedTalkAttachments({
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'author-1',
      responderId: 'recipient-1',
      responderName: 'Recipient',
      attachments: [],
    });
    expect(empty.ports.isBlockedEitherWay).not.toHaveBeenCalled();

    const blocked = createPorts({ isBlockedEitherWay: jest.fn(async () => true) });
    await new AttachmentShareEffects(blocked.ports).autoShareMatchedTalkAttachments({
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'author-1',
      responderId: 'recipient-1',
      responderName: 'Recipient',
      attachments: [attachment('cid-1')],
    });
    expect(blocked.ports.buildPayload).not.toHaveBeenCalled();
    expect(blocked.ports.persistProcessed).not.toHaveBeenCalled();
  });

  it('deduplicates stable ids, isolates attachment failures and marks only after both sends', async () => {
    const order: string[] = [];
    const { ports, processed } = createPorts({
      sendConversationMessage: jest.fn(async ({ messageId }) => {
        order.push(`conversation:${messageId}`);
        if (order.filter((entry) => entry.startsWith('conversation:')).length === 1) {
          throw new Error('first new attachment failed');
        }
      }),
      postMailbox: jest.fn(async ({ messageId }) => { order.push(`mailbox:${messageId}`); }),
      markProcessed: jest.fn((messageId) => {
        order.push(`mark:${messageId}`);
        processed.add(messageId);
      }),
    });
    const skippedId = await attachmentShareMessageId('conversation-1', 'talk-1', 'author-1', 'cid-skip');
    const successfulId = await attachmentShareMessageId('conversation-1', 'talk-1', 'author-1', 'cid-ok');
    processed.add(skippedId);

    const sent = await new AttachmentShareEffects(ports).autoShareMatchedTalkAttachments({
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'author-1',
      responderId: 'recipient-1',
      responderName: 'Recipient',
      attachments: [attachment('cid-skip'), attachment('cid-fail'), attachment('cid-ok')],
    });

    expect(sent).toBe(1);
    expect(ports.buildPayload).toHaveBeenCalledTimes(2);
    expect(order.slice(-3)).toEqual([
      `conversation:${successfulId}`,
      `mailbox:${successfulId}`,
      `mark:${successfulId}`,
    ]);
    expect(ports.postMailbox).toHaveBeenCalledTimes(1);
    expect(ports.persistProcessed).toHaveBeenCalledTimes(1);
    expect(ports.onFailure).toHaveBeenCalledWith('auto-share', expect.any(Error));
    expect(processed.has(successfulId)).toBe(true);

    const mailbox = (ports.postMailbox as jest.Mock).mock.calls[0]![0] as MailboxAttachmentSharePayload;
    expect(mailbox).toMatchObject({
      senderId: 'author-1',
      senderName: 'Author',
      recipientId: 'recipient-1',
      recipientName: 'Recipient',
      timestamp: '2026-11-27T12:00:00.000Z',
    });
  });

  it('suppresses an overlapping send before durable idempotency is written', async () => {
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    const { ports } = createPorts({
      sendConversationMessage: jest.fn(() => sendGate),
    });
    const effects = new AttachmentShareEffects(ports);
    const params = {
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'author-1',
      responderId: 'recipient-1',
      responderName: 'Recipient',
      attachments: [attachment('cid-race')],
    };

    const first = effects.autoShareMatchedTalkAttachments(params);
    while ((ports.sendConversationMessage as jest.Mock).mock.calls.length === 0) {
      await Promise.resolve();
    }
    await expect(effects.autoShareMatchedTalkAttachments(params)).resolves.toBe(0);
    expect(ports.sendConversationMessage).toHaveBeenCalledTimes(1);

    releaseSend();
    await expect(first).resolves.toBe(1);
  });

  it('rejects duplicate and blocked inbox shares before ingest', async () => {
    const duplicate = createPorts();
    duplicate.processed.add('message-1');
    await expect(new AttachmentShareEffects(duplicate.ports)
      .ingestAttachmentShareFromMailbox(inboxPayload())).resolves.toBe(false);
    expect(duplicate.ports.isBlockedEitherWay).not.toHaveBeenCalled();
    expect(duplicate.ports.ingestConversationMessage).not.toHaveBeenCalled();

    const blocked = createPorts({
      currentUser: jest.fn(() => ({ id: 'recipient-1', stageName: 'Recipient' })),
      isBlockedEitherWay: jest.fn(async () => true),
    });
    await expect(new AttachmentShareEffects(blocked.ports)
      .ingestAttachmentShareFromMailbox(inboxPayload())).resolves.toBe(false);
    expect(blocked.ports.ingestConversationMessage).not.toHaveBeenCalled();
    expect(blocked.ports.markProcessed).not.toHaveBeenCalled();
  });

  it('ingests before scheduling fetch, then marks and persists the mailbox share', async () => {
    const order: string[] = [];
    const { ports } = createPorts({
      currentUser: jest.fn(() => ({ id: 'recipient-1', stageName: 'Recipient' })),
      ingestConversationMessage: jest.fn(async () => { order.push('ingest'); }),
      fetchAttachmentBytes: jest.fn(async () => {
        order.push('fetch');
        return new Uint8Array([1]);
      }),
      markProcessed: jest.fn(() => { order.push('mark'); }),
      persistProcessed: jest.fn(() => { order.push('persist'); }),
    });

    await expect(new AttachmentShareEffects(ports)
      .ingestAttachmentShareFromMailbox(inboxPayload())).resolves.toBe(true);

    expect(order.slice(0, 3)).toEqual(['ingest', 'mark', 'persist']);
    while ((ports.fetchAttachmentBytes as jest.Mock).mock.calls.length === 0) await Promise.resolve();
    expect(ports.fetchAttachmentBytes).toHaveBeenCalledWith(
      expect.objectContaining({ cid: 'cid-inbox' }),
      'sender-epub',
    );
  });

  it('does not consume a mailbox share when conversation ingest fails', async () => {
    const { ports } = createPorts({
      currentUser: jest.fn(() => ({ id: 'recipient-1', stageName: 'Recipient' })),
      ingestConversationMessage: jest.fn(async () => { throw new Error('graph unavailable'); }),
    });

    await expect(new AttachmentShareEffects(ports)
      .ingestAttachmentShareFromMailbox(inboxPayload())).rejects.toThrow('graph unavailable');
    expect(ports.fetchAttachmentBytes).not.toHaveBeenCalled();
    expect(ports.markProcessed).not.toHaveBeenCalled();
    expect(ports.persistProcessed).not.toHaveBeenCalled();
  });

  it('owns attachment retry/backoff and publishes fetched bytes once', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const { ports, fetched } = createPorts({
      fetchAttachmentBytes: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(bytes),
    });
    const share = attachmentSharePayload({
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'sender-1',
      attachment: attachment('cid-retry'),
    }, 'encrypted-key', '2026-11-27T12:00:00.000Z');

    await expect(new AttachmentShareEffects(ports)
      .fetchSharedAttachmentBytes(share, 'sender-1', 3)).resolves.toBe('fetched');

    expect(ports.requestAttachment).toHaveBeenCalledTimes(2);
    expect(ports.fetchAttachmentBytes).toHaveBeenCalledTimes(2);
    expect(ports.sleep).toHaveBeenCalledWith(1_500);
    expect(fetched.get('cid-retry')).toEqual(bytes);
    expect(ports.attachmentFetched).toHaveBeenCalledTimes(1);
  });

  it('enforces the receive block and key gates before requesting attachment bytes', async () => {
    const share = attachmentSharePayload({
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'sender-1',
      attachment: attachment('cid-blocked'),
    }, 'encrypted-key', '2026-11-27T12:00:00.000Z');
    const blocked = createPorts({ isBlockedEitherWay: jest.fn(async () => true) });
    await expect(new AttachmentShareEffects(blocked.ports)
      .fetchSharedAttachmentBytes(share, 'sender-1')).resolves.toBe('blocked');
    expect(blocked.ports.resolveSenderEpub).not.toHaveBeenCalled();

    const noKey = createPorts({ canDecryptAttachments: jest.fn(() => false) });
    await expect(new AttachmentShareEffects(noKey.ports)
      .fetchSharedAttachmentBytes(share, 'sender-1')).resolves.toBe('no-key');
    expect(noKey.ports.requestAttachment).not.toHaveBeenCalled();
  });

  it('deduplicates and isolates retraction messages with stable ids', async () => {
    const { ports, processed } = createPorts({
      sendConversationMessage: jest.fn()
        .mockRejectedValueOnce(new Error('first retraction failed'))
        .mockResolvedValue(undefined),
    });
    const effects = new AttachmentShareEffects(ports);
    const params = {
      conversationId: 'conversation-1',
      talkId: 'talk-1',
      authorId: 'author-1',
      conversationPeerId: 'recipient-1',
      attachments: [attachment('cid-fail'), attachment('cid-ok')],
      retractedAt: 1234,
    };

    await expect(effects.markSharedAttachmentLinksDead(params)).resolves.toBe(1);
    expect(ports.onFailure).toHaveBeenCalledWith('retraction', expect.any(Error));
    expect(ports.persistProcessed).toHaveBeenCalledTimes(1);
    expect(processed.size).toBe(1);
    const sent = (ports.sendConversationMessage as jest.Mock).mock.calls[1]![0];
    expect(sent.text).toContain('IPFS_SHARE_RETRACTED:');
    expect(sent.text).toContain('cid-ok');

    await expect(effects.markSharedAttachmentLinksDead({
      ...params,
      attachments: [attachment('cid-ok')],
    })).resolves.toBe(0);
    expect(ports.sendConversationMessage).toHaveBeenCalledTimes(2);
  });
});
