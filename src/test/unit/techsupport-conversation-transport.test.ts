import { TechSupportConversationTransport } from '../../web/services/techsupport-conversation-transport';
import { StarGunConversationTransport } from '../../web/services/star-gun-conversation-transport';
import type { WebGunService } from '../../web/services/web-gun-service';
import type { Message } from '../../shared/types';

/**
 * Regression coverage for the "message shows up then disappears" bug: the poll/initial-load
 * paths used to call the merge routine with the server-only snapshot standing in for the Gun
 * snapshot, silently dropping any message that only exists in Gun (never persisted server-side,
 * e.g. because the server POST failed, or a deliberately local-only write like the welcome
 * greeting) on every subsequent tick.
 */
describe('TechSupportConversationTransport.subscribeToMessages', () => {
  const mockGunService = {} as unknown as WebGunService;

  const gunOnlyMessage: Message = {
    id: 'msg_gun_only',
    senderId: 'alice',
    text: 'never reached the server',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    channel: 'public',
    readBy: [],
    isFromChatbot: false,
  };

  let gunCallback: ((msgs: Message[]) => void) | null = null;
  let subscribeSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    gunCallback = null;
    subscribeSpy = jest
      .spyOn(StarGunConversationTransport.prototype, 'subscribeToMessages')
      .mockImplementation((_conversationId, callback) => {
        gunCallback = callback;
        return () => {};
      });
    // The server never has this message (persist failed / never attempted) — every GET
    // returns empty, exactly like a message that only ever landed in Gun.
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    } as unknown as Response);
  });

  afterEach(() => {
    subscribeSpy.mockRestore();
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  it('keeps a Gun-only message across subsequent poll ticks instead of dropping it', async () => {
    const transport = new TechSupportConversationTransport(mockGunService, 'http://api.test');
    const received: Message[][] = [];
    const unsubscribe = transport.subscribeToMessages('conv_support_root_alice', (msgs) => {
      received.push(msgs);
    });

    // Let the initial (server-only) merge-and-notify settle.
    await jest.runOnlyPendingTimersAsync();
    expect(gunCallback).not.toBeNull();

    // The live Gun subscription observes the message that only exists locally.
    gunCallback!([gunOnlyMessage]);
    await jest.runOnlyPendingTimersAsync();
    expect(received[received.length - 1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'msg_gun_only' })]),
    );

    // A poll tick fires 5s later. The server still doesn't have this message (it never
    // reached the server) — the message must still be present, not dropped.
    jest.advanceTimersByTime(5000);
    await jest.runOnlyPendingTimersAsync();
    expect(received[received.length - 1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'msg_gun_only' })]),
    );

    unsubscribe();
  });
});
