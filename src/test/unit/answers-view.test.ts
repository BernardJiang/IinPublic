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

    const items = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_0', answerId: 'a_match', answerText: 'Match.' }],
      2,
    );

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('tag');
    expect(items[0].choice).toBe('Checked');
    expect(items[0].answeredCount).toBe(2);
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

    const items = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_1', answerId: 'a_1_0', answerText: 'Blue Bottle' }],
      1,
    );

    expect(items[0].kind).toBe('question');
    expect(items[0].choice).toBe('Blue Bottle');
    expect(items[0].contextHash).toBe('cafefeed');
    expect(items[0].contextPath[0]).toBe('Need coffee?→Yes, please');
    expect(items[0].contextLabel).toBe('Need coffee?→Yes, please');
  });

  it('keeps route branches with same prompt as separate context rows', () => {
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

    expect(document.querySelectorAll('.answer-question-item').length).toBe(2);
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

    const content = document.getElementById('answers-content')?.textContent || '';
    expect(content).toContain('Q1? -> A1');
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

    const items = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_0', answerId: 'a_apple', answerText: 'Apple', mode: 'auto' }],
      1,
      state,
    );

    expect(items[0].chatbotGenerated).toBe(true);
    expect(items[0].autoUseCount).toBe(1);
    expect(items[0].latestAutoUseAt).toBe(2000);
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

    const items = buildAnswerItemModels(
      talk,
      [{ questionId: 'q_0', answerId: 'a_yes', answerText: 'Yes', mode: 'auto' }],
      1,
      state,
    );

    expect(items[0].autoUseCount).toBe(0);
  });

  it('keeps otherwise identical answer-history rows separate by displayed language', () => {
    document.body.innerHTML = '<div id="answers-content"></div>';
    const baseRecord = {
      title: 'Tea',
      type: 'flow',
      outcome: 'match' as const,
      answeredAt: '2026-05-25T00:00:00.000Z',
      senderIds: [],
      items: [{
        questionId: 'q_0',
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

    const badges = Array.from(document.querySelectorAll<HTMLElement>('.answer-language-badge'));
    expect(badges.map((badge) => badge.dataset.language).sort()).toEqual(['en', 'zh']);
    expect(badges.map((badge) => badge.textContent).sort()).toEqual(['Chinese', 'English']);
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

    expect(document.getElementById('answers-content')?.textContent).not.toContain('Welcome to IinPublic');
    expect(document.getElementById('answers-content')?.textContent).toContain('TechSupport check-in');
  });

  it('matches answer history search queries against normalized rendered text', () => {
    const model = {
      talkId: 'talk_1',
      title: 'Coffee survey',
      metadata: '1 item',
      outcome: 'match' as const,
      items: [],
      searchText: 'coffee survey choose a cafe blue bottle auto',
    };

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
        .map((row) => row.dataset.talkId);
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
    });

    it('does not duplicate rows across several rapid successive re-renders', async () => {
      for (let i = 0; i < 5; i += 1) displayAnswersList(baseDeps(40) as any);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const ids = Array.from(document.querySelectorAll<HTMLElement>('.answer-talk-item'))
        .map((row) => row.dataset.talkId);
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

    it('a deferred-remainder row is fully interactive: copy button, details button, and row click all reach the current deps', async () => {
      const copyAnsweredTalkToTalks = jest.fn();
      const showItemDetailsPopup = jest.fn();
      const showTalkDetail = jest.fn();
      displayAnswersList(baseDeps(40, { copyAnsweredTalkToTalks, showItemDetailsPopup, showTalkDetail }) as any);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // A second render (fresh deps object, matching how ui-manager.ts rebuilds deps
      // every call) — the delegated listener must read this new one, not the first.
      const copyAnsweredTalkToTalks2 = jest.fn();
      const showTalkDetail2 = jest.fn();
      displayAnswersList(baseDeps(40, { copyAnsweredTalkToTalks: copyAnsweredTalkToTalks2, showTalkDetail: showTalkDetail2 }) as any);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const remainderRow = document.querySelector<HTMLElement>('.answer-talk-item[data-source-talk-id="talk-answer-039"]');
      expect(remainderRow).toBeTruthy();

      const copyBtn = remainderRow!.querySelector<HTMLElement>('.answer-copy-talk-btn');
      copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(copyAnsweredTalkToTalks2).toHaveBeenCalledWith('talk-answer-039');
      expect(copyAnsweredTalkToTalks).not.toHaveBeenCalled();

      remainderRow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(showTalkDetail2).toHaveBeenCalled();
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
});
