import type express from 'express';
import type { QuestionAnswer, RelationshipLabel, Tag } from '../../shared/types';
import { UserService } from '../services/user-service';
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';

type RegisterUserRoutesDeps = {
  userService: UserService;
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

export function registerUserRoutes(
  app: express.Application,
  { userService, hubRelayClient }: RegisterUserRoutesDeps,
): void {
  const publicResponse = <T extends { profile?: QuestionAnswer[] }>(record: T) => {
    const { knownPeople: _contacts, blockedUserIds: _blocks, receivedBlockSignals: _received,
      sharedBlockSignals: _shared, talkFilters: _filters, ...publicFields } = record as T & {
        knownPeople?: unknown; blockedUserIds?: unknown; receivedBlockSignals?: unknown;
        sharedBlockSignals?: unknown; talkFilters?: unknown;
      };
    return {
      ...publicFields,
      profile: (record.profile || []).filter((entry) => (entry.visibility || 'public') === 'public'),
      knownPeople: [],
    };
  };
  const getRemotePublicUser = async (userId: string) => {
    if (!hubRelayClient) return null;
    try {
      const remoteUser = await hubRelayClient.getPublicUser(userId);
      return remoteUser?.id ? publicResponse(remoteUser) : null;
    } catch {
      return null;
    }
  };

  app.post('/api/users', async (req, res) => {
    try {
      const user = await userService.upsertPublicUser(req.body);
      if (hubRelayClient) {
        void hubRelayClient.upsertPublicUser(user).catch(() => undefined);
      }
      res.json(publicResponse(user));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/users/:id', async (req, res) => {
    try {
      const rawViewer = req.query.viewerId;
      const qViewer = typeof rawViewer === 'string' ? rawViewer.trim() : '';
      if (qViewer && qViewer !== req.params.id) {
        // Only need the "blocked by target" direction — one Gun read instead of two.
        const blockedByTarget = await userService.isBlocked(req.params.id, qViewer);
        if (blockedByTarget) {
          res.status(403).json({ error: 'Profile is not available', blockedBy: true });
          return;
        }
      }
      // A caller-supplied viewerId is not authentication. Until contact views have a verified
      // audience, this public route serves only public profile rows even to a claimed owner.
      const user = await userService.getUser(req.params.id, { viewerId: null });
      if ((!user.id || !user.pub || !user.epub) && hubRelayClient) {
        const remoteUser = await getRemotePublicUser(req.params.id);
        if (remoteUser?.id) {
          res.json(remoteUser);
          return;
        }
      }
      res.json(publicResponse(user));
    } catch (error) {
      const remoteUser = await getRemotePublicUser(req.params.id);
      if (remoteUser?.id) {
        res.json(remoteUser);
        return;
      }
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.post('/api/users/:id/public-profile-foundation', async (req, res) => {
    try {
      const body = req.body as {
        headshot?: string;
        languages?: string[];
        profile?: QuestionAnswer[];
        interests?: Tag[];
      };
      await userService.updatePublicProfileFoundation(req.params.id, {
        headshot: typeof body.headshot === 'string' ? body.headshot : '',
        languages: Array.isArray(body.languages) ? body.languages : ['en'],
        profile: Array.isArray(body.profile)
          ? body.profile.filter((entry) => entry && typeof entry === 'object' && (entry.visibility || 'public') === 'public')
          : [],
        interests: Array.isArray(body.interests) ? body.interests : [],
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/users/:id/known-people', async (req, res) => {
    try {
      const { targetId, label, nickname, customLabel, rating, notes } = req.body as {
        targetId?: string;
        label?: string;
        nickname?: string;
        customLabel?: string;
        rating?: number;
        notes?: string;
      };
      if (!targetId || !label) {
        res.status(400).json({ error: 'targetId and label required' });
        return;
      }
      const extras = {
        ...(customLabel ? { customLabel } : {}),
        ...(typeof rating === 'number' ? { rating } : {}),
        ...(notes ? { notes } : {}),
      };
      await userService.addKnownPerson(
        req.params.id,
        targetId,
        label as RelationshipLabel,
        nickname,
        extras,
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/users/:id/known-people/:targetId', async (req, res) => {
    try {
      await userService.removeKnownPerson(req.params.id, req.params.targetId);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/users/:id/known-people', async (req, res) => {
    try {
      const list = await userService.listKnownPeople(req.params.id);
      res.json(list);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.put('/api/users/:id/friend-marks/:targetId', async (req, res) => {
    try {
      const mark = req.body as { markerUserId?: unknown; targetUserId?: unknown };
      if (mark?.markerUserId !== req.params.id || mark?.targetUserId !== req.params.targetId) {
        res.status(400).json({ error: 'friend mark route does not match its signed identities' });
        return;
      }
      if (hubRelayClient?.setFriendMark) {
        // A phone may not have the target's public record cached locally. The hub does, and it is
        // the authority used by the room-creation gate, so validate/store there first. Keep a
        // best-effort local mirror for offline reads without letting an incomplete phone cache
        // reject an otherwise valid network-level mark.
        const result = await hubRelayClient.setFriendMark(req.params.id, req.params.targetId, mark);
        void userService.setFriendMark(mark).catch(() => undefined);
        res.json({ ok: true, ...result });
        return;
      }
      const result = await userService.setFriendMark(mark);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/users/:id/room-creation-credit', async (req, res) => {
    try {
      const creatorPub = typeof req.query.creatorPub === 'string' ? req.query.creatorPub.trim() : '';
      if (!creatorPub) {
        res.status(400).json({ error: 'creatorPub required' });
        return;
      }
      const credit = hubRelayClient?.getRoomCreationCredit
        ? await hubRelayClient.getRoomCreationCredit(req.params.id, creatorPub)
        : await userService.getRoomCreationCredit(req.params.id, creatorPub);
      res.json(credit);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // No GET /api/users/:id/blocks — that would enumerate a user's full block list, which the
  // block-pairs storage (src/shared/block-pair.ts) deliberately doesn't support. Use
  // block-status/:targetId below for a specific-pair check instead.

  app.get('/api/users/:id/block-status/:targetId', async (req, res) => {
    try {
      const local = await userService.getBlockStatus(req.params.id, req.params.targetId);
      // On a phone, a block made on ANOTHER phone reaches only the hub (see the relay below), so
      // ask it too; this phone's own answer stands when the hub cannot be reached.
      const remote = hubRelayClient?.getBlockStatus
        ? await hubRelayClient.getBlockStatus(req.params.id, req.params.targetId).catch(() => null)
        : null;
      const blocked = local.blocked || remote?.blocked === true;
      const blockedBy = local.blockedBy || remote?.blockedBy === true;
      const status = { blocked, blockedBy, eitherBlocked: blocked || blockedBy };
      res.json(status);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/users/:id/blocks', async (req, res) => {
    try {
      const { targetId } = req.body as { targetId?: string };
      if (!targetId) {
        res.status(400).json({ error: 'targetId required' });
        return;
      }
      const result = await userService.blockUser(req.params.id, targetId);
      // A phone node holds the block in its own store only; the blocked person's device learns it
      // from the hub (phone-path 04, 2026-10-14: Alice's phone never knew Bob had blocked her).
      if (hubRelayClient?.setBlock) void hubRelayClient.setBlock(req.params.id, targetId, true).catch(() => undefined);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/users/:id/blocks/:targetId', async (req, res) => {
    try {
      const result = await userService.unblockUser(req.params.id, req.params.targetId);
      if (hubRelayClient?.setBlock) {
        void hubRelayClient.setBlock(req.params.id, req.params.targetId, false).catch(() => undefined);
      }
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/users/:id/age-verify', async (req, res) => {
    try {
      await userService.vouchAgeVerified(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
