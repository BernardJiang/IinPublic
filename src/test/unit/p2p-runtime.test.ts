import {
  applyLocalNodeAction,
  createLocalNodeSupervisorSnapshot,
  resolveP2PRuntimeFlags,
  STAR_GUN_PATH_CLASSIFICATIONS,
} from '../../shared/p2p-runtime';

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

  it('models the permissioned local node supervisor lifecycle', () => {
    const initial = createLocalNodeSupervisorSnapshot();

    expect(initial.status).toBe('stopped');
    expect(initial.permissionDisclosures.map((item) => item.key)).toEqual(
      expect.arrayContaining(['storage', 'bandwidth', 'battery', 'background', 'local-port', 'delete-stop']),
    );
    expect(initial.sessionPairing).toEqual(
      expect.objectContaining({
        required: true,
        trustModel: 'signed-session-pairing',
      }),
    );
    expect(initial.persistenceControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'neighbor-cache', localOnly: true }),
        expect.objectContaining({ dataClass: 'message-history', localOnly: true }),
      ]),
    );

    const running = applyLocalNodeAction(initial, 'start', new Date('2026-05-20T00:00:00.000Z'));
    expect(running.status).toBe('running');
    expect(running.health.ok).toBe(true);

    const bound = applyLocalNodeAction(running, 'bind-identity', new Date('2026-05-20T00:00:01.000Z'), {
      webIdentityId: 'web_pub',
      nodeIdentityId: 'node_pub',
      proof: 'signed-proof',
    });
    expect(bound.identityBinding).toEqual(
      expect.objectContaining({ webIdentityId: 'web_pub', nodeIdentityId: 'node_pub', proof: 'signed-proof' }),
    );

    const wiped = applyLocalNodeAction(bound, 'wipe', new Date('2026-05-20T00:00:02.000Z'));
    expect(wiped.status).toBe('wiped');
    expect(wiped.identityBinding).toBeNull();
  });
});
