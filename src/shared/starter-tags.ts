/**
 * Starter interest tags (OPEN-87, docs/design/actionable-first-run-starter-talks.md): the
 * preloaded tags a new user likes or passes on the Talks tab after the introduction.
 *
 * Content-oriented: specific things people watch, read, play, eat and follow, which say more about
 * a person than broad activities (sharing a rarer interest attracts more, Alves 2018). There is one
 * set per UI language, written for that audience; a tag is an ordinary single-keyword `tag` Talk
 * in its set's language, so people who liked the same tag in the same set share one identity key
 * and ordinary Talk exchange matches them. Groups are display only (a heading with an icon); a
 * tag's emoji is display only too — only the keyword enters the identity key.
 *
 * Order: groups go from the most widely shared (food, screen, music) to the more specific; inside a
 * group the most common tag comes first, so it is reached before liking anything below passes it.
 */
import { computeTalkIdFromTalkData } from './cid';

export const STARTER_TAGS_VERSION = 2;

/** Sender id of the local starter source. It is not a person: no response, Contact or exchange. */
export const STARTER_TAGS_SOURCE_ID = 'iinpublic-starter-interests';
/** `starterContactId` carried by starter tag Talks; the app skips peer delivery for it. */
export const STARTER_TAGS_CONTACT_ID = 'interest-tags';

export type StarterTagLanguage = 'en' | 'zh';
export type StarterTag = { id: string; emoji: string; text: string };
export type StarterTagGroup = { id: string; icon: string; label: string; tags: readonly StarterTag[] };
/** A tag with its group, in list order. */
export type StarterTagEntry = StarterTag & { language: StarterTagLanguage; group: StarterTagGroup };

const group = (id: string, icon: string, label: string, tags: Array<[string, string, string]>): StarterTagGroup =>
  ({ id, icon, label, tags: tags.map(([tagId, emoji, text]) => ({ id: tagId, emoji, text })) });

const EN: readonly StarterTagGroup[] = [
  group('food', '🍜', 'Food & drink', [
    ['coffee', '☕', 'Coffee'], ['pizza', '🍕', 'Pizza'], ['tacos', '🌮', 'Tacos'], ['sushi', '🍣', 'Sushi'],
    ['bbq', '🍖', 'BBQ'], ['baking', '🧁', 'Baking'], ['ramen', '🍜', 'Ramen'], ['vegan', '🥗', 'Vegan food'],
  ]),
  group('screen', '🎬', 'Movies & TV', [
    ['comedy', '😂', 'Comedy'], ['sci-fi', '🚀', 'Sci-fi'], ['horror', '👻', 'Horror'], ['superhero', '🦸', 'Superhero movies'],
    ['documentaries', '🎥', 'Documentaries'], ['reality-tv', '📺', 'Reality TV'], ['anime', '🍥', 'Anime'], ['k-drama', '🇰🇷', 'K-dramas'],
  ]),
  group('music', '🎵', 'Music', [
    ['pop', '🎤', 'Pop'], ['hip-hop', '🎧', 'Hip-hop'], ['country', '🤠', 'Country'], ['rock', '🎸', 'Rock'],
    ['rnb', '🎶', 'R&B'], ['edm', '🪩', 'EDM'], ['jazz', '🎷', 'Jazz'], ['k-pop', '💜', 'K-pop'],
  ]),
  group('outdoors', '🏕️', 'Travel & outdoors', [
    ['hiking', '🥾', 'Hiking'], ['beaches', '🏖️', 'Beaches'], ['road-trips', '🚗', 'Road trips'], ['camping', '⛺', 'Camping'],
    ['national-parks', '🏞️', 'National parks'], ['theme-parks', '🎢', 'Theme parks'],
  ]),
  group('sports', '🏟️', 'Sports to watch', [
    ['nfl', '🏈', 'NFL'], ['nba', '🏀', 'NBA'], ['soccer', '⚽', 'Soccer'], ['mlb', '⚾', 'MLB'],
    ['f1', '🏎️', 'Formula 1'], ['ufc', '🥊', 'UFC'],
  ]),
  group('games', '🎮', 'Games', [
    ['video-games', '🎮', 'Video games'], ['board-games', '🎲', 'Board games'], ['nintendo', '🍄', 'Nintendo'],
    ['minecraft', '⛏️', 'Minecraft'], ['dnd', '🐉', 'Dungeons & Dragons'], ['esports', '🏆', 'Esports'],
  ]),
  group('books', '📚', 'Books & ideas', [
    ['fantasy', '🧙', 'Fantasy books'], ['thrillers', '🔪', 'Thrillers'], ['true-crime', '🕵️', 'True crime'], ['history', '🏛️', 'History'],
    ['psychology', '🧠', 'Psychology'], ['space', '🔭', 'Space'],
  ]),
  group('making', '🎨', 'Making things', [
    ['photography', '📷', 'Photography'], ['drawing', '✏️', 'Drawing'], ['fashion', '👗', 'Fashion'], ['diy', '🔨', 'DIY'],
    ['writing', '✍️', 'Writing'], ['knitting', '🧶', 'Knitting'],
  ]),
  group('life', '🌿', 'Everyday life', [
    ['dogs', '🐶', 'Dogs'], ['cats', '🐱', 'Cats'], ['fitness', '💪', 'Fitness'], ['houseplants', '🪴', 'Houseplants'],
    ['personal-finance', '💰', 'Personal finance'], ['ai', '🤖', 'AI'],
  ]),
];

