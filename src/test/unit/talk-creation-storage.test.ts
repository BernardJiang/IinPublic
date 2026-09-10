/** @jest-environment jsdom */

import { saveCreatedTalk } from '../../web/ui/talk-creation-storage';
import { getMyTalks } from '../../web/ui/my-talks-storage';

function deps(overrides: Partial<Parameters<typeof saveCreatedTalk>[2]> = {}) {
  return {
    saveAnswerPreference: jest.fn(),
    saveQuestionAnswersFromCompletion: jest.fn(),
    saveFlatAnswerHistoryRecord: jest.fn(),
    refreshTalksListIfActive: jest.fn(),
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
      [{ questionId: 'q1', answerText: 'Yes' }],
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

  it('refreshes the talks list only when the talks view is active', () => {
    const d = deps();
    document.getElementById('talks-view')!.classList.remove('active');
    saveCreatedTalk(talk(), { selfAnswers: [] }, d);
    expect(d.refreshTalksListIfActive).not.toHaveBeenCalled();

    document.getElementById('talks-view')!.classList.add('active');
    saveCreatedTalk(talk(), { selfAnswers: [] }, d);
    expect(d.refreshTalksListIfActive).toHaveBeenCalledTimes(1);
  });
});
