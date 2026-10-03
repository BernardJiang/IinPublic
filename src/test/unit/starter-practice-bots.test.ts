import {
  getStarterPracticeProgress,
  STARTER_PRACTICE_AUTHOR_ID,
  STARTER_PRACTICE_BOTS,
} from '../../web/ui/starter-practice-bots';
import { TalkValidator } from '../../shared/talk-engine';
import {
  resolveAnswerPreferenceForTalkQuestion,
  saveAnswerPreference,
} from '../../web/ui/answer-preference-resolution';

describe('starter practice bots', () => {
  beforeEach(() => localStorage.clear());

  it('ships three local-only instructors with stable, unique Talk ids', () => {
    const talks = STARTER_PRACTICE_BOTS.flatMap((bot) => bot.build('en'));

    expect(STARTER_PRACTICE_BOTS.map((bot) => bot.id)).toEqual(['builder', 'echo', 'pathfinder']);
    expect(new Set(talks.map((talk) => talk.id)).size).toBe(talks.length);
    expect(talks.every((talk) => talk.practiceOnly === true)).toBe(true);
    expect(talks.every((talk) => talk.authorId === STARTER_PRACTICE_AUTHOR_ID)).toBe(true);
    expect(talks.every((talk) => /^qa_[0-9a-f]{8}$/.test(talk.id))).toBe(true);
    expect(talks.map((talk) => talk.type)).toEqual(['tag', 'tag', 'flow', 'flow', 'survey', 'route']);
    expect(talks[1].questions[0].reciprocalTagContext).toBe(true);
    talks.forEach((talk) => expect(() => TalkValidator.validateTalk(talk)).not.toThrow());
  });

  it('gives Echo Bot the same first question frame so exact-answer memory can reuse it', () => {
    const echo = STARTER_PRACTICE_BOTS.find((bot) => bot.id === 'echo')!;
    const [teach, reuse] = echo.build('en');

    expect(reuse.questions[0].text).toBe(teach.questions[0].text);
    expect(reuse.questions[0].answers.map((answer: any) => answer.text)).toEqual(
      teach.questions[0].answers.map((answer: any) => answer.text),
    );
    expect(reuse.questions[1].text).toBe('Does this weekend work for you?');

    saveAnswerPreference(
      'new-user',
      teach,
      teach.id,
      teach.questions[0],
      'q_0_yes',
      'Yes, I am interested',
      [{ questionId: 'q_0', answerId: 'q_0_yes', answerText: 'Yes, I am interested' }],
      'auto',
    );
    expect(resolveAnswerPreferenceForTalkQuestion(
      'new-user',
      reuse,
      0,
      [],
      reuse.questions[0],
      reuse.id,
    )).toMatchObject({
      answerId: 'q_0_yes',
      answerText: 'Yes, I am interested',
      mode: 'auto',
      autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
    });
  });

  it('continues a multi-step instructor from the first unfinished practice Talk', () => {
    const echo = STARTER_PRACTICE_BOTS.find((bot) => bot.id === 'echo')!;
    const [first, second] = echo.build('en');
    const progress = getStarterPracticeProgress(echo, 'en', {
      [first.id]: {
        talkId: first.id,
        title: first.title,
        type: first.type,
        timestamp: first.createdAt,
        role: 'answered',
        fullTalk: first,
        completedAnswers: [{ questionId: 'q_0', answerId: 'q_0_outdoors' }],
      },
    });

    expect(progress).toMatchObject({ completed: 1, total: 2 });
    expect(progress.nextTalk.id).toBe(second.id);
  });

  it('localizes the practice content, not just the card labels', () => {
    const pathfinder = STARTER_PRACTICE_BOTS.find((bot) => bot.id === 'pathfinder')!;
    expect(pathfinder.build('zh')[0].title).toContain('探路机器人');
    expect(pathfinder.build('zh')[0].questions[0].text).toContain('机器人');
  });
});
