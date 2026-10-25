/** @jest-environment jsdom */

import type { DisplayTalksListDeps } from '../../web/ui/talks-list-view';
import { TAG_CHIP_FLY_MS } from '../../web/ui/tag-chip-fly';

/** The row selection of the module instance the latest renderFresh used (long-press selects). */
let selectTalkRow: (row: HTMLElement) => void = () => undefined;

function renderFresh(deps: DisplayTalksListDeps): void {
  jest.isolateModules(() => {
    // Listener/render sequence state is document-scoped inside the module; a fresh module keeps
    // each characterization independent.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { displayTalksList } = require('../../web/ui/talks-list-view');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    selectTalkRow = require('../../web/ui/tag-tap-mode').selectTalkRow;
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
    talksCompletionFilter: 'unanswered',
    talksOutcomeFilter: 'all',
    talksDateFrom: '',
    talksDateTo: '',
    syncStatusBarMatchCount: jest.fn(),
    deleteMyTalk: jest.fn(),
    restoreIgnoredTalk: jest.fn(),
    quickAnswerIncomingTag: jest.fn(),
    quickIgnoreIncomingTalk: jest.fn(),
    quickCopyIncomingTalk: jest.fn(),
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
    showTalkTemplatePicker: jest.fn(),
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
      <select id="talks-filter-completion">
        <option value="unanswered">unanswered</option>
        <option value="answered">answered</option>
        <option value="ignored">ignored</option>
        <option value="all">all</option>
      </select>
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

  it('renders the ordinary empty state and routes its creation actions', () => {
    installTalksDom();
    const deps = makeDeps({ talksShowIncoming: false, talksQuery: 'needle' });
    renderFresh(deps);

    expect(document.querySelector('.empty-state')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid="talks-starter-more"]')?.click();
    expect(deps.showTalkTemplatePicker).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLButtonElement>('[data-testid="talks-starter-scratch"]')?.click();
    expect(deps.showTalkEditorDialog).toHaveBeenCalledWith();
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

  it('keeps outgoing Talks visible when incoming completion and outcome filters are active', () => {
    installTalksDom();
    localStorage.setItem('myTalks', JSON.stringify({
      created: {
        talkId: 'created', title: 'My new flow', type: 'flow', role: 'created',
        timestamp: '2026-09-12T00:00:00.000Z', lastInteraction: '2026-09-12T00:00:00.000Z',
        fullTalk: { id: 'created', title: 'My new flow', type: 'flow', questions: [] },
      },
    }));

    renderFresh(makeDeps({ talksCompletionFilter: 'answered', talksOutcomeFilter: 'match' }));

    expect(document.querySelector('.talk-list-item[data-talk-id="created"]')).not.toBeNull();
  });

  it('hides answered incoming history by default and reveals it with the Answered filter', () => {
    localStorage.setItem('myTalks', JSON.stringify({
      answered: {
        talkId: 'answered', title: 'Read email behavior', type: 'flow', role: 'answered',
        lastInteraction: '2026-09-12T00:00:00.000Z', senders: ['alice'], outcome: 'match',
        completedAnswers: [{ questionId: 'q1', answerId: 'yes' }],
        fullTalk: {
          id: 'answered', title: 'Read email behavior', type: 'flow', authorId: 'alice',
          questions: [{ id: 'q1', text: 'Ready?', answers: [{ id: 'yes', text: 'Yes' }] }],
        },
      },
    }));

    installTalksDom();
    renderFresh(makeDeps());
    expect(document.querySelector('.talk-list-item[data-role="incoming"]')).toBeNull();

    installTalksDom();
    renderFresh(makeDeps({ talksCompletionFilter: 'answered' }));
    const row = document.querySelector<HTMLElement>('.talk-list-item[data-role="incoming"]');
    expect(row?.textContent).toContain('Read email behavior');
    expect(row?.classList.contains('talk-incoming-answered')).toBe(true);
    expect(row?.querySelector('.talk-add-to-my-talks-btn')).toBeNull();
  });

  it('retains a copied answered talk in Answered incoming history', () => {
    localStorage.setItem('myTalks', JSON.stringify({
      copied: {
        talkId: 'copied', title: 'Answered and auto-saved', type: 'flow', role: 'copied',
        lastInteraction: '2026-09-12T00:00:00.000Z', senders: ['alice'], outcome: 'match',
        completedAnswers: [{ questionId: 'q1', answerId: 'yes' }],
        fullTalk: {
          id: 'copied', title: 'Answered and auto-saved', type: 'flow', authorId: 'alice',
          questions: [{ id: 'q1', text: 'Ready?', answers: [{ id: 'yes', text: 'Yes' }] }],
        },
      },
    }));

    installTalksDom();
    renderFresh(makeDeps({ talksCompletionFilter: 'answered' }));
    const row = document.querySelector<HTMLElement>('.talk-list-item[data-role="incoming"]');
    expect(row?.textContent).toContain('Answered and auto-saved');
    expect(row?.querySelector('.talk-add-to-my-talks-btn')).toBeNull();
  });

  it('does not show starters when existing Talk history is merely hidden by a filter', () => {
    installTalksDom();
    localStorage.setItem('myTalks', JSON.stringify({
      existing: {
        talkId: 'existing', title: 'Existing history', type: 'flow', role: 'created',
        lastInteraction: '2026-09-12T00:00:00.000Z',
        fullTalk: { id: 'existing', title: 'Existing history', type: 'flow', questions: [] },
      },
    }));
    renderFresh(makeDeps({ talksQuery: 'does-not-match' }));

    expect(document.querySelector('[data-testid="talks-starter-shelf"]')).toBeNull();
    expect(document.getElementById('talks-list')?.textContent).toContain('talksNoTalks');
  });

  it('pins a long-pressed row with the toolbar and grays the toolbar out without a selection', () => {
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
    document.body.insertAdjacentHTML('beforeend', ['pass', 'like', 'pin']
      .map((action) => `<button class="talks-tap-mode-btn" id="talks-tap-${action}-btn" disabled></button>`).join(''));
    renderFresh(makeDeps({ emit }));

    const pin = () => document.getElementById('talks-tap-pin-btn') as HTMLButtonElement;
    // Nothing selected: the toolbar is grayed out.
    expect(pin().disabled).toBe(true);
    // A long-press selects the row; 📌 then pins it, and it shows a badge instead of a button.
    selectTalkRow(document.querySelector<HTMLElement>('[data-talk-id="older"]')!);
    expect(pin().disabled).toBe(false);
    pin().click();
    let ids = Array.from(document.querySelectorAll<HTMLElement>('.talk-list-item')).map((row) => row.dataset.talkId);
    expect(ids).toEqual(['older', 'newer']);
    expect(document.querySelector('[data-talk-id="older"] .talk-pin-badge')).not.toBeNull();
    expect(document.querySelector('.talk-pin-button')).toBeNull();
    expect(emit).not.toHaveBeenCalledWith('loadTalkForEdit', expect.anything());

    pin().click();
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

  it('likes a tag on tap, passes it on Delete or with the toolbar on a selection', () => {
    jest.useFakeTimers();
    installTalksDom();
    document.body.insertAdjacentHTML('beforeend', ['pass', 'like', 'pin']
      .map((action) => `<button class="talks-tap-mode-btn" id="talks-tap-${action}-btn" disabled></button>`).join(''));
    const quickAnswerIncomingTag = jest.fn();
    const quickIgnoreIncomingTalk = jest.fn();
    renderFresh(makeDeps({
      quickAnswerIncomingTag,
      quickIgnoreIncomingTalk,
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

    // No buttons on the row: a tap likes it, Delete passes it, and the toolbar acts on a selection.
    const chip = () => document.querySelector<HTMLElement>('.talk-tag-in')!;
    expect(chip().querySelector('button')).toBeNull();
    chip().click();
    expect(document.querySelectorAll('.talk-tag-fly-ghost.talk-tag-fly-like')).toHaveLength(1);
    expect(quickAnswerIncomingTag).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TAG_CHIP_FLY_MS);
    expect(quickAnswerIncomingTag).toHaveBeenCalledWith('incoming-tag', 'qa_tag_one', true);

    // A chip in flight ignores further taps until the list re-renders.
    chip().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    jest.advanceTimersByTime(TAG_CHIP_FLY_MS);
    expect(quickIgnoreIncomingTalk).not.toHaveBeenCalled();
    chip().removeAttribute('aria-busy');
    chip().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(document.querySelectorAll('.talk-tag-fly-ghost.talk-tag-fly-pass')).toHaveLength(1);
    jest.advanceTimersByTime(TAG_CHIP_FLY_MS);
    expect(quickIgnoreIncomingTalk).toHaveBeenCalledWith('incoming-tag', 'qa_tag_one');

    // Toolbar ✕ on the long-pressed row.
    quickIgnoreIncomingTalk.mockClear();
    chip().removeAttribute('aria-busy');
    chip().style.visibility = '';
    selectTalkRow(chip());
    const passButton = document.getElementById('talks-tap-pass-btn') as HTMLButtonElement;
    expect(passButton.disabled).toBe(false);
    passButton.click();
    jest.advanceTimersByTime(TAG_CHIP_FLY_MS);
    expect(quickIgnoreIncomingTalk).toHaveBeenCalledWith('incoming-tag', 'qa_tag_one');
  });

  it('renders an incoming Pair-tag as the same button-free chip', () => {
    installTalksDom();
    renderFresh(makeDeps({
      incomingTalkClusters: [{
        identityKey: 'pair:sell:buy',
        latestTalkId: 'incoming-pair-tag',
        title: 'Sell',
        type: 'tag',
        latestTalk: {
          id: 'incoming-pair-tag', title: 'Sell', type: 'tag',
          questions: [{
            id: 'q1', text: 'sell', reciprocalTagContext: true,
            answers: [{ id: 'buy', text: 'buy', isMatch: true }],
          }],
        },
        senders: {},
      }],
    }));

    // Same tap-to-like chip, no buttons.
    const row = document.querySelector('.talk-tag-in');
    expect(row?.getAttribute('role')).toBe('button');
    expect(row?.querySelector('button')).toBeNull();
    expect(row?.textContent).toContain('Sell');
  });

  it('keeps ignored content out of normal views and restores it from the Ignored list', () => {
    localStorage.setItem('myTalks', JSON.stringify({
      ignored: {
        talkId: 'ignored', title: 'Ignored content', type: 'flow', role: 'ignored',
        lastInteraction: '2026-09-12T00:00:00.000Z', senders: ['alice'],
        fullTalk: { id: 'ignored', title: 'Ignored content', type: 'flow', questions: [] },
      },
    }));
    localStorage.setItem('answeredTalkByContent', JSON.stringify({ 'same-flow': 'ignored' }));
    installTalksDom();
    renderFresh(makeDeps({
      incomingTalkClusters: [{
        identityKey: 'same-flow', latestTalkId: 'flow-new', title: 'Ignored content from Bob', type: 'flow',
        latestTalk: { id: 'flow-new', title: 'Ignored content from Bob', type: 'flow', questions: [] }, senders: {},
      }],
    }));
    expect(document.body.textContent).not.toContain('Ignored content');

    installTalksDom();
    const restoreIgnoredTalk = jest.fn();
    renderFresh(makeDeps({ talksCompletionFilter: 'ignored', restoreIgnoredTalk }));
    expect(document.body.textContent).toContain('Ignored content');
    document.querySelector<HTMLButtonElement>('.talk-restore-ignored-btn')?.click();
    expect(restoreIgnoredTalk).toHaveBeenCalledWith('ignored');
  });

  it('shows an accepted copied tag only in My Talks, not again in incoming history', () => {
    localStorage.setItem('myTalks', JSON.stringify({
      accepted: {
        talkId: 'accepted', title: 'Accepted tag', type: 'tag', role: 'copied',
        senders: ['alice'], completedAnswers: [{ questionId: 'q1', answerId: 'yes' }],
        fullTalk: { id: 'accepted', title: 'Accepted tag', type: 'tag', questions: [] },
      },
    }));
    installTalksDom();
    renderFresh(makeDeps({ talksCompletionFilter: 'all' }));

    expect(document.querySelectorAll('.talk-list-item[data-talk-id="accepted"]')).toHaveLength(1);
    expect(document.querySelector('.talk-list-item[data-talk-id="accepted"]')?.getAttribute('data-role')).toBe('copied');
  });

  it('does not render Add to My Talks on incoming Flow, Survey, or Route cards', () => {
    installTalksDom();
    renderFresh(makeDeps({
      incomingTalkClusters: ['flow', 'survey', 'route'].map((type) => ({
        identityKey: `qa_${type}_one`, latestTalkId: `incoming-${type}`, title: `${type} incoming`, type,
        language: 'en', latestTalk: { id: `incoming-${type}`, title: `${type} incoming`, type, questions: [] },
        senders: { sender: { senderId: 'sender', senderName: 'Alice' } }, updatedAt: '2026-09-12T00:00:00.000Z',
      })),
    }));

    expect(document.querySelectorAll('.talk-list-item[data-role="incoming"]')).toHaveLength(3);
    expect(document.querySelector('.talk-add-to-my-talks-btn')).toBeNull();
  });

  it('copies an incoming Flow talk from the row 📋 toggle without opening it', () => {
    installTalksDom();
    const quickCopyIncomingTalk = jest.fn();
    const showTalkDetail = jest.fn();
    renderFresh(makeDeps({
      quickCopyIncomingTalk,
      showTalkDetail,
      incomingTalkClusters: [{
        identityKey: 'qa_flow_one', latestTalkId: 'incoming-flow', title: 'Sell notebook', type: 'flow',
        language: 'en', latestTalk: { id: 'incoming-flow', title: 'Sell notebook', type: 'flow', questions: [] },
        senders: { sender: { senderId: 'sender', senderName: 'Alice' } }, updatedAt: '2026-09-12T00:00:00.000Z',
      }],
    }));

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="talk-copy-toggle"]');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle?.title).toBe('talksCopyToMyTalks');
    toggle?.click();
    expect(quickCopyIncomingTalk).toHaveBeenCalledWith('incoming-flow', 'qa_flow_one');
    expect(showTalkDetail).not.toHaveBeenCalled();
  });

  it('shows ✓ on a copied answered talk and un-copies it from the same toggle', () => {
    localStorage.setItem('myTalks', JSON.stringify({
      copied: {
        talkId: 'copied', title: 'Answered and copied', type: 'flow', role: 'copied',
        lastInteraction: '2026-09-12T00:00:00.000Z', senders: ['alice'], outcome: 'match',
        completedAnswers: [{ questionId: 'q1', answerId: 'yes' }],
        fullTalk: { id: 'copied', title: 'Answered and copied', type: 'flow', authorId: 'alice', questions: [] },
      },
    }));
    installTalksDom();
    const showNotification = jest.fn();
    renderFresh(makeDeps({ talksCompletionFilter: 'answered', showNotification }));

    const toggleSelector = '.talk-list-item[data-role="incoming"] [data-testid="talk-copy-toggle"]';
    const toggle = document.querySelector<HTMLButtonElement>(toggleSelector);
    expect(toggle?.classList.contains('is-copied')).toBe(true);
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    toggle?.click();
    expect(JSON.parse(localStorage.getItem('myTalks') || '{}').copied.role).toBe('answered');
    expect(showNotification).toHaveBeenCalledWith('talksRemovedFromList', 'success');
    expect(document.querySelector(toggleSelector)?.getAttribute('aria-pressed')).toBe('false');
  });
});
