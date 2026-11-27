import {
  MailboxDeliveryService,
  mailboxEnvelopeId,
  type MailboxDeliveryEvent,
  type MailboxDeliveryPorts,
  type MailboxDeliveryTransport,
} from '../../core/mailbox-delivery';

type TestKey = { priv: string };

function setup(overrides: Partial<MailboxDeliveryPorts<TestKey>> = {}) {
  const events: MailboxDeliveryEvent[] = [];
  const transport: jest.Mocked<MailboxDeliveryTransport<TestKey>> = {
    encryptForRecipient: jest.fn(async (_epub: string, _key: TestKey, payload: unknown) => `encrypted:${String(payload)}`),
    postEnvelope: jest.fn(async (_params) => ({ stored: true })),
  };
  const ports: MailboxDeliveryPorts<TestKey> = {
    senderKey: () => ({ priv: 'sender-private-key' }),
    resolveRecipientEpub: jest.fn(async (recipientId: string, _knownEpub?: string) => `epub-${recipientId}`),
    transport: () => transport,
    sleep: jest.fn(async (_delayMs: number) => undefined),
    onEvent: (event) => events.push(event),
    ...overrides,
  };
  return { service: new MailboxDeliveryService(ports), ports, transport, events };
}

describe('mailbox delivery core', () => {
  it('resolves, encrypts and stores an envelope', async () => {
    const { service, ports, transport, events } = setup();

    await expect(service.deliver({
      envelopeId: 'envelope-1',
      recipientId: 'recipient-1',
      payload: 'secret payload',
      context: 'conversation',
    })).resolves.toEqual({
      stored: true,
      envelopeId: 'envelope-1',
      recipientId: 'recipient-1',
      attempts: 1,
    });

    expect(ports.resolveRecipientEpub).toHaveBeenCalledWith('recipient-1', undefined);
    expect(transport.encryptForRecipient).toHaveBeenCalledWith(
      'epub-recipient-1',
      { priv: 'sender-private-key' },
      'secret payload',
    );
    expect(transport.postEnvelope).toHaveBeenCalledWith({
      id: 'envelope-1',
      recipientId: 'recipient-1',
      ciphertext: 'encrypted:secret payload',
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'stored', context: 'conversation' }));
  });

  it('uses a supplied recipient key without consulting discovery', async () => {
    const { service, ports, transport } = setup();

    await service.deliver({
      envelopeId: 'known-key',
      recipientId: 'recipient-1',
      recipientEpub: 'known-epub',
      payload: {},
    });

    expect(ports.resolveRecipientEpub).not.toHaveBeenCalled();
    expect(transport.encryptForRecipient).toHaveBeenCalledWith(
      'known-epub',
      expect.anything(),
      {},
    );
  });

  it('passes a session key hint through host discovery so the host can validate and cache it', async () => {
    const { service, ports } = setup();

    await service.deliver({
      envelopeId: 'hinted-key',
      recipientId: 'recipient-1',
      knownRecipientEpub: 'session-epub',
      payload: {},
    });

    expect(ports.resolveRecipientEpub).toHaveBeenCalledWith('recipient-1', 'session-epub');
  });

  it('retries rejected posts with bounded linear delays and eventually succeeds', async () => {
    const { service, ports, transport, events } = setup();
    transport.postEnvelope
      .mockResolvedValueOnce({ stored: false, error: 'hub unavailable' })
      .mockResolvedValueOnce({ stored: false, error: 'still unavailable' })
      .mockResolvedValueOnce({ stored: true });

    await expect(service.deliver({
      envelopeId: 'retry-me',
      recipientId: 'recipient-1',
      payload: {},
      maxAttempts: 3,
      retryDelayMs: 25,
    })).resolves.toEqual(expect.objectContaining({ stored: true, attempts: 3 }));

    expect(ports.sleep).toHaveBeenNthCalledWith(1, 25);
    expect(ports.sleep).toHaveBeenNthCalledWith(2, 50);
    expect(events.filter((event) => event.type === 'retrying')).toHaveLength(2);
  });

  it('returns an explicit failure after exhausting attempts', async () => {
    const { service, transport, events } = setup();
    transport.postEnvelope.mockResolvedValue({ stored: false, error: 'quota exceeded' });

    const result = await service.deliver({
      envelopeId: 'failed-envelope',
      recipientId: 'recipient-1',
      payload: {},
      maxAttempts: 2,
    });

    expect(result).toEqual(expect.objectContaining({ stored: false, attempts: 2 }));
    if (result.stored) throw new Error('expected delivery failure');
    expect(result.error.message).toContain('quota exceeded');
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'failed', attempts: 2 }));
  });

  it('fails closed without sender custody and performs no transport work', async () => {
    const { service, transport } = setup({ senderKey: () => undefined });

    expect(service.hasSenderKey()).toBe(false);

    const result = await service.deliver({
      envelopeId: 'no-key',
      recipientId: 'recipient-1',
      payload: {},
    });

    expect(result).toEqual(expect.objectContaining({ stored: false, attempts: 0 }));
    expect(transport.encryptForRecipient).not.toHaveBeenCalled();
    expect(transport.postEnvelope).not.toHaveBeenCalled();
  });

  it('isolates fan-out failures and deduplicates the same recipient envelope', async () => {
    const { service, transport } = setup();
    transport.postEnvelope.mockImplementation(async ({ recipientId }) => (
      recipientId === 'bad' ? { stored: false, error: 'rejected' } : { stored: true }
    ));
    const repeated = { envelopeId: 'same', recipientId: 'good', payload: {} };

    const results = await service.fanOut([
      repeated,
      repeated,
      { envelopeId: 'other', recipientId: 'bad', payload: {} },
      { envelopeId: 'third', recipientId: 'also-good', payload: {} },
    ]);

    expect(results).toHaveLength(3);
    expect(results.filter((result) => result.stored)).toHaveLength(2);
    expect(results.filter((result) => !result.stored)).toHaveLength(1);
    expect(transport.postEnvelope).toHaveBeenCalledTimes(3);
  });

  it('does not let an observability callback break delivery', async () => {
    const { service } = setup({ onEvent: () => { throw new Error('logger unavailable'); } });

    await expect(service.deliver({
      envelopeId: 'logger-safe',
      recipientId: 'recipient-1',
      payload: {},
    })).resolves.toEqual(expect.objectContaining({ stored: true }));
  });

  it('offers a throwing adapter for workflows whose caller owns failure isolation', async () => {
    const { service, transport } = setup();
    transport.postEnvelope.mockResolvedValue({ stored: false, error: 'offline' });

    await expect(service.deliverOrThrow({
      envelopeId: 'throwing',
      recipientId: 'recipient-1',
      payload: {},
    })).rejects.toThrow('offline');
  });

  it('builds the existing deterministic envelope identifiers', () => {
    expect(mailboxEnvelopeId.attachmentShare('m1')).toBe('mbx_share_m1');
    expect(mailboxEnvelopeId.blockSignal('s1', 'u1')).toBe('blocksig_s1_u1');
    expect(mailboxEnvelopeId.conversationMessage('c1', 'm1')).toBe('mbx_dm_c1_m1');
    expect(mailboxEnvelopeId.supportQuestion('q1', 'asker', 'operator')).toBe('mbx_support_q1_asker_operator');
  });
});
