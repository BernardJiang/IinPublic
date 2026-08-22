/**
 * @jest-environment jsdom
 */

import { answerTalkMatchesQuery, buildAnswerItemModels, displayAnswersList, getAnswerDisplayText } from '../../web/ui/answers-view';
import {
  appendAutoUse,
  createEmptyExactChatbotMemoryState,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import { uiText } from '../../web/ui/ui-translations';

describe('answers view models', () => {
  it('renders tags as checked or unchecked choices', () => {
    const talk = {
      type: 'tag',
      title: 'Tennis',
      questions: [
        {
          id: 'q_0',
          text: 'Tennis',
          answers: [
            { id: 'a_match', text: 'Match.', isMatch: true },
            { id: 'a_ignore', text: 'Ignore.', isIgnore: true },
          ],
        },
      ],
    };

    const variants = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_0', answerId: 'a_match', answerText: 'Match.' }],
      'talk-1',
      'Tennis',
      'match',
      1000,
      ['sender-1'],
      undefined,
    );

    expect(variants).toHaveLength(1);
    expect(variants[0].choice).toBe('Checked');
    expect(variants[0].contextKey).toBe('');
  });

  it('preserves question answer text and context metadata', () => {
    const talk = {
      type: 'route',
      title: 'Route talk',
      questions: [
        {
          id: 'q_0',
          text: 'Need coffee?',
          answers: [{ id: 'a_0_1', text: 'Yes, please' }],
        },
        {
          id: 'q_1',
          text: 'Choose a cafe',
          contextHashId: 'cafefeed',
          contextPath: [{ questionId: 'q_0', answerId: 'a_0_1' }],
          answers: [{ id: 'a_1_0', text: 'Blue Bottle' }],
        },
      ],
    };

    const variants = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_1', answerId: 'a_1_0', answerText: 'Blue Bottle' }],
      'talk-1',
      'Route talk',
      'match',
      1000,
      [],
      undefined,
    );

    expect(variants[0].choice).toBe('Blue Bottle');
    expect(variants[0].contextKey).toBe('cafefeed');
    expect(variants[0].contextLabel).toBe('Need coffee?→Yes, please');
  });

  it('merges route branches with the same prompt into one row, keeping each context distinct as its own sub-line', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    const baseRecord = {
      id: 'route-history',
      talkId: 'route-talk',
      title: 'Branching cafe talk',
      type: 'route',
      language: 'en',
      outcome: 'match' as const,
      answeredAt: '2026-06-11T00:00:00.000Z',
      senderIds: ['u1'],
      items: [
        {
          questionId: 'q_level',
          answerId: 'a_beginner',
          prompt: 'Skill level?',
          choice: 'Beginner',
          kind: 'question' as const,
          contextPath: [],
          contextHash: 'hash_tennis',
          contextLabel: 'Tennis?→Yes',
        },
        {
          questionId: 'q_level',
          answerId: 'a_pro',
          prompt: 'Skill level?',
          choice: 'Professional',
          kind: 'question' as const,
          contextPath: [],
          contextHash: 'hash_badminton',
          contextLabel: 'Badminton?→Yes',
        },
      ],
    };

    displayAnswersList({
      getMyTalks: () => ({}),
      getFlatAnswerHistory: () => ({ history: baseRecord }),
      escapeHtml: (value) => value,
      copyAnsweredTalkToTalks: jest.fn(),
      showTalkDetail: jest.fn(),
      showPreferencesDialog: jest.fn(),
      showItemDetailsPopup: jest.fn(),
      getTalkContentKey: jest.fn(),
      text: (key) => uiText('en', key),
      formatDate: () => 'date',
      formatType: () => 'Route',
      formatLanguage: () => 'English',
    });

    // One merged row for the shared questionId, not two separate top-level rows.
    expect(document.querySelectorAll('.answer-question-item').length).toBe(1);
    const row = document.querySelector<HTMLElement>('.answer-question-item')!;
    expect(row.dataset.contextCount).toBe('2');
    expect(row.querySelectorAll('.answer-context-jump').length).toBe(2);

    const content = document.getElementById('answers-content')?.textContent || '';
    expect(content).toContain('Tennis? -> Yes');
    expect(content).toContain('Badminton? -> Yes');
  });

  it('renders stored contextLabel even when source talk is unavailable', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    displayAnswersList({
      getMyTalks: () => ({}),
      getFlatAnswerHistory: () => ({
        persisted: {
          id: 'persisted',
          talkId: 'missing-talk',
          title: 'Withdrawn flow',
          type: 'flow',
          language: 'en',
          outcome: 'mismatch',
          answeredAt: '2026-06-11T00:00:00.000Z',
          senderIds: [],
          items: [
            {
              questionId: 'q2',
              answerId: 'a2',
              prompt: 'Second question?',
              choice: 'Answer B',
              kind: 'question',
              contextPath: [],
              contextHash: 'deadbeef',
              contextLabel: 'First question?→Answer A',
            },
          ],
        },
      }),
      escapeHtml: (value) => value,
      copyAnsweredTalkToTalks: jest.fn(),
      showTalkDetail: jest.fn(),
      showPreferencesDialog: jest.fn(),
      showItemDetailsPopup: jest.fn(),
      getTalkContentKey: jest.fn(),
      text: (key) => uiText('en', key),
      formatDate: () => 'date',
      formatType: () => 'Flow',
      formatLanguage: () => 'English',
    });

    const content = document.getElementById('answers-content')?.textContent || '';
    expect(content).toContain('First question? -> Answer A');
  });

  it('derives flow context labels from earlier answered rows when backfill data is missing', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    displayAnswersList({
      getMyTalks: () => ({}),
      getFlatAnswerHistory: () => ({
        flow: {
          id: 'flow',
          talkId: 'flow-talk',
          title: 'Three-step flow',
          type: 'flow',
          language: 'en',
          outcome: 'match',
          answeredAt: '2026-06-11T00:00:00.000Z',
          senderIds: [],
          items: [
            {
              questionId: 'q1',
              answerId: 'a1',
              prompt: 'Q1?',
              choice: 'A1',
              kind: 'question',
              contextPath: [],
              contextHash: '',
            },
            {
              questionId: 'q2',
              answerId: 'a2',
              prompt: 'Q2?',
              choice: 'A2',
              kind: 'question',
              contextPath: [],
              contextHash: 'hash_q2',
            },
            {
              questionId: 'q3',
              answerId: 'a3',
              prompt: 'Q3?',
              choice: 'A3',
              kind: 'question',
              contextPath: [],
              contextHash: 'hash_q3',
            },
          ],
        },
      }),
      escapeHtml: (value) => value,
      copyAnsweredTalkToTalks: jest.fn(),
      showTalkDetail: jest.fn(),
      showPreferencesDialog: jest.fn(),
      showItemDetailsPopup: jest.fn(),
      getTalkContentKey: jest.fn(),
      text: (key) => uiText('en', key),
      formatDate: () => 'date',
      formatType: () => 'Flow',
      formatLanguage: () => 'English',
    });

    // q1 is universal (no context) — plain "Q1? -> A1" on the row itself.
    // q3's context breadcrumb (Q1->A1 · Q2->A2) lives in its detail popup content.
    const content = document.getElementById('answers-content')?.textContent || '';
    expect(content).toContain('Q1?');
    expect(content).toContain('A1');
    expect(content).toContain('Q1? -> A1 · Q2? -> A2');
  });

  it('falls back to the talk answer text when a stored answer says ignore', () => {
    const talk = {
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'Coffee?',
          answers: [{ id: 'a_0_1', text: 'No thanks' }],
        },
      ],
    };

    expect(
      getAnswerDisplayText(talk, { questionId: 'q_0', answerId: 'a_0_1', answerText: 'ignore' }),
    ).toBe('No thanks');
  });

  it('surfaces exact chatbot memory auto-use metrics for answer history', () => {
    const talk = {
      type: 'flow',
      questions: [
        {
          id: 'q_0',
          text: 'Favorite fruit?',
          answers: [{ id: 'a_apple', text: 'Apple' }],
        },
      ],
    };
    const state = createEmptyExactChatbotMemoryState();
    const saved = saveTemporaryAnswer(state, 'local', 'Favorite fruit?', 'Apple', 1000);
    appendAutoUse(state, 'local', saved.questionId, saved.eventId, 2000);

    const variants = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_0', answerId: 'a_apple', answerText: 'Apple', mode: 'auto' }],
      'talk-1',
      'Fruit talk',
      'match',
      1000,
      [],
      undefined,
      state,
    );

    expect(variants[0].chatbotGenerated).toBe(true);
    expect(variants[0].autoUseCount).toBe(1);
    expect(variants[0].latestAutoUseAt).toBe(2000);
  });

  it('does not display auto-use metrics from another language', () => {
    const talk = {
      type: 'flow',
      language: 'zh',
      questions: [{ id: 'q_0', text: 'Tea?', answers: [{ id: 'a_yes', text: 'Yes' }] }],
    };
    const state = createEmptyExactChatbotMemoryState();
    const saved = saveTemporaryAnswer(state, 'local', 'Tea?', 'Yes', 1000, { language: 'en' });
    appendAutoUse(state, 'local', saved.questionId, saved.eventId, 2000);

    const variants = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_0', answerId: 'a_yes', answerText: 'Yes', mode: 'auto' }],
      'talk-1',
      'Tea talk',
      'match',
      1000,
      [],
      undefined,
      state,
    );

    expect(variants[0].autoUseCount).toBe(0);
  });

  it('folds the same question text asked via different talks/languages into one row', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    // docs/TODO.md §LL.2 follow-up: grouping is text-based now (not questionContentId) — both
    // records share the prompt "Tea?", so they merge regardless of their (here, coincidentally
    // matching) cidId/questionId.
    const baseRecord = {
      title: 'Tea',
      type: 'flow',
      outcome: 'match' as const,
      answeredAt: '2026-05-25T00:00:00.000Z',
      senderIds: [],
      items: [{
        questionId: 'q_0',
        questionContentId: 'cid_tea_yesno',
        answerId: 'a_yes',
        prompt: 'Tea?',
        choice: 'Yes',
        kind: 'question' as const,
        contextPath: [],
      }],
    };
    displayAnswersList({
      getMyTalks: () => ({}),
      getFlatAnswerHistory: () => ({
        en: { ...baseRecord, id: 'en', talkId: 'talk_en', language: 'en' },
        zh: { ...baseRecord, id: 'zh', talkId: 'talk_zh', language: 'zh' },
      }),
      escapeHtml: (value) => value,
      copyAnsweredTalkToTalks: jest.fn(),
      showTalkDetail: jest.fn(),
      showPreferencesDialog: jest.fn(),
      showItemDetailsPopup: jest.fn(),
      getTalkContentKey: jest.fn(),
      text: (key) => uiText('en', key),
      formatDate: () => 'date',
      formatType: () => 'Flow',
      formatLanguage: (code) => (code === 'zh' ? 'Chinese' : 'English'),
    });

    // Same prompt text from two different talks merges into one row...
    expect(document.querySelectorAll('.answer-question-item').length).toBe(1);
    // ...and both contributing talks are still tracked on the merged row (aggregate
    // data-talk-ids), even though this is a context-free question — only the most recent
    // instance's answer is shown, no per-language sub-lines.
    const row = document.querySelector<HTMLElement>('.answer-question-item')!;
    expect(row.dataset.talkIds?.split(' ').sort()).toEqual(['talk_en', 'talk_zh']);
  });

  it('does NOT merge two different questions that coincidentally share the same talk-local questionId but have no matching content id', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    // Regression test for the real bug this fix addresses: two unrelated talks' first
    // questions both get the positional id 'q_0' from the editor's own convention. Without
    // a real questionContentId to merge on, they must NOT be folded together.
    displayAnswersList({
      getMyTalks: () => ({}),
      getFlatAnswerHistory: () => ({
        tom: {
          id: 'tom', talkId: 'talk_tom', title: 'Tom Out Talk', type: 'flow', language: 'en',
          outcome: 'mismatch' as const, answeredAt: '2026-05-25T00:00:00.000Z', senderIds: [],
          items: [{
            questionId: 'q_0', answerId: 'a_no', prompt: 'Do you want to join Tom?',
            choice: 'No thanks.', kind: 'question' as const, contextPath: [],
          }],
        },
        jerry: {
          id: 'jerry', talkId: 'talk_jerry', title: 'Jerry Out Talk', type: 'flow', language: 'en',
          outcome: 'match' as const, answeredAt: '2026-05-25T00:01:00.000Z', senderIds: [],
          items: [{
            questionId: 'q_0', answerId: 'a_yes', prompt: 'Do you want to join Jerry?',
            choice: "Yes, let's do it.", kind: 'question' as const, contextPath: [],
          }],
        },
      }),
      escapeHtml: (value) => value,
      copyAnsweredTalkToTalks: jest.fn(),
      showTalkDetail: jest.fn(),
      showPreferencesDialog: jest.fn(),
      showItemDetailsPopup: jest.fn(),
      getTalkContentKey: jest.fn(),
      text: (key) => uiText('en', key),
      formatDate: () => 'date',
      formatType: () => 'Flow',
      formatLanguage: () => 'English',
    });

    expect(document.querySelectorAll('.answer-question-item').length).toBe(2);
    const content = document.getElementById('answers-content')?.textContent || '';
    expect(content).toContain('Do you want to join Tom?');
    expect(content).toContain('Do you want to join Jerry?');
  });

  it('hides support-channel messages while retaining answered TechSupport talks', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    const record = {
      type: 'flow',
      language: 'en',
      outcome: 'match' as const,
      answeredAt: '2026-05-25T00:00:00.000Z',
      senderIds: ['iinpublic-root-techsupport'],
      items: [{
        questionId: 'q_0',
        answerId: 'a_yes',
        prompt: 'Need assistance?',
        choice: 'Yes',
        kind: 'question' as const,
        contextPath: [],
      }],
    };
    displayAnswersList({
      getMyTalks: () => ({}),
      getFlatAnswerHistory: () => ({
        support: {
          ...record,
          id: 'support',
          talkId: 'support_message',
          title: 'Welcome to IinPublic',
          supportMessage: true,
          supportChannel: true,
        },
        answered: {
          ...record,
          id: 'answered',
          talkId: 'answered_talk',
          title: 'TechSupport check-in',
        },
      }),
      escapeHtml: (value) => value,
      copyAnsweredTalkToTalks: jest.fn(),
      showTalkDetail: jest.fn(),
      showPreferencesDialog: jest.fn(),
      showItemDetailsPopup: jest.fn(),
      getTalkContentKey: jest.fn(),
      text: (key) => uiText('en', key),
      formatDate: () => 'date',
      formatType: () => 'Flow',
      formatLanguage: () => 'English',
    });

    const content = document.getElementById('answers-content')?.textContent || '';
    expect(content).not.toContain('Welcome to IinPublic');
    expect(content).toContain('Need assistance?');
    // docs/TODO.md §LL.2 follow-up: talk titles are no longer shown on this page at all — the
    // answered TechSupport talk is still retained (not filtered out like the support message
    // record), verified via its talk id reaching the rendered row's jump target instead.
    expect(document.querySelector<HTMLElement>('.answer-context-jump')?.dataset.talkId).toBe('answered_talk');
  });

  it('matches answer history search queries against normalized rendered text', () => {
    const model = { searchText: 'coffee survey choose a cafe blue bottle auto' };

    expect(answerTalkMatchesQuery(model, 'blue bottle')).toBe(true);
    expect(answerTalkMatchesQuery(model, '  CAFE ')).toBe(true);
    expect(answerTalkMatchesQuery(model, 'tennis')).toBe(false);
  });

  describe('TODO §R3: progressive render for long answer lists', () => {
    function buildFlatHistory(count: number): Record<string, unknown> {
      const history: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const id = `answer-${String(i).padStart(3, '0')}`;
        history[id] = {
          id,
          talkId: `talk-${id}`,
          title: `Answer Talk ${i}`,
          type: 'flow',
          language: 'en',
          outcome: 'match',
          answeredAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
          senderIds: [],
          items: [{
            questionId: `q-${id}`,
            answerId: `a-${id}`,
            prompt: `Question ${i}?`,
            choice: `Answer ${i}`,
            kind: 'question' as const,
            contextPath: [],
            contextHash: '',
          }],
        };
      }
      return history;
    }

    function baseDeps(count: number, overrides: Record<string, unknown> = {}) {
      return {
        getMyTalks: () => ({}),
        getFlatAnswerHistory: () => buildFlatHistory(count),
        escapeHtml: (value: string) => value,
        copyAnsweredTalkToTalks: jest.fn(),
        showTalkDetail: jest.fn(),
        showPreferencesDialog: jest.fn(),
        showItemDetailsPopup: jest.fn(),
        getTalkContentKey: jest.fn(),
        text: (key: Parameters<typeof uiText>[1]) => uiText('en', key),
        formatDate: () => 'date',
        formatType: () => 'Flow',
        formatLanguage: () => 'English',
        ...overrides,
      };
    }

    beforeEach(() => {
      document.body.innerHTML = '<div id="answers-content"></div>';
    });

    it('renders the first chunk immediately; the remainder fills in without dropping or duplicating', async () => {
      displayAnswersList(baseDeps(40) as any);

      const immediate = document.querySelectorAll('.answer-talk-item').length;
      expect(immediate).toBeGreaterThan(0);
      expect(immediate).toBeLessThanOrEqual(25);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const ids = Array.from(document.querySelectorAll<HTMLElement>('.answer-talk-item'))
        .map((row) => row.dataset.questionId);
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
    });

    it('does not duplicate rows across several rapid successive re-renders', async () => {
      for (let i = 0; i < 5; i += 1) displayAnswersList(baseDeps(40) as any);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const ids = Array.from(document.querySelectorAll<HTMLElement>('.answer-talk-item'))
        .map((row) => row.dataset.questionId);
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
    });

    it('fires onRowsRendered after the first chunk and again after the deferred remainder', async () => {
      const onRowsRendered = jest.fn();
      displayAnswersList(baseDeps(40, { onRowsRendered }) as any);

      expect(onRowsRendered).toHaveBeenCalledTimes(1);

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(onRowsRendered).toHaveBeenCalledTimes(2);
    });

    it('a deferred-remainder row is fully interactive: clicking its answer jumps to the current deps\' showTalkDetail', async () => {
      const showTalkDetail = jest.fn();
      displayAnswersList(baseDeps(40, { showTalkDetail }) as any);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // A second render (fresh deps object, matching how ui-manager.ts rebuilds deps
      // every call) — the delegated listener must read this new one, not the first.
      const showTalkDetail2 = jest.fn();
      displayAnswersList(baseDeps(40, { showTalkDetail: showTalkDetail2 }) as any);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const remainderRow = document.querySelector<HTMLElement>('.answer-talk-item[data-question-id="q-answer-039"]');
      expect(remainderRow).toBeTruthy();

      const jumpEl = remainderRow!.querySelector<HTMLElement>('.answer-context-jump');
      jumpEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(showTalkDetail2).toHaveBeenCalledWith('talk-answer-039', 'q-answer-039');
      expect(showTalkDetail).not.toHaveBeenCalled();
    });

    it('preferences button works from the empty state too, exactly once', () => {
      const showPreferencesDialog = jest.fn();
      displayAnswersList({
        getMyTalks: () => ({}),
        getFlatAnswerHistory: () => ({}),
        escapeHtml: (value: string) => value,
        copyAnsweredTalkToTalks: jest.fn(),
        showTalkDetail: jest.fn(),
        showPreferencesDialog,
        showItemDetailsPopup: jest.fn(),
        getTalkContentKey: jest.fn(),
        text: (key: Parameters<typeof uiText>[1]) => uiText('en', key),
        formatDate: () => 'date',
        formatType: () => 'Flow',
        formatLanguage: () => 'English',
      } as any);

      document.getElementById('view-preferences-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(showPreferencesDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('spec §13.7.1: pinned identity header + sectioning', () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="answers-content"></div>';
    });

    function baseDeps(overrides: Record<string, unknown> = {}) {
      return {
        getMyTalks: () => ({}),
        getFlatAnswerHistory: () => ({}),
        escapeHtml: (value: string) => value,
        copyAnsweredTalkToTalks: jest.fn(),
        showTalkDetail: jest.fn(),
        showPreferencesDialog: jest.fn(),
        showItemDetailsPopup: jest.fn(),
        getTalkContentKey: jest.fn(),
        text: (key: Parameters<typeof uiText>[1]) => uiText('en', key),
        formatDate: () => 'date',
        formatType: () => 'Flow',
        formatLanguage: () => 'English',
        ...overrides,
      };
    }

    it('renders the pinned identity header (StageName) above the answer list', () => {
      displayAnswersList(
        baseDeps({
          getCurrentIdentity: () => ({ stageName: 'Bernard' }),
          getFlatAnswerHistory: () => ({
            a: {
              id: 'a', talkId: 'talk-a', title: 'Hobby', type: 'tag', language: 'en', outcome: 'match',
              answeredAt: new Date().toISOString(), senderIds: [],
              items: [{ questionId: 'q0', answerId: 'a0', prompt: 'Tennis', choice: 'Checked', kind: 'tag', contextPath: [], contextHash: '' }],
            },
          }),
        }) as any,
      );

      const header = document.querySelector('[data-testid="me-identity-header"]');
      expect(header).toBeTruthy();
      expect(document.querySelector('[data-testid="me-identity-stage-name"]')?.textContent).toBe('Bernard');
    });

    it('omits the identity header when no identity is supplied (deps.getCurrentIdentity absent)', () => {
      displayAnswersList(
        baseDeps({
          getFlatAnswerHistory: () => ({
            a: {
              id: 'a', talkId: 'talk-a', title: 'Hobby', type: 'tag', language: 'en', outcome: 'match',
              answeredAt: new Date().toISOString(), senderIds: [],
              items: [{ questionId: 'q0', answerId: 'a0', prompt: 'Tennis', choice: 'Checked', kind: 'tag', contextPath: [], contextHash: '' }],
            },
          }),
        }) as any,
      );

      expect(document.querySelector('[data-testid="me-identity-header"]')).toBeNull();
    });

    it('lists every distinct question once in a flat list, with no per-talk sections', () => {
      displayAnswersList(
        baseDeps({
          getFlatAnswerHistory: () => ({
            tag1: {
              id: 'tag1', talkId: 'talk-tag', title: 'Hobby Tag', type: 'tag', language: 'en', outcome: 'match',
              answeredAt: new Date(2026, 0, 1).toISOString(), senderIds: [],
              items: [{ questionId: 'q0', answerId: 'a0', prompt: 'Tennis', choice: 'Checked', kind: 'tag', contextPath: [], contextHash: '' }],
            },
            flow1: {
              id: 'flow1', talkId: 'talk-notebook', title: 'Sell Used Notebook', type: 'flow', language: 'en', outcome: 'match',
              answeredAt: new Date(2026, 0, 2).toISOString(), senderIds: [],
              items: [
                { questionId: 'qf0', answerId: 'af0', prompt: 'Are you selling?', choice: 'Yes', kind: 'question', contextPath: [], contextHash: '' },
                { questionId: 'qf1', answerId: 'af1', prompt: 'What model?', choice: 'ModelX', kind: 'question', contextPath: [], contextHash: '' },
              ],
            },
          }),
        }) as any,
      );

      // docs/TODO.md §LL.2 follow-up: no more "General"/talk-titled sections — one flat list.
      expect(document.querySelectorAll('.answer-section').length).toBe(0);
      expect(document.querySelectorAll('.answer-question-item').length).toBe(3);

      const content = document.getElementById('answers-content')?.textContent || '';
      expect(content).toContain('Tennis');
      expect(content).toContain('Are you selling?');
      expect(content).toContain('What model?');
    });

    it('merges the same question text asked by two different talks into one row with a sub-line per context', () => {
      displayAnswersList(
        baseDeps({
          getFlatAnswerHistory: () => ({
            flowA: {
              id: 'flowA', talkId: 'talk-notebook', title: 'Sell Used Notebook', type: 'flow', language: 'en', outcome: 'match',
              answeredAt: new Date(2026, 0, 2).toISOString(), senderIds: [],
              items: [
                { questionId: 'qa0', answerId: 'aa0', prompt: 'Are you selling?', choice: 'Yes', kind: 'question', contextPath: [], contextHash: '' },
                { questionId: 'qa1', answerId: 'aa1', prompt: 'What model?', choice: 'ModelX', kind: 'question', contextPath: [], contextHash: 'hash_notebook', contextLabel: 'Notebook' },
              ],
            },
            flowB: {
              id: 'flowB', talkId: 'talk-bike', title: 'Sell Used Bike', type: 'flow', language: 'en', outcome: 'match',
              answeredAt: new Date(2026, 0, 3).toISOString(), senderIds: [],
              items: [
                { questionId: 'qb0', answerId: 'ab0', prompt: 'Are you selling a bike?', choice: 'Yes', kind: 'question', contextPath: [], contextHash: '' },
                { questionId: 'qb1', answerId: 'ab1', prompt: 'What model?', choice: 'BrandY', kind: 'question', contextPath: [], contextHash: 'hash_bike', contextLabel: 'Bike' },
              ],
            },
          }),
        }) as any,
      );

      // "Are you selling?" and "Are you selling a bike?" are different text — stay separate.
      // Both talks' "What model?" question — identical text — merges into ONE row with 2
      // context-tagged answer sub-lines, not two separate rows under two talks.
      expect(document.querySelectorAll('.answer-question-item').length).toBe(3);
      const modelRows = Array.from(document.querySelectorAll<HTMLElement>('.answer-question-item'))
        .filter((row) => row.textContent?.includes('What model?'));
      expect(modelRows).toHaveLength(1);
      expect(modelRows[0].querySelectorAll('.answer-context-jump').length).toBe(2);
      expect(modelRows[0].textContent).toContain('ModelX');
      expect(modelRows[0].textContent).toContain('BrandY');
    });
  });
});
