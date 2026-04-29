import { buildAnswerItemModels, getAnswerDisplayText } from '../../web/ui/answers-view';

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
    expect(items[0].contextPath[0]).toContain('q_0');
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
});
