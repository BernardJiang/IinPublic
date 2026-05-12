import type express from 'express';
import {
  aggregateChatroomLocationStats,
  aggregateByAnswer,
  aggregateByRegion,
  aggregateByTime,
  aggregateCrossQuestion,
  aggregatePeerReputationStats,
  aggregateTimeSeriesOverview,
  buildStatsDashboard,
  summarize,
  type TalkResponse,
  type TalkType,
  type TimeBucket,
} from '../../shared/talk-stats';
import { logger } from '../logger';
import { TalkService } from '../services/talk-service';
import type { BroadcastTagTrendSnapshot } from '../services/broadcast-tag-popularity-store';

type StatsRouteDeps = {
  talkService: TalkService;
  getUserRegion: (userId: string) => Promise<string>;
  recordTalkStatsResponse: (params: {
    talkId: string;
    talkType: TalkType;
    responderId: string;
    region: string;
    answers: Array<{ questionId: string; answerId: string; answerText: string }>;
    outcome?: 'match' | 'ignore' | 'other';
  }) => Promise<void>;
  getTalkResponses: (talkId: string, opts?: { from?: number; to?: number }) => TalkResponse[] | Promise<TalkResponse[]>;
  getAllTalkResponses?: () => Map<string, TalkResponse[]> | Promise<Map<string, TalkResponse[]>>;
  /** Broadcast preamble tag picks (slug → cumulative count) */
  getBroadcastTagPopularity?: () => Array<{ id: string; count: number }>;
  /** UTC day-bucketed bumps for targeting preamble tags */
  getBroadcastTagTrends?: (lastNDays: number) => BroadcastTagTrendSnapshot;
};

export function registerStatsRoutes(app: express.Application, deps: StatsRouteDeps): void {
  const {
    talkService,
    getUserRegion,
    recordTalkStatsResponse,
    getTalkResponses,
    getAllTalkResponses,
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

  // STAT-01 — record a response in the generic stats log.
  // Called from the client's talkCompleted handler (which writes responses directly to
  // Gun, bypassing POST /api/talks/:id/response). Keeps stats in sync regardless of path.
  app.post('/api/stats/talks/:id/record', async (req, res) => {
    try {
      const talkId = req.params.id;
      const { responderId, talkType, answers } = req.body as {
        responderId?: string;
        talkType?: TalkType;
        answers?: Array<{ questionId: string; answerId: string; answerText?: string }>;
        outcome?: 'match' | 'ignore' | 'other';
      };
      const outcome =
        req.body?.outcome === 'match' || req.body?.outcome === 'ignore' || req.body?.outcome === 'other'
          ? req.body.outcome
          : undefined;
      if (!responderId || !talkType || !Array.isArray(answers)) {
        res.status(400).json({ error: 'responderId, talkType, answers required' });
        return;
      }
      const region = await getUserRegion(responderId);
      await recordTalkStatsResponse({
        talkId,
        talkType,
        responderId,
        region,
        answers: answers.map((a) => ({
          questionId: String(a.questionId),
          answerId: String(a.answerId),
          answerText: String(a.answerText ?? ''),
        })),
        outcome,
      });
      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, 'stats record error');
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // STAT-01 — generic stats/inquiry endpoints (uniform across tag/flow/survey/route)
  app.get('/api/stats/dashboard', async (req, res) => {
    const responsesByTalk = getAllTalkResponses ? await getAllTalkResponses() : new Map<string, TalkResponse[]>();
    const viewerId = typeof req.query.viewerId === 'string' && req.query.viewerId.trim()
      ? req.query.viewerId.trim()
      : undefined;
    res.json(buildStatsDashboard({
      responsesByTalk,
      ...(viewerId ? { viewerId } : {}),
      broadcastTagPopularity: getBroadcastTagPopularity?.() ?? [],
      broadcastTagTrends: getBroadcastTagTrends?.(14) ?? { days: [], tags: [] },
    }));
  });

  app.get('/api/stats/talks/:id/summary', async (req, res) => {
    const talkId = req.params.id;
    const responses = await getTalkResponses(talkId);
    const talkType = (responses[0]?.talkType ?? 'flow') as TalkType;
    res.json(summarize(talkId, talkType, responses));
  });

  app.get('/api/stats/talks/:id/by-day', async (req, res) => {
    const talkId = req.params.id;
    const opts: { from?: number; to?: number } = {};
    if (req.query.from) opts.from = Number(req.query.from);
    if (req.query.to) opts.to = Number(req.query.to);
    const rawBucket = String(req.query.bucket || 'day').toLowerCase();
    const bucket: TimeBucket = rawBucket === 'week' || rawBucket === 'month' ? rawBucket : 'day';
    const responses = await getTalkResponses(talkId, opts);
    res.json(aggregateByTime(talkId, responses, bucket));
  });

  app.get('/api/stats/talks/:id/time-series', async (req, res) => {
    const talkId = req.params.id;
    res.json(aggregateTimeSeriesOverview(talkId, await getTalkResponses(talkId)));
  });

  app.get('/api/stats/talks/:id/by-region', async (req, res) => {
    const talkId = req.params.id;
    res.json(aggregateByRegion(talkId, await getTalkResponses(talkId)));
  });

  app.get('/api/stats/talks/:id/by-answer', async (req, res) => {
    const talkId = req.params.id;
    const questionId = String(req.query.questionId || '');
    if (!questionId) {
      res.status(400).json({ error: 'questionId query param required' });
      return;
    }
    res.json(aggregateByAnswer(talkId, await getTalkResponses(talkId), questionId));
  });

  app.get('/api/stats/talks/:id/cross-question', async (req, res) => {
    const talkId = req.params.id;
    const questionA = String(req.query.questionA || '');
    const questionB = String(req.query.questionB || '');
    if (!questionA || !questionB) {
      res.status(400).json({ error: 'questionA and questionB query params required' });
      return;
    }
    res.json(aggregateCrossQuestion(talkId, await getTalkResponses(talkId), questionA, questionB));
  });

  app.get('/api/stats/talks/:id/chatrooms', async (req, res) => {
    const talkId = req.params.id;
    res.json(aggregateChatroomLocationStats(await getTalkResponses(talkId), { talkId }));
  });

  app.get('/api/stats/chatrooms', async (_req, res) => {
    const responsesByTalk = getAllTalkResponses ? await getAllTalkResponses() : new Map<string, TalkResponse[]>();
    res.json(aggregateChatroomLocationStats(Array.from(responsesByTalk.values()).flat()));
  });

  app.get('/api/stats/peers', async (req, res) => {
    const responsesByTalk = getAllTalkResponses ? await getAllTalkResponses() : new Map<string, TalkResponse[]>();
    const viewerId = typeof req.query.viewerId === 'string' && req.query.viewerId.trim()
      ? req.query.viewerId.trim()
      : undefined;
    res.json(aggregatePeerReputationStats(Array.from(responsesByTalk.values()).flat(), viewerId));
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
