/**
 * STAT-01 — generic statistics & inquiry layer across all four talk types.
 *
 * Design goal (user-driven):
 *   "Make the statistics and inquiry as easily as possible so that it can be added
 *    to talks by users without complex definitions."
 *
 * Every response — regardless of talk type (tag / flow / survey / route) — is
 * normalized into {@link TalkResponse} at write time.  Secondary indices let
 * the aggregation endpoints answer the three basic inquiry dimensions without
 * scanning the full graph:
 *
 *   - time     → bucket counts by day / week / month
 *   - region   → counts per blurred region id
 *   - answer   → per-question choice distribution with counts and percentages
 */

export type TalkType = 'tag' | 'flow' | 'survey' | 'route';

export interface TalkResponseAnswer {
  questionId: string;
  answerId: string;
  answerText: string;
}

export interface TalkResponse {
  responseId: string;
  talkId: string;
  talkType: TalkType;
  responderId: string;
  region: string;
  answers: TalkResponseAnswer[];
  createdAt: number;
  outcome?: 'match' | 'ignore' | 'other';
  chatroomId?: string;
  isTraveller?: boolean;
}

export type TimeBucket = 'day' | 'week' | 'month';

export interface StatsSummary {
  talkId: string;
  talkType: TalkType;
  total: number;
  matches: number;
  ignores: number;
  byQuestion: Array<{
    questionId: string;
    total: number;
    answers: Array<{ answerId: string; answerText: string; count: number; percentage: number }>;
  }>;
}

export interface StatsByTime {
  talkId: string;
  bucket: TimeBucket;
  series: Array<{ bucket: string; count: number }>;
}

export interface StatsByRegion {
  talkId: string;
  series: Array<{ region: string; count: number }>;
}

export interface StatsByAnswer {
  talkId: string;
  questionId: string;
  total: number;
  answers: Array<{ answerId: string; answerText: string; count: number; percentage: number }>;
}

export interface StatsPrivacyPolicy {
  minCohortSize: number;
  regionGranularity: 'blurred-region';
  timeBuckets: TimeBucket[];
  csvExportsMaskSmallCohorts: boolean;
  preciseLocationExposed: false;
}

export interface StatsSourceOfTruth {
  responseEvents: 'append-only-gun-mirrored';
  inMemoryIndices: 'derived-cache';
  broadcastTagCounters: 'server-cache-with-trend-buckets';
  quotaCounters: 'server-cache';
  recomputableFromEvents: string[];
  intentionallyEphemeral: string[];
}

export interface StatsCrossQuestion {
  talkId: string;
  questionA: string;
  questionB: string;
  totalPairs: number;
  cells: Array<{
    answerAId: string;
    answerAText: string;
    answerBId: string;
    answerBText: string;
    count: number;
    percentage: number;
    masked: boolean;
  }>;
}

export interface StatsTimeSeriesOverview {
  talkId: string;
  day: StatsByTime;
  week: StatsByTime;
  month: StatsByTime;
}

export interface StatsChatroomLocation {
  scope: 'all' | 'talk';
  talkId?: string;
  totalResponses: number;
  regions: Array<{
    region: string;
    count: number;
    matchCount: number;
    responseRate: number;
    matchRate: number;
    localCount: number;
    travellerCount: number;
    masked: boolean;
  }>;
}

export interface StatsPeerReputation {
  viewerId?: string;
  peers: Array<{
    peerId: string;
    responses: number;
    matches: number;
    ignores: number;
    matchRate: number;
    visibility: 'public-summary';
  }>;
}

export interface StatsDashboard {
  generatedAt: string;
  privacy: StatsPrivacyPolicy;
  sourceOfTruth: StatsSourceOfTruth;
  totals: {
    talks: number;
    responses: number;
    matches: number;
    ignores: number;
    matchRate: number;
  };
  byTalkType: Array<{
    talkType: TalkType;
    responses: number;
    matches: number;
    ignores: number;
    matchRate: number;
  }>;
  topTalks: Array<{
    talkId: string;
    talkType: TalkType;
    responses: number;
    matches: number;
    ignores: number;
    matchRate: number;
    latestResponseAt: number;
  }>;
  timeSeries: {
    day: Array<{ bucket: string; count: number }>;
    week: Array<{ bucket: string; count: number }>;
    month: Array<{ bucket: string; count: number }>;
  };
  chatrooms: StatsChatroomLocation;
  peers: StatsPeerReputation;
  broadcastTags: {
    popularity: Array<{ id: string; count: number }>;
    trends: { days: string[]; tags: Array<{ id: string; total: number; byDay: number[] }> };
  };
}

