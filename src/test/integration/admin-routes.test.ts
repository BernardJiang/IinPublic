import express from 'express';
import request from 'supertest';
import { registerAdminRoutes } from '../../server/routes/admin-routes';

describe('admin announcement routes', () => {
  it('requires TechSupport authorization and creates authorized announcements', async () => {
    const app = express();
    app.use(express.json());
    const announcementService = {
      verifyAdminAuthorization: jest.fn().mockResolvedValue(true),
      createAnnouncement: jest.fn().mockResolvedValue({ id: 'notice-1', text: 'Maintenance' }),
    };
    registerAdminRoutes(app, announcementService as any);

    const unauthorized = await request(app).post('/api/admin/announcements').send({
      text: 'Maintenance', expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await request(app).post('/api/admin/announcements').send({
      text: ' Maintenance ',
      expiresAt: '2030-01-01T00:00:00.000Z',
      requestedAt: new Date().toISOString(),
      authorization: 'SEA{signed}',
    });
    expect(authorized.status).toBe(201);
    expect(announcementService.verifyAdminAuthorization).toHaveBeenCalledWith(expect.objectContaining({ text: 'Maintenance' }));
    expect(announcementService.createAnnouncement).toHaveBeenCalledWith({
      text: 'Maintenance', expiresAt: '2030-01-01T00:00:00.000Z',
    });
  });
});
