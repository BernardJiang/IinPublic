import express from 'express';
import request from 'supertest';
import { registerChatroomRoutes } from '../../server/routes/chatroom-routes';
import { PlaceCreationConflictError } from '../../shared/place-lifecycle';
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';

function buildApp(options: { hubRelayClient?: EmbeddedHubRelayClientLike } = {}) {
  const app = express();
  app.use(express.json());
  const manager = {
    getAllChatrooms: jest.fn().mockResolvedValue([]),
    joinChatroom: jest.fn().mockResolvedValue(undefined),
    addMemberFast: jest.fn().mockResolvedValue(undefined),
    touchMemberFast: jest.fn().mockResolvedValue(undefined),
    leaveChatroom: jest.fn().mockResolvedValue(undefined),
    getChatroom: jest.fn().mockResolvedValue(null),
    createChatroom: jest.fn().mockResolvedValue({ id: 'room_1', name: 'Room 1', type: 'custom' }),
    updateChatroom: jest.fn().mockResolvedValue({ id: 'room_1', name: 'Renamed', type: 'custom' }),
    deleteChatroom: jest.fn().mockResolvedValue(undefined),
    getActiveMembersWithStageName: jest.fn().mockResolvedValue([]),
  } as any;
  registerChatroomRoutes(app, {
    chatroomManager: manager,
    ...(options.hubRelayClient ? { hubRelayClient: options.hubRelayClient } : {}),
  });
  return { app, manager };
}

const placeRoomId = 'place_32.71_-117.17_abcdefabcdef';

