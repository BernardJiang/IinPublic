import type express from 'express';
import { TalkService } from '../services/talk-service';

type TalkRouteDeps = {
  // TalkService kept for potential future server-side survey/query use.
  talkService: TalkService;
  loadTalkDataFromGraphOrBody: (talkId: string, bodyTalkData?: unknown) => Promise<any | null>;
};

export function registerTalkRoutes(app: express.Application, deps: TalkRouteDeps): void {
  const { loadTalkDataFromGraphOrBody } = deps;

  /**
   * GET /api/talks/:id — Gun graph read-through for talk bodies.
   * Still used by WebTalkService.getTalkWithRetry as a fallback when a receiver
   * has not yet replicated the talk locally (mesh delivery) or when a dev seed
   * needs to read back a Gun-stored talk.  All talk mutations (create/update/send)
   * are now local-only on the client.
   */
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
}
