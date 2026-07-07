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
  const getRemotePublicUser = async (userId: string) => {
    if (!hubRelayClient) return null;
    try {
      const remoteUser = await hubRelayClient.getPublicUser(userId);
      return remoteUser?.id ? remoteUser : null;
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
      res.json(user);
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
      const profileViewer = qViewer.length > 0 ? qViewer : null;
      const user = await userService.getUser(req.params.id, { viewerId: profileViewer });
      if ((!user.id || !user.pub || !user.epub) && hubRelayClient) {
        const remoteUser = await getRemotePublicUser(req.params.id);
        if (remoteUser?.id) {
          res.json(remoteUser);
          return;
        }
      }
      res.json(user);
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
        profile: Array.isArray(body.profile) ? body.profile : [],
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

  app.get('/api/users/:id/blocks', async (req, res) => {
    try {
      const blockedUserIds = await userService.getBlockedUserIds(req.params.id);
      res.json({ blockedUserIds });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/users/:id/block-status/:targetId', async (req, res) => {
    try {
      const status = await userService.getBlockStatus(req.params.id, req.params.targetId);
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
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/users/:id/blocks/:targetId', async (req, res) => {
    try {
      const result = await userService.unblockUser(req.params.id, req.params.targetId);
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
