import {
  ResilientConversationTransport,
  type TransportFallbackInfo,
} from '../../web/services/resilient-conversation-transport';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';

/**
 * Deterministic coverage of the resilient fallback chain
 * (`direct-p2p → server-relay → star-gun`) using the E2E fault-injection seam.
 * Fakes stand in for the real WebRTC / Gun-relay / star transports so the routing
 * logic is verified without a browser. Mirrors the E2E spec
 * `tests/e2e/staged/stage2-two-user/00m-transport-fallback.spec.ts` (T3).
 */

type SendCall = { conversationId: string; senderId: string; text: string };

function makeFakeTransport(mode: ConversationTransportMode) {
  const sends: SendCall[] = [];
  return {
    mode,
    sends,
    sendMessage: jest.fn(async (conversationId: string, senderId: string, text: string) => {
      sends.push({ conversationId, senderId, text });
    }),
    subscribeToMessages: jest.fn(() => () => undefined),
    // direct-only members touched by tryDirectConnect (unused in send tests):
    ensureSessionConnected: jest.fn(async () => undefined),
    getConnectionState: jest.fn(() => 'connected'),
    getHandshakeDiagnostics: jest.fn(() => null),
    setLedgerHandshakeHooks: jest.fn(),
  };
}

function buildResilient() {
  const direct = makeFakeTransport('direct-p2p');
  const relay = makeFakeTransport('server-relay');
  const star = makeFakeTransport('star-gun');
  const fallbacks: TransportFallbackInfo[] = [];
  const transport = new ResilientConversationTransport(
    {} as any,
    star as any,
    { onFallback: (info) => fallbacks.push(info) },
    { direct: direct as any, relay: relay as any },
  );
  return { transport, direct, relay, star, fallbacks };
}

describe('ResilientConversationTransport fallback chain (T3 fault injection)', () => {
  beforeAll(() => {
    // Diagnostics POST is best-effort; stub fetch so no real network is attempted.
    (global as any).fetch = jest.fn(async () => ({ ok: true }));
  });

  it('stays on direct-p2p when no mode is forced to fail', async () => {
    const { transport, direct, relay, star } = buildResilient();
    await transport.sendMessage('c1', 'tom', 'hello');
    expect(direct.sendMessage).toHaveBeenCalledTimes(1);
    expect(relay.sendMessage).not.toHaveBeenCalled();
    expect(star.sendMessage).not.toHaveBeenCalled();
    expect(transport.mode).toBe('direct-p2p');
  });

  it('falls back to server-relay when direct-p2p fails, and delivers there', async () => {
    const { transport, direct, relay, star, fallbacks } = buildResilient();
    transport.setFailModesForE2e(['direct-p2p']);

    await transport.sendMessage('c1', 'tom', 'hello');

    expect(direct.sendMessage).not.toHaveBeenCalled(); // forced to throw before send
    expect(relay.sendMessage).toHaveBeenCalledTimes(1);
    expect(relay.sends[0]).toMatchObject({ conversationId: 'c1', senderId: 'tom', text: 'hello' });
    expect(star.sendMessage).not.toHaveBeenCalled();
    expect(transport.mode).toBe('server-relay');
    expect(fallbacks.map((f) => f.mode)).toEqual(['server-relay']);
    expect(fallbacks[0].fallbackReason).toContain('direct-p2p');
  });

  it('falls back through to star-gun when both direct-p2p and server-relay fail', async () => {
    const { transport, direct, relay, star, fallbacks } = buildResilient();
    transport.setFailModesForE2e(['direct-p2p', 'server-relay']);

    await transport.sendMessage('c1', 'tom', 'hello');

    expect(direct.sendMessage).not.toHaveBeenCalled();
    expect(relay.sendMessage).not.toHaveBeenCalled();
    expect(star.sendMessage).toHaveBeenCalledTimes(1);
    expect(star.sends[0]).toMatchObject({ conversationId: 'c1', senderId: 'tom', text: 'hello' });
    expect(transport.mode).toBe('star-gun');
    expect(fallbacks.map((f) => f.mode)).toEqual(['server-relay', 'star-gun']);
  });

  it('clearing fail modes restores direct-p2p delivery on a fresh transport', async () => {
    const { transport, direct, relay } = buildResilient();
    transport.setFailModesForE2e(['direct-p2p']);
    transport.setFailModesForE2e([]); // cleared before any send
    await transport.sendMessage('c2', 'jerry', 'hi');
    expect(direct.sendMessage).toHaveBeenCalledTimes(1);
    expect(relay.sendMessage).not.toHaveBeenCalled();
    expect(transport.mode).toBe('direct-p2p');
  });
});

describe('ResilientConversationTransport subscribe-side fallback (T3 receiver render)', () => {
  beforeAll(() => {
    (global as any).fetch = jest.fn(async () => ({ ok: true }));
  });

  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('renders from direct-p2p when nothing is forced to fail', async () => {
    const { transport, direct, relay, star } = buildResilient();
    const unsub = transport.subscribeToMessages('c1', () => undefined, 'me', 'other');
    await flush();
    expect(direct.subscribeToMessages).toHaveBeenCalledTimes(1);
    expect(relay.subscribeToMessages).not.toHaveBeenCalled();
    expect(star.subscribeToMessages).not.toHaveBeenCalled();
    unsub();
  });

  it('re-subscribes on server-relay when direct-p2p is forced to fail', async () => {
    const { transport, direct, relay, star, fallbacks } = buildResilient();
    transport.setFailModesForE2e(['direct-p2p']);
    const unsub = transport.subscribeToMessages('c1', () => undefined, 'me', 'other');
    await flush();
    expect(direct.subscribeToMessages).toHaveBeenCalledTimes(1); // initial attach
    expect(relay.subscribeToMessages).toHaveBeenCalledTimes(1);
    expect(star.subscribeToMessages).not.toHaveBeenCalled();
    expect(transport.mode).toBe('server-relay');
    expect(fallbacks.map((f) => f.mode)).toEqual(['server-relay']);
    unsub();
  });

  it('advances the subscription all the way to star-gun when direct AND relay fail', async () => {
    const { transport, relay, star, fallbacks } = buildResilient();
    transport.setFailModesForE2e(['direct-p2p', 'server-relay']);
    const unsub = transport.subscribeToMessages('c1', () => undefined, 'me', 'other');
    await flush();
    // Receiver ends up subscribed on star-gun — the leg the sender delivers on — so the
    // star message renders, not merely persists.
    expect(star.subscribeToMessages).toHaveBeenCalledTimes(1);
    expect(transport.mode).toBe('star-gun');
    expect(fallbacks.map((f) => f.mode)).toEqual(['server-relay', 'star-gun']);
    // Relay is not used as the final render leg (it was forced to fail).
    expect(relay.subscribeToMessages).not.toHaveBeenCalled();
    unsub();
  });
});
