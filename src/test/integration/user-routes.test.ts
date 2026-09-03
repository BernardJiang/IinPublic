import express from 'express';
import request from 'supertest';
import { registerUserRoutes } from '../../server/routes/user-routes';
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
    getTurnCredentials: jest.fn().mockResolvedValue({ username: '', credential: '', ttl: 0, urls: [] }),
    ...overrides,
  };
}

describe('user routes', () => {
  it('falls back to the explicit hub relay when local user data lacks public keys', async () => {
    const app = express();
    app.use(express.json());
    const userService = {
      getUser: jest.fn().mockResolvedValue({
        conversations: { '#': 'users/browser_1/conversations' },
      }),
      isBlocked: jest.fn(),
      upsertPublicUser: jest.fn(),
    };
    const hubRelayClient = buildHubRelayClient({
      getPublicUser: jest.fn().mockResolvedValue({
        id: 'browser_1',
        stageName: 'Browser',
        pub: 'pub_browser',
        epub: 'epub_browser',
      }),
    });
    registerUserRoutes(app, { userService: userService as any, hubRelayClient });

    const res = await request(app).get('/api/users/browser_1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'browser_1',
      stageName: 'Browser',
      pub: 'pub_browser',
      epub: 'epub_browser',
    });
    expect(hubRelayClient.getPublicUser).toHaveBeenCalledWith('browser_1');
  });
});
