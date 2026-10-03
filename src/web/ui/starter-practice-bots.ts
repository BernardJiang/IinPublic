import { computeTalkIdFromTalkData } from '../../shared/cid';
import type { MyTalkMap } from './my-talks-storage';
import type { UiLanguage, UiTranslationKey } from './ui-translations';

export const STARTER_PRACTICE_CATALOG_VERSION = 1;
export const STARTER_PRACTICE_AUTHOR_ID = 'iinpublic-practice-guide';

export type StarterPracticeBotId = 'builder' | 'echo' | 'pathfinder';

export type StarterPracticeBotDefinition = {
  id: StarterPracticeBotId;
  icon: string;
  nameKey: UiTranslationKey;
  descKey: UiTranslationKey;
  build: (locale?: UiLanguage) => any[];
};

const language = (locale?: UiLanguage): UiLanguage => (locale === 'zh' ? 'zh' : 'en');

function practiceTalk(
  locale: UiLanguage,
  botId: StarterPracticeBotId,
  step: number,
  draft: any,
): any {
  const talk = {
    ...draft,
    authorId: STARTER_PRACTICE_AUTHOR_ID,
    authorName: locale === 'zh' ? 'IinPublic 练习教练' : 'IinPublic Practice Coach',
    isAdult: false,
    language: locale,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    isTemplate: false,
    usageCount: 0,
    practiceOnly: true,
    starterPractice: {
      catalogVersion: STARTER_PRACTICE_CATALOG_VERSION,
      botId,
      step,
    },
  };
  return { ...talk, id: computeTalkIdFromTalkData(talk) };
}

function buildBuilder(locale: UiLanguage = 'en'): any[] {
  const lang = language(locale);
  const zh = lang === 'zh';
  const title = zh ? '生成器机器人：一键开始' : 'Builder Bot: One-tap start';
  return [
    practiceTalk(lang, 'builder', 0, {
      type: 'tag',
      title,
      questions: [{
        id: 'q_0',
        text: zh ? '我正在打造自己的机器人' : 'I am building my own bot',
        tagKind: 'simple',
        answers: [
          {
            id: 'q_0_match',
            text: zh ? '我正在打造自己的机器人' : 'I am building my own bot',
            isMatch: true,
            isTerminal: true,
          },
          { id: 'q_0_ignore', text: zh ? '暂时不要' : 'Not now', isIgnore: true, isTerminal: true },
        ],
      }],
    }),
    practiceTalk(lang, 'builder', 1, {
      type: 'tag',
      title: zh ? '生成器机器人：互补标签' : 'Builder Bot: Pair two complementary tags',
      questions: [{
        id: 'q_0',
        text: zh ? '我可以教一种技能' : 'I can teach a skill',
        reciprocalTagContext: true,
        answers: [
          {
            id: 'q_0_match',
            text: zh ? '我想学习一种技能' : 'I want to learn a skill',
            isMatch: true,
            isTerminal: true,
          },
          { id: 'q_0_ignore', text: zh ? '暂时不要' : 'Not now', isIgnore: true, isTerminal: true },
        ],
      }],
    }),
  ];
}

function echoActivityQuestion(zh: boolean, continues: boolean): any {
  return {
    id: 'q_0',
    text: zh ? '你想参加周末活动吗？' : 'Would you like to join a weekend activity?',
    answers: [
      {
        id: 'q_0_yes',
        text: zh ? '想参加' : 'Yes, I am interested',
        ...(continues ? { nextQuestionId: 'q_1' } : { isMatch: true, isTerminal: true }),
      },
      { id: 'q_0_ignore', text: zh ? '暂时不参加' : 'Not right now', isIgnore: true, isTerminal: true },
    ],
  };
}

