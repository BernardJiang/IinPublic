import {
  aggregateChatroomLocationStats,
  aggregateCrossQuestion,
  aggregatePeerReputationStats,
  aggregateTimeSeriesOverview,
  buildStatsDashboard,
  type TalkResponse,
} from '../../shared/talk-stats';

const responses: TalkResponse[] = [
  {
    responseId: 'r1',
    talkId: 'talk_stats',
    talkType: 'survey',
    responderId: 'alice',
    region: 'region_a',
    chatroomId: 'room_a',
    answers: [
      { questionId: 'q_color', answerId: 'blue', answerText: 'Blue' },
      { questionId: 'q_sport', answerId: 'tennis', answerText: 'Tennis' },
    ],
    createdAt: Date.UTC(2026, 4, 10, 23, 50),
    outcome: 'match',
  },
  {
    responseId: 'r2',
    talkId: 'talk_stats',
    talkType: 'survey',
    responderId: 'bob',
    region: 'region_a',
    chatroomId: 'room_a',
    answers: [
      { questionId: 'q_color', answerId: 'blue', answerText: 'Blue' },
      { questionId: 'q_sport', answerId: 'soccer', answerText: 'Soccer' },
    ],
    createdAt: Date.UTC(2026, 4, 11, 0, 10),
    outcome: 'ignore',
  },
  {
    responseId: 'r3',
    talkId: 'talk_stats',
    talkType: 'survey',
    responderId: 'carol',
    region: 'region_b',
    chatroomId: 'room_b',
    isTraveller: true,
    answers: [
      { questionId: 'q_color', answerId: 'green', answerText: 'Green' },
      { questionId: 'q_sport', answerId: 'tennis', answerText: 'Tennis' },
    ],
    createdAt: Date.UTC(2026, 4, 17, 1, 0),
    outcome: 'match',
  },
];

describe('talk stats aggregations', () => {
  it('builds cross-question cells with percentages and privacy masks', () => {
    const result = aggregateCrossQuestion('talk_stats', responses, 'q_color', 'q_sport', 2);

    expect(result.totalPairs).toBe(3);
    expect(result.cells).toEqual([
      expect.objectContaining({
        answerAId: 'blue',
        answerBId: 'soccer',
        count: 1,
        masked: true,
      }),
      expect.objectContaining({
        answerAId: 'blue',
        answerBId: 'tennis',
        count: 1,
        masked: true,
      }),
      expect.objectContaining({
        answerAId: 'green',
        answerBId: 'tennis',
        count: 1,
        percentage: 33.33,
        masked: true,
      }),
    ]);
  });

  it('returns day week and month time series together', () => {
    const overview = aggregateTimeSeriesOverview('talk_stats', responses);

    expect(overview.day.series.map((row) => row.bucket)).toEqual(['2026-05-10', '2026-05-11', '2026-05-17']);
    expect(overview.week.series).toEqual([
      { bucket: '2026-W19', count: 1 },
      { bucket: '2026-W20', count: 2 },
    ]);
    expect(overview.month.series).toEqual([{ bucket: '2026-05', count: 3 }]);
  });

  it('summarizes chatroom location and traveller split without precise location', () => {
    const result = aggregateChatroomLocationStats(responses, { minCohortSize: 3 });

    expect(result.totalResponses).toBe(3);
    expect(result.regions).toEqual([
      expect.objectContaining({
        region: 'room_a',
        count: 2,
        localCount: 2,
        travellerCount: 0,
        matchRate: 50,
        masked: true,
      }),
      expect.objectContaining({
        region: 'room_b',
        count: 1,
        localCount: 0,
        travellerCount: 1,
        matchRate: 100,
        masked: true,
      }),
    ]);
  });

  it('summarizes peer response and match rates', () => {
    const result = aggregatePeerReputationStats(responses, 'alice');

    expect(result.peers).toEqual(expect.arrayContaining([
      expect.objectContaining({ peerId: 'bob', responses: 1, matches: 0, ignores: 1, matchRate: 0 }),
      expect.objectContaining({ peerId: 'carol', responses: 1, matches: 1, ignores: 0, matchRate: 100 }),
    ]));
  });

  it('builds a dashboard from all response maps', () => {
    const dashboard = buildStatsDashboard({
      responsesByTalk: new Map([['talk_stats', responses]]),
      broadcastTagPopularity: [{ id: 'sports', count: 2 }],
      broadcastTagTrends: { days: ['2026-05-11'], tags: [{ id: 'sports', total: 2, byDay: [2] }] },
    });

    expect(dashboard.totals).toMatchObject({
      talks: 1,
      responses: 3,
      matches: 2,
      ignores: 1,
      matchRate: 66.67,
    });
    expect(dashboard.byTalkType[0]).toMatchObject({ talkType: 'survey', responses: 3 });
    expect(dashboard.broadcastTags.popularity).toEqual([{ id: 'sports', count: 2 }]);
    expect(dashboard.sourceOfTruth.responseEvents).toBe('append-only-gun-mirrored');
    expect(dashboard.privacy.preciseLocationExposed).toBe(false);
  });
});
