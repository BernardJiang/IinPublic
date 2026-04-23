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
