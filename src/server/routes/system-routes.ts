import fs from 'fs';
import path from 'path';
import type express from 'express';
import { logger } from '../logger';
import {
  applyLocalNodeAction,
  createLocalNodeSupervisorSnapshot,
  resolveP2PRuntimeFlags,
  STAR_GUN_PATH_CLASSIFICATIONS,
  type LocalNodeAction,
  type LocalNodeSupervisorSnapshot,
} from '../../shared/p2p-runtime';

/** Gun radisk default directory (see node_modules/gun/lib/radisk.js). */
function clearRadiskOnDisk(): string[] {
  const root = process.cwd();
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return removed;
  }
  for (const name of names) {
    const isRadiskDir = name === 'radata' || /^radata_w\d+$/.test(name);
    const isGunJson = name === 'data.json' || name === 'data.json.tmp';
    if (!isRadiskDir && !isGunJson) continue;
    const target = path.join(root, name);
    fs.rmSync(target, { recursive: true, force: true });
    if (isRadiskDir) fs.mkdirSync(target, { recursive: true });
    removed.push(name);
  }
  return removed;
}

export type E2eServerSnapshot = {
  version: 1;
  gunGraph: Record<string, unknown>;
  incomingTalks: Record<string, Record<string, unknown>>;
  conversations: Record<string, Record<string, unknown>>;
  talkResponses: Record<string, unknown[]>;
  statsIdx: {
    byDay: Record<string, string[]>;
    byRegion: Record<string, string[]>;
    byTalkAnswer: Record<string, string[]>;
  };
};

function mapOfMapsToObject(m: Map<string, Map<string, any>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, inner] of m) {
    out[k] = Object.fromEntries(inner);
  }
  return out;
}

function statsIdxToObject(statsIdx: {
  byDay: Map<string, Set<string>>;
  byRegion: Map<string, Set<string>>;
  byTalkAnswer: Map<string, Set<string>>;
}): E2eServerSnapshot['statsIdx'] {
  const sets = (s: Map<string, Set<string>>) =>
    Object.fromEntries([...s.entries()].map(([k, v]) => [k, [...v]]));
  return {
    byDay: sets(statsIdx.byDay),
    byRegion: sets(statsIdx.byRegion),
    byTalkAnswer: sets(statsIdx.byTalkAnswer),
  };
}

function statsIdxFromObject(raw: E2eServerSnapshot['statsIdx']): {
  byDay: Map<string, Set<string>>;
  byRegion: Map<string, Set<string>>;
  byTalkAnswer: Map<string, Set<string>>;
} {
  const from = (o: Record<string, string[]>) => {
    const m = new Map<string, Set<string>>();
    for (const [k, arr] of Object.entries(o || {})) {
      m.set(k, new Set(arr));
    }
    return m;
  };
  return {
    byDay: from(raw?.byDay || {}),
    byRegion: from(raw?.byRegion || {}),
    byTalkAnswer: from(raw?.byTalkAnswer || {}),
  };
}

type RegisterSystemRoutesDeps = {
  gun: any;
  incomingTalksMap: Map<string, Map<string, any>>;
  conversationsMap: Map<string, Map<string, any>>;
  talkResponsesMap: Map<string, unknown[]>;
  statsIdx: {
    byDay: Map<string, Set<string>>;
    byRegion: Map<string, Set<string>>;
    byTalkAnswer: Map<string, Set<string>>;
  };
  clearTalkResponseStats: () => void;
  nodeEnv: string | undefined;
};

