import type express from 'express';
import {
  buildStatsDashboard,
} from '../../shared/talk-stats';
import { TalkService } from '../services/talk-service';
import type { BroadcastTagTrendSnapshot } from '../services/broadcast-tag-popularity-store';

type StatsRouteDeps = {
  talkService: TalkService;
  /** Broadcast preamble tag picks (slug → cumulative count) */
  getBroadcastTagPopularity?: () => Array<{ id: string; count: number }>;
  /** UTC day-bucketed bumps for targeting preamble tags */
  getBroadcastTagTrends?: (lastNDays: number) => BroadcastTagTrendSnapshot;
};

/**
 * Stats routes — P0 step 7: server-side talkResponsesMap removed.
 * Talk-delivery-derived endpoints (record, summary, by-day, by-region, by-answer,
 * cross-question, chatrooms, peers) are deleted; these are now local-only on the client.
 * Kept: broadcast-tag popularity/trends (server-side BroadcastTagPopularityStore),
 * stats dashboard (broadcast tags only), and survey results (Gun-stored survey data).
 */
export function registerStatsRoutes(app: express.Application, deps: StatsRouteDeps): void {
  const {
    talkService,
    getBroadcastTagPopularity,
    getBroadcastTagTrends,
  } = deps;

  app.get('/api/stats/broadcast-tags', (_req, res) => {
    const tags = getBroadcastTagPopularity?.() ?? [];
    res.json({ tags });
  });

  app.get('/api/stats/broadcast-tags/trends', (req, res) => {
    const raw = Number(req.query.days);
    const days = Number.isFinite(raw) ? raw : 7;
    const snapshot = getBroadcastTagTrends?.(days) ?? { days: [], tags: [] };
    res.json(snapshot);
  });

  /** Stats dashboard — broadcast-tag section only; per-talk aggregates are now local. */
  app.get('/api/stats/dashboard', (req, res) => {
    const viewerId = typeof req.query.viewerId === 'string' && req.query.viewerId.trim()
      ? req.query.viewerId.trim()
      : undefined;
    res.json(buildStatsDashboard({
      responsesByTalk: new Map(),
      ...(viewerId ? { viewerId } : {}),
      broadcastTagPopularity: getBroadcastTagPopularity?.() ?? [],
      broadcastTagTrends: getBroadcastTagTrends?.(14) ?? { days: [], tags: [] },
    }));
  });

  app.get('/api/surveys/:id/results', async (req, res) => {
    try {
      const results = await talkService.getSurveyResults(req.params.id);
      res.json(results);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });
}
