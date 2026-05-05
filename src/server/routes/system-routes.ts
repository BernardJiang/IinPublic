import type express from 'express';
import { logger } from '../logger';

type RegisterSystemRoutesDeps = {
  gun: any;
  incomingTalksMap: Map<string, Map<string, any>>;
  conversationsMap: Map<string, Map<string, any>>;
  clearTalkResponseStats: () => void;
  nodeEnv: string | undefined;
};

export function registerSystemRoutes(
  app: express.Application,
  { gun, incomingTalksMap, conversationsMap, clearTalkResponseStats, nodeEnv }: RegisterSystemRoutesDeps,
): void {
  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Location privacy validation endpoint
  app.post('/api/validate-privacy', (_req, res) => {
    try {
      // This would validate that no high-precision location data is being sent
      res.json({ valid: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Test-only endpoints (non-production only)
  if (nodeEnv !== 'production') {
    app.get('/api/test/user-conversations/:userId', (req, res) => {
      const { userId } = req.params;
      const userMap = conversationsMap.get(userId);
      const conversations = userMap ? Array.from(userMap.values()) : [];
      res.json({ conversations, count: conversations.length });
    });

    app.post('/api/test/clear-database', (_req, res) => {
      try {
        // Clear Gun.js in-memory graph
        // Gun stores data in gun._.graph which is the in-memory cache
        if (gun && gun._ && gun._.graph) {
          logger.info('🧹 Clearing Gun.js in-memory database...');
          gun._.graph = {};
          incomingTalksMap.clear();
          conversationsMap.clear();
          clearTalkResponseStats();
          logger.info('✅ Gun.js in-memory database cleared');
          res.json({ success: true, message: 'Gun.js in-memory database cleared' });
        } else {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
        }
      } catch (error) {
        logger.error({ err: error }, 'Error clearing Gun.js database');
        res.status(500).json({ error: (error as Error).message });
      }
    });
  }
}
