/** @jest-environment jsdom */

import {
  getMyQuestionAnswers,
  saveQuestionAnswersFromCompletion,
} from '../../web/ui/answer-preferences-storage';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="me-view"></div>';
});

describe('saveQuestionAnswersFromCompletion', () => {
  const talkData = {
    questions: [
      { id: 'q1', text: 'Favorite color?' },
      { id: 'q2', text: '  ' }, // blank text -> skipped
    ],
  };

  it('saves an entry keyed by normalized question text', () => {
    saveQuestionAnswersFromCompletion(
      talkData,
      [{ questionId: 'q1', answerId: 'a1', answerText: 'Blue' }],
      undefined,
      jest.fn(),
    );
    const all = getMyQuestionAnswers();
    const [entry] = Object.values(all);
    expect(entry.questionText).toBe('Favorite color?');
    expect(entry.answerId).toBe('a1');
    expect(entry.answerText).toBe('Blue');
    expect(entry.isIgnored).toBe(false);
  });

  it('skips an answer whose question has no non-blank text', () => {
    saveQuestionAnswersFromCompletion(
      talkData,
      [{ questionId: 'q2', answerId: 'a1', answerText: 'X' }],
      undefined,
      jest.fn(),
    );
    expect(Object.keys(getMyQuestionAnswers())).toHaveLength(0);
  });

  it('treats an explicit "ignore" or missing answerText as isIgnored with empty answerText', () => {
    saveQuestionAnswersFromCompletion(
      talkData,
      [{ questionId: 'q1', answerId: 'a1', answerText: 'ignore' }],
      undefined,
      jest.fn(),
    );
    const [entry] = Object.values(getMyQuestionAnswers());
    expect(entry.isIgnored).toBe(true);
    expect(entry.answerText).toBe('');
  });

  it('includes a formatted location string only when a location is given', () => {
    saveQuestionAnswersFromCompletion(
      talkData,
      [{ questionId: 'q1', answerId: 'a1', answerText: 'Blue' }],
      { latitude: 37.123456, longitude: -122.6789 },
      jest.fn(),
    );
    const [entry] = Object.values(getMyQuestionAnswers());
    expect(entry.location).toBe('37.1235, -122.6789');
  });

  it('last answer wins when two answers key to the same normalized question text', () => {
    saveQuestionAnswersFromCompletion(
      talkData,
      [
        { questionId: 'q1', answerId: 'a1', answerText: 'Blue' },
        { questionId: 'q1', answerId: 'a2', answerText: 'Green' },
      ],
      undefined,
      jest.fn(),
    );
    expect(Object.keys(getMyQuestionAnswers())).toHaveLength(1);
    const [entry] = Object.values(getMyQuestionAnswers());
    expect(entry.answerText).toBe('Green');
  });

  it('refreshes the answers list only when the Me view is currently active', () => {
    const refresh = jest.fn();
    saveQuestionAnswersFromCompletion(talkData, [{ questionId: 'q1', answerId: 'a1', answerText: 'Blue' }], undefined, refresh);
    expect(refresh).not.toHaveBeenCalled();

    document.getElementById('me-view')!.classList.add('active');
    saveQuestionAnswersFromCompletion(talkData, [{ questionId: 'q1', answerId: 'a1', answerText: 'Blue' }], undefined, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