export const DEFAULT_STATS_PRIVACY_POLICY: StatsPrivacyPolicy = {
  minCohortSize: 3,
  regionGranularity: 'blurred-region',
  timeBuckets: ['day', 'week', 'month'],
  csvExportsMaskSmallCohorts: true,
  preciseLocationExposed: false,
};

export const DEFAULT_STATS_SOURCE_OF_TRUTH: StatsSourceOfTruth = {
  responseEvents: 'append-only-gun-mirrored',
  inMemoryIndices: 'derived-cache',
  broadcastTagCounters: 'server-cache-with-trend-buckets',
  quotaCounters: 'server-cache',
  recomputableFromEvents: [
    'summary',
    'by-day',
    'by-week',
    'by-month',
    'by-region',
    'by-answer',
    'cross-question',
    'chatroom-location',
    'peer-response-summary',
  ],
  intentionallyEphemeral: [
    'live websocket presence',
    'in-flight broadcast preview',
  ],
};

/* ── Bucket helpers ───────────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO week number (1–53) using the Monday-start convention. */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

export function bucketKey(createdAt: number, bucket: TimeBucket): string {
  const d = new Date(createdAt);
  if (bucket === 'day') {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  if (bucket === 'month') {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
  }
  const { year, week } = isoWeek(d);
  return `${year}-W${pad2(week)}`;
}

/* ── Aggregations ─────────────────────────────────────────────────── */

function answerTextById(
  questionId: string,
  answerId: string,
  responses: TalkResponse[],
): string {
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.questionId === questionId && a.answerId === answerId) return a.answerText;
    }
  }
  return answerId;
}

export function summarize(talkId: string, talkType: TalkType, responses: TalkResponse[]): StatsSummary {
  const byQ: Record<string, Map<string, number>> = {};
  let matches = 0;
  let ignores = 0;
  for (const r of responses) {
    if (r.outcome === 'match') matches += 1;
    else if (r.outcome === 'ignore') ignores += 1;
    for (const a of r.answers) {
      const m = (byQ[a.questionId] ||= new Map<string, number>());
      m.set(a.answerId, (m.get(a.answerId) ?? 0) + 1);
    }
  }
  const byQuestion = Object.entries(byQ).map(([questionId, counts]) => {
    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    const answers = Array.from(counts.entries()).map(([answerId, count]) => ({
      answerId,
      answerText: answerTextById(questionId, answerId, responses),
      count,
      percentage: total > 0 ? +((count * 100) / total).toFixed(2) : 0,
    }));
    answers.sort((a, b) => b.count - a.count);
    return { questionId, total, answers };
  });
  return { talkId, talkType, total: responses.length, matches, ignores, byQuestion };
}

export function aggregateByTime(
  talkId: string,
  responses: TalkResponse[],
  bucket: TimeBucket,
): StatsByTime {
  const counts = new Map<string, number>();
  for (const r of responses) {
    const key = bucketKey(r.createdAt, bucket);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ bucket: k, count: v }));
  return { talkId, bucket, series };
}

export function aggregateByRegion(talkId: string, responses: TalkResponse[]): StatsByRegion {
  const counts = new Map<string, number>();
  for (const r of responses) {
    counts.set(r.region, (counts.get(r.region) ?? 0) + 1);
  }
  const series = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ region, count }));
  return { talkId, series };
}

