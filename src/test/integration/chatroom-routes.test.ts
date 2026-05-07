import express from 'express';
import request from 'supertest';
import { registerChatroomRoutes } from '../../server/routes/chatroom-routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  const manager = {
    getAllChatrooms: jest.fn().mockResolvedValue([]),
    joinChatroom: jest.fn().mockResolvedValue(undefined),
    leaveChatroom: jest.fn().mockResolvedValue(undefined),
    getChatroom: jest.fn().mockResolvedValue(null),
    createChatroom: jest.fn().mockResolvedValue({ id: 'room_1', name: 'Room 1', type: 'custom' }),
    updateChatroom: jest.fn().mockResolvedValue({ id: 'room_1', name: 'Renamed', type: 'custom' }),
    deleteChatroom: jest.fn().mockResolvedValue(undefined),
    getActiveMembersWithStageName: jest.fn().mockResolvedValue([]),
  } as any;
  registerChatroomRoutes(app, { chatroomManager: manager });
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
    expect(manager.joinChatroom).toHaveBeenCalledWith('room_1', 'u2', 'Jerry');

    const removeRes = await request(app).delete('/api/chatrooms/room_1/members/u2');
    expect(removeRes.status).toBe(200);
    expect(manager.leaveChatroom).toHaveBeenCalledWith('room_1', 'u2');
  });
});
