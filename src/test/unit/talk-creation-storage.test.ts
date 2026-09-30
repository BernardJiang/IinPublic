/** @jest-environment jsdom */

import { saveCreatedTalk } from '../../web/ui/talk-creation-storage';
import { getMyTalks } from '../../web/ui/my-talks-storage';
import { getTypedPreferenceState } from '../../web/ui/answer-preferences-storage';
import { LOCAL_EXACT_CHATBOT_USER_ID } from '../../shared/exact-chatbot-memory';

function deps(overrides: Partial<Parameters<typeof saveCreatedTalk>[2]> = {}) {
  return {
    saveAnswerPreference: jest.fn(() => 'context-hash'),
    saveQuestionAnswersFromCompletion: jest.fn(),
    saveFlatAnswerHistoryRecord: jest.fn(),
    refreshTalksListIfActive: jest.fn(),
    refreshAnswersListIfActive: jest.fn(),
    ...overrides,
  };
}

function talk(overrides: Partial<Parameters<typeof saveCreatedTalk>[0]> = {}) {
  return {
    id: 't1',
    title: 'My Talk',
    type: 'flow',
    questions: [{ id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="talks-view" class="active"></div>';
});

describe('saveCreatedTalk', () => {
  it('stores a new entry in myTalks with role "created"', () => {
    saveCreatedTalk(talk(), { selfAnswers: [] }, deps());
    const stored = getMyTalks().t1;
    expect(stored.role).toBe('created');
    expect(stored.title).toBe('My Talk');
    expect(stored.type).toBe('flow');
  });

  it('preserves any existing entry fields not explicitly overwritten', () => {
    const preDeps = deps();
    saveCreatedTalk(talk(), { selfAnswers: [] }, preDeps);
    // A second save (e.g. an edit) should still carry role: 'created' etc. through the spread.
    saveCreatedTalk(talk({ title: 'Renamed' }), { selfAnswers: [] }, preDeps);
    expect(getMyTalks().t1.title).toBe('Renamed');
    expect(getMyTalks().t1.role).toBe('created');
  });

  it('marks a tag talk disabled when any self-answer is "ignore"', () => {
    saveCreatedTalk(
      talk({ type: 'tag' }),
      { selfAnswers: [{ questionId: 'q1', answerId: 'ignore' }] },
      deps(),
    );
    expect(getMyTalks().t1.disabled).toBe(true);
  });

  it('does not mark a non-tag talk disabled even with an "ignore" self-answer', () => {
    saveCreatedTalk(
      talk({ type: 'flow' }),
      { selfAnswers: [{ questionId: 'q1', answerId: 'ignore' }] },
      deps(),
    );
    expect(getMyTalks().t1.disabled).toBe(false);
  });

  it('cascades each self-answer through saveAnswerPreference', () => {
    const d = deps();
    saveCreatedTalk(talk(), { selfAnswers: [{ questionId: 'q1', answerId: 'a1' }] }, d);
    expect(d.saveAnswerPreference).toHaveBeenCalledTimes(1);
    expect(d.saveAnswerPreference).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      't1',
      expect.objectContaining({ id: 'q1' }),
      'a1',
      'Yes',
      [{ questionId: 'q1', answerId: 'a1', answerText: 'Yes', contextHash: 'context-hash' }],
      'auto',
    );
  });

  it('skips a self-answer whose question or answer id does not exist on the talk', () => {
    const d = deps();
    saveCreatedTalk(
      talk(),
      { selfAnswers: [{ questionId: 'missing-q', answerId: 'a1' }, { questionId: 'q1', answerId: 'missing-a' }] },
      d,
    );
    expect(d.saveAnswerPreference).not.toHaveBeenCalled();
    expect(d.saveQuestionAnswersFromCompletion).not.toHaveBeenCalled();
  });

  it('saves question-answers-from-completion and flat history only when at least one self-answer resolved', () => {
    const d = deps();
    saveCreatedTalk(talk(), { selfAnswers: [{ questionId: 'q1', answerId: 'a1' }] }, d);
    expect(d.saveQuestionAnswersFromCompletion).toHaveBeenCalledTimes(1);
    expect(d.saveFlatAnswerHistoryRecord).toHaveBeenCalledWith('t1', expect.anything(), expect.any(Array), 'match', []);
  });

  it('records outcome "mismatch" when no resolved self-answer is a match', () => {
    const d = deps();
    saveCreatedTalk(
      talk({ questions: [{ id: 'q1', text: 'Q1', answers: [{ id: 'a1', text: 'No', isMatch: false }] }] }),
      { selfAnswers: [{ questionId: 'q1', answerId: 'a1' }] },
      d,
    );
    expect(d.saveFlatAnswerHistoryRecord).toHaveBeenCalledWith('t1', expect.anything(), expect.any(Array), 'mismatch', []);
  });

  it('stores each typed built-in declaration as a structured answer and isolated lookup entry', () => {
    const d = deps();
    saveCreatedTalk(talk({
      title: 'Inventory',
      type: 'route',
      questions: [
        { id: 'root', text: 'Which item?', answers: [{ id: 'notebook', text: 'Notebook' }, { id: 'pen', text: 'Pen' }] },
        {
          id: 'notebook-quantity', text: 'How many?',
          contextPath: [{ questionId: 'root', answerId: 'notebook' }],
          answers: [], builtIn: { kind: 'quantity', quantity: 5 },
        },
        {
          id: 'pen-quantity', text: 'How many?',
          contextPath: [{ questionId: 'root', answerId: 'pen' }],
          answers: [], builtIn: { kind: 'quantity', quantity: 1 },
        },
      ],
    }), { selfAnswers: [] }, d);

    const completed = (d.saveFlatAnswerHistoryRecord as jest.Mock).mock.calls[0][2];
    expect(completed).toEqual([
      expect.objectContaining({ questionId: 'notebook-quantity', answerText: '5', typedValue: { kind: 'quantity', quantity: 5 } }),
      expect.objectContaining({ questionId: 'pen-quantity', answerText: '1', typedValue: { kind: 'quantity', quantity: 1 } }),
    ]);
    expect(d.saveQuestionAnswersFromCompletion).not.toHaveBeenCalled();
    const indexed = Object.values(getTypedPreferenceState().users[LOCAL_EXACT_CHATBOT_USER_ID]);
    expect(indexed).toHaveLength(2);
    expect(indexed.map((value) => value.quantity).sort()).toEqual([1, 5]);
    expect(indexed.every((value) => value.sourceTalkId === 't1')).toBe(true);
  });

  it('refreshes the talks list only when the talks view is active', () => {
    const d = deps();
    document.getElementById('talks-view')!.classList.remove('active');
    saveCreatedTalk(talk(), { selfAnswers: [] }, d);
    expect(d.refreshTalksListIfActive).not.toHaveBeenCalled();

    document.getElementById('talks-view')!.classList.add('active');
    saveCreatedTalk(talk(), { selfAnswers: [] }, d);
    expect(d.refreshTalksListIfActive).toHaveBeenCalledTimes(1);
  });

  it('refreshes the answers list after saving a typed declaration when Me is active', () => {
    const d = deps();
    document.body.innerHTML = '<div id="me-view" class="active"></div>';
    saveCreatedTalk(talk({
      questions: [{ id: 'q1', text: 'How many?', answers: [], builtIn: { kind: 'quantity', quantity: 3 } }],
    }), { selfAnswers: [] }, d);
    expect(d.refreshAnswersListIfActive).toHaveBeenCalledTimes(1);
  });
});
