/** @jest-environment jsdom */

import {
  DEFAULT_STATS_PRIVACY_POLICY,
  DEFAULT_STATS_SOURCE_OF_TRUTH,
  type StatsDashboard,
} from '../../shared/talk-stats';
import { renderStatisticsDashboard } from '../../web/ui/statistics-dashboard';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

function text(key: UiTranslationKey): string {
  return uiText('en', key);
}

function makeDashboard(): StatsDashboard {
  return {
    generatedAt: '2026-08-24T12:00:00.000Z',
    privacy: DEFAULT_STATS_PRIVACY_POLICY,
    sourceOfTruth: DEFAULT_STATS_SOURCE_OF_TRUTH,
    totals: { talks: 2, responses: 9, matches: 5, ignores: 1, matchRate: 56 },
    byTalkType: [
      { talkType: 'survey', responses: 6, matches: 4, ignores: 1, matchRate: 67 },
    ],
    topTalks: [
      {
        talkId: '<script>unsafe talk</script>',
        talkType: 'survey',
        responses: 6,
        matches: 4,
        ignores: 1,
        matchRate: 67,
        latestResponseAt: Date.UTC(2026, 7, 24),
      },
    ],
    timeSeries: {
      day: Array.from({ length: 15 }, (_, index) => ({
        bucket: `day-${index + 1}`,
        count: index + 1,
      })),
      week: [],
      month: [],
    },
    chatrooms: {
      scope: 'all',
      totalResponses: 9,
      regions: [
        {
          region: '<script>masked region</script>',
          count: 2,
          matchCount: 1,
          responseRate: 22,
          matchRate: 50,
          localCount: 1,
          travellerCount: 1,
          masked: true,
        },
        {
          region: 'Bay <Area>',
          count: 7,
          matchCount: 4,
          responseRate: 78,
          matchRate: 57,
          localCount: 5,
          travellerCount: 2,
          masked: false,
        },
      ],
    },
    peers: {
      viewerId: 'viewer',
      peers: [
        {
          peerId: '<img src=x onerror=alert(1)>',
          responses: 3,
          matches: 2,
          ignores: 1,
          matchRate: 67,
          visibility: 'public-summary',
        },
      ],
    },
    broadcastTags: {
      popularity: [
        { id: '<script>tag</script>', count: 2 },
        { id: 'largest', count: 8 },
      ],
      trends: {
        days: Array.from({ length: 8 }, (_, index) => `trend-${index + 1}`),
        tags: [{ id: 'largest', total: 8, byDay: [0, 1, 0, 1, 1, 1, 2, 2] }],
      },
    },
  };
}

describe('statistics dashboard characterization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders bounded local aggregates, escaped labels, charts, and masked regions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderStatisticsDashboard({
      container,
      dashboard: makeDashboard(),
      text,
      onRefresh: jest.fn(),
    });

    const bodyText = container.textContent?.replace(/\s+/g, ' ') || '';
    expect(bodyText).toContain('My talk statistics');
    expect(bodyText).toContain('Talks 2');
    expect(bodyText).toContain('Responses 9');
    expect(bodyText).toContain('Match rate 56%');
    expect(bodyText).toContain('Hidden region');
    expect(bodyText).not.toContain('masked region');
    expect(bodyText).toContain('Bay <Area>');
    expect(bodyText).toContain('Local: 6 · Traveller: 3');
    expect(bodyText).not.toMatch(/\bday-1\b/);
    expect(bodyText).toContain('day-2');
    expect(bodyText).toContain('Latest day day-15');
    expect(bodyText).not.toMatch(/\btrend-1\b/);
    expect(bodyText).toContain('trend-2');
    expect(bodyText).toContain('14 days · 119 responses');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();

    const bars = container.querySelectorAll<HTMLElement>('.stats-bar-track i');
    expect(bars[0]?.style.width).toBe('25%');
    expect(bars[1]?.style.width).toBe('100%');
    expect(container.querySelector('.stats-sparkline polyline')?.getAttribute('points')).toBeTruthy();
  });

  it('delegates refresh without owning dashboard data fetching', () => {
    const container = document.createElement('div');
    const onRefresh = jest.fn(() => Promise.resolve());

    renderStatisticsDashboard({ container, dashboard: makeDashboard(), text, onRefresh });
    container.querySelector<HTMLButtonElement>('#statistics-refresh-btn')?.click();

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
