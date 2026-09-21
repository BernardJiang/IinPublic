/** @jest-environment jsdom */

import type { DisplayTalksListDeps } from '../../web/ui/talks-list-view';

function renderFresh(deps: DisplayTalksListDeps): void {
  jest.isolateModules(() => {
    // Listener/render sequence state is document-scoped inside the module; a fresh module keeps
    // each characterization independent.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { displayTalksList } = require('../../web/ui/talks-list-view');
    displayTalksList(deps);
  });
}

function makeDeps(overrides: Partial<DisplayTalksListDeps> = {}): DisplayTalksListDeps {
  return {
    currentUser: undefined,
    currentLocation: undefined,
    creatorReplyRows: [],
    incomingTalkClusters: [],
    talkStatsMap: {},
    talksShowIncoming: true,
    talksShowOutgoing: true,
    talksEnabledTypes: new Set(['tag', 'flow', 'survey', 'route']),
    talksOutSortMode: 'recent',
    talksQuery: '',
    talksCompletionFilter: 'all',
    talksOutcomeFilter: 'all',
    talksDateFrom: '',
    talksDateTo: '',
    syncStatusBarMatchCount: jest.fn(),
    deleteMyTalk: jest.fn(),
    quickAnswerIncomingTag: jest.fn(),
    showTalkDetail: jest.fn(),
    showSurveyStatsDialog: jest.fn(),
    showCreatorRepliesForTalk: jest.fn(),
    setTalkDisabled: jest.fn(),
    showNotification: jest.fn(),
    t: (key) => key,
    tf: (key, values) => `${key}:${Object.values(values).join(',')}`,
    bindTalksRowGestures: jest.fn(),
    getMyConversations: () => ({}),
    formatReasonCounts: () => '',
    displayContextualStatistics: jest.fn(),
    getCoExchangedPeople: () => [],
    formatTalkDistanceFromAuthor: () => '',
    formatTalkExpiration: () => 'Forever',
    formatTalkLanguage: (code) => code,
    formatTalkLocation: () => 'Anywhere',
    formatTalkRelativeTime: () => 'now',
    formatTalkType: (type) => type,
    getIncomingResponseCount: () => 0,
    getPreferredTalkLanguage: () => 'en',
    pickIncomingRowTalkId: (cluster) => String(cluster?.latestTalkId || ''),
    showTalkEditorDialog: jest.fn(),
    navigateToGraphNode: jest.fn(),
    showChooseWhoToDmPicker: jest.fn(),
    emit: jest.fn(),
    persistTalksTabState: jest.fn(),
    getTalksGestureSuppressClickUntil: () => 0,
    ...overrides,
  };
}

function installTalksDom(): void {
  document.body.innerHTML = `
    <div id="talks-view-content">
      <input id="talks-filter-incoming" type="checkbox">
      <input id="talks-filter-outgoing" type="checkbox">
      <select id="talks-out-sort-order"><option value="recent">recent</option></select>
      <input id="talks-filter-query">
      <select id="talks-filter-completion"><option value="all">all</option></select>
      <select id="talks-filter-outcome"><option value="all">all</option></select>
      <input id="talks-filter-date-from">
      <input id="talks-filter-date-to">
      <div id="talks-list"></div>
    </div>
  `;
}

