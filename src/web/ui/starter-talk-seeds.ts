import { computeTalkIdFromTalkData } from '../../shared/cid';
import type { KnownPerson } from '../../shared/types';
import type { MyTalkMap } from './my-talks-storage';
import type { UiLanguage } from './ui-translations';

export const STARTER_CONTACTS_VERSION = 1;

export type StarterPracticeContactId = 'tag-guide' | 'flow-guide' | 'survey-guide' | 'route-guide';

export type StarterPracticeContact = {
  id: StarterPracticeContactId;
  userId: string;
  icon: string;
  talkType: 'tag' | 'flow' | 'survey' | 'route';
  name: string;
  description: string;
  talks: any[];
};

const definitions: Array<{
  id: StarterPracticeContactId;
  userId: string;
  icon: string;
  talkType: StarterPracticeContact['talkType'];
}> = [
  { id: 'tag-guide', userId: 'iinpublic-demo-tag-guide', icon: '🏷️', talkType: 'tag' },
  { id: 'flow-guide', userId: 'iinpublic-demo-flow-guide', icon: '➡️', talkType: 'flow' },
  { id: 'survey-guide', userId: 'iinpublic-demo-survey-guide', icon: '📊', talkType: 'survey' },
  { id: 'route-guide', userId: 'iinpublic-demo-route-guide', icon: '🔀', talkType: 'route' },
];

const stateKey = (userId: string): string => `iinpublic_starter_contacts_v${STARTER_CONTACTS_VERSION}:${userId}`;
const lang = (locale?: UiLanguage): UiLanguage => locale === 'zh' ? 'zh' : 'en';

function makeTalk(contactId: StarterPracticeContactId, locale: UiLanguage, draft: any): any {
  const definition = definitions.find((item) => item.id === contactId)!;
  const talk = {
    ...draft,
    authorId: definition.userId,
    authorName: contactName(contactId, locale),
    isAdult: false,
    language: locale,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    isTemplate: false,
    usageCount: 0,
    starterContactId: contactId,
  };
  return { ...talk, id: computeTalkIdFromTalkData(talk) };
}

function contactName(id: StarterPracticeContactId, locale: UiLanguage): string {
  const zh = locale === 'zh';
  const names: Record<StarterPracticeContactId, [string, string]> = {
    'tag-guide': ['Tag Guide', '标签向导'],
    'flow-guide': ['Flow Guide', '流程向导'],
    'survey-guide': ['Survey Guide', '问卷向导'],
    'route-guide': ['Route Guide', '路线向导'],
  };
  return names[id][zh ? 1 : 0];
}

function contactDescription(id: StarterPracticeContactId, locale: UiLanguage): string {
  const zh = locale === 'zh';
  const descriptions: Record<StarterPracticeContactId, [string, string]> = {
    'tag-guide': ['Sends simple and paired Tag Talks', '发送简单标签和成对标签话题'],
    'flow-guide': ['Sends step-by-step Flow Talks', '发送分步流程话题'],
    'survey-guide': ['Sends Survey Talks', '发送问卷话题'],
    'route-guide': ['Sends branching Route Talks', '发送分支路线话题'],
  };
  return descriptions[id][zh ? 1 : 0];
}

