import express from 'express';
import request from 'supertest';
import { registerTurnRoutes } from '../../server/routes/turn-routes';
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';

function buildHubRelayClient(overrides: Partial<EmbeddedHubRelayClientLike> = {}): EmbeddedHubRelayClientLike {
  return {
    listMembers: jest.fn().mockResolvedValue([]),
    addMember: jest.fn().mockResolvedValue(undefined),
    touchMember: jest.fn().mockResolvedValue(undefined),
    removeMember: jest.fn().mockResolvedValue(undefined),
    listSignalingFrames: jest.fn().mockResolvedValue([]),
    postSignalingFrame: jest.fn().mockResolvedValue(undefined),
    getPublicUser: jest.fn().mockResolvedValue(null),
    upsertPublicUser: jest.fn().mockResolvedValue(undefined),
    getTurnCredentials: jest.fn().mockResolvedValue({
      username: '123:iinpublic',
      credential: 'hub-minted-credential',
      ttl: 3600,
      urls: ['turn:vps.example.com:3478?transport=udp'],
    }),
    ...overrides,
  };
}

describe('turn routes', () => {
  const originalSecret = process.env.TURN_SHARED_SECRET;
  const originalHost = process.env.TURN_SERVER_HOST;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.TURN_SHARED_SECRET;
    else process.env.TURN_SHARED_SECRET = originalSecret;
    if (originalHost === undefined) delete process.env.TURN_SERVER_HOST;
    else process.env.TURN_SERVER_HOST = originalHost;
  });

  it('returns empty urls when no local TURN config and no hub relay client', async () => {
    delete process.env.TURN_SHARED_SECRET;
    delete process.env.TURN_SERVER_HOST;
    const app = express();
    registerTurnRoutes(app);

    const res = await request(app).get('/api/turn-credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ urls: [] });
  });

  it('mints credentials locally when TURN_SHARED_SECRET/TURN_SERVER_HOST are set', async () => {
    process.env.TURN_SHARED_SECRET = 'test-secret';
    process.env.TURN_SERVER_HOST = 'vps.example.com';
    const app = express();
    const hubRelayClient = buildHubRelayClient();
    registerTurnRoutes(app, { hubRelayClient });

    const res = await request(app).get('/api/turn-credentials');
    expect(res.status).toBe(200);
    expect(res.body.urls).toEqual([
      'turn:vps.example.com:3478?transport=udp',
      'turn:vps.example.com:3478?transport=tcp',
    ]);
    expect(hubRelayClient.getTurnCredentials).not.toHaveBeenCalled();
  });

  it('forwards to the hub relay client on an embedded node with no local TURN config', async () => {
    delete process.env.TURN_SHARED_SECRET;
    delete process.env.TURN_SERVER_HOST;
    const app = express();
    const hubRelayClient = buildHubRelayClient();
    registerTurnRoutes(app, { hubRelayClient });

    const res = await request(app).get('/api/turn-credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      username: '123:iinpublic',
      credential: 'hub-minted-credential',
      ttl: 3600,
      urls: ['turn:vps.example.com:3478?transport=udp'],
    });
    expect(hubRelayClient.getTurnCredentials).toHaveBeenCalledTimes(1);
  });

  it('falls back to empty urls when the hub relay client throws', async () => {
    delete process.env.TURN_SHARED_SECRET;
    delete process.env.TURN_SERVER_HOST;
    const app = express();
    const hubRelayClient = buildHubRelayClient({
      getTurnCredentials: jest.fn().mockRejectedValue(new Error('offline')),
    });
    registerTurnRoutes(app, { hubRelayClient });

    const res = await request(app).get('/api/turn-credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ urls: [] });
  });
});
