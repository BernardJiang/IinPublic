import type express from 'express';
import type { BackgroundTalkAgentConfig } from '../../shared/background-talk-agent';
import type { BackgroundTalkAgent } from '../services/background-talk-agent';

function authorized(req: express.Request, token: string): boolean {
  return token.length >= 32 && req.get('authorization') === `Bearer ${token}`;
}

export function registerBackgroundAgentRoutes(
  app: express.Application,
  agent: BackgroundTalkAgent,
  token: string,
): void {
  const guard = (req: express.Request, res: express.Response): boolean => {
    if (authorized(req, token)) return true;
    res.status(404).end();
    return false;
  };

  app.post('/api/native/background-agent/provision', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      await agent.provision(req.body?.config as BackgroundTalkAgentConfig, req.body?.pair);
      res.json(agent.status());
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.post('/api/native/background-agent/drain', async (req, res) => {
    if (!guard(req, res)) return;
    try { res.json({ events: await agent.drain(), status: agent.status() }); }
    catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  app.get('/api/native/background-agent/events', (req, res) => {
    if (!guard(req, res)) return;
    res.json({ events: agent.listEvents(), status: agent.status() });
  });
  app.post('/api/native/background-agent/events/ack', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      await agent.acknowledge(Array.isArray(req.body?.ids) ? req.body.ids : []);
      res.json(agent.status());
    } catch (error) {
      res.status(503).json({ error: (error as Error).message });
    }
  });
}
