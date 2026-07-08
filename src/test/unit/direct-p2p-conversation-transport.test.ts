import { DirectP2PConversationTransport } from '../../web/services/direct-p2p-conversation-transport';
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
      .spyOn(GunMessageStore.prototype, 'buildAndPersistMessage')
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
      .spyOn(GunMessageStore.prototype, 'buildAndPersistMessage')
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
      .spyOn(GunMessageStore.prototype, 'buildAndPersistMessage')
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
    expect(onUndeliverable).toHaveBeenCalledWith(wire, 'conv1', 'bob');
    buildSpy.mockRestore();
  });

  it('does NOT fire the undeliverable handler when WebRTC delivery succeeds', async () => {
    const buildSpy = jest
      .spyOn(GunMessageStore.prototype, 'buildAndPersistMessage')
      .mockResolvedValue(wire);
    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm: jest.fn(async () => undefined),
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });
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
    expect(subSpy).toHaveBeenCalledWith('conv1', cb, 'alice');
    subSpy.mockRestore();
  });
});
