import {
  drainMailboxEnvelopes,
  type MailboxDrainOptions,
  type MailboxDrainTransport,
  type MailboxEnvelopeRecord,
} from '../../core/mailbox-drain';
import type { MailboxPayloadHandlers } from '../../core/mailbox-envelope';

type TestKey = { priv: string };

function setup(
  payloadByEnvelope: Record<string, unknown>,
  overrides: Partial<MailboxDrainOptions<TestKey>> = {},
): MailboxDrainOptions<TestKey> & {
  transport: jest.Mocked<MailboxDrainTransport<TestKey>>;
  handlers: jest.Mocked<MailboxPayloadHandlers>;
} {
  const envelopes: MailboxEnvelopeRecord[] = Object.keys(payloadByEnvelope).map((id) => ({
    id,
    ciphertext: JSON.stringify({ senderEpub: ` epub-${id} `, ct: id }),
  }));
  const transport: jest.Mocked<MailboxDrainTransport<TestKey>> = {
    fetchEnvelopes: jest.fn(async (_recipientId: string) => envelopes),
    decryptEnvelope: jest.fn(async (ciphertext: string, _recipientKey: TestKey) => {
      const id = (JSON.parse(ciphertext) as { ct: string }).ct;
      return payloadByEnvelope[id];
    }),
    deleteEnvelope: jest.fn(async (_recipientId: string, _envelopeId: string) => true),
  };
  const handlers: jest.Mocked<MailboxPayloadHandlers> = {
    ingestConversationMessage: jest.fn(async (_payload: unknown) => undefined),
    ingestAttachmentShare: jest.fn(async (_payload: unknown) => undefined),
    ingestSupportQuestion: jest.fn(async (_payload: unknown) => true),
    ingestBlockSignal: jest.fn(async (_payload: unknown) => undefined),
  };
  return {
    recipientId: 'recipient-1',
    recipientKey: { priv: 'private-key' },
    transport,
    handlers,
    ...overrides,
  } as MailboxDrainOptions<TestKey> & {
    transport: jest.Mocked<MailboxDrainTransport<TestKey>>;
    handlers: jest.Mocked<MailboxPayloadHandlers>;
  };
}

describe('mailbox drain core', () => {
  it('decrypts, dispatches, remembers the authenticated sender key, then acknowledges', async () => {
    const rememberSenderKey = jest.fn();
    const onEvent = jest.fn();
    const options = setup({ e1: { kind: 'conversation-message-v1', senderId: ' sender-1 ' } }, {
      rememberSenderKey,
      onEvent,
    });

    await expect(drainMailboxEnvelopes(options)).resolves.toEqual({
      fetched: 1,
      acknowledged: 1,
      retained: 0,
      failed: 0,
    });

    expect(options.handlers.ingestConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: ' sender-1 ' }),
    );
    expect(rememberSenderKey).toHaveBeenCalledWith('sender-1', 'epub-e1');
    expect(options.transport.deleteEnvelope).toHaveBeenCalledWith('recipient-1', 'e1');
    expect(onEvent).toHaveBeenCalledWith({ type: 'acknowledged', envelopeId: 'e1' });
  });

  it('retains a support question when durable ingestion is not confirmed', async () => {
    const options = setup({ support: { kind: 'support-question-v1' } });
    options.handlers.ingestSupportQuestion.mockResolvedValue(false);

    await expect(drainMailboxEnvelopes(options)).resolves.toEqual({
      fetched: 1,
      acknowledged: 0,
      retained: 1,
      failed: 0,
    });

    expect(options.transport.deleteEnvelope).not.toHaveBeenCalled();
  });

  it('isolates a failed envelope and continues draining later work', async () => {
    const options = setup({ broken: { kind: 'conversation-message-v1' }, good: { kind: 'ipfs-conversation-share-v1' } });
    options.handlers.ingestConversationMessage.mockRejectedValue(new Error('local store unavailable'));

    await expect(drainMailboxEnvelopes(options)).resolves.toEqual({
      fetched: 2,
      acknowledged: 1,
      retained: 0,
      failed: 1,
    });

    expect(options.transport.deleteEnvelope).toHaveBeenCalledTimes(1);
    expect(options.transport.deleteEnvelope).toHaveBeenCalledWith('recipient-1', 'good');
  });

  it('reports a failed delete as retryable instead of claiming acknowledgement', async () => {
    const onEvent = jest.fn();
    const options = setup({ e1: { kind: 'conversation-message-v1' } }, { onEvent });
    options.transport.deleteEnvelope.mockResolvedValue(false);

    await expect(drainMailboxEnvelopes(options)).resolves.toEqual({
      fetched: 1,
      acknowledged: 0,
      retained: 0,
      failed: 1,
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'failed',
      envelopeId: 'e1',
      error: expect.any(Error),
    }));
  });

  it('does no host work for an empty mailbox', async () => {
    const options = setup({});

    await expect(drainMailboxEnvelopes(options)).resolves.toEqual({
      fetched: 0,
      acknowledged: 0,
      retained: 0,
      failed: 0,
    });

    expect(options.transport.decryptEnvelope).not.toHaveBeenCalled();
    expect(options.transport.deleteEnvelope).not.toHaveBeenCalled();
  });
});
