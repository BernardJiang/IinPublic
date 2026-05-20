import { resolveP2PRuntimeFlags, STAR_GUN_PATH_CLASSIFICATIONS } from '../../shared/p2p-runtime';

describe('p2p runtime flags', () => {
  it('defaults to durable star mode with local node and direct chat disabled', () => {
    expect(resolveP2PRuntimeFlags({})).toEqual({
      starServerPersistence: 'durable',
      p2pNodeEnabled: false,
      p2pDirectChatEnabled: false,
    });
  });

  it('accepts explicit ephemeral persistence and enabled P2P flags', () => {
    expect(
      resolveP2PRuntimeFlags({
        STAR_SERVER_PERSISTENCE: 'ephemeral',
        P2P_NODE_ENABLED: 'true',
        P2P_DIRECT_CHAT_ENABLED: '1',
      }),
    ).toEqual({
      starServerPersistence: 'ephemeral',
      p2pNodeEnabled: true,
      p2pDirectChatEnabled: true,
    });
  });

  it('classifies representative star Gun paths', () => {
    expect(STAR_GUN_PATH_CLASSIFICATIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', category: 'durable-public' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', category: 'relay-only' }),
        expect.objectContaining({ path: 'conversations/{conversationId}', category: 'removable-legacy' }),
      ]),
    );
  });
});
