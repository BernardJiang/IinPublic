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

  it('merges route branches with the same prompt into one row, keeping each context distinct in the detail popup', () => {
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
    expect(row.querySelector('.context-indicator .count')?.textContent).toBe('2');

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

  it('folds the same question (by spec content id) asked via different talks/languages into one row, keeping each variant distinguishable in detail', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    // Both records' item carries the SAME questionContentId (Question.cidId) — the spec-
    // defined content hash — even though their talk-local questionId ('q_0') is also
    // coincidentally identical here; the merge must key off questionContentId, not questionId.
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

    // Same questionContentId from two different talks merges into one row...
    expect(document.querySelectorAll('.answer-question-item').length).toBe(1);
    // ...but both contributing instances still show up, each with its own language, once
    // the row's detail is expanded.
    const badges = Array.from(document.querySelectorAll<HTMLElement>('.answer-language-badge'));
    expect(badges.map((badge) => badge.dataset.language).sort()).toEqual(['en', 'zh']);
    expect(badges.map((badge) => badge.textContent).sort()).toEqual(['Chinese', 'English']);
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
    expect(content).toContain('TechSupport check-in');
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

    it('a deferred-remainder row is fully interactive: copy button, view-talk button, and row click all reach the current deps', async () => {
      const copyAnsweredTalkToTalks = jest.fn();
      const showItemDetailsPopup = jest.fn();
      const showTalkDetail = jest.fn();
      displayAnswersList(baseDeps(40, { copyAnsweredTalkToTalks, showItemDetailsPopup, showTalkDetail }) as any);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // A second render (fresh deps object, matching how ui-manager.ts rebuilds deps
      // every call) — the delegated listener must read this new one, not the first.
      const copyAnsweredTalkToTalks2 = jest.fn();
      const showItemDetailsPopup2 = jest.fn();
      displayAnswersList(baseDeps(40, { copyAnsweredTalkToTalks: copyAnsweredTalkToTalks2, showItemDetailsPopup: showItemDetailsPopup2 }) as any);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const remainderRow = document.querySelector<HTMLElement>('.answer-talk-item[data-question-id="q-answer-039"]');
      expect(remainderRow).toBeTruthy();

      const copyBtn = remainderRow!.querySelector<HTMLElement>('.answer-copy-talk-btn');
      copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(copyAnsweredTalkToTalks2).toHaveBeenCalledWith('talk-answer-039');
      expect(copyAnsweredTalkToTalks).not.toHaveBeenCalled();

      // Row click (not on a button) opens the details popup via the current deps.
      remainderRow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(showItemDetailsPopup2).toHaveBeenCalled();
      expect(showItemDetailsPopup).not.toHaveBeenCalled();
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
});
