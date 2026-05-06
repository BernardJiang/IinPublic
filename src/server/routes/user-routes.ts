import type express from 'express';
import type { RelationshipLabel } from '../../shared/types';
import { UserService } from '../services/user-service';

type RegisterUserRoutesDeps = {
  userService: UserService;
};

export function registerUserRoutes(
  app: express.Application,
  { userService }: RegisterUserRoutesDeps,
): void {
  app.post('/api/users', async (req, res) => {
    try {
      const user = await userService.createUser(req.body);
      res.json(user);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/users/:id', async (req, res) => {
    try {
      const viewerId = typeof req.query.viewerId === 'string' ? req.query.viewerId : '';
      if (viewerId && viewerId !== req.params.id) {
        // Only need the "blocked by target" direction — one Gun read instead of two.
        const blockedByTarget = await userService.isBlocked(req.params.id, viewerId);
        if (blockedByTarget) {
          res.status(403).json({ error: 'Profile is not available', blockedBy: true });
          return;
        }
      }
      const user = await userService.getUser(req.params.id);
      res.json(user);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
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