function buildEcho(locale: UiLanguage = 'en'): any[] {
  const lang = language(locale);
  const zh = lang === 'zh';
  return [
    practiceTalk(lang, 'echo', 0, {
      type: 'flow',
      title: zh ? '回声机器人：教我一个答案' : 'Echo Bot: Teach me one answer',
      questions: [echoActivityQuestion(zh, false)],
    }),
    practiceTalk(lang, 'echo', 1, {
      type: 'flow',
      title: zh ? '回声机器人：只回答新问题' : 'Echo Bot: Only answer what is new',
      questions: [
        echoActivityQuestion(zh, true),
        {
          id: 'q_1',
          text: zh ? '这个周末方便吗？' : 'Does this weekend work for you?',
          answers: [
            { id: 'q_1_yes', text: zh ? '方便，聊聊吧' : "Yes, let's talk", isMatch: true, isTerminal: true },
            { id: 'q_1_ignore', text: zh ? '这个周末不方便' : 'Not this weekend', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    }),
  ];
}

function buildPathfinder(locale: UiLanguage = 'en'): any[] {
  const lang = language(locale);
  const zh = lang === 'zh';
  return [
    practiceTalk(lang, 'pathfinder', 0, {
      type: 'survey',
      title: zh ? '探路机器人：快速投票' : 'Pathfinder Bot: Quick survey',
      questions: [{
        id: 'q_0',
        text: zh ? '你最想让机器人先学习哪项能力？' : 'Which skill should your bot learn first?',
        isAggregatable: true,
        answers: [
          { id: 'q_0_people', text: zh ? '找到合适的人' : 'Finding the right people', isTerminal: true, counter: 0 },
          { id: 'q_0_repeat', text: zh ? '复用我的答案' : 'Reusing my answers', isTerminal: true, counter: 0 },
          { id: 'q_0_route', text: zh ? '引导一段流程' : 'Guiding a workflow', isTerminal: true, counter: 0 },
          { id: 'q_0_ignore', text: zh ? '跳过' : 'Skip', isIgnore: true, isTerminal: true },
        ],
      }],
    }),
    practiceTalk(lang, 'pathfinder', 1, {
      type: 'route',
      title: zh ? '探路机器人：选择一条路径' : 'Pathfinder Bot: Choose a path',
      questions: [
      {
        id: 'q_0',
        text: zh ? '你希望自己的机器人先帮什么忙？' : 'What should your bot help with first?',
        contextPath: [],
        answers: [
          { id: 'q_0_people', text: zh ? '认识合适的人' : 'Meet the right people', nextQuestionId: 'q_1' },
          { id: 'q_0_feedback', text: zh ? '收集意见' : 'Collect feedback', nextQuestionId: 'q_2' },
          { id: 'q_0_exchange', text: zh ? '促成交换' : 'Arrange an exchange', nextQuestionId: 'q_3' },
          { id: 'q_0_ignore', text: zh ? '暂时跳过' : 'Not for me', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_1',
        text: zh ? '先从哪类人开始？' : 'Who would you like to meet first?',
        contextPath: [{ questionId: 'q_0', answerId: 'q_0_people' }],
        answers: [
          { id: 'q_1_local', text: zh ? '附近的人' : 'Someone nearby', isMatch: true, isTerminal: true },
          { id: 'q_1_interest', text: zh ? '兴趣相同的人' : 'Someone with a shared interest', isMatch: true, isTerminal: true },
          { id: 'q_1_ignore', text: zh ? '暂时跳过' : 'Not for me', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_2',
        text: zh ? '你想收集什么意见？' : 'What would you like feedback on?',
        contextPath: [{ questionId: 'q_0', answerId: 'q_0_feedback' }],
        answers: [
          { id: 'q_2_idea', text: zh ? '一个想法' : 'An idea', isMatch: true, isTerminal: true },
          { id: 'q_2_plan', text: zh ? '一个计划' : 'A plan', isMatch: true, isTerminal: true },
          { id: 'q_2_ignore', text: zh ? '暂时跳过' : 'Not for me', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'q_3',
        text: zh ? '先尝试哪种交换？' : 'Which exchange should you try first?',
        contextPath: [{ questionId: 'q_0', answerId: 'q_0_exchange' }],
        answers: [
          { id: 'q_3_item', text: zh ? '物品' : 'An item', isMatch: true, isTerminal: true },
          { id: 'q_3_skill', text: zh ? '技能' : 'A skill', isMatch: true, isTerminal: true },
          { id: 'q_3_ignore', text: zh ? '暂时跳过' : 'Not for me', isIgnore: true, isTerminal: true },
        ],
      },
      ],
    }),
  ];
}

export const STARTER_PRACTICE_BOTS: StarterPracticeBotDefinition[] = [
  {
    id: 'builder',
    icon: '🧱',
    nameKey: 'practiceBotBuilderName',
    descKey: 'practiceBotBuilderDesc',
    build: buildBuilder,
  },
  {
    id: 'echo',
    icon: '🔁',
    nameKey: 'practiceBotEchoName',
    descKey: 'practiceBotEchoDesc',
    build: buildEcho,
  },
  {
    id: 'pathfinder',
    icon: '🧭',
    nameKey: 'practiceBotPathfinderName',
    descKey: 'practiceBotPathfinderDesc',
    build: buildPathfinder,
  },
];

export function findStarterPracticeBot(id: string): StarterPracticeBotDefinition | undefined {
  return STARTER_PRACTICE_BOTS.find((bot) => bot.id === id);
}

export function getStarterPracticeProgress(
  bot: StarterPracticeBotDefinition,
  locale: UiLanguage,
  myTalks: MyTalkMap,
): { completed: number; total: number; nextTalk: any | null } {
  const talks = bot.build(locale);
  const completedIds = new Set(
    Object.values(myTalks)
      .filter((entry) => entry.fullTalk?.practiceOnly === true && entry.completedAnswers?.length)
      .map((entry) => String(entry.fullTalk?.id || entry.talkId)),
  );
  const nextTalk = talks.find((talk) => !completedIds.has(talk.id)) || null;
  const completed = talks.filter((talk) => completedIds.has(talk.id)).length;
  return { completed, total: talks.length, nextTalk };
}
