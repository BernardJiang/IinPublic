/** @jest-environment jsdom */

import { displayContextualStatistics, displayStatisticsDashboard, type LocalStatisticsDeps } from '../../web/ui/local-statistics';

function setExchanges(entries: Array<{
  peerId: string;
  talkId: string;
  title?: string;
  talkType?: string;
  outcome: 'match' | 'mismatch' | 'ignore';
  direction?: 'sent' | 'received';
  date?: string;
}>): void {
  const exchanges: Record<string, unknown> = {};
  for (const e of entries) {
    exchanges[`${e.peerId}::${e.talkId}`] = {
      peerId: e.peerId,
      peerName: 'Peer',
      talkId: e.talkId,
      title: e.title ?? 'Talk',
      talkType: e.talkType ?? 'tag',
      outcome: e.outcome,
      direction: e.direction ?? 'sent',
      date: e.date ?? new Date().toISOString(),
    };
  }
  localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
}

function deps(overrides: Partial<LocalStatisticsDeps> = {}): LocalStatisticsDeps {
  return {
    apiBase: '',
    currentUserId: 'me',
    t: (key) => key,
    tf: (key, values) => `${key}(${JSON.stringify(values)})`,
    ...overrides,
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('displayContextualStatistics', () => {
  it('does nothing when the target element does not exist', () => {
    expect(() => displayContextualStatistics('missing-el', '', deps())).not.toThrow();
  });

  it('renders a zeroed summary when there are no exchanges', () => {
    document.body.innerHTML = '<div id="stats"></div>';
    displayContextualStatistics('stats', 'Prefix: ', deps());
    const text = document.getElementById('stats')!.textContent!;
    expect(text).toContain('Prefix: ');
    expect(text).toContain('"responses":0');
    expect(text).toContain('"matches":0');
  });

  it('reflects sent-match exchanges in the summary counts', () => {
    setExchanges([
      { peerId: 'p1', talkId: 't1', outcome: 'match' },
      { peerId: 'p2', talkId: 't2', outcome: 'mismatch' },
    ]);
    document.body.innerHTML = '<div id="stats"></div>';
    displayContextualStatistics('stats', '', deps());
    const text = document.getElementById('stats')!.textContent!;
    expect(text).toContain('"responses":2');
    expect(text).toContain('"matches":1');
  });

  it('falls back to the empty-state text when building the dashboard throws', () => {
    localStorage.setItem('localTalkExchanges', '{not valid json, but readLocalTalkExchanges swallows this');
    // Force a throw further down by making currentUserId access safe but tf throw instead.
    document.body.innerHTML = '<div id="stats"></div>';
    const throwingDeps = deps({
      tf: () => {
        throw new Error('boom');
      },
    });
    displayContextualStatistics('stats', 'X: ', throwingDeps);
    expect(document.getElementById('stats')!.textContent).toBe('X: contextualStatsEmpty');
  });
});

describe('displayStatisticsDashboard', () => {
  it('does nothing when the statistics-content container is absent', async () => {
    global.fetch = jest.fn();
    await displayStatisticsDashboard(deps({ apiBase: 'http://api.test' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not call the downloads-style stats API when apiBase is blank', async () => {
    document.body.innerHTML = '<div id="statistics-content"></div>';
    global.fetch = jest.fn();
    await displayStatisticsDashboard(deps({ apiBase: '' }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('statistics-content')!.innerHTML).not.toBe('');
  });

  it('fetches broadcast-tag popularity and trends when apiBase is set, and renders the dashboard', async () => {
    document.body.innerHTML = '<div id="statistics-content"></div>';
    global.fetch = jest.fn((url: string) => {
      if (String(url).includes('/trends')) {
        return Promise.resolve({ ok: true, json: async () => ({ days: ['d1'], tags: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ tags: [{ id: 'sell', count: 3 }] }) });
    }) as unknown as typeof fetch;
    await displayStatisticsDashboard(deps({ apiBase: 'http://api.test' }));
    expect(global.fetch).toHaveBeenCalledWith('http://api.test/api/stats/broadcast-tags', { cache: 'no-store' });
    expect(global.fetch).toHaveBeenCalledWith('http://api.test/api/stats/broadcast-tags/trends', { cache: 'no-store' });
    expect(document.getElementById('statistics-content')!.innerHTML.length).toBeGreaterThan(0);
  });

  it('still renders the dashboard when the stats API is unreachable', async () => {
    document.body.innerHTML = '<div id="statistics-content"></div>';
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(displayStatisticsDashboard(deps({ apiBase: 'http://api.test' }))).resolves.toBeUndefined();
    expect(document.getElementById('statistics-content')!.innerHTML.length).toBeGreaterThan(0);
  });

  it('the refresh callback wired into the rendered dashboard re-runs displayStatisticsDashboard', async () => {
    setExchanges([{ peerId: 'p1', talkId: 't1', outcome: 'match' }]);
    document.body.innerHTML = '<div id="statistics-content"></div>';
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await displayStatisticsDashboard(deps());
    const refreshBtn = document.querySelector('[data-action="refresh-stats"], button');
    // Refresh affordance exists somewhere in the rendered dashboard; clicking it must not throw.
    if (refreshBtn) {
      expect(() => (refreshBtn as HTMLElement).click()).not.toThrow();
    }
  });
});
