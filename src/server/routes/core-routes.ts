/**
 * The device core hosted by the embedded node (OPEN-91 P5): the same `src/core/` handler the web
 * worker runs, over this node's own Gun (radisk on disk), answered on loopback to the app's own
 * WebView. Any other app on the device can reach a loopback port, so a request must carry the
 * shell's per-install secret (`IINPUBLIC_CORE_TOKEN`, or the background agent's on Android, which
 * the shell already passes in); without it the route does not exist (404).
 */
import fs from 'fs';
import path from 'path';
import type express from 'express';
import { createCoreHandler } from '../../core/core-handler';
import { gunGraphStore } from '../../core/graph-store';
import type { CoreRequest } from '../../core/protocol';

export function localNodeToken(env: NodeJS.ProcessEnv): string {
  const token = String(env.IINPUBLIC_CORE_TOKEN || env.IINPUBLIC_BACKGROUND_AGENT_TOKEN || '');
  return token.length >= 32 ? token : '';
}

/** A node whose Gun has never stored anything (no radata yet): snapshots are empty until a write. */
function freshDataDir(dataDir: string): boolean {
  try {
    return fs.readdirSync(path.join(dataDir, 'radata')).length === 0;
  } catch {
    return true;
  }
}

export function registerCoreRoutes(app: express.Application, gun: unknown, token: string, dataDir: string): void {
  const handle = createCoreHandler(gunGraphStore(gun), { freshDevice: freshDataDir(dataDir) });
  const authorized = (req: express.Request): boolean => token.length >= 32 && req.get('authorization') === `Bearer ${token}`;

  app.post('/api/core', async (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    try {
      res.json({ ok: true, value: await handle(req.body?.request as CoreRequest) });
    } catch (error) {
      res.status(400).json({ ok: false, error: (error as Error).message });
    }
  });
}
