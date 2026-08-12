import { CURRENT_MESH_SYNC_CAPABILITIES, MESH_FRAME_INVENTORY, negotiateMeshSyncMode, translateLegacyTalkBody } from '../../shared/mesh-frame-policy';

describe('PeerMesh frame narrowing and mixed versions', () => {
  test('classifies every current frame kind', () => {
    expect(Object.keys(MESH_FRAME_INVENTORY).sort()).toEqual([
      'ack', 'mesh-ping', 'mesh-pong', 'talk-announce', 'talk-body', 'talk-body-request',
      'talk-response', 'talk-retracted',
    ]);
    expect(MESH_FRAME_INVENTORY['talk-body']).toBe('adapt-to-gun-sync');
  });

  test('new sender and receiver negotiate Gun-native sync', () => {
    expect(negotiateMeshSyncMode(CURRENT_MESH_SYNC_CAPABILITIES, CURRENT_MESH_SYNC_CAPABILITIES)).toBe('gun-native');
  });

  test('new sender falls back to full body for an old receiver', () => {
    expect(negotiateMeshSyncMode(CURRENT_MESH_SYNC_CAPABILITIES, undefined)).toBe('legacy-body');
  });

  test('new receiver translates an old body without changing identity or authorship', () => {
    const translated = translateLegacyTalkBody({ talkId: 'talk-1', authorId: 'alice', authorName: 'Alice', title: 'T', questionCount: 1, talkData: { id: 'talk-1' } });
    expect(translated).toEqual({ talkId: 'talk-1', authorKey: 'alice', talkData: { id: 'talk-1' }, source: 'legacy-talk-body-v1' });
  });
});

