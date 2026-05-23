import { filterIncomingTalkClusters, talkPassesIntakeFilters } from '../../web/ui/talk-intake-filters';
import type { TalkIntakeFilters } from '../../shared/types';

describe('talk intake filters', () => {
  const baseFilters: TalkIntakeFilters = {
    allowedLanguages: ['en', 'zh'],
    requireGoodGrammar: false,
    blockDirtyWords: false,
    allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
  };

  it('filters by talk type and sent-after time', () => {
    const result = filterIncomingTalkClusters(
      [
        { title: 'Old tag', type: 'tag', updatedAt: '2026-04-20T10:00:00.000Z' },
        { title: 'Fresh flow', type: 'flow', updatedAt: '2026-04-28T10:00:00.000Z' },
      ],
      {
        ...baseFilters,
        allowedTalkTypes: ['flow'],
        sentAfter: '2026-04-25T00:00:00.000Z',
      },
    );

    expect(result.visible).toHaveLength(1);
    expect(result.hiddenCount).toBe(1);
    expect(result.hiddenByReason).toEqual({ intake_talk_type: 1 });
    expect(result.visible[0].title).toBe('Fresh flow');
  });

  it('summarizes each hidden reason so Settings can explain filtered incoming talks', () => {
    const result = filterIncomingTalkClusters(
      [
        { title: 'Español', type: 'flow', language: 'es' },
        { title: 'Blocked topic', type: 'flow', language: 'en', questions: [{ text: 'Avoid spoilers' }] },
        { title: 'Visible', type: 'flow', language: 'en' },
      ],
      { ...baseFilters, allowedLanguages: ['en'], customBlockedTerms: ['spoilers'] },
    );

    expect(result.visible.map((talk) => talk.title)).toEqual(['Visible']);
    expect(result.hiddenCount).toBe(2);
    expect(result.hiddenByReason).toEqual({
      intake_language: 1,
      intake_custom_blocked_terms: 1,
    });
  });

  it('filters by language and dirty words', () => {
    const englishDirty = {
      title: 'Fake bot message',
      type: 'flow',
      questionsJson: JSON.stringify([{ text: 'This is fake spam', answers: [{ text: 'ok' }] }]),
    };
    const chineseClean = {
      title: '你好',
      type: 'tag',
      language: 'zh',
      questionsJson: JSON.stringify([{ text: '你好', answers: [{ text: 'Match.' }] }]),
    };

    expect(
      talkPassesIntakeFilters(englishDirty, { ...baseFilters, blockDirtyWords: true }, undefined),
    ).toBe(false);
    expect(talkPassesIntakeFilters(chineseClean, baseFilters, undefined)).toBe(true);
  });

  it('does not reject short survey answer labels as grammar failures', () => {
    const survey = {
      title: 'Restaurant survey',
      type: 'survey',
      language: 'en',
      questions: [
        {
          text: 'Which restaurant has the best burger?',
          answers: [{ text: 'KFC' }, { text: 'others' }, { text: 'Ignore.' }],
        },
      ],
    };

    expect(talkPassesIntakeFilters(survey, { ...baseFilters, requireGoodGrammar: true }, undefined)).toBe(true);
  });

  it('still checks punctuated answers for dirty words', () => {
    const survey = {
      title: 'Restaurant survey',
      type: 'survey',
      language: 'en',
      questions: [
        {
          text: 'Which restaurant has the best burger?',
          answers: [{ text: 'KFC' }, { text: 'FAKE!' }],
        },
      ],
    };

    expect(talkPassesIntakeFilters(survey, { ...baseFilters, blockDirtyWords: true }, undefined)).toBe(false);
  });

  it('filters by min and max distance when author location is available', () => {
    const cluster = {
      title: 'Nearby',
      type: 'flow',
      authorLocation: { latitude: 37.78, longitude: -122.42 },
    };
    const me = {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 100,
      timestamp: new Date('2026-04-28T12:00:00.000Z'),
    };

    expect(
      talkPassesIntakeFilters(cluster, { ...baseFilters, maxDistanceMiles: 1 }, me),
    ).toBe(true);
    expect(
      talkPassesIntakeFilters(cluster, { ...baseFilters, minDistanceMiles: 10 }, me),
    ).toBe(false);
    expect(
      talkPassesIntakeFilters(
        { ...cluster, authorLocation: { latitude: me.latitude, longitude: me.longitude } },
        { ...baseFilters, minDistanceMiles: 10 },
        me,
      ),
    ).toBe(false);
  });
});
