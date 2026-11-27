/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import { BLOCK_SIGNAL_PAYLOAD_KIND } from '../../shared/block-signal';

function appWithoutConstructor(): any {
  const app = Object.create(IinPublicApp.prototype) as any;
  app.currentUser = { id: 'sender-1', stageName: 'Sender' };
  app.mailboxFallbackDisabledForE2e = false;
  app.uiManager = { showNotification: jest.fn() };
  app.uiText = jest.fn(() => 'Delivery failed');
  return app;
}

describe('IinPublicApp outbound mailbox adapters', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('routes attachment shares through the portable delivery service', async () => {
    const app = appWithoutConstructor();
    const deliver = jest.fn(async () => ({
      stored: true as const,
      envelopeId: 'mbx_share_message-1',
      recipientId: 'recipient-1',
      attempts: 1,
    }));
    app.mailboxDelivery = { deliver };
    const payload = {
      kind: 'ipfs-conversation-share-v1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      senderId: 'sender-1',
      senderName: 'Sender',
      recipientId: 'recipient-1',
      recipientName: 'Recipient',
      text: 'share',
      timestamp: '2026-11-27T00:00:00.000Z',
    };

    await app.postAttachmentShareToMailbox(payload);

    expect(deliver).toHaveBeenCalledWith({
      envelopeId: 'mbx_share_message-1',
      recipientId: 'recipient-1',
      payload,
      context: 'attachment-share',
    });
  });

  it('uses the throwing delivery adapter for block-signal failure isolation', async () => {
    const app = appWithoutConstructor();
    const deliverOrThrow = jest.fn(async () => ({
      stored: true as const,
      envelopeId: 'blocksig_signal-1_recipient-1',
      recipientId: 'recipient-1',
      attempts: 1,
    }));
    app.mailboxDelivery = { deliverOrThrow };
    const payload = {
      kind: BLOCK_SIGNAL_PAYLOAD_KIND,
      targetIdentity: 'blocked-user',
      at: '2026-11-27T00:00:00.000Z',
      signalId: 'signal-1',
    };

    await app.sendBlockSignalPayload(payload, 'recipient-1');

    expect(deliverOrThrow).toHaveBeenCalledWith({
      envelopeId: 'blocksig_signal-1_recipient-1',
      recipientId: 'recipient-1',
      payload,
      context: 'block-signal',
    });
  });

  it('passes DM retry policy and the session key hint to the portable service', async () => {
    const app = appWithoutConstructor();
    const deliver = jest.fn(async () => ({
      stored: true as const,
      envelopeId: 'mbx_dm_conversation-1_message-1',
      recipientId: 'recipient-1',
      attempts: 1,
    }));
    app.mailboxDelivery = { deliver };
    const wire = {
      id: 'message-1',
      senderId: 'sender-1',
      text: 'hello',
      timestamp: '2026-11-27T00:00:00.000Z',
    };

    await expect(app.postConversationMessageToMailbox(
      wire,
      'conversation-1',
      'recipient-1',
      'known-epub',
    )).resolves.toBe(true);

    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      envelopeId: 'mbx_dm_conversation-1_message-1',
      recipientId: 'recipient-1',
      knownRecipientEpub: 'known-epub',
      maxAttempts: 5,
      retryDelayMs: 3_000,
      context: 'conversation-message',
      payload: expect.objectContaining({
        kind: 'conversation-message-v1',
        conversationId: 'conversation-1',
        senderId: 'sender-1',
        senderName: 'Sender',
        wire,
      }),
    }));
  });

  it('surfaces an exhausted DM but stays quiet when custody is not ready', async () => {
    const app = appWithoutConstructor();
    const error = new Error('hub rejected envelope');
    const deliver = jest.fn()
      .mockResolvedValueOnce({
        stored: false,
        envelopeId: 'mbx_dm_c_m1',
        recipientId: 'recipient-1',
        attempts: 5,
        error,
      })
      .mockResolvedValueOnce({
        stored: false,
        envelopeId: 'mbx_dm_c_m2',
        recipientId: 'recipient-1',
        attempts: 0,
        error: new Error('sender key unavailable'),
      });
    app.mailboxDelivery = { deliver };
    const wire = { id: 'm1', senderId: 'sender-1', text: 'hello', timestamp: 'now' };

    await expect(app.postConversationMessageToMailbox(wire, 'c', 'recipient-1')).resolves.toBe(false);
    await expect(app.postConversationMessageToMailbox({ ...wire, id: 'm2' }, 'c', 'recipient-1')).resolves.toBe(false);

    expect(app.uiManager.showNotification).toHaveBeenCalledTimes(1);
    expect(app.uiManager.showNotification).toHaveBeenCalledWith('Delivery failed', 'error');
  });
});
