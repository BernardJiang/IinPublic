import type express from 'express';
import { TalkService } from '../services/talk-service';

type TalkRouteDeps = {
  talkService: TalkService;
  loadTalkDataFromGraphOrBody: (talkId: string, bodyTalkData?: unknown) => Promise<any | null>;
};

export function registerTalkRoutes(app: express.Application, deps: TalkRouteDeps): void {
  const { talkService, loadTalkDataFromGraphOrBody } = deps;

  app.post('/api/talks', async (req, res) => {
    try {
      const talk = await talkService.createTalk(req.body);
      res.json(talk);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /** Full talk JSON from server Gun graph (peers may lag replicating to the browser). */
  app.get('/api/talks/:id', async (req, res) => {
    try {
      const talk = await loadTalkDataFromGraphOrBody(req.params.id);
      if (!talk) {
        // 202 (not 404) avoids browser "Failed to load resource" spam while clients poll until replication.
        res.status(202).json({ pending: true, id: req.params.id });
        return;
      }
      res.json(talk);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/talks/:id/send', async (req, res) => {
    try {
      const job = await talkService.sendBulkTalk(
        req.params.id,
        req.body.senderId,
        req.body.targetScope,
        req.body.maxRecipients,
      );
      res.json(job);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
