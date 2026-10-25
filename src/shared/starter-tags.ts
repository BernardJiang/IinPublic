/**
 * Starter interest tags (OPEN-87, docs/design/actionable-first-run-starter-talks.md): the
 * preloaded tags a new user likes or passes on the Talks tab after the introduction. Each one is an
 * ordinary single-keyword `tag` Talk in one canonical form — type `tag`, language `en`, the English
 * keyword — so every user's copy has the same content identity key whatever their UI language, and
 * ordinary Talk exchange matches people who liked the same tag. The UI shows the localized label.
 */
import { computeTalkIdFromTalkData } from './cid';

export const STARTER_TAGS_VERSION = 1;

/** Sender id of the local starter source. It is not a person: no response, Contact or exchange. */
export const STARTER_TAGS_SOURCE_ID = 'iinpublic-starter-interests';
/** `starterContactId` carried by starter tag Talks; the app skips peer delivery for it. */
export const STARTER_TAGS_CONTACT_ID = 'interest-tags';

export type StarterTag = { id: string; emoji: string; en: string; zh: string };

export const STARTER_TAGS: readonly StarterTag[] = [
  { id: 'hiking', emoji: '🥾', en: 'Hiking', zh: '徒步' },
  { id: 'coffee', emoji: '☕', en: 'Coffee', zh: '咖啡' },
  { id: 'books', emoji: '📚', en: 'Books', zh: '读书' },
  { id: 'movies', emoji: '🎬', en: 'Movies', zh: '电影' },
  { id: 'music', emoji: '🎵', en: 'Live music', zh: '现场音乐' },
  { id: 'cooking', emoji: '🍳', en: 'Cooking', zh: '烹饪' },
  { id: 'foodie', emoji: '🍜', en: 'Trying new food', zh: '探店美食' },
  { id: 'running', emoji: '🏃', en: 'Running', zh: '跑步' },
  { id: 'cycling', emoji: '🚴', en: 'Cycling', zh: '骑行' },
  { id: 'gym', emoji: '🏋️', en: 'Gym', zh: '健身' },
  { id: 'yoga', emoji: '🧘', en: 'Yoga', zh: '瑜伽' },
  { id: 'basketball', emoji: '🏀', en: 'Basketball', zh: '篮球' },
  { id: 'soccer', emoji: '⚽', en: 'Soccer', zh: '足球' },
  { id: 'tennis', emoji: '🎾', en: 'Tennis', zh: '网球' },
  { id: 'board-games', emoji: '🎲', en: 'Board games', zh: '桌游' },
  { id: 'video-games', emoji: '🎮', en: 'Video games', zh: '电子游戏' },
  { id: 'photography', emoji: '📷', en: 'Photography', zh: '摄影' },
  { id: 'travel', emoji: '✈️', en: 'Travel', zh: '旅行' },
  { id: 'pets', emoji: '🐶', en: 'Pets', zh: '宠物' },
  { id: 'gardening', emoji: '🌱', en: 'Gardening', zh: '园艺' },
  { id: 'art', emoji: '🎨', en: 'Art', zh: '艺术' },
  { id: 'tech', emoji: '💻', en: 'Tech', zh: '科技' },
  { id: 'languages', emoji: '🗣️', en: 'Learning languages', zh: '学外语' },
  { id: 'volunteering', emoji: '🤝', en: 'Volunteering', zh: '志愿服务' },
];

/** The label a user sees for a starter tag: emoji plus the keyword in their UI language. */
export function starterTagLabel(tag: StarterTag, locale: string | undefined): string {
  return `${tag.emoji} ${locale === 'zh' ? tag.zh : tag.en}`;
}

/**
 * The canonical Talk for one starter tag. Only `type`, `language` and the keyword enter the identity
 * key (src/shared/cid.ts), so the localized display title and the Ignore label do not split users.
 */
export function starterTagTalk(tag: StarterTag, locale: string | undefined): any {
  const talk = {
    type: 'tag',
    language: 'en',
    title: starterTagLabel(tag, locale),
    questions: [{
      id: 'q_0',
      text: tag.en,
      tagKind: 'simple',
      answers: [
        { id: 'q_0_match', text: tag.en, isMatch: true, isTerminal: true },
        { id: 'q_0_ignore', text: locale === 'zh' ? '忽略' : 'Ignore', isIgnore: true, isTerminal: true },
      ],
    }],
    authorId: STARTER_TAGS_SOURCE_ID,
    authorName: 'IinPublic',
    isAdult: false,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    isTemplate: false,
    usageCount: 0,
    starterContactId: STARTER_TAGS_CONTACT_ID,
    starterTagId: tag.id,
  };
  return { ...talk, id: computeTalkIdFromTalkData(talk) };
}

/**
 * A liked starter tag copied into My Talks becomes the user's own Talk: it is sent as theirs and
 * answered like any Talk, so it must carry neither the starter source as author nor the starter
 * marker (which makes the app skip peer delivery). Its content, and so its identity key, is
 * unchanged.
 */
export function detachStarterTagTalk(talk: any, author: { id: string; name: string }): any {
  const { starterContactId: _contact, starterTagId: _tag, ...rest } = talk || {};
  return { ...rest, authorId: author.id, authorName: author.name };
}

export function isStarterTagTalk(talk: any): boolean {
  return talk?.starterContactId === STARTER_TAGS_CONTACT_ID;
}
