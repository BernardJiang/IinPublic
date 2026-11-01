import { DirectP2PConversationTransport, DM_OPEN_LINK_GRACE_MS, DM_PREPARE_TIMEOUT_MS } from '../../web/services/direct-p2p-conversation-transport';
import { GunMessageStore } from '../../web/services/gun-message-store';
import type { WebGunService } from '../../web/services/web-gun-service';

async function waitForMockCall(mockFn: jest.Mock, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (mockFn.mock.calls.length === 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('DirectP2PConversationTransport (P2P-H)', () => {
  const wire = {
    id: 'msg_test_1',
    senderId: 'alice',
    text: 'hello',
    timestamp: new Date().toISOString(),
    channel: 'public',
    transport: 'direct-p2p' as const,
  };

  beforeEach(() => {
    jest.spyOn(GunMessageStore.prototype, 'putMessageRecord').mockResolvedValue(undefined);
  });

  const mockGun = {
    getGun: () => ({
      get: () => ({
        get: () => ({
          get: () => ({ put: jest.fn() }),
        }),
        once: (cb: (d: undefined) => void) => cb(undefined),
      }),
    }),
    getStoredPair: () => ({ pub: 'pub_alice', epub: 'e', priv: 'p', epriv: 'ep' }),
    getPublicUser: async () => ({ pub: 'pub_bob' }),
  } as unknown as WebGunService;

  it('buildAndPersistMessage on Gun store before WebRTC sendDm', async () => {
    const buildSpy = jest
      .spyOn(GunMessageStore.prototype, 'buildMessage')
      .mockResolvedValue(wire);
    const sendDm = jest.fn(async () => undefined);

    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm,
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });

    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
    await waitForMockCall(sendDm);

    expect(buildSpy).toHaveBeenCalledWith(
      'conv1',
      'alice',
      'hello',
      expect.objectContaining({ transport: 'direct-p2p' }),
    );
    expect(sendDm).toHaveBeenCalledWith('alice', 'hello', 'public', wire);

    buildSpy.mockRestore();
  });

  it('passes explicit messageId to Gun store for idempotent sends', async () => {
    const buildSpy = jest
      .spyOn(GunMessageStore.prototype, 'buildMessage')
      .mockResolvedValue({ ...wire, id: 'bafy-auto-share-msg' });
    const sendDm = jest.fn(async () => undefined);

    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm,
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });

    await transport.sendMessage('conv1', 'alice', 'ipfs://bafy...', {
      otherUserId: 'bob',
      messageId: 'bafy-auto-share-msg',
      channel: 'known',
    });

    expect(buildSpy).toHaveBeenCalledWith(
      'conv1',
      'alice',
      'ipfs://bafy...',
      expect.objectContaining({
        transport: 'direct-p2p',
        messageId: 'bafy-auto-share-msg',
        channel: 'known',
      }),
    );

    buildSpy.mockRestore();
  });

  it('fires the undeliverable handler with the wire + recipient when WebRTC send fails (Phase 4 mailbox)', async () => {
    const buildSpy = jest
      .spyOn(GunMessageStore.prototype, 'buildMessage')
      .mockResolvedValue(wire);
    const sendDm = jest.fn(async () => {
      throw new Error('DataChannel not connected (peer offline)');
    });

    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm,
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });
    const onUndeliverable = jest.fn();
    transport.setUndeliverableHandler(onUndeliverable);

    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });

    await waitForMockCall(sendDm);
    await waitForMockCall(onUndeliverable);
    expect(sendDm).toHaveBeenCalled();
    expect(onUndeliverable).toHaveBeenCalledWith(wire, 'conv1', 'bob', undefined);
    buildSpy.mockRestore();
  });

  describe('showing the sender their own message', () => {
    const sessionless = (transport: DirectP2PConversationTransport) => jest
      .spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor')
      .mockRejectedValue(new Error('no link in this test'));

    const shown = (transport: DirectP2PConversationTransport): string[] =>
      ((transport as unknown as { liveMessagesByConversation: Map<string, Array<{ text: string }>> })
        .liveMessagesByConversation.get('conv1') ?? []).map((message) => message.text);

    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it('shows it before saving has finished', async () => {
      jest.useFakeTimers();
      const buildSpy = jest
        .spyOn(GunMessageStore.prototype, 'buildMessage')
        .mockReturnValue(new Promise(() => undefined));
      const transport = new DirectP2PConversationTransport(mockGun);
      sessionless(transport);

      void transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob', messageId: 'm1' }).catch(() => undefined);

      expect(shown(transport)).toEqual(['hello']);
      expect(buildSpy).toHaveBeenCalled();
    });

    it('delivers without waiting for a slow save', async () => {
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
      jest.spyOn(GunMessageStore.prototype, 'putMessageRecord').mockReturnValue(new Promise(() => undefined));
      const sendDm = jest.fn(async () => undefined);
      const transport = new DirectP2PConversationTransport(mockGun);
      jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
        sendDm,
        setLedgerHooks: jest.fn(),
        setOnRemoteDm: jest.fn(),
      });

      void transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
      await waitForMockCall(sendDm);

      expect(sendDm).toHaveBeenCalledWith('alice', 'hello', 'public', wire);
    });

    it('takes it back and reports when saving fails', async () => {
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
      jest.spyOn(GunMessageStore.prototype, 'putMessageRecord').mockRejectedValue(new Error('no epub'));
      const transport = new DirectP2PConversationTransport(mockGun);
      sessionless(transport);

      await expect(transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' })).rejects.toThrow('no epub');

      expect(shown(transport)).toEqual([]);
    });

    it('reports a save that never finishes instead of leaving it pending', async () => {
      jest.useFakeTimers();
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockReturnValue(new Promise(() => undefined));
      const transport = new DirectP2PConversationTransport(mockGun);
      sessionless(transport);

      const sending = transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
      const outcome = expect(sending).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(DM_PREPARE_TIMEOUT_MS);
      await outcome;
    });

    it('gives the mailbox the key already used to encrypt the message', async () => {
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
      jest.spyOn(GunMessageStore.prototype, 'knownEpub').mockReturnValue('epub_bob');
      const transport = new DirectP2PConversationTransport(mockGun);
      sessionless(transport);
      const onUndeliverable = jest.fn();
      transport.setUndeliverableHandler(onUndeliverable);

      await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
      await waitForMockCall(onUndeliverable);

      expect(onUndeliverable).toHaveBeenCalledWith(wire, 'conv1', 'bob', 'epub_bob');
    });
  });

  it('shares the peer key found for the link, so the first message needs no second lookup', async () => {
    const remember = jest.spyOn(GunMessageStore.prototype, 'rememberEpub');
    const getPublicUser = jest.fn().mockResolvedValue({ pub: 'pub_bob', epub: 'epub_bob' });
    const transport = new DirectP2PConversationTransport({ ...mockGun, getPublicUser } as unknown as WebGunService);

    await (transport as unknown as { sessionFor: (c: string, l: string, o: string) => Promise<unknown> })
      .sessionFor('conv1', 'alice', 'bob')
      .catch(() => undefined);

    expect(remember).toHaveBeenCalledWith('bob', 'epub_bob');
  });

  it('keeps looking up a peer whose record has not synced yet', async () => {
    const getPublicUser = jest.fn()
      .mockRejectedValueOnce(new Error('No data found for key: users/bob'))
      .mockRejectedValueOnce(new Error('No data found for key: users/bob'))
      .mockResolvedValue({ pub: 'pub_bob', epub: 'epub_bob' });
    const transport = new DirectP2PConversationTransport({ ...mockGun, getPublicUser } as unknown as WebGunService);

    const pub = await (transport as unknown as { getUserPub: (id: string) => Promise<string> }).getUserPub('bob');

    expect(pub).toBe('pub_bob');
    expect(getPublicUser).toHaveBeenCalledTimes(3);
  });

  describe('choosing the mailbox', () => {
    const setUp = (sendDm: () => Promise<undefined>, linkOpen: boolean) => {
      const transport = new DirectP2PConversationTransport(mockGun);
      jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
        sendDm,
        setLedgerHooks: jest.fn(),
        setOnRemoteDm: jest.fn(),
      });
      jest.spyOn(transport as unknown as { hasOpenLink: () => boolean }, 'hasOpenLink').mockReturnValue(linkOpen);
      const onUndeliverable = jest.fn();
      transport.setUndeliverableHandler(onUndeliverable);
      return { transport, onUndeliverable };
    };
    let buildSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      buildSpy = jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
    });

    afterEach(() => {
      buildSpy.mockRestore();
      jest.useRealTimers();
    });

    it('uses the mailbox at once, and only once, when no direct link is open', async () => {
      let failLink: (error: Error) => void = () => undefined;
      const hanging = () => new Promise<undefined>((_resolve, reject) => { failLink = reject; });
      const { transport, onUndeliverable } = setUp(hanging, false);

      await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
      await jest.advanceTimersByTimeAsync(0);
      expect(onUndeliverable).toHaveBeenCalledWith(wire, 'conv1', 'bob', undefined);

      failLink(new Error('WebRTC connection timeout'));
      await jest.advanceTimersByTimeAsync(20_000);
      expect(onUndeliverable).toHaveBeenCalledTimes(1);
    });

    it('leaves the mailbox alone when an open link delivers', async () => {
      const { transport, onUndeliverable } = setUp(async () => undefined, true);

      await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
      await jest.advanceTimersByTimeAsync(20_000);
      expect(onUndeliverable).not.toHaveBeenCalled();
    });

    it('falls back to the mailbox when an open link stalls', async () => {
      const { transport, onUndeliverable } = setUp(() => new Promise<undefined>(() => undefined), true);

      await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
      await jest.advanceTimersByTimeAsync(DM_OPEN_LINK_GRACE_MS - 1);
      expect(onUndeliverable).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(onUndeliverable).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire the undeliverable handler when WebRTC delivery succeeds', async () => {
    const buildSpy = jest
      .spyOn(GunMessageStore.prototype, 'buildMessage')
      .mockResolvedValue(wire);
    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm: jest.fn(async () => undefined),
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });
    jest.spyOn(transport as unknown as { hasOpenLink: () => boolean }, 'hasOpenLink').mockReturnValue(true);
    const onUndeliverable = jest.fn();
    transport.setUndeliverableHandler(onUndeliverable);

    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });

    expect(onUndeliverable).not.toHaveBeenCalled();
    buildSpy.mockRestore();
  });

  it('subscribeToMessages delegates to Gun store subscription after participant resolution fallback', async () => {
    const subSpy = jest
      .spyOn(GunMessageStore.prototype, 'subscribeToMessages')
      .mockReturnValue(() => undefined);

    const transport = new DirectP2PConversationTransport(mockGun);
    const cb = jest.fn();
    transport.subscribeToMessages('conv1', cb, 'alice');

    for (let i = 0; i < 5 && subSpy.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(subSpy).toHaveBeenCalledWith('conv1', expect.any(Function), 'alice');
    subSpy.mockRestore();
  });

  it('does not let an older Gun snapshot erase a message already echoed locally', async () => {
    let emitGunSnapshot: ((messages: any[]) => void) | undefined;
    const subSpy = jest
      .spyOn(GunMessageStore.prototype, 'subscribeToMessages')
      .mockImplementation((_conversationId, callback) => {
        emitGunSnapshot = callback;
        return () => undefined;
      });
    const buildSpy = jest
      .spyOn(GunMessageStore.prototype, 'buildMessage')
      .mockResolvedValue(wire);

    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      ensureConnected: jest.fn(async () => undefined),
      sendDm: jest.fn(async () => undefined),
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });
    const cb = jest.fn();
    transport.subscribeToMessages('conv1', cb, 'alice', 'bob');
    for (let i = 0; i < 5 && !emitGunSnapshot; i++) await Promise.resolve();

    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob', messageId: wire.id });
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: wire.id, text: 'hello' })]);

    emitGunSnapshot?.([]);
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: wire.id, text: 'hello' })]);

    buildSpy.mockRestore();
    subSpy.mockRestore();
  });

  it('a record rewritten under the same id replaces the cached copy (renamed TechSupport welcome)', async () => {
    let emitGunSnapshot: ((messages: any[]) => void) | undefined;
    const subSpy = jest
      .spyOn(GunMessageStore.prototype, 'subscribeToMessages')
      .mockImplementation((_conversationId, callback) => {
        emitGunSnapshot = callback;
        return () => undefined;
      });
    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      ensureConnected: jest.fn(async () => undefined),
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });
    const cb = jest.fn();
    transport.subscribeToMessages('conv1', cb, 'alice', 'bob');
    for (let i = 0; i < 5 && !emitGunSnapshot; i++) await Promise.resolve();

    const timestamp = new Date();
    emitGunSnapshot?.([{ id: 'support_welcome_alice', senderId: 'ts', text: 'Welcome, User123', timestamp }]);
    emitGunSnapshot?.([{ id: 'support_welcome_alice', senderId: 'ts', text: 'Welcome, Alice', timestamp }]);
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'support_welcome_alice', text: 'Welcome, Alice' })]);

    // A later, unrelated emit must not bring the old text back.
    emitGunSnapshot?.([]);
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ text: 'Welcome, Alice' })]);
    subSpy.mockRestore();
  });
  it('looks up a peer\'s keys once, not before every send and every decrypt (OPEN-66)', async () => {
    const getPublicUser = jest.fn(async () => ({ pub: 'pub_bob', epub: 'epub_bob' }));
    const transport = new DirectP2PConversationTransport({ ...mockGun, getPublicUser } as unknown as WebGunService);
    const keys = transport as unknown as {
      getUserPub: (id: string) => Promise<string>;
      getUserEpub: (id: string) => Promise<string | undefined>;
    };
    // Opening the conversation, two sends and a decrypt; the first two race like the real boot.
    const [pub, epub] = await Promise.all([keys.getUserPub('bob'), keys.getUserEpub('bob')]);
    expect(await keys.getUserPub('bob')).toBe(pub);
    expect(await keys.getUserPub('bob')).toBe('pub_bob');
    expect(await keys.getUserEpub('bob')).toBe(epub);
    expect(epub).toBe('epub_bob');
    expect(getPublicUser).toHaveBeenCalledTimes(1);
  });

  it('keeps asking for an epub the peer has not published yet', async () => {
    const getPublicUser = jest.fn()
      .mockResolvedValueOnce({ pub: 'pub_bob' })
      .mockResolvedValue({ pub: 'pub_bob', epub: 'epub_bob' });
    const transport = new DirectP2PConversationTransport({ ...mockGun, getPublicUser } as unknown as WebGunService);
    const keys = transport as unknown as { getUserEpub: (id: string) => Promise<string | undefined> };
    expect(await keys.getUserEpub('bob')).toBe('epub_bob');
    expect(getPublicUser).toHaveBeenCalledTimes(2);
  });
});
