import express from 'express';
import request from 'supertest';
import { registerChatroomRoutes } from '../../server/routes/chatroom-routes';
import {
  EmbeddedHubRelayRequestError,
  type EmbeddedHubRelayClientLike,
} from '../../node-app/embedded-hub-relay-client';

function buildApp(options: { hubRelayClient?: EmbeddedHubRelayClientLike; chatroomCapacity?: number } = {}) {
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
    ...(options.chatroomCapacity != null ? { chatroomCapacity: options.chatroomCapacity } : {}),
  });
  return { app, manager };
}

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

  it('rejects a new member when a Place has reached the global capacity', async () => {
    const { app, manager } = buildApp({ chatroomCapacity: 2 });
    manager.getActiveMembersWithStageName.mockResolvedValue([
      { userId: 'u1', stageName: 'One' },
      { userId: 'u2', stageName: 'Two' },
    ]);

    const response = await request(app)
      .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/members')
      .send({ userId: 'u3', stageName: 'Three', reserveOnly: true });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'Place is full', code: 'PLACE_FULL', capacity: 2 });
    expect(manager.addMemberFast).not.toHaveBeenCalled();
  });

  it('does not let the legacy join endpoint bypass Place admission', async () => {
    const { app, manager } = buildApp({ chatroomCapacity: 2 });

    const response = await request(app)
      .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/join')
      .send({ userId: 'u3' });

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('PLACE_ADMISSION_REQUIRED');
    expect(manager.joinChatroom).not.toHaveBeenCalled();
  });

  it('allows an admitted Place member to refresh a seat after the Place becomes full', async () => {
    const { app, manager } = buildApp({ chatroomCapacity: 2 });
    manager.getActiveMembersWithStageName.mockResolvedValue([
      { userId: 'u1', stageName: 'One' },
      { userId: 'u2', stageName: 'Two' },
    ]);

    const response = await request(app)
      .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/members')
      .send({ userId: 'u2', stageName: 'Two refreshed', isTraveler: true });

    expect(response.status).toBe(200);
    expect(manager.addMemberFast).toHaveBeenCalledWith(
      'place_32.71_-117.17_abcdefabcdef',
      'u2',
      'Two refreshed',
      true,
    );
  });

  it('serializes simultaneous Place admissions so no more than C are accepted', async () => {
    const { app, manager } = buildApp({ chatroomCapacity: 2 });
    const active: Array<{ userId: string; stageName: string }> = [];
    manager.getActiveMembersWithStageName.mockImplementation(async () => [...active]);
    manager.addMemberFast.mockImplementation(async (_roomId: string, userId: string, stageName: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.push({ userId, stageName });
    });

    const reservations = await Promise.all(
      ['u1', 'u2', 'u3'].map((userId) => request(app)
        .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/members')
        .send({ userId, stageName: userId.toUpperCase(), reserveOnly: true })),
    );

    expect(reservations.map((response) => response.status).sort()).toEqual([200, 200, 409]);
    expect(active).toHaveLength(0);
    const admitted = reservations.filter((response) => response.status === 200);
    const commits = await Promise.all(admitted.map((reservation, index) => request(app)
      .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/members')
      .send({
        userId: `u${index + 1}`,
        stageName: `U${index + 1}`,
        reservationToken: reservation.body.reservationToken,
      })));
    expect(commits.map((response) => response.status)).toEqual([200, 200]);
    expect(active).toHaveLength(2);
    expect(manager.addMemberFast).toHaveBeenCalledTimes(2);
  });

  it('releases an uncommitted Place reservation and rejects heartbeat admission bypasses', async () => {
    const { app, manager } = buildApp({ chatroomCapacity: 1 });
    const roomPath = '/api/chatrooms/place_32.71_-117.17_abcdefabcdef';
    const first = await request(app).post(`${roomPath}/members`).send({ userId: 'u1', reserveOnly: true });
    expect(first.status).toBe(200);
    expect(await request(app).post(`${roomPath}/members`).send({ userId: 'u2', reserveOnly: true }))
      .toMatchObject({ status: 409 });

    const heartbeat = await request(app).patch(`${roomPath}/members/u2`).send({ stageName: 'Two' });
    expect(heartbeat.status).toBe(409);
    expect(heartbeat.body.code).toBe('PLACE_ADMISSION_REQUIRED');
    expect(manager.touchMemberFast).not.toHaveBeenCalled();

    expect(await request(app).delete(`${roomPath}/members/u1`)).toMatchObject({ status: 200 });
    expect(await request(app).post(`${roomPath}/members`).send({ userId: 'u2', reserveOnly: true }))
      .toMatchObject({ status: 200 });
  });

  it('honors the upstream hub rejection before writing embedded Place presence locally', async () => {
    const hubRelayClient = {
      listMembers: jest.fn().mockResolvedValue([]),
      reservePlaceMember: jest.fn().mockRejectedValue(new EmbeddedHubRelayRequestError(
        409,
        '{"code":"PLACE_FULL"}',
        'upstream Place is full',
      )),
      addMember: jest.fn(),
    } as any;
    const { app, manager } = buildApp({ hubRelayClient, chatroomCapacity: 2 });

    const response = await request(app)
      .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/members')
      .send({ userId: 'u3', stageName: 'Three', reserveOnly: true });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PLACE_FULL');
    expect(manager.addMemberFast).not.toHaveBeenCalled();
  });

  it('fails a distributed Place admission closed when the hub roster is unavailable', async () => {
    const hubRelayClient = {
      listMembers: jest.fn().mockRejectedValue(new Error('offline')),
      addMember: jest.fn(),
    } as any;
    const { app, manager } = buildApp({ hubRelayClient, chatroomCapacity: 2 });

    const response = await request(app)
      .post('/api/chatrooms/place_32.71_-117.17_abcdefabcdef/members')
      .send({ userId: 'u3', stageName: 'Three', reserveOnly: true });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PLACE_ADMISSION_UNAVAILABLE');
    expect(hubRelayClient.addMember).not.toHaveBeenCalled();
    expect(manager.addMemberFast).not.toHaveBeenCalled();
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