export function registerSystemRoutes(
  app: express.Application,
  {
    gun,
    incomingTalksMap,
    conversationsMap,
    talkResponsesMap,
    statsIdx,
    clearTalkResponseStats,
    nodeEnv,
  }: RegisterSystemRoutesDeps,
): void {
  let localNodeSupervisor: LocalNodeSupervisorSnapshot = createLocalNodeSupervisorSnapshot();

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
    app.get('/api/debug/storage', (_req, res) => {
      try {
        if (!gun?._?.graph) {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
          return;
        }
        const graph = gun._.graph as Record<string, unknown>;
        const topLevelCounts: Record<string, number> = {};
        for (const soul of Object.keys(graph)) {
          const top = soul.split('/')[0] || soul.split('#')[0] || soul;
          if (!top || top === '_') continue;
          topLevelCounts[top] = (topLevelCounts[top] || 0) + 1;
        }
        res.json({
          mode: 'star',
          topology: {
            browser: 'Gun client',
            hub: 'Node Gun hub',
            routes: 'HTTP/Socket API',
          },
          flags: resolveP2PRuntimeFlags(process.env),
          localNode: localNodeSupervisor,
          serverPersistence: {
            radisk: !!gun?._?.opt?.radisk,
            policy: resolveP2PRuntimeFlags(process.env).starServerPersistence,
            graphSouls: Object.keys(graph).length,
            topLevelCounts,
          },
          pathClassifications: STAR_GUN_PATH_CLASSIFICATIONS,
        });
      } catch (error) {
        logger.error({ err: error }, 'Error reading storage debug data');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get('/api/p2p/local-node', (_req, res) => {
      res.json(localNodeSupervisor);
    });

    app.post('/api/p2p/local-node/:action', (req, res) => {
      const action = req.params.action as LocalNodeAction;
      try {
        localNodeSupervisor = applyLocalNodeAction(localNodeSupervisor, action, new Date(), req.body);
        res.json(localNodeSupervisor);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

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
          const radiskDirs = clearRadiskOnDisk();
          logger.info({ radiskDirs }, '✅ Gun.js in-memory database cleared');
          res.json({
            success: true,
            message: 'Gun.js in-memory database cleared',
            radiskDirs,
          });
        } else {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
        }
      } catch (error) {
        logger.error({ err: error }, 'Error clearing Gun.js database');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get('/api/test/export-snapshot', (_req, res) => {
      try {
        if (!gun?._?.graph) {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
          return;
        }
        const snapshot: E2eServerSnapshot = {
          version: 1,
          gunGraph: { ...gun._.graph },
          incomingTalks: mapOfMapsToObject(incomingTalksMap),
          conversations: mapOfMapsToObject(conversationsMap),
          talkResponses: Object.fromEntries(talkResponsesMap),
          statsIdx: statsIdxToObject(statsIdx),
        };
        res.json(snapshot);
      } catch (error) {
        logger.error({ err: error }, 'Error exporting E2E snapshot');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/api/test/import-snapshot', (req, res) => {
      try {
        const body = req.body as E2eServerSnapshot;
        if (!body || body.version !== 1 || !body.gunGraph) {
          res.status(400).json({ error: 'Invalid snapshot payload (expected version 1)' });
          return;
        }
        if (!gun?._?.graph) {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
          return;
        }
        gun._.graph = { ...body.gunGraph };
        incomingTalksMap.clear();
        conversationsMap.clear();
        for (const [uid, inner] of Object.entries(body.incomingTalks || {})) {
          incomingTalksMap.set(uid, new Map(Object.entries(inner || {})));
        }
        for (const [uid, inner] of Object.entries(body.conversations || {})) {
          conversationsMap.set(uid, new Map(Object.entries(inner || {})));
        }
        talkResponsesMap.clear();
        for (const [talkId, rows] of Object.entries(body.talkResponses || {})) {
          talkResponsesMap.set(talkId, Array.isArray(rows) ? rows : []);
        }
        const restored = statsIdxFromObject(body.statsIdx);
        statsIdx.byDay.clear();
        statsIdx.byRegion.clear();
        statsIdx.byTalkAnswer.clear();
        for (const [k, v] of restored.byDay) statsIdx.byDay.set(k, v);
        for (const [k, v] of restored.byRegion) statsIdx.byRegion.set(k, v);
        for (const [k, v] of restored.byTalkAnswer) statsIdx.byTalkAnswer.set(k, v);
        logger.info('✅ E2E snapshot imported');
        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, 'Error importing E2E snapshot');
        res.status(500).json({ error: (error as Error).message });
      }
    });
  }
}
