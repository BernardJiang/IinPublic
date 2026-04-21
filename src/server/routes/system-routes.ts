import type express from 'express';
import { logger } from '../logger';

type RegisterSystemRoutesDeps = {
  gun: any;
  incomingTalksMap: Map<string, Map<string, any>>;
  nodeEnv: string | undefined;
};

export function registerSystemRoutes(
  app: express.Application,
  { gun, incomingTalksMap, nodeEnv }: RegisterSystemRoutesDeps,
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

  // Test-only endpoint to clear Gun.js in-memory database
  if (nodeEnv !== 'production') {
    app.post('/api/test/clear-database', (_req, res) => {
      try {
        // Clear Gun.js in-memory graph
        // Gun stores data in gun._.graph which is the in-memory cache
        if (gun && gun._ && gun._.graph) {
          logger.info('🧹 Clearing Gun.js in-memory database...');
          // Create a new empty graph
          gun._.graph = {};
          // Also clear server-side incoming talks Map
          incomingTalksMap.clear();
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
