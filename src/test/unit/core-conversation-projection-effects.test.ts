import {
  ConversationProjectionEffects,
  type ConversationProjectionEffectsPorts,
} from '../../core/conversation-projection-effects';

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'message-1',
  senderId: 'me',
  text: 'hello',
  timestamp: '2026-11-27T12:00:00.000Z',
  ...overrides,
});

const flushTasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const ports = (overrides: Partial<ConversationProjectionEffectsPorts> = {}) => {
  const value: ConversationProjectionEffectsPorts = {
    currentUser: jest.fn(() => ({ id: 'me', stageName: 'Mine' })),
    transportMode: jest.fn(() => 'direct-p2p'),
    resolveOtherUserName: jest.fn(async () => undefined),
    upsertConversation: jest.fn(),
    recordConversation: jest.fn(async () => undefined),
    applyDealConfirmations: jest.fn(() => ['me', 'peer']),
    maybeFinalizeDeal: jest.fn(),
    verifySupportMessages: jest.fn(async (messages) => messages),
    readLegacyMessages: jest.fn(async () => []),
    clearLegacyMessages: jest.fn(async () => undefined),
    waitForGraphWrite: jest.fn(async () => undefined),
    recordMessages: jest.fn(async () => undefined),
    subscribeToMessages: jest.fn(() => () => undefined),
    refreshGraph: jest.fn(async () => undefined),
    onFailure: jest.fn(),
    ...overrides,
  };
  return value;
};

