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
  let graphRecord: jest.Mock<Promise<void>, any[]>;
  let graphList: jest.Mock<Promise<any[]>, any[]>;
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
    graphRecord = jest.fn(async () => undefined);
    graphList = jest.fn(async () => []);
    jest.spyOn(
      DirectP2PConversationTransport.prototype as unknown as { requireMessageLog: () => unknown },
      'requireMessageLog',
    ).mockReturnValue({ recordMessage: graphRecord, listMessages: graphList });
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

  it('records plaintext in the graph log before completing a WebRTC send', async () => {
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
    expect(graphRecord).toHaveBeenCalledWith('conv1', 'bob', expect.objectContaining({
      id: wire.id,
      senderId: 'alice',
      text: 'hello',
    }));

    buildSpy.mockRestore();
  });

  it('sends the message with the same time the sender already shows it with (both sides order by it)', async () => {
    const buildSpy = jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
    const putSpy = jest.spyOn(GunMessageStore.prototype, 'putMessageRecord').mockResolvedValue(undefined);
    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm: jest.fn(async () => undefined), setLedgerHooks: jest.fn(), setOnRemoteDm: jest.fn(),
    });
    const shown = jest.spyOn(
      transport as unknown as { pushLiveMessage: (conversationId: string, message: { timestamp: Date }) => void },
      'pushLiveMessage',
    );
    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });
    const sentAt = (buildSpy.mock.calls[0]![3] as { sentAt?: Date }).sentAt;
    expect(sentAt).toBeInstanceOf(Date);
    expect(shown.mock.calls[0]![1].timestamp).toBe(sentAt);
    buildSpy.mockRestore();
    putSpy.mockRestore();
  });

  it('passes an explicit message id to the wire codec and graph for idempotent sends', async () => {
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
    expect(graphRecord).toHaveBeenCalledWith(
      'conv1',
      'bob',
      expect.objectContaining({ id: 'bafy-auto-share-msg', text: 'ipfs://bafy...' }),
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
    const deliveryState = (transport: DirectP2PConversationTransport): string | undefined =>
      (transport as unknown as {
        liveMessagesByConversation: Map<string, Array<{ deliveryState?: string }>>;
      }).liveMessagesByConversation.get('conv1')?.[0]?.deliveryState;

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
      expect(deliveryState(transport)).toBe('sending');
      expect(buildSpy).toHaveBeenCalled();
    });

    it('marks a direct delivery sent without persisting UI delivery state', async () => {
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
      const putSpy = jest.spyOn(GunMessageStore.prototype, 'putMessageRecord').mockResolvedValue(undefined);
      const transport = new DirectP2PConversationTransport(mockGun);
      const sendDm = jest.fn(async () => undefined);
      jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
        sendDm, setLedgerHooks: jest.fn(), setOnRemoteDm: jest.fn(),
      });

      await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob', messageId: wire.id });
      await waitForMockCall(sendDm);
      await Promise.resolve();

      expect(deliveryState(transport)).toBe('sent');
      expect(putSpy).not.toHaveBeenCalled();
    });

    it.each([
      [true, 'queued'],
      [false, 'failed'],
    ] as const)('marks mailbox acceptance %s as %s', async (accepted, expectedState) => {
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
      const putSpy = jest.spyOn(GunMessageStore.prototype, 'putMessageRecord').mockResolvedValue(undefined);
      const transport = new DirectP2PConversationTransport(mockGun);
      sessionless(transport);
      const onUndeliverable = jest.fn(async () => accepted);
      transport.setUndeliverableHandler(onUndeliverable);

      await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob', messageId: wire.id });
      await waitForMockCall(onUndeliverable);
      await Promise.resolve();

      expect(deliveryState(transport)).toBe(expectedState);
      expect(putSpy).not.toHaveBeenCalled();
    });

    it('delivers without waiting for a slow save', async () => {
      jest.spyOn(GunMessageStore.prototype, 'buildMessage').mockResolvedValue(wire);
      graphRecord.mockReturnValue(new Promise(() => undefined));
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
      graphRecord.mockRejectedValue(new Error('graph write failed'));
      const transport = new DirectP2PConversationTransport(mockGun);
      sessionless(transport);

      await expect(transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' })).rejects.toThrow('graph write failed');

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

  it('subscribeToMessages reads durable history from the graph log', async () => {
    graphList.mockResolvedValue([{
      id: 'logged-1', senderId: 'bob', text: 'from graph',
      timestamp: '2026-11-11T00:00:00.000Z', channel: 'known',
    }]);
    const transport = new DirectP2PConversationTransport(mockGun);
    const cb = jest.fn();
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockRejectedValue(new Error('offline'));
    transport.subscribeToMessages('conv1', cb, 'alice', 'bob');

    for (let i = 0; i < 5 && graphList.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(graphList).toHaveBeenCalledWith('conv1', 'bob', 500);
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'logged-1', text: 'from graph' })]);
  });

  it('does not let an older graph snapshot erase a message already echoed locally', async () => {
    let finishGraphRead!: (messages: any[]) => void;
    graphList.mockReturnValue(new Promise((resolve) => { finishGraphRead = resolve; }));
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

    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob', messageId: wire.id });
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: wire.id, text: 'hello' })]);

    finishGraphRead([]);
    await Promise.resolve();
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: wire.id, text: 'hello' })]);

    buildSpy.mockRestore();
  });

  it('starts the graph write first, shows an inbound message without waiting, and resolves once durable', async () => {
    let finishPersist!: () => void;
    const persisted = new Promise<void>((resolve) => { finishPersist = resolve; });
    graphRecord.mockReturnValue(persisted);
    const transport = new DirectP2PConversationTransport(mockGun);
    const publishSpy = jest.spyOn(
      transport as unknown as { pushLiveMessage: (conversationId: string, message: unknown) => void },
      'pushLiveMessage',
    );

    const receive = (
      transport as unknown as {
        persistAndPublishRemoteMessage: (
          conversationId: string,
          localUserId: string,
          otherUserId: string,
          remoteWire: typeof wire,
        ) => Promise<void>;
      }
    ).persistAndPublishRemoteMessage('conv1', 'alice', 'bob', { ...wire, senderId: 'bob' });

    let settled = false;
    void receive.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(graphRecord).toHaveBeenCalledWith('conv1', 'bob', expect.objectContaining({
      id: wire.id, senderId: 'bob', text: wire.text,
    }));
    // Shown while the write is still in flight (arrival must not wait for the core's write queue).
    expect(publishSpy).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({ id: wire.id, senderId: 'bob', text: wire.text }),
    );
    expect(graphRecord.mock.invocationCallOrder[0]!).toBeLessThan(publishSpy.mock.invocationCallOrder[0]!);
    expect(settled).toBe(false);

    finishPersist();
    await receive;
    expect(settled).toBe(true);
  });

  it('a later graph row under the same id replaces the cached copy', async () => {
    graphList.mockResolvedValue([{ id: 'same', senderId: 'bob', text: 'new', timestamp: new Date().toISOString() }]);
    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      ensureConnected: jest.fn(async () => undefined),
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });
    const cb = jest.fn();
    (transport as unknown as { mergeLiveMessages: (id: string, messages: any[]) => void }).mergeLiveMessages('conv1', [{
      id: 'same', senderId: 'bob', text: 'old', timestamp: new Date(), readBy: [], channel: 'public',
    }]);
    transport.subscribeToMessages('conv1', cb, 'alice', 'bob');
    for (let i = 0; i < 5 && cb.mock.calls.length < 2; i++) await Promise.resolve();
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'same', text: 'new' })]);
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
