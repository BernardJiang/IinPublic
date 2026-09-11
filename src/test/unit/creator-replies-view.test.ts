/** @jest-environment jsdom */

import {
  renderCreatorReplies,
  CREATOR_REPLY_PAGE_SIZE,
  persistCreatorReplyFilterState,
  readCreatorReplyFilterState,
  restoreCreatorReplyFilterState,
  type CreatorReplyRow,
  type CreatorReplyFilterState,
  type RenderCreatorRepliesDeps,
} from '../../web/ui/creator-replies-view';
import { uiText, type UiTranslationKey } from '../../web/ui/ui-translations';

function t(key: UiTranslationKey): string {
  return uiText('en', key);
}
function tf(key: UiTranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((label, [k, v]) => label.replace(`{${k}}`, String(v)), t(key));
}

function makeRow(overrides: Partial<CreatorReplyRow> = {}): CreatorReplyRow {
  return {
    responseId: 'resp-1',
    talkId: 'talk-1',
    title: 'My Talk',
    type: 'flow',
    language: 'en',
    responderId: 'user-1',
    responderName: 'Alice',
    outcome: 'match',
    answerMode: 'manual',
    date: '2026-08-01T10:00:00.000Z',
    answers: [{ questionId: 'q1', answerId: 'a1', answerText: 'Yes' }],
    ...overrides,
  };
}