describe('chatroom routes', () => {
  it('creates a custom or business chatroom', async () => {
    const { app, manager } = buildApp();
    const res = await request(app).post('/api/chatrooms').send({
      name: 'Tech Support',
      type: 'custom',
      createdBy: 'user_1',
      description: 'Support room',
      anchorCell: 'region_32.71_-117.17',
    });
    expect(res.status).toBe(201);
    expect(manager.createChatroom).toHaveBeenCalledTimes(1);
  });

  it('accepts valid public chatroom coordinates and rejects invalid coordinates', async () => {
    const { app, manager } = buildApp();
    const valid = await request(app).post('/api/chatrooms').send({
      name: 'Coffee discussion',
      type: 'custom',
      createdBy: 'user_1',
      anchorCell: 'region_32.71_-117.17',
      location: { latitude: 32.7157, longitude: -117.1611 },
    });

    expect(valid.status).toBe(201);
    expect(manager.createChatroom).toHaveBeenCalledWith(
      expect.objectContaining({ location: { latitude: 32.7157, longitude: -117.1611 } }),
    );

    manager.createChatroom.mockClear();
    const invalid = await request(app).post('/api/chatrooms').send({
      name: 'Impossible room',
      type: 'custom',
      createdBy: 'user_1',
      anchorCell: 'region_32.71_-117.17',
      location: { latitude: 91, longitude: 0 },
    });

    expect(invalid.status).toBe(400);
    expect(manager.createChatroom).not.toHaveBeenCalled();
  });

  it('requires a blurred anchor cell (custom rooms are local) and a pin inside that cell', async () => {
    const { app, manager } = buildApp();
    const noAnchor = await request(app).post('/api/chatrooms').send({ name: 'Taiwan', type: 'custom', createdBy: 'user_1' });
    expect(noAnchor.status).toBe(400);
    const badAnchor = await request(app).post('/api/chatrooms').send({ name: 'X', type: 'custom', createdBy: 'user_1', anchorCell: 'usa' });
    expect(badAnchor.status).toBe(400);
    const pinElsewhere = await request(app).post('/api/chatrooms').send({
      name: 'Far pin', type: 'business', createdBy: 'user_1', anchorCell: 'region_32.71_-117.17',
      location: { latitude: 34.05, longitude: -118.24 },
    });
    expect(pinElsewhere.status).toBe(400);
    expect(manager.createChatroom).not.toHaveBeenCalled();
  });

  it('rejects chatroom create when required fields are missing', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/chatrooms').send({ type: 'custom' });
    expect(res.status).toBe(400);
  });

  it('retires owner mutation and deletion routes', async () => {
    const { app, manager } = buildApp();
    const patchRes = await request(app).patch('/api/chatrooms/room_1').send({
      userId: 'owner_1',
      name: 'Renamed',
    });
    expect(patchRes.status).toBe(410);
    expect(manager.updateChatroom).not.toHaveBeenCalled();

    const deleteRes = await request(app).delete('/api/chatrooms/room_1').query({ userId: 'owner_1' });
    expect(deleteRes.status).toBe(410);
    expect(manager.deleteChatroom).not.toHaveBeenCalled();
  });

  it('supports chatroom membership list and add/remove', async () => {
    const { app, manager } = buildApp();
    manager.getActiveMembersWithStageName.mockResolvedValue([{ userId: 'u1', stageName: 'Tom' }]);

    const listRes = await request(app).get('/api/chatrooms/room_1/members');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([{ userId: 'u1', stageName: 'Tom' }]);

    const addRes = await request(app).post('/api/chatrooms/room_1/members').send({
      userId: 'u2',
      stageName: 'Jerry',
    });
    expect(addRes.status).toBe(200);
    expect(manager.addMemberFast).toHaveBeenCalledWith('room_1', 'u2', 'Jerry');

    const touchRes = await request(app).patch('/api/chatrooms/room_1/members/u2').send({
      stageName: 'Jerry',
      lastSeen: '2026-07-06T00:00:00.000Z',
    });
    expect(touchRes.status).toBe(200);
    expect(manager.touchMemberFast).toHaveBeenCalledWith('room_1', 'u2', {
      stageName: 'Jerry',
      lastSeen: '2026-07-06T00:00:00.000Z',
    });

    const removeRes = await request(app).delete('/api/chatrooms/room_1/members/u2');
    expect(removeRes.status).toBe(200);
    expect(manager.leaveChatroom).toHaveBeenCalledWith('room_1', 'u2');
  });

  it('keeps no hub roster for a Place: its people are each one\'s own list', async () => {
    const relay = placeRelayDouble({});
    const { app, manager } = buildApp({ hubRelayClient: relay });
    const roomPath = `/api/chatrooms/${placeRoomId}`;
    const responses = await Promise.all([
      request(app).post(`${roomPath}/members`).send({ userId: 'u1', stageName: 'One' }),
      request(app).patch(`${roomPath}/members/u1`).send({ stageName: 'One' }),
      request(app).get(`${roomPath}/members`),
      request(app).post(`${roomPath}/join`).send({ userId: 'u1' }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(410);
      expect(response.body.code).toBe('PLACE_HAS_NO_ROSTER');
    }
    expect(manager.addMemberFast).not.toHaveBeenCalled();
    expect(manager.touchMemberFast).not.toHaveBeenCalled();
    expect(manager.joinChatroom).not.toHaveBeenCalled();
    expect(relay.addMember).not.toHaveBeenCalled();
    expect(relay.listMembers).not.toHaveBeenCalled();
  });

  function placeRelayDouble(overrides: Partial<EmbeddedHubRelayClientLike>): EmbeddedHubRelayClientLike {
    return {
      listMembers: jest.fn().mockResolvedValue([]),
      addMember: jest.fn().mockResolvedValue(undefined),
      touchMember: jest.fn().mockResolvedValue(undefined),
      removeMember: jest.fn().mockResolvedValue(undefined),
      listSignalingFrames: jest.fn().mockResolvedValue([]),
      postSignalingFrame: jest.fn().mockResolvedValue(undefined),
      getPublicUser: jest.fn().mockResolvedValue(null),
      upsertPublicUser: jest.fn().mockResolvedValue(undefined),
      getTurnCredentials: jest.fn().mockResolvedValue({ username: '', credential: '', ttl: 0, urls: [] }),
      listSupportMessages: jest.fn().mockResolvedValue([]),
      postSupportMessage: jest.fn().mockResolvedValue(undefined),
      postDelegateRequest: jest.fn().mockResolvedValue(undefined),
      listDelegateGrants: jest.fn().mockResolvedValue([]),
      getFaqBundle: jest.fn().mockResolvedValue(null),
      postFaqBundle: jest.fn().mockResolvedValue(undefined),
      postMailboxEnvelope: jest.fn().mockResolvedValue(undefined),
      listMailboxEnvelopes: jest.fn().mockResolvedValue([]),
      getGraphBlob: jest.fn().mockResolvedValue(null),
      putGraphBlob: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  const placeBody = {
    name: 'Bean There',
    type: 'business',
    createdBy: 'user_1',
    anchorCell: 'region_-22.85_-43.07',
  };

  it('an embedded node publishes a new room at the hub before saving it locally', async () => {
    const publishChatroom = jest.fn().mockResolvedValue({ status: 201, body: { id: 'place_bx' } });
    const { app, manager } = buildApp({ hubRelayClient: placeRelayDouble({ publishChatroom }) });
    const res = await request(app).post('/api/chatrooms').send(placeBody);
    expect(res.status).toBe(201);
    expect(publishChatroom).toHaveBeenCalledWith(placeBody);
    expect(manager.createChatroom).toHaveBeenCalledTimes(1);
  });

  it('an embedded node keeps no local-only room when the hub rejects or is unreachable', async () => {
    const rejected = buildApp({
      hubRelayClient: placeRelayDouble({
        publishChatroom: jest.fn().mockResolvedValue({ status: 400, body: { error: 'invalid place signature' } }),
      }),
    });
    const rejectedRes = await request(rejected.app).post('/api/chatrooms').send(placeBody);
    expect(rejectedRes.status).toBe(400);
    expect(rejectedRes.body).toEqual({ error: 'invalid place signature' });
    expect(rejected.manager.createChatroom).not.toHaveBeenCalled();

    const offline = buildApp({
      hubRelayClient: placeRelayDouble({ publishChatroom: jest.fn().mockRejectedValue(new Error('aborted')) }),
    });
    const offlineRes = await request(offline.app).post('/api/chatrooms').send(placeBody);
    expect(offlineRes.status).toBe(503);
    expect(offline.manager.createChatroom).not.toHaveBeenCalled();
  });

  it('an embedded node lists the hub rooms along with its own', async () => {
    const { app, manager } = buildApp({
      hubRelayClient: placeRelayDouble({
        listChatrooms: jest.fn().mockResolvedValue([{ id: 'place_a', name: 'Hub copy' }, { id: 'place_b', name: 'B' }]),
      }),
    });
    manager.getAllChatrooms.mockResolvedValue([{ id: 'place_a', name: 'Local' }]);
    const res = await request(app).get('/api/chatrooms');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'place_a', name: 'Local' }, { id: 'place_b', name: 'B' }]);

    const offline = buildApp({
      hubRelayClient: placeRelayDouble({ listChatrooms: jest.fn().mockRejectedValue(new Error('aborted')) }),
    });
    offline.manager.getAllChatrooms.mockResolvedValue([{ id: 'place_a', name: 'Local' }]);
    expect((await request(offline.app).get('/api/chatrooms')).body).toEqual([{ id: 'place_a', name: 'Local' }]);
  });

  it('answers a refused Place creation with 409 and the reason', async () => {
    const { app, manager } = buildApp();
    manager.createChatroom.mockRejectedValue(new PlaceCreationConflictError({
      code: 'PLACE_NAME_TAKEN', existingId: 'place_bexisting', existingName: 'Bean There',
    }));
    const res = await request(app).post('/api/chatrooms').send(placeBody);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'PLACE_NAME_TAKEN', existingId: 'place_bexisting', existingName: 'Bean There' });
  });

  it('lists only live Places, plus the caller\'s own expired Place', async () => {
    const { app, manager } = buildApp();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const placeId = (n: number) => `place_b${String(n).repeat(55)}`;
    manager.getAllChatrooms.mockResolvedValue([
      { id: placeId(1), name: 'Live', createdAt: fresh, creatorPub: 'pubA' },
      { id: placeId(2), name: 'Expired', createdAt: old, creatorPub: 'pubA' },
      { id: placeId(3), name: 'Revived', createdAt: old, lastActiveAt: fresh, creatorPub: 'pubB' },
      { id: placeId(4), name: 'Mine', createdAt: old, creatorPub: 'pubMe' },
    ]);
    const anyone = await request(app).get('/api/chatrooms');
    expect(anyone.body.map((room: { name: string }) => room.name)).toEqual(['Live', 'Revived']);
    const creator = await request(app).get('/api/chatrooms').query({ creatorPub: 'pubMe' });
    expect(creator.body.map((room: { name: string }) => room.name)).toEqual(['Live', 'Revived', 'Mine']);
  });

  it('mirrors local membership writes to the explicit hub relay', async () => {
    const hubRelayClient: EmbeddedHubRelayClientLike = {
      listMembers: jest.fn().mockResolvedValue([{ userId: 'remote_1', stageName: 'Remote' }]),
      addMember: jest.fn().mockResolvedValue(undefined),
      touchMember: jest.fn().mockResolvedValue(undefined),
      removeMember: jest.fn().mockResolvedValue(undefined),
      listSignalingFrames: jest.fn().mockResolvedValue([]),
      postSignalingFrame: jest.fn().mockResolvedValue(undefined),
      getPublicUser: jest.fn().mockResolvedValue(null),
      upsertPublicUser: jest.fn().mockResolvedValue(undefined),
      getTurnCredentials: jest.fn().mockResolvedValue({ username: '', credential: '', ttl: 0, urls: [] }),
      listSupportMessages: jest.fn().mockResolvedValue([]),
      postSupportMessage: jest.fn().mockResolvedValue(undefined),
      postDelegateRequest: jest.fn().mockResolvedValue(undefined),
      listDelegateGrants: jest.fn().mockResolvedValue([]),
      getFaqBundle: jest.fn().mockResolvedValue(null),
      postFaqBundle: jest.fn().mockResolvedValue(undefined),
      postMailboxEnvelope: jest.fn().mockResolvedValue(undefined),
      listMailboxEnvelopes: jest.fn().mockResolvedValue([]),
      getGraphBlob: jest.fn().mockResolvedValue(null),
      putGraphBlob: jest.fn().mockResolvedValue(undefined),
    };
    const { app, manager } = buildApp({ hubRelayClient });

    const addRes = await request(app).post('/api/chatrooms/global/members').send({
      userId: 'local_1',
      stageName: 'Local',
    });

    expect(addRes.status).toBe(200);
    expect(hubRelayClient.addMember).toHaveBeenCalledWith('global', 'local_1', 'Local');
    expect(hubRelayClient.listMembers).toHaveBeenCalledWith('global');
    expect(manager.touchMemberFast).toHaveBeenCalledWith('global', 'remote_1', {
      stageName: 'Remote',
      lastSeen: expect.any(String),
    });
  });

  it('merges explicit hub relay members into the local members endpoint', async () => {
    const hubRelayClient: EmbeddedHubRelayClientLike = {
      listMembers: jest.fn().mockResolvedValue([
        { userId: 'remote_1', stageName: 'Remote' },
        { userId: 'local_1', stageName: 'Local From Hub' },
      ]),
      addMember: jest.fn().mockResolvedValue(undefined),
      touchMember: jest.fn().mockResolvedValue(undefined),
      removeMember: jest.fn().mockResolvedValue(undefined),
      listSignalingFrames: jest.fn().mockResolvedValue([]),
      postSignalingFrame: jest.fn().mockResolvedValue(undefined),
      getPublicUser: jest.fn().mockResolvedValue(null),
      upsertPublicUser: jest.fn().mockResolvedValue(undefined),
      getTurnCredentials: jest.fn().mockResolvedValue({ username: '', credential: '', ttl: 0, urls: [] }),
      listSupportMessages: jest.fn().mockResolvedValue([]),
      postSupportMessage: jest.fn().mockResolvedValue(undefined),
      postDelegateRequest: jest.fn().mockResolvedValue(undefined),
      listDelegateGrants: jest.fn().mockResolvedValue([]),
      getFaqBundle: jest.fn().mockResolvedValue(null),
      postFaqBundle: jest.fn().mockResolvedValue(undefined),
      postMailboxEnvelope: jest.fn().mockResolvedValue(undefined),
      listMailboxEnvelopes: jest.fn().mockResolvedValue([]),
      getGraphBlob: jest.fn().mockResolvedValue(null),
      putGraphBlob: jest.fn().mockResolvedValue(undefined),
    };
    const { app, manager } = buildApp({ hubRelayClient });
    manager.getActiveMembersWithStageName.mockResolvedValue([{ userId: 'local_1', stageName: 'Local' }]);

    const res = await request(app).get('/api/chatrooms/global/members');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { userId: 'local_1', stageName: 'Local From Hub' },
      { userId: 'remote_1', stageName: 'Remote' },
    ]);
    expect(manager.touchMemberFast).toHaveBeenCalledWith('global', 'remote_1', {
      stageName: 'Remote',
      lastSeen: expect.any(String),
    });
  });
});
