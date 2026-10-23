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

  describe('blocks on a phone node (phone-path 04, 2026-10-14)', () => {
    const build = (hub: Partial<EmbeddedHubRelayClientLike>, local = { blocked: false, blockedBy: false }) => {
      const app = express();
      app.use(express.json());
      const userService = {
        blockUser: jest.fn().mockResolvedValue({ changed: true }),
        unblockUser: jest.fn().mockResolvedValue({ changed: true }),
        getBlockStatus: jest.fn().mockResolvedValue({ ...local, eitherBlocked: local.blocked || local.blockedBy }),
      };
      const hubRelayClient = buildHubRelayClient(hub);
      registerUserRoutes(app, { userService: userService as any, hubRelayClient });
      return { app, hubRelayClient };
    };

    it('forwards a block and an unblock to the hub', async () => {
      const setBlock = jest.fn().mockResolvedValue(undefined);
      const { app } = build({ setBlock });
      await request(app).post('/api/users/bob/blocks').send({ targetId: 'alice' }).expect(200);
      await request(app).delete('/api/users/bob/blocks/alice').expect(200);
      expect(setBlock).toHaveBeenNthCalledWith(1, 'bob', 'alice', true);
      expect(setBlock).toHaveBeenNthCalledWith(2, 'bob', 'alice', false);
    });

    it('reports a block made on another device, which only the hub knows', async () => {
      const getBlockStatus = jest.fn().mockResolvedValue({ blocked: false, blockedBy: true });
      const { app } = build({ getBlockStatus });
      const res = await request(app).get('/api/users/alice/block-status/bob').expect(200);
      expect(res.body).toEqual({ blocked: false, blockedBy: true, eitherBlocked: true });
    });

    it('keeps its own answer when the hub cannot be reached', async () => {
      const getBlockStatus = jest.fn().mockRejectedValue(new Error('offline'));
      const { app } = build({ getBlockStatus }, { blocked: true, blockedBy: false });
      const res = await request(app).get('/api/users/bob/block-status/alice').expect(200);
      expect(res.body).toEqual({ blocked: true, blockedBy: false, eitherBlocked: true });
    });
  });

  it('uses the hub as the Friend-mark authority and mirrors locally on a phone node', async () => {
    const app = express();
    app.use(express.json());
    const mark = { markerUserId: 'alice', targetUserId: 'bob', active: true, proof: { signature: 'signed' } };
    const userService = {
      setFriendMark: jest.fn().mockResolvedValue({ changed: true, friendsCount: 12 }),
    };
    const setFriendMark = jest.fn().mockResolvedValue({ changed: true, friendsCount: 12 });
    registerUserRoutes(app, {
      userService: userService as any,
      hubRelayClient: buildHubRelayClient({ setFriendMark }),
    });

    const response = await request(app).put('/api/users/alice/friend-marks/bob').send(mark).expect(200);
    expect(response.body).toMatchObject({ ok: true, changed: true, friendsCount: 12 });
    expect(userService.setFriendMark).toHaveBeenCalledWith(mark);
    expect(setFriendMark).toHaveBeenCalledWith('alice', 'bob', mark);
  });

  it('does not reject a hub-accepted Friend mark when the phone lacks the target profile', async () => {
    const app = express();
    app.use(express.json());
    const mark = { markerUserId: 'alice', targetUserId: 'bob', active: true, proof: { signature: 'signed' } };
    const userService = {
      setFriendMark: jest.fn().mockRejectedValue(new Error('target not cached locally')),
    };
    const setFriendMark = jest.fn().mockResolvedValue({ changed: true, friendsCount: 4 });
    registerUserRoutes(app, {
      userService: userService as any,
      hubRelayClient: buildHubRelayClient({ setFriendMark }),
    });

    const response = await request(app).put('/api/users/alice/friend-marks/bob').send(mark).expect(200);
    expect(response.body).toMatchObject({ ok: true, changed: true, friendsCount: 4 });
    expect(setFriendMark).toHaveBeenCalledWith('alice', 'bob', mark);
  });
});