describe('displayTalksList', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceWith(document.createElement('body'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a no-op when the Talks list root is absent', () => {
    const deps = makeDeps();
    renderFresh(deps);
    expect(deps.syncStatusBarMatchCount).not.toHaveBeenCalled();
  });

  it('renders the empty state and synchronizes controls and summary callbacks', () => {
    installTalksDom();
    const deps = makeDeps({ talksShowIncoming: false, talksQuery: 'needle' });
    renderFresh(deps);

    expect(document.getElementById('talks-list')?.textContent).toContain('talksNoTalks');
    expect((document.getElementById('talks-filter-incoming') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('talks-filter-query') as HTMLInputElement).value).toBe('needle');
    expect(deps.displayContextualStatistics).toHaveBeenCalledWith(
      'talks-stats-strip',
      expect.stringContaining('talksStatusSummary'),
    );
    expect(deps.syncStatusBarMatchCount).toHaveBeenCalledTimes(2);
    expect(deps.bindTalksRowGestures).toHaveBeenCalledTimes(1);
  });

  it('renders an outgoing talk, requests its stats, and routes a row click to editing', () => {
    installTalksDom();
    localStorage.setItem('myTalks', JSON.stringify({
      'talk-1': {
        talkId: 'talk-1',
        title: 'A visible talk',
        type: 'flow',
        role: 'created',
        timestamp: '2026-09-12T00:00:00.000Z',
        lastInteraction: '2026-09-12T00:00:00.000Z',
        fullTalk: {
          id: 'talk-1',
          title: 'A visible talk',
          type: 'flow',
          questions: [{ id: 'q1', text: 'Ready?', answers: [{ id: 'yes', text: 'Yes' }] }],
        },
      },
    }));
    const emit = jest.fn();
    renderFresh(makeDeps({ emit }));

    const row = document.querySelector<HTMLElement>('.talk-list-item[data-talk-id="talk-1"]');
    expect(row?.textContent).toContain('A visible talk');
    expect(emit).toHaveBeenCalledWith('needTalkStats', { talkIds: ['talk-1'] });
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emit).toHaveBeenCalledWith('loadTalkForEdit', { talkId: 'talk-1' });
  });

  it('pins an older talk above the current sort and unpins it without opening the row', () => {
    installTalksDom();
    localStorage.setItem('myTalks', JSON.stringify({
      newer: {
        talkId: 'newer', title: 'Newer talk', type: 'flow', role: 'created',
        lastInteraction: '2026-09-12T00:00:00.000Z',
        fullTalk: { id: 'newer', title: 'Newer talk', type: 'flow', questions: [] },
      },
      older: {
        talkId: 'older', title: 'Older talk', type: 'flow', role: 'created',
        lastInteraction: '2026-09-11T00:00:00.000Z',
        fullTalk: { id: 'older', title: 'Older talk', type: 'flow', questions: [] },
      },
    }));
    const emit = jest.fn();
    renderFresh(makeDeps({ emit }));

    document.querySelector<HTMLButtonElement>('[data-talk-id="older"] .talk-pin-button')?.click();
    let ids = Array.from(document.querySelectorAll<HTMLElement>('.talk-list-item')).map((row) => row.dataset.talkId);
    expect(ids).toEqual(['older', 'newer']);
    expect(document.querySelector('[data-talk-id="older"] .talk-pin-button')?.getAttribute('aria-pressed')).toBe('true');
    expect(emit).not.toHaveBeenCalledWith('loadTalkForEdit', expect.anything());

    document.querySelector<HTMLButtonElement>('[data-talk-id="older"] .talk-pin-button')?.click();
    ids = Array.from(document.querySelectorAll<HTMLElement>('.talk-list-item')).map((row) => row.dataset.talkId);
    expect(ids).toEqual(['newer', 'older']);
  });

  it('delegates the outgoing broadcast checkbox and reports the new state', () => {
    jest.useFakeTimers();
    installTalksDom();
    localStorage.setItem('myTalks', JSON.stringify({
      flow: {
        talkId: 'flow', title: 'Flow', type: 'flow', role: 'created',
        timestamp: '2026-09-12T00:00:00.000Z',
        fullTalk: {
          id: 'flow', title: 'Flow', type: 'flow',
          questions: [{ id: 'q1', text: 'Ready?', answers: [{ id: 'yes', text: 'Yes' }] }],
        },
      },
    }));
    const setTalkDisabled = jest.fn();
    const showNotification = jest.fn();
    renderFresh(makeDeps({ setTalkDisabled, showNotification }));

    const checkbox = document.querySelector<HTMLInputElement>('.talk-broadcast-toggle-checkbox');
    expect(checkbox).not.toBeNull();
    if (!checkbox) return;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(setTalkDisabled).toHaveBeenCalledWith('flow', true);
    expect(showNotification).toHaveBeenCalledWith('talksBroadcastDisabled', 'success');
  });

  it('delegates an incoming tag decision and preserves identity fallback', () => {
    jest.useFakeTimers();
    installTalksDom();
    const quickAnswerIncomingTag = jest.fn();
    renderFresh(makeDeps({
      quickAnswerIncomingTag,
      incomingTalkClusters: [{
        identityKey: 'qa_tag_one',
        latestTalkId: 'incoming-tag',
        title: 'Tennis',
        type: 'tag',
        language: 'en',
        latestTalk: { id: 'incoming-tag', title: 'Tennis', type: 'tag', questions: [] },
        senders: {},
        updatedAt: '2026-09-12T00:00:00.000Z',
      }],
    }));

    const checkbox = document.querySelector<HTMLInputElement>('.talk-tag-in-checkbox');
    expect(checkbox?.indeterminate).toBe(true);
    checkbox?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    jest.runOnlyPendingTimers();
    expect(quickAnswerIncomingTag).toHaveBeenCalledWith(
      'incoming-tag',
      'qa_tag_one',
      true,
    );
  });
});
