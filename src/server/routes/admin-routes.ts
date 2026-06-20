import type express from 'express';
import type { TechSupportAnnouncementService } from '../services/techsupport-announcement-service';

export function registerAdminRoutes(
  app: express.Application,
  announcementService: TechSupportAnnouncementService,
): void {
  app.post('/api/admin/announcements', async (req, res) => {
    try {
      const { text, expiresAt, requestedAt, authorization } = req.body || {};
      if (typeof text !== 'string' || !text.trim() || text.length > 2_000) {
        res.status(400).json({ error: 'text must be between 1 and 2000 characters' });
        return;
      }
      if (typeof expiresAt !== 'string' || new Date(expiresAt).getTime() <= Date.now()) {
        res.status(400).json({ error: 'expiresAt must be a future ISO timestamp' });
        return;
      }
      if (typeof requestedAt !== 'string' || typeof authorization !== 'string') {
        res.status(401).json({ error: 'TechSupport authorization is required' });
        return;
      }
      const authorized = await announcementService.verifyAdminAuthorization({
        text: text.trim(), expiresAt, requestedAt, authorization,
      });
      if (!authorized) {
        res.status(403).json({ error: 'TechSupport authorization was invalid' });
        return;
      }
      const announcement = await announcementService.createAnnouncement({ text: text.trim(), expiresAt });
      res.status(201).json({ announcement });
    } catch (error) {
      res.status(503).json({ error: (error as Error).message });
    }
  });
}
