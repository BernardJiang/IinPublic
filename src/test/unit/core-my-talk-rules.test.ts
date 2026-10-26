/** OPEN-91 P4: rules for my list of Talks. */
import { copiedTalkEntry, ignoreAnswersFor, planTalkRemoval, restoredFromIgnored, uncopiedTalkEntry } from '../../core/my-talk-rules';

const NOW = '2026-10-26T10:00:00.000Z';

describe('my Talk rules', () => {
  it('a copy carries its senders; undoing it keeps an answered Talk as history and drops an unanswered one', () => {
    const entry = copiedTalkEntry({ id: 't1', title: 'Pizza', type: 'tag' }, 't1', { senders: { a: { senderId: 'ann' }, b: { senderId: 'ann' } } }, NOW);
    expect(entry).toMatchObject({ talkId: 't1', role: 'copied', senders: ['ann'] });
    expect(uncopiedTalkEntry({ role: 'copied', completedAnswers: [{}] }, NOW)).toMatchObject({ role: 'answered' });
    expect(uncopiedTalkEntry({ role: 'copied' }, NOW)).toBeNull();
    expect(uncopiedTalkEntry({ role: 'created' }, NOW)).toBeUndefined();
  });

  it('only the author retracts; an answered non-tag copy keeps its answers', () => {
    expect(planTalkRemoval({ role: 'created' })).toEqual({ keepAnswers: false, retract: true });
    expect(planTalkRemoval({ role: 'copied', type: 'flow', completedAnswers: [{}] })).toEqual({ keepAnswers: true, retract: false });
    expect(planTalkRemoval({ role: 'copied', type: 'tag', completedAnswers: [{}] })).toEqual({ keepAnswers: false, retract: false });
  });

  it('restoring from Ignored returns the earlier role, unanswered', () => {
    expect(restoredFromIgnored({ role: 'ignored', roleBeforeIgnore: 'copied', completedAnswers: [{}], outcome: 'mismatch' }, NOW))
      .toEqual({ role: 'copied', lastInteraction: NOW });
    expect(restoredFromIgnored({ role: 'ignored' }, NOW)).toBeNull();
  });

  it('ignoring answers the first question with Ignore', () => {
    expect(ignoreAnswersFor({ questions: [{ id: 'q1' }] })).toEqual([{ questionId: 'q1', answerId: 'ignore', answerText: 'ignore', mode: 'manual' }]);
    expect(ignoreAnswersFor({})).toEqual([]);
  });
});