function makeFilterState(overrides: Partial<CreatorReplyFilterState> = {}): CreatorReplyFilterState {
  return {
    query: '',
    outcome: 'all',
    relationship: 'all',
    type: 'all',
    language: 'all',
    from: '',
    to: '',
    sort: 'recent',
    group: 'none',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RenderCreatorRepliesDeps> = {}): RenderCreatorRepliesDeps {
  let scopedTalkId: string | null = null;
  let scopedTalkTitle = '';
  let visibleCount = CREATOR_REPLY_PAGE_SIZE;
  return {
    getRows: () => [makeRow()],
    readFilterState: () => makeFilterState(),
    getScopedTalkId: () => scopedTalkId,
    getScopedTalkTitle: () => scopedTalkTitle,
    clearScope: () => {
      scopedTalkId = null;
      scopedTalkTitle = '';
    },
    getVisibleCount: () => visibleCount,
    growVisibleCount: () => { visibleCount += CREATOR_REPLY_PAGE_SIZE; },
    getMyConversations: () => ({}),
    getKnownPerson: () => undefined,
    getUiLanguage: () => 'en',
    t,
    tf,
    formatTalkLanguage: (code) => code.toUpperCase(),
    showConversationDetail: jest.fn(),
    navigateToGraphNode: jest.fn(),
    ...overrides,
  };
}

describe('renderCreatorReplies (UIManager decomposition cluster #11)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="creator-replies-summary"></div>
      <div id="creator-replies-active-filters"></div>
      <div id="creator-replies-list"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing when the list/summary DOM is absent', () => {
    document.body.innerHTML = '';
    expect(() => renderCreatorReplies(makeDeps())).not.toThrow();
  });

  it('renders rows and a summary count reflecting shown/filtered/total', () => {
    const deps = makeDeps({ getRows: () => [makeRow({ responseId: 'r1' }), makeRow({ responseId: 'r2', responderName: 'Bob' })] });
    renderCreatorReplies(deps);

    expect(document.getElementById('creator-replies-summary')?.textContent).toBe('Showing 2 of 2 filtered replies (2 total)');
    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(2);
    expect(document.body.textContent).toContain('Alice');
    expect(document.body.textContent).toContain('Bob');
  });

  it('shows the empty state when every row is filtered out', () => {
    const deps = makeDeps({
      getRows: () => [makeRow()],
      readFilterState: () => makeFilterState({ outcome: 'mismatch' }),
    });
    renderCreatorReplies(deps);

    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(0);
    expect(document.getElementById('creator-replies-list')?.textContent).toBe(t('repliesNoMatch'));
  });

  it('scoped-talk filter: hides non-matching rows and shows a clearable scope chip', () => {
    const rows = [makeRow({ responseId: 'r1', talkId: 'talk-a' }), makeRow({ responseId: 'r2', talkId: 'talk-b' })];
    let scopedTalkId: string | null = 'talk-a';
    const deps = makeDeps({
      getRows: () => rows,
      getScopedTalkId: () => scopedTalkId,
      getScopedTalkTitle: () => 'Talk A',
      clearScope: () => { scopedTalkId = null; },
    });
    renderCreatorReplies(deps);

    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(1);
    const chip = document.getElementById('reply-scope-chip');
    expect(chip).not.toBeNull();

    chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(scopedTalkId).toBeNull();
    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(2);
    expect(document.getElementById('reply-scope-chip')).toBeNull();
  });

  it('pagination: shows a "load more" button that grows the visible page and re-renders', () => {
    const rows = Array.from({ length: CREATOR_REPLY_PAGE_SIZE + 5 }, (_, i) =>
      makeRow({ responseId: `r${i}`, responderName: `User${i}` }),
    );
    const deps = makeDeps({ getRows: () => rows });
    renderCreatorReplies(deps);

    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(CREATOR_REPLY_PAGE_SIZE);
    const loadMore = document.getElementById('reply-load-more');
    expect(loadMore).not.toBeNull();
    expect(loadMore?.textContent).toBe('Show 5 more replies');

    loadMore?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(rows.length);
    expect(document.getElementById('reply-load-more')).toBeNull();
  });

  it('clicking a row with a matched conversation opens it via showConversationDetail', () => {
    const showConversationDetail = jest.fn();
    const deps = makeDeps({
      getRows: () => [makeRow({ outcome: 'match', responderId: 'user-9' })],
      getMyConversations: () => ({
        'conv-1': { otherUserId: 'user-9', matchScore: 3, matchTotal: 4 },
      }),
      showConversationDetail,
    });
    renderCreatorReplies(deps);

    const row = document.querySelector('.creator-reply-row') as HTMLElement;
    expect(row.dataset.conversationId).toBe('conv-1');
    expect(row.querySelector('.creator-reply-match-percent')?.textContent).toBe('75%');
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(showConversationDetail).toHaveBeenCalledWith('conv-1');
  });

  it('clicking a row with no conversation navigates to the responder\'s graph node', () => {
    const navigateToGraphNode = jest.fn();
    const deps = makeDeps({
      getRows: () => [makeRow({ responderId: 'user-2', responderName: 'Carol', outcome: 'ignore' })],
      navigateToGraphNode,
    });
    renderCreatorReplies(deps);

    const row = document.querySelector('.creator-reply-row') as HTMLElement;
    expect(row.dataset.conversationId).toBeUndefined();
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(navigateToGraphNode).toHaveBeenCalledWith({ type: 'person', id: 'user-2', name: 'Carol' });
  });

  it('escapes hostile responder names and titles rather than injecting markup', () => {
    const deps = makeDeps({
      getRows: () => [makeRow({ responderName: '<img src=x onerror=alert(1)>', title: '<script>bad</script>' })],
    });
    renderCreatorReplies(deps);

    expect(document.querySelector('.creator-reply-row img')).toBeNull();
    expect(document.querySelector('.creator-reply-row script')).toBeNull();
    expect(document.body.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('search query filters by responder name and talk title', () => {
    const rows = [makeRow({ responseId: 'r1', responderName: 'Alice', title: 'Bicycle' }), makeRow({ responseId: 'r2', responderName: 'Bob', title: 'Piano' })];
    const deps = makeDeps({
      getRows: () => rows,
      readFilterState: () => makeFilterState({ query: 'bicycle' }),
    });
    renderCreatorReplies(deps);

    expect(document.querySelectorAll('.creator-reply-row')).toHaveLength(1);
    expect(document.body.textContent).toContain('Alice');
    expect(document.body.textContent).not.toContain('Bob');
  });
});

describe('creator reply filter state persistence', () => {
  function renderFilterFixture(): void {
    document.body.innerHTML = `
      <input id="reply-filter-query">
      <select id="reply-filter-outcome"><option value="all" selected>All</option><option value="match">Match</option></select>
      <select id="reply-filter-relationship"><option value="all" selected>All</option><option value="partner">Partner</option></select>
      <select id="reply-filter-type"><option value="all" selected>All</option><option value="flow">Flow</option></select>
      <select id="reply-filter-language"><option value="all" selected>All</option><option value="en">English</option></select>
      <input id="reply-filter-from">
      <input id="reply-filter-to">
      <select id="reply-sort-order"><option value="recent" selected>Recent</option><option value="oldest">Oldest</option></select>
      <select id="reply-group-order"><option value="none" selected>None</option><option value="talk">Talk</option></select>
    `;
  }

  beforeEach(() => {
    localStorage.clear();
    renderFilterFixture();
  });

  it('readCreatorReplyFilterState reads every control\'s current DOM value', () => {
    (document.getElementById('reply-filter-query') as HTMLInputElement).value = '  bicycle  ';
    (document.getElementById('reply-filter-outcome') as HTMLSelectElement).value = 'match';
    (document.getElementById('reply-sort-order') as HTMLSelectElement).value = 'oldest';
    expect(readCreatorReplyFilterState()).toEqual({
      query: 'bicycle',
      outcome: 'match',
      relationship: 'all',
      type: 'all',
      language: 'all',
      from: '',
      to: '',
      sort: 'oldest',
      group: 'none',
    });
  });

  it('persistCreatorReplyFilterState + restoreCreatorReplyFilterState round-trip through localStorage', () => {
    (document.getElementById('reply-filter-query') as HTMLInputElement).value = 'bicycle';
    (document.getElementById('reply-filter-outcome') as HTMLSelectElement).value = 'match';
    (document.getElementById('reply-sort-order') as HTMLSelectElement).value = 'oldest';
    persistCreatorReplyFilterState();

    renderFilterFixture(); // fresh, default-valued controls simulating a reload
    restoreCreatorReplyFilterState();

    expect((document.getElementById('reply-filter-query') as HTMLInputElement).value).toBe('bicycle');
    expect((document.getElementById('reply-filter-outcome') as HTMLSelectElement).value).toBe('match');
    expect((document.getElementById('reply-sort-order') as HTMLSelectElement).value).toBe('oldest');
  });

  it('restoreCreatorReplyFilterState leaves defaults untouched when nothing was ever persisted', () => {
    restoreCreatorReplyFilterState();
    expect((document.getElementById('reply-filter-query') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('reply-filter-outcome') as HTMLSelectElement).value).toBe('all');
  });

  it('restoreCreatorReplyFilterState does not throw on malformed stored JSON', () => {
    localStorage.setItem('creatorReplyFilterState', 'not json');
    expect(() => restoreCreatorReplyFilterState()).not.toThrow();
    expect((document.getElementById('reply-filter-query') as HTMLInputElement).value).toBe('');
  });

  it('restoreCreatorReplyFilterState never sets a control to an empty stored value', () => {
    (document.getElementById('reply-filter-query') as HTMLInputElement).value = 'stale-value';
    localStorage.setItem('creatorReplyFilterState', JSON.stringify({ query: '', outcome: 'match' }));
    restoreCreatorReplyFilterState();
    // Falsy stored value is skipped, so the control keeps whatever it already had.
    expect((document.getElementById('reply-filter-query') as HTMLInputElement).value).toBe('stale-value');
    expect((document.getElementById('reply-filter-outcome') as HTMLSelectElement).value).toBe('match');
  });
});
