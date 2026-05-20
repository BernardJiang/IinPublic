import express from 'express';
import request from 'supertest';
import { registerSystemRoutes } from '../../server/routes/system-routes';

function buildApp(nodeEnv = 'test') {
  const app = express();
  app.use(express.json());
  const gun = {
    _: {
      graph: {
        'chatrooms/global': {},
        'users/user_1/publicProfile': {},
        'incomingTalksByUser/user_2': {},
      },
      opt: { radisk: true },
    },
  };
  const statsIdx = {
    byDay: new Map<string, Set<string>>(),
    byRegion: new Map<string, Set<string>>(),
    byTalkAnswer: new Map<string, Set<string>>(),
  };
  registerSystemRoutes(app, {
    gun,
    incomingTalksMap: new Map(),
    conversationsMap: new Map(),
    talkResponsesMap: new Map(),
    statsIdx,
    clearTalkResponseStats: jest.fn(),
    nodeEnv,
  });
  return { app, gun };
}

describe('system routes', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reports star-mode storage policy and path classifications in non-production', async () => {
    process.env.STAR_SERVER_PERSISTENCE = 'durable';
    process.env.P2P_NODE_ENABLED = 'false';
    process.env.P2P_DIRECT_CHAT_ENABLED = 'false';

    const { app } = buildApp();
    const res = await request(app).get('/api/debug/storage');

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('star');
    expect(res.body.topology).toEqual({
      browser: 'Gun client',
      hub: 'Node Gun hub',
      routes: 'HTTP/Socket API',
    });
    expect(res.body.flags).toEqual({
      starServerPersistence: 'durable',
      p2pNodeEnabled: false,
      p2pDirectChatEnabled: false,
    });
    expect(res.body.localNode).toEqual(
      expect.objectContaining({
        status: 'stopped',
        sessionPairing: expect.objectContaining({ trustModel: 'signed-session-pairing' }),
        permissionDisclosures: expect.arrayContaining([
          expect.objectContaining({ key: 'storage' }),
          expect.objectContaining({ key: 'local-port' }),
        ]),
      }),
    );
    expect(res.body.serverPersistence).toEqual(
      expect.objectContaining({
        radisk: true,
        policy: 'durable',
        graphSouls: 3,
      }),
    );
    expect(res.body.serverPersistence.topLevelCounts).toEqual({
      chatrooms: 1,
      users: 1,
      incomingTalksByUser: 1,
    });
    expect(res.body.pathClassifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', category: 'durable-public' }),
        expect.objectContaining({ path: 'incomingTalksByUser/{userId}', category: 'relay-only' }),
        expect.objectContaining({ path: 'conversations/{conversationId}', category: 'removable-legacy' }),
      ]),
    );
  });

  it('does not expose debug storage in production', async () => {
    const { app } = buildApp('production');
    const res = await request(app).get('/api/debug/storage');

    expect(res.status).toBe(404);
  });

  it('supervises local node start, health-check, identity binding, and wipe in non-production', async () => {
    const { app } = buildApp();

    const started = await request(app).post('/api/p2p/local-node/start').send({});
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('running');
    expect(started.body.health.ok).toBe(true);

    const bound = await request(app).post('/api/p2p/local-node/bind-identity').send({
      webIdentityId: 'web_pub',
      nodeIdentityId: 'node_pub',
      proof: 'signed-proof',
    });
    expect(bound.status).toBe(200);
    expect(bound.body.identityBinding).toEqual(
      expect.objectContaining({ webIdentityId: 'web_pub', nodeIdentityId: 'node_pub' }),
    );

    const health = await request(app).post('/api/p2p/local-node/health-check').send({});
    expect(health.status).toBe(200);
    expect(health.body.health.reason).toBe('Local node health check passed.');

    const wiped = await request(app).post('/api/p2p/local-node/wipe').send({});
    expect(wiped.status).toBe(200);
    expect(wiped.body.status).toBe('wiped');
    expect(wiped.body.identityBinding).toBeNull();
  });
});