describe('ConversationProjectionEffects', () => {
  it('normalizes legacy participants, resolves placeholder names and records graph links', async () => {
    const host = ports({ resolveOtherUserName: jest.fn(async () => 'Peer') });
    const effects = new ConversationProjectionEffects(host);

    await expect(effects.ingestRecords([{
      conversationId: 'conversation-1',
      userId1: 'me',
      userId2: 'peer',
      userName2: 'Unknown',
      talkId: 'talk-1',
      relatedTalkIdsJson: JSON.stringify(['talk-2', 'talk-1', 'direct']),
      createdAt: '2026-11-27T12:00:00.000Z',
      dealConfirmedByJson: JSON.stringify(['me', 'peer']),
      dealEligible: true,
    }])).resolves.toBe(1);
    await Promise.resolve();

    expect(host.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      otherUserId: 'peer',
      otherUserName: 'Peer',
      transportMode: 'direct-p2p',
      dealEligible: true,
    }));
    expect(host.recordConversation).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      otherUserId: 'peer',
      talkIds: ['talk-1', 'talk-2'],
      startedAt: Date.parse('2026-11-27T12:00:00.000Z'),
    });
    expect(host.applyDealConfirmations).toHaveBeenCalledWith(
      'conversation-1',
      ['me', 'peer'],
    );
    expect(host.maybeFinalizeDeal).toHaveBeenCalledWith(
      ['me', 'peer'],
      'peer',
      'conversation-1',
    );
  });

  it('rejects empty/self participants and bounds a stalled name lookup', async () => {
    jest.useFakeTimers();
    const host = ports({
      resolveOtherUserName: jest.fn(() => new Promise<string>(() => undefined)),
    });
    const effects = new ConversationProjectionEffects(host, { nameLookupTimeoutMs: 20 });
    const ingest = effects.ingestRecords([
      { conversationId: 'self', otherUserId: 'me' },
      { conversationId: 'missing' },
      { conversationId: 'valid', otherUserId: 'peer', otherUserName: 'Someone' },
    ]);
    await jest.advanceTimersByTimeAsync(20);
    await expect(ingest).resolves.toBe(1);
    expect(host.upsertConversation).toHaveBeenCalledTimes(1);
    expect(host.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'valid',
      otherUserName: 'Someone',
    }));
    jest.useRealTimers();
  });

  it('validates plaintext graph imports and preserves supported metadata', () => {
    const effects = new ConversationProjectionEffects(ports());
    const imports = effects.messageImports('peer', [
      message({ talkId: 'talk-1', channel: 'known', isFromChatbot: true }),
      message({ id: 'cipher', text: 'SEA{encrypted}' }),
      message({ id: 'stranger', senderId: 'stranger' }),
      message({ id: 'bad-date', timestamp: 'not-a-date' }),
      message({ id: 'bad-channel', channel: 'pair' }),
    ]);

    expect(imports).toEqual([
      expect.objectContaining({
        sourceMessageId: 'message-1',
        senderId: 'me',
        text: 'hello',
        talkId: 'talk-1',
        channel: 'known',
        isFromChatbot: true,
      }),
      expect.objectContaining({
        sourceMessageId: 'bad-channel',
        senderId: 'me',
        text: 'hello',
      }),
    ]);
    expect(imports[1]).not.toHaveProperty('channel');
  });

  it('serializes writes per conversation and splits graph batches', async () => {
    let releaseFirst: (() => void) | undefined;
    const host = ports({
      recordMessages: jest.fn(() => new Promise<void>((resolve) => {
        if (!releaseFirst) releaseFirst = resolve;
        else resolve();
      })),
    });
    const effects = new ConversationProjectionEffects(host, { messageBatchSize: 2 });
    const imports = effects.messageImports('peer', [
      message({ id: '1' }),
      message({ id: '2' }),
      message({ id: '3' }),
    ]);
    const first = effects.writeMessages('conversation-1', 'peer', imports);
    const second = effects.writeMessages('conversation-1', 'peer', [imports[0]]);
    await flushTasks();
    expect(host.recordMessages).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await first;
    await second;
    expect(host.recordMessages).toHaveBeenCalledTimes(3);
    expect(host.recordMessages).toHaveBeenNthCalledWith(1, expect.objectContaining({
      messages: imports.slice(0, 2),
    }));
    expect(host.recordMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({
      messages: imports.slice(2),
    }));
  });

  it('verifies support rows before importing them', async () => {
    const host = ports({
      verifySupportMessages: jest.fn(async (messages) => messages.slice(0, 1)),
    });
    const effects = new ConversationProjectionEffects(host);
    effects.recordConversationMessages('conv_support_me_peer', 'peer', [
      message({ id: 'verified', senderId: 'peer' }),
      message({ id: 'tampered', senderId: 'peer' }),
    ]);
    await flushTasks();

    expect(host.verifySupportMessages).toHaveBeenCalled();
    expect(host.recordMessages).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ sourceMessageId: 'verified' })],
    }));
  });

  it('shares one legacy migration and only clears fully importable plaintext', async () => {
    let releaseRead: ((messages: Record<string, unknown>[]) => void) | undefined;
    const host = ports({
      readLegacyMessages: jest.fn(() => new Promise((resolve) => { releaseRead = resolve; })),
    });
    const effects = new ConversationProjectionEffects(host);
    const first = effects.migrateLegacyHistory('conversation-1', 'peer');
    const second = effects.migrateLegacyHistory('conversation-1', 'peer');
    expect(first).toBe(second);
    releaseRead?.([message({ id: 'legacy', senderId: 'peer' })]);
    await first;
    expect(host.readLegacyMessages).toHaveBeenCalledTimes(1);
    expect(host.clearLegacyMessages).toHaveBeenCalledWith('conversation-1');

    const invalidHost = ports({
      readLegacyMessages: jest.fn(async () => [message({ text: 'SEA{encrypted}' })]),
    });
    const invalid = new ConversationProjectionEffects(invalidHost);
    await expect(invalid.migrateLegacyHistory('conversation-2', 'peer')).rejects.toThrow(
      'undecryptable',
    );
    expect(invalidHost.clearLegacyMessages).not.toHaveBeenCalled();
  });

  it('takes a bounded one-shot device-sync snapshot and unsubscribes', async () => {
    const unsubscribe = jest.fn();
    const host = ports({
      subscribeToMessages: jest.fn((_id, listener) => {
        listener([message({ senderId: 'peer', channel: 'mutual' })]);
        return unsubscribe;
      }),
    });
    const effects = new ConversationProjectionEffects(host);

    await expect(effects.snapshotLocalMessages('conversation-1', 'peer')).resolves.toEqual([{
      id: 'message-1',
      senderId: 'peer',
      text: 'hello',
      timestamp: '2026-11-27T12:00:00.000Z',
      channel: 'mutual',
    }]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
