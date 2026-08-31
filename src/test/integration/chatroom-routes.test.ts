import express from 'express';
import request from 'supertest';
import { registerChatroomRoutes } from '../../server/routes/chatroom-routes';
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

describe('chatroom routes', () => {
  it('creates a custom or business chatroom', async () => {
    const { app, manager } = buildApp();
    const res = await request(app).post('/api/chatrooms').send({
      name: 'Tech Support',
      type: 'custom',
      createdBy: 'user_1',
      description: 'Support room',
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
      location: { latitude: 91, longitude: 0 },
    });

    expect(invalid.status).toBe(400);
    expect(manager.createChatroom).not.toHaveBeenCalled();
  });

  it('rejects chatroom create when required fields are missing', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/chatrooms').send({ type: 'custom' });
    expect(res.status).toBe(400);
  });

  it('updates and soft deletes a chatroom', async () => {
    const { app, manager } = buildApp();
    const patchRes = await request(app).patch('/api/chatrooms/room_1').send({
      userId: 'owner_1',
      name: 'Renamed',
    });
    expect(patchRes.status).toBe(200);
    expect(manager.updateChatroom).toHaveBeenCalledWith('room_1', 'owner_1', expect.objectContaining({ name: 'Renamed' }));

    const deleteRes = await request(app).delete('/api/chatrooms/room_1').query({ userId: 'owner_1' });
    expect(deleteRes.status).toBe(200);
    expect(manager.deleteChatroom).toHaveBeenCalledWith('room_1', 'owner_1');
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