export function aggregateByAnswer(
  talkId: string,
  responses: TalkResponse[],
  questionId: string,
): StatsByAnswer {
  const counts = new Map<string, number>();
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.questionId !== questionId) continue;
      counts.set(a.answerId, (counts.get(a.answerId) ?? 0) + 1);
    }
  }
  const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
  const answers = Array.from(counts.entries())
    .map(([answerId, count]) => ({
      answerId,
      answerText: answerTextById(questionId, answerId, responses),
      count,
      percentage: total > 0 ? +((count * 100) / total).toFixed(2) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  return { talkId, questionId, total, answers };
}

export function aggregateTimeSeriesOverview(
  talkId: string,
  responses: TalkResponse[],
): StatsTimeSeriesOverview {
  return {
    talkId,
    day: aggregateByTime(talkId, responses, 'day'),
    week: aggregateByTime(talkId, responses, 'week'),
    month: aggregateByTime(talkId, responses, 'month'),
  };
}

export function aggregateCrossQuestion(
  talkId: string,
  responses: TalkResponse[],
  questionA: string,
  questionB: string,
  minCohortSize = DEFAULT_STATS_PRIVACY_POLICY.minCohortSize,
): StatsCrossQuestion {
  const counts = new Map<string, {
    answerAId: string;
    answerAText: string;
    answerBId: string;
    answerBText: string;
    count: number;
  }>();

  for (const response of responses) {
    const a = response.answers.find((answer) => answer.questionId === questionA);
    const b = response.answers.find((answer) => answer.questionId === questionB);
    if (!a || !b) continue;
    const key = `${a.answerId}\u0000${b.answerId}`;
    const current = counts.get(key) ?? {
      answerAId: a.answerId,
      answerAText: a.answerText || a.answerId,
      answerBId: b.answerId,
      answerBText: b.answerText || b.answerId,
      count: 0,
    };
    current.count += 1;
    counts.set(key, current);
  }

  const totalPairs = Array.from(counts.values()).reduce((sum, row) => sum + row.count, 0);
  const cells = Array.from(counts.values())
    .map((row) => ({
      ...row,
      percentage: totalPairs > 0 ? +((row.count * 100) / totalPairs).toFixed(2) : 0,
      masked: row.count < minCohortSize,
    }))
    .sort((a, b) => b.count - a.count || a.answerAText.localeCompare(b.answerAText) || a.answerBText.localeCompare(b.answerBText));

  return { talkId, questionA, questionB, totalPairs, cells };
}

export function aggregateChatroomLocationStats(
  responses: TalkResponse[],
  opts: { talkId?: string; minCohortSize?: number } = {},
): StatsChatroomLocation {
  const scoped = opts.talkId ? responses.filter((response) => response.talkId === opts.talkId) : responses;
  const minCohortSize = opts.minCohortSize ?? DEFAULT_STATS_PRIVACY_POLICY.minCohortSize;
  const byRegion = new Map<string, {
    count: number;
    matchCount: number;
    localCount: number;
    travellerCount: number;
  }>();

  for (const response of scoped) {
    const region = response.chatroomId || response.region || 'unknown';
    const current = byRegion.get(region) ?? { count: 0, matchCount: 0, localCount: 0, travellerCount: 0 };
    current.count += 1;
    if (response.outcome === 'match') current.matchCount += 1;
    if (response.isTraveller) current.travellerCount += 1;
    else current.localCount += 1;
    byRegion.set(region, current);
  }

  const regions = Array.from(byRegion.entries())
    .map(([region, row]) => ({
      region,
      count: row.count,
      matchCount: row.matchCount,
      responseRate: scoped.length > 0 ? +((row.count * 100) / scoped.length).toFixed(2) : 0,
      matchRate: row.count > 0 ? +((row.matchCount * 100) / row.count).toFixed(2) : 0,
      localCount: row.localCount,
      travellerCount: row.travellerCount,
      masked: row.count < minCohortSize,
    }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));

  return {
    scope: opts.talkId ? 'talk' : 'all',
    ...(opts.talkId ? { talkId: opts.talkId } : {}),
    totalResponses: scoped.length,
    regions,
  };
}

export function aggregatePeerReputationStats(
  responses: TalkResponse[],
  viewerId?: string,
): StatsPeerReputation {
  const byPeer = new Map<string, { responses: number; matches: number; ignores: number }>();
  for (const response of responses) {
    const peerId = response.responderId;
    if (!peerId || peerId === viewerId) continue;
    const current = byPeer.get(peerId) ?? { responses: 0, matches: 0, ignores: 0 };
    current.responses += 1;
    if (response.outcome === 'match') current.matches += 1;
    if (response.outcome === 'ignore') current.ignores += 1;
    byPeer.set(peerId, current);
  }

  const peers = Array.from(byPeer.entries())
    .map(([peerId, row]) => ({
      peerId,
      responses: row.responses,
      matches: row.matches,
      ignores: row.ignores,
      matchRate: row.responses > 0 ? +((row.matches * 100) / row.responses).toFixed(2) : 0,
      visibility: 'public-summary' as const,
    }))
    .sort((a, b) => b.responses - a.responses || b.matches - a.matches || a.peerId.localeCompare(b.peerId));

  return {
    ...(viewerId ? { viewerId } : {}),
    peers,
  };
}

export function buildStatsDashboard(params: {
  responsesByTalk: Map<string, TalkResponse[]> | Record<string, TalkResponse[]>;
  broadcastTagPopularity?: Array<{ id: string; count: number }>;
  broadcastTagTrends?: { days: string[]; tags: Array<{ id: string; total: number; byDay: number[] }> };
  viewerId?: string;
  privacy?: StatsPrivacyPolicy;
  sourceOfTruth?: StatsSourceOfTruth;
}): StatsDashboard {
  const entries = params.responsesByTalk instanceof Map
    ? Array.from(params.responsesByTalk.entries())
    : Object.entries(params.responsesByTalk);
  const allResponses = entries.flatMap(([, responses]) => responses);
  const privacy = params.privacy ?? DEFAULT_STATS_PRIVACY_POLICY;
  const sourceOfTruth = params.sourceOfTruth ?? DEFAULT_STATS_SOURCE_OF_TRUTH;
  const totalMatches = allResponses.filter((response) => response.outcome === 'match').length;
  const totalIgnores = allResponses.filter((response) => response.outcome === 'ignore').length;

  const byTalkTypeMap = new Map<TalkType, { responses: number; matches: number; ignores: number }>();
  for (const response of allResponses) {
    const current = byTalkTypeMap.get(response.talkType) ?? { responses: 0, matches: 0, ignores: 0 };
    current.responses += 1;
    if (response.outcome === 'match') current.matches += 1;
    if (response.outcome === 'ignore') current.ignores += 1;
    byTalkTypeMap.set(response.talkType, current);
  }

  const byTalkType = Array.from(byTalkTypeMap.entries())
    .map(([talkType, row]) => ({
      talkType,
      responses: row.responses,
      matches: row.matches,
      ignores: row.ignores,
      matchRate: row.responses > 0 ? +((row.matches * 100) / row.responses).toFixed(2) : 0,
    }))
    .sort((a, b) => b.responses - a.responses || a.talkType.localeCompare(b.talkType));

  const topTalks = entries
    .map(([talkId, responses]) => {
      const matches = responses.filter((response) => response.outcome === 'match').length;
      const ignores = responses.filter((response) => response.outcome === 'ignore').length;
      const latestResponseAt = responses.reduce((latest, response) => Math.max(latest, response.createdAt || 0), 0);
      return {
        talkId,
        talkType: (responses[0]?.talkType ?? 'flow') as TalkType,
        responses: responses.length,
        matches,
        ignores,
        matchRate: responses.length > 0 ? +((matches * 100) / responses.length).toFixed(2) : 0,
        latestResponseAt,
      };
    })
    .sort((a, b) => b.responses - a.responses || b.latestResponseAt - a.latestResponseAt)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    privacy,
    sourceOfTruth,
    totals: {
      talks: entries.length,
      responses: allResponses.length,
      matches: totalMatches,
      ignores: totalIgnores,
      matchRate: allResponses.length > 0 ? +((totalMatches * 100) / allResponses.length).toFixed(2) : 0,
    },
    byTalkType,
    topTalks,
    timeSeries: {
      day: aggregateByTime('all', allResponses, 'day').series,
      week: aggregateByTime('all', allResponses, 'week').series,
      month: aggregateByTime('all', allResponses, 'month').series,
    },
    chatrooms: aggregateChatroomLocationStats(allResponses, { minCohortSize: privacy.minCohortSize }),
    peers: aggregatePeerReputationStats(allResponses, params.viewerId),
    broadcastTags: {
      popularity: params.broadcastTagPopularity ?? [],
      trends: params.broadcastTagTrends ?? { days: [], tags: [] },
    },
  };
}
