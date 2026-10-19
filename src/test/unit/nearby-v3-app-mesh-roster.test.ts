/** @jest-environment jsdom */
/**
 * In Nearby the mesh's roster is my list (§3.7). Found by web e2e 14-exact-chatbot-memory: warming a
 * link to one peer called `joinRoom('nearby-v3', [me, peer])`, which switched the mesh out of
 * personal mode and replaced the roster until the next list sync switched it back.
 */
import { IinPublicApp } from '../../web/app/app';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';

function appWithMesh(roomId: string) {
  const app: any = Object.create(IinPublicApp.prototype);
  const mesh = {
    joinRoom: jest.fn(async () => undefined),
    openPersonalLink: jest.fn(async () => true),
    waitForConnectedNeighbor: jest.fn(async () => true),
  };
  app.currentUser = { id: 'me', stageName: 'Me' };
  app.ensurePeerMeshService = () => mesh;
  app.chatroomService = { getCurrentChatroomId: () => roomId, getActiveMembers: async () => [] };
  return { app, mesh };
}

describe('Nearby keeps the mesh roster as my list', () => {
  it('warms one link in Nearby without replacing the roster', async () => {
    const { app, mesh } = appWithMesh(NEARBY_V3_ROOM_ID);
    expect(await app.warmMeshConnectionToPeer('peer', 'Peer')).toBe(true);
    expect(mesh.openPersonalLink).toHaveBeenCalledWith('peer');
    expect(mesh.joinRoom).not.toHaveBeenCalled();
  });

  it('still joins a Place room roster to warm a link there', async () => {
    const { app, mesh } = appWithMesh('place_32.71_-117.17_abcdefabcdef');
    expect(await app.warmMeshConnectionToPeer('peer', 'Peer')).toBe(true);
    expect(mesh.joinRoom).toHaveBeenCalled();
    expect(mesh.openPersonalLink).not.toHaveBeenCalled();
  });
});
