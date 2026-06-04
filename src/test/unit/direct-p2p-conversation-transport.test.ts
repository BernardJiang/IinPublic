import { DirectP2PConversationTransport } from '../../web/services/direct-p2p-conversation-transport';
import { StarGunConversationTransport } from '../../web/services/star-gun-conversation-transport';
import type { WebGunService } from '../../web/services/web-gun-service';

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
      .spyOn(StarGunConversationTransport.prototype, 'buildAndPersistMessage')
      .mockResolvedValue(wire);
    const sendDm = jest.fn(async () => undefined);

    const transport = new DirectP2PConversationTransport(mockGun);
    jest.spyOn(transport as unknown as { sessionFor: () => Promise<unknown> }, 'sessionFor').mockResolvedValue({
      sendDm,
      setLedgerHooks: jest.fn(),
      setOnRemoteDm: jest.fn(),
    });

    await transport.sendMessage('conv1', 'alice', 'hello', { otherUserId: 'bob' });

    expect(buildSpy).toHaveBeenCalledWith(
      'conv1',
      'alice',
      'hello',
      expect.objectContaining({ transport: 'direct-p2p' }),
    );
    expect(sendDm).toHaveBeenCalledWith('alice', 'hello', 'public', wire);

    buildSpy.mockRestore();
  });

  it('subscribeToMessages delegates to Gun store subscription after participant resolution fallback', async () => {
    const subSpy = jest
      .spyOn(StarGunConversationTransport.prototype, 'subscribeToMessages')
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