const ZH: readonly StarterTagGroup[] = [
  group('food', '🍜', '美食', [
    ['hotpot', '🍲', '火锅'], ['milk-tea', '🧋', '奶茶'], ['coffee', '☕', '咖啡'], ['bbq', '🍢', '烧烤'],
    ['food-hunting', '📍', '探店'], ['baking', '🧁', '烘焙'], ['spicy', '🌶️', '川湘菜'], ['desserts', '🍰', '甜品'],
  ]),
  group('screen', '🎬', '影视综艺', [
    ['domestic-drama', '📺', '国产剧'], ['suspense', '🔍', '悬疑剧'], ['variety', '🎉', '综艺'], ['sci-fi', '🚀', '科幻片'],
    ['documentaries', '🎥', '纪录片'], ['k-drama', '🇰🇷', '韩剧'], ['us-tv', '🇺🇸', '美剧'], ['short-drama', '📱', '短剧'],
  ]),
  group('music', '🎵', '音乐', [
    ['mandopop', '🎤', '华语流行'], ['folk', '🪕', '民谣'], ['rap', '🎧', '说唱'], ['rock', '🎸', '摇滚'],
    ['guofeng', '🏮', '古风'], ['concerts', '🏟️', '演唱会'], ['livehouse', '🎶', 'Livehouse'], ['electronic', '🪩', '电子音乐'],
  ]),
  group('acg', '🌸', '二次元与潮玩', [
    ['anime', '🍥', '动漫'], ['figures', '🧸', '手办'], ['blind-boxes', '🎁', '盲盒'], ['cosplay', '🎭', 'Cosplay'],
    ['hanfu', '👘', '汉服'], ['guochao', '🐉', '国潮'],
  ]),
  group('games', '🎮', '游戏', [
    ['honor-of-kings', '⚔️', '王者荣耀'], ['genshin', '🌟', '原神'], ['console', '🎮', '主机游戏'], ['murder-mystery', '🕵️', '剧本杀'],
    ['board-games', '🎲', '桌游'], ['esports', '🏆', '电竞'],
  ]),
  group('outdoors', '🏕️', '旅行与户外', [
    ['citywalk', '🚶', 'Citywalk'], ['camping', '⛺', '露营'], ['mountains', '⛰️', '爬山'], ['road-trips', '🚗', '自驾游'],
    ['cycling', '🚴', '骑行'], ['special-forces-travel', '🎒', '特种兵旅游'],
  ]),
  group('sports', '🏸', '运动', [
    ['badminton', '🏸', '羽毛球'], ['basketball', '🏀', '篮球'], ['table-tennis', '🏓', '乒乓球'], ['fitness', '💪', '健身'],
    ['football', '⚽', '足球'], ['yoga', '🧘', '瑜伽'],
  ]),
  group('knowledge', '📚', '阅读与成长', [
    ['web-novels', '📖', '网络小说'], ['history', '🏛️', '历史'], ['psychology', '🧠', '心理学'], ['investing', '💰', '理财'],
    ['career', '💼', '职场成长'], ['ai', '🤖', 'AI'],
  ]),
  group('life', '🌿', '生活方式', [
    ['cats', '🐱', '猫'], ['dogs', '🐶', '狗'], ['photography', '📷', '摄影'], ['outfits', '👗', '穿搭'],
    ['plants', '🪴', '养绿植'], ['home', '🏠', '家居布置'],
  ]),
];

export const STARTER_TAG_SETS: Readonly<Record<StarterTagLanguage, readonly StarterTagGroup[]>> = { en: EN, zh: ZH };

export function starterTagLanguage(locale: string | undefined): StarterTagLanguage {
  return locale === 'zh' ? 'zh' : 'en';
}

/** Every starter tag for a UI language, in list order, with its group. */
export function starterTagsFor(locale: string | undefined): StarterTagEntry[] {
  const language = starterTagLanguage(locale);
  return STARTER_TAG_SETS[language].flatMap((tagGroup) =>
    tagGroup.tags.map((tag) => ({ ...tag, language, group: tagGroup })));
}

/** The label a user sees: emoji plus the keyword. */
export function starterTagLabel(tag: StarterTag): string {
  return `${tag.emoji} ${tag.text}`;
}

/**
 * The Talk for one starter tag. Only `type`, `language` and the keyword enter the identity key
 * (src/shared/cid.ts); the emoji title and the Ignore label do not.
 */
export function starterTagTalk(tag: StarterTagEntry): any {
  const talk = {
    type: 'tag',
    language: tag.language,
    title: starterTagLabel(tag),
    questions: [{
      id: 'q_0',
      text: tag.text,
      tagKind: 'simple',
      answers: [
        { id: 'q_0_match', text: tag.text, isMatch: true, isTerminal: true },
        { id: 'q_0_ignore', text: tag.language === 'zh' ? '忽略' : 'Ignore', isIgnore: true, isTerminal: true },
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