function buildTalks(id: StarterPracticeContactId, locale: UiLanguage): any[] {
  const zh = locale === 'zh';
  if (id === 'tag-guide') {
    const tag = (title: string, accepted = title) => makeTalk(id, locale, {
      type: 'tag', title,
      questions: [{
        id: 'q_0', text: title,
        ...(accepted === title ? { tagKind: 'simple' } : { reciprocalTagContext: true }),
        answers: [
          { id: 'q_0_match', text: accepted, isMatch: true, isTerminal: true },
          { id: 'q_0_ignore', text: zh ? '忽略' : 'Ignore', isIgnore: true, isTerminal: true },
        ],
      }],
    });
    return [
      tag(zh ? '周末徒步' : 'Weekend hiking'),
      tag(zh ? '语言交换' : 'Language exchange'),
      tag(zh ? '我可以提供指导' : 'I can offer mentoring', zh ? '我想找一位导师' : 'I am looking for a mentor'),
      tag(zh ? '我正在招聘' : 'I am hiring', zh ? '我正在找工作' : 'I am looking for work'),
    ];
  }
  if (id === 'flow-guide') return [makeTalk(id, locale, {
    type: 'flow', title: zh ? '一起喝咖啡吗？' : 'Meet for coffee?',
    questions: [
      { id: 'q_0', text: zh ? '你想喝咖啡聊聊吗？' : 'Would you like to meet for coffee?', answers: [
        { id: 'yes', text: zh ? '想' : 'Yes', nextQuestionId: 'q_1' },
        { id: 'no', text: zh ? '暂时不' : 'Not now', isIgnore: true, isTerminal: true },
      ] },
      { id: 'q_1', text: zh ? '哪天方便？' : 'Which day works?', answers: [
        { id: 'weekend', text: zh ? '这个周末' : 'This weekend', isMatch: true, isTerminal: true },
        { id: 'skip', text: zh ? '暂时不' : 'Not now', isIgnore: true, isTerminal: true },
      ] },
    ],
  })];
  if (id === 'survey-guide') return [makeTalk(id, locale, {
    type: 'survey', title: zh ? '你更喜欢哪种活动？' : 'Which activity do you prefer?',
    questions: [{ id: 'q_0', text: zh ? '选一个你更喜欢的活动' : 'Pick the activity you prefer', isAggregatable: true, answers: [
      { id: 'outdoors', text: zh ? '户外活动' : 'Outdoors', isTerminal: true, counter: 0 },
      { id: 'games', text: zh ? '桌游' : 'Board games', isTerminal: true, counter: 0 },
      { id: 'food', text: zh ? '美食' : 'Trying food', isTerminal: true, counter: 0 },
      { id: 'skip', text: zh ? '跳过' : 'Skip', isIgnore: true, isTerminal: true },
    ] }],
  })];
  return [makeTalk(id, locale, {
    type: 'route', title: zh ? '找到适合的活动' : 'Find an activity that fits',
    questions: [
      { id: 'q_0', text: zh ? '你想室内还是户外？' : 'Indoors or outdoors?', contextPath: [], answers: [
        { id: 'indoors', text: zh ? '室内' : 'Indoors', nextQuestionId: 'q_1' },
        { id: 'outdoors', text: zh ? '户外' : 'Outdoors', nextQuestionId: 'q_2' },
        { id: 'skip', text: zh ? '跳过' : 'Skip', isIgnore: true, isTerminal: true },
      ] },
      { id: 'q_1', text: zh ? '一起玩桌游吗？' : 'How about board games?', contextPath: [{ questionId: 'q_0', answerId: 'indoors' }], answers: [
        { id: 'yes', text: zh ? '好' : 'Sounds good', isMatch: true, isTerminal: true },
        { id: 'no', text: zh ? '不合适' : 'Not for me', isIgnore: true, isTerminal: true },
      ] },
      { id: 'q_2', text: zh ? '一起徒步吗？' : 'How about a hike?', contextPath: [{ questionId: 'q_0', answerId: 'outdoors' }], answers: [
        { id: 'yes', text: zh ? '好' : 'Sounds good', isMatch: true, isTerminal: true },
        { id: 'no', text: zh ? '不合适' : 'Not for me', isIgnore: true, isTerminal: true },
      ] },
    ],
  })];
}

function readActiveIds(userId: string, eligible: boolean, storage: Storage): StarterPracticeContactId[] {
  if (!userId) return [];
  try {
    const raw = storage.getItem(stateKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.activeIds)
        ? parsed.activeIds.filter((id: string) => definitions.some((item) => item.id === id))
        : [];
    }
    if (!eligible) return [];
    const activeIds = definitions.map((item) => item.id);
    storage.setItem(stateKey(userId), JSON.stringify({ activeIds }));
    return activeIds;
  } catch {
    return eligible ? definitions.map((item) => item.id) : [];
  }
}

export function isStarterContactEligible(
  myTalks: MyTalkMap,
  conversations: Record<string, any>,
  knownPeople: KnownPerson[],
): boolean {
  const realConversations = Object.values(conversations).filter((conversation: any) => conversation?.supportChannel !== true);
  return Object.keys(myTalks).length === 0
    && realConversations.length === 0
    && knownPeople.length === 0;
}

export function getStarterPracticeContacts(
  userId: string,
  locale: UiLanguage,
  eligible: boolean,
  storage: Storage = localStorage,
): StarterPracticeContact[] {
  const normalizedLocale = lang(locale);
  const activeIds = new Set(readActiveIds(userId, eligible, storage));
  return definitions
    .filter((definition) => activeIds.has(definition.id))
    .map((definition) => ({
      ...definition,
      name: contactName(definition.id, normalizedLocale),
      description: contactDescription(definition.id, normalizedLocale),
      talks: buildTalks(definition.id, normalizedLocale),
    }));
}

export function removeStarterPracticeContact(
  userId: string,
  id: StarterPracticeContactId,
  storage: Storage = localStorage,
): void {
  const activeIds = readActiveIds(userId, false, storage).filter((candidate) => candidate !== id);
  storage.setItem(stateKey(userId), JSON.stringify({ activeIds }));
}

export function starterIncomingTalkClusters(contacts: StarterPracticeContact[]): any[] {
  return contacts.flatMap((contact) => contact.talks.map((talk, index) => ({
    identityKey: talk.id,
    latestTalkId: talk.id,
    title: talk.title,
    type: talk.type,
    language: talk.language,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    isAnswered: false,
    latestTalk: talk,
    senders: {
      [contact.userId]: {
        senderId: contact.userId,
        senderName: contact.name,
        lastTalkId: talk.id,
        starterContactId: contact.id,
      },
    },
    talkIds: { [talk.id]: talk.createdAt },
    starterContactId: contact.id,
  })));
}
