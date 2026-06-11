/**
 * P0 step 7 — star talk-delivery endpoints are removed (404).
 *
 * Ensures that the deleted server-side star routes are not accidentally
 * re-introduced: POST /api/talks/:id/received, POST /api/talks/:id/response,
 * GET /api/incoming-talks, GET /api/users/:id/peers, GET /api/users/:id/replies,
 * GET /api/users/:id/peers/:peerId/relationship, GET /api/users/:id/peers/:peerId/talk-history,
 * POST /api/stats/talks/:id/record.
 */
import express from 'express';
import request from 'supertest';
import { registerSystemRoutes } from '../../server/routes/system-routes';
import { registerTalkRoutes } from '../../server/routes/talk-routes';
import { registerStatsRoutes } from '../../server/routes/stats-routes';
import { registerUserRoutes } from '../../server/routes/user-routes';
import { GunService } from '../../server/services/gun-service';
import { UserService } from '../../server/services/user-service';
import { TalkService } from '../../server/services/talk-service';
import { ReputationService } from '../../server/services/reputation-service';

function buildApp() {
  const app = express();
  app.use(express.json());

  // Minimal Gun stub
  const gun = {
    _: {
      graph: {},
      opt: { radisk: false },
    },
    get: () => ({ put: () => {}, on: () => {}, once: () => {} }),
    on: () => {},
  } as unknown as any;

  const gunService = new GunService(gun);
  const reputationService = new ReputationService(gunService);
  const userService = new UserService(gunService);
  const talkService = new TalkService(gunService, reputationService);

  registerSystemRoutes(app, { gun, gunService, nodeEnv: 'test' });
  registerTalkRoutes(app, {
    talkService,
    loadTalkDataFromGraphOrBody: async () => null,
  });
  registerStatsRoutes(app, { talkService });
  registerUserRoutes(app, { userService });

  return app;
}

describe('P0 step 7 — star talk-delivery endpoints return 404', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  it('POST /api/talks/:id/received → 404', async () => {
    const res = await request(app).post('/api/talks/talk_abc/received').send({});
    expect(res.status).toBe(404);
  });

  it('POST /api/talks/:id/response → 404', async () => {
    const res = await request(app).post('/api/talks/talk_abc/response').send({});
    expect(res.status).toBe(404);
  });

  it('GET /api/incoming-talks → 404', async () => {
    const res = await request(app).get('/api/incoming-talks');
    expect(res.status).toBe(404);
  });

  it('GET /api/users/:id/peers → 404', async () => {
    const res = await request(app).get('/api/users/user_alice/peers');
    expect(res.status).toBe(404);
  });

  it('GET /api/users/:id/replies → 404', async () => {
    const res = await request(app).get('/api/users/user_alice/replies');
    expect(res.status).toBe(404);
  });

  it('GET /api/users/:id/peers/:peerId/relationship → 404', async () => {
    const res = await request(app).get('/api/users/user_alice/peers/user_bob/relationship');
    expect(res.status).toBe(404);
  });

  it('GET /api/users/:id/peers/:peerId/talk-history → 404', async () => {
    const res = await request(app).get('/api/users/user_alice/peers/user_bob/talk-history');
    expect(res.status).toBe(404);
  });

  it('POST /api/stats/talks/:id/record → 404', async () => {
    const res = await request(app).post('/api/stats/talks/talk_abc/record').send({});
    expect(res.status).toBe(404);
  });

  it('GET /api/talks/:id still works (Gun read-through kept)', async () => {
    // Returns 202 "pending" when Gun graph has no data, not 404
    const res = await request(app).get('/api/talks/nonexistent_talk_id');
    expect(res.status).toBe(202);
    expect(res.body.pending).toBe(true);
  });
});
