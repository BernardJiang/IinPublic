/** @jest-environment jsdom */
/**
 * OPEN-87 starter interest tags: one canonical Talk per tag, ordinary incoming clusters with no
 * sender (interest tags before the demo Talks), the Like copy adopted as the user's own Talk, the
 * one-tap pass of chips scrolled past, and the hand-over from the introduction to Talks.
 */
import { buildTalkIdentityKey } from '../../shared/cid';
import {
  STARTER_TAG_SETS,
  STARTER_TAGS_CONTACT_ID,
  detachStarterTagTalk,
  isStarterTagTalk,
  starterTagTalk,
  starterTagsFor,
} from '../../shared/starter-tags';
import {
  STARTER_CONTACTS_DISABLED_KEY,
  adoptLikedStarterTag,
  findStarterTalk,
  starterSeedsFor,
} from '../../web/ui/starter-talk-seeds';
import { getMyTalks, setMyTalks } from '../../web/ui/my-talks-storage';
import { flyTagChips, starterChipsScrolledPast, starterGroupHeadings } from '../../web/ui/tag-chip-fly';
import { showFirstRunIfNeeded } from '../../web/ui/first-run-controller';

const fresh = { myTalks: {}, conversations: {}, knownPeople: [] };
const EN = starterTagsFor('en');
const ZH = starterTagsFor('zh');

describe('starter interest tags', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('has one content set per language, each tag matched by its keyword alone', () => {
    expect(EN.length).toBeGreaterThanOrEqual(50);
    expect(ZH.length).toBeGreaterThanOrEqual(50);
    expect(ZH.every((tag) => starterTagTalk(tag).language === 'zh')).toBe(true);
    // Unique ids and identity keys within each set.
    for (const set of [EN, ZH]) {
      expect(new Set(set.map((tag) => tag.id)).size).toBe(set.length);
      expect(new Set(set.map((tag) => starterTagTalk(tag).id)).size).toBe(set.length);
    }
    // The emoji is display only: a manual tag with the same keyword in the same language is the same tag.
    const hiking = EN.find((tag) => tag.id === 'hiking')!;
    expect(starterTagTalk(hiking).title).toBe('🥾 Hiking');
    expect(buildTalkIdentityKey({
      type: 'tag', language: 'en',
      questions: [{ id: 'q_0', text: 'Hiking', tagKind: 'simple', answers: [
        { id: 'm', text: 'Hiking', isMatch: true }, { id: 'i', text: 'Ignore', isIgnore: true },
      ] }],
    })).toBe(starterTagTalk(hiking).id);
    // Every group has an icon heading and a few tags.
    for (const set of Object.values(STARTER_TAG_SETS)) {
      expect(set.every((tagGroup) => tagGroup.icon && tagGroup.label && tagGroup.tags.length >= 4)).toBe(true);
    }
  });

  it('lists interest tags first, then the demo Talks, from a source that is no sender', () => {
    const { clusters, contacts } = starterSeedsFor('u1', 'en', fresh);
    expect(clusters.slice(0, EN.length).every((cluster) => cluster.starterContactId === STARTER_TAGS_CONTACT_ID)).toBe(true);
    expect(clusters.length).toBe(EN.length + 7);
    expect(clusters[0].starterGroup).toEqual({ id: EN[0]!.group.id, icon: EN[0]!.group.icon, label: EN[0]!.group.label });
    // A Chinese UI gets the Chinese set.
    expect(starterSeedsFor('u9', 'zh', fresh).clusters[0].title).toBe(`${ZH[0]!.emoji} ${ZH[0]!.text}`);
    expect(contacts.map((contact) => contact.id)).not.toContain(STARTER_TAGS_CONTACT_ID);
    // Newer than the demo Talks and in catalog order, so the incoming list shows them first.
    const times = clusters.map((cluster) => Date.parse(cluster.updatedAt));
    expect(times[0]).toBeGreaterThan(times[1]!);
    expect(times[EN.length - 1]).toBeGreaterThan(times[EN.length]!);
  });

  it('stays enrolled after the first answer, skips existing users and the E2E opt-out', () => {
    starterSeedsFor('u1', 'en', fresh);
    const answered = { ...fresh, myTalks: { x: { role: 'copied' } as any } };
    expect(starterSeedsFor('u1', 'en', answered).clusters.length).toBeGreaterThan(0);
    expect(starterSeedsFor('u2', 'en', answered).clusters).toHaveLength(0);
    localStorage.setItem(STARTER_CONTACTS_DISABLED_KEY, 'true');
    expect(starterSeedsFor('u3', 'en', fresh).clusters).toHaveLength(0);
  });

  it('gives way to the same tag sent by a real person, so answering reaches them', () => {
    const hiking = starterTagTalk(EN[0]!);
    const { clusters } = starterSeedsFor('u1', 'en', { ...fresh, incoming: [{ identityKey: hiking.id }] });
    expect(clusters.some((cluster) => cluster.identityKey === hiking.id)).toBe(false);
    expect(findStarterTalk(clusters, hiking.id, hiking.id)).toBeNull();
  });

  it("adopts a liked starter copy as the user's own Talk with the same identity key", () => {
    const talk = starterTagTalk(EN[1]!);
    setMyTalks({ [talk.id]: { role: 'copied', fullTalk: talk } as any });
    adoptLikedStarterTag(talk, { id: 'me', name: 'Me' });
    const adopted = getMyTalks()[talk.id]!.fullTalk;
    expect(adopted.authorId).toBe('me');
    expect(isStarterTagTalk(adopted)).toBe(false);
    expect(adopted.starterTagId).toBeUndefined();
    expect(buildTalkIdentityKey(adopted)).toBe(talk.id);
    expect(detachStarterTagTalk(talk, { id: 'me', name: 'Me' }).id).toBe(talk.id);
  });

  it('passes the unanswered starter chips above a liked one, not the ones below or answered', () => {
    document.body.innerHTML = `<div id="talks-list">
      <div class="talk-tag-chip talk-incoming-new" data-starter-tag="true" id="a"></div>
      <div class="talk-tag-chip talk-incoming-answered" data-starter-tag="true" id="b"></div>
      <div class="talk-tag-chip talk-incoming-new" id="real"></div>
      <div class="talk-tag-chip talk-incoming-new" data-starter-tag="true" id="c"></div>
      <div class="talk-tag-chip talk-incoming-new" data-starter-tag="true" id="d"></div></div>`;
    const row = document.getElementById('c')!;
    expect(starterChipsScrolledPast(row).map((chip) => chip.id)).toEqual(['a']);
    expect(starterChipsScrolledPast(document.getElementById('real')!)).toEqual([]);
  });

  it('puts each group heading on the first remaining tag of that group', () => {
    const food = { id: 'food', icon: '🍜', label: 'Food' };
    const music = { id: 'music', icon: '🎵', label: 'Music' };
    const headings = starterGroupHeadings([
      { identityKey: 'a', starterGroup: food }, { identityKey: 'b', starterGroup: food },
      { identityKey: 'real' }, { identityKey: 'c', starterGroup: music },
    ]);
    expect(Array.from(headings.entries())).toEqual([['a', food], ['c', music]]);
  });

  it('plays the like/pass motion, then answers once', () => {
    document.body.innerHTML = '<div id="x"></div><div id="y"></div>';
    const x = document.getElementById('x')!;
    const y = document.getElementById('y')!;
    let scheduled: (() => void) | undefined;
    const done = jest.fn();
    flyTagChips([{ chip: x, direction: 'pass' }, { chip: y, direction: 'like' }], done, (callback) => { scheduled = callback; });
    // Fixed-position copies fly (a list re-render cannot cut them short); the chips hide.
    expect(document.querySelectorAll('.talk-tag-fly-ghost.talk-tag-fly-pass')).toHaveLength(1);
    expect(document.querySelectorAll('.talk-tag-fly-ghost.talk-tag-fly-like')).toHaveLength(1);
    expect(x.style.visibility).toBe('hidden');
    expect(y.getAttribute('aria-busy')).toBe('true');
    expect(done).not.toHaveBeenCalled();
    scheduled!();
    expect(done).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.talk-tag-fly-ghost')).toHaveLength(0);
  });

  it('opens Talks when the introduction is closed', () => {
    window.history.replaceState(null, '', '/');
    const openStarterTalks = jest.fn();
    const hmr = process.env.DISABLE_HMR;
    delete process.env.DISABLE_HMR;
    try {
      showFirstRunIfNeeded({ t: (key: string) => key, openStarterTalks } as never);
    } finally {
      if (hmr !== undefined) process.env.DISABLE_HMR = hmr;
    }
    (document.querySelector('[data-testid="walkthrough-close-btn"]') as HTMLElement).click();
    expect(openStarterTalks).toHaveBeenCalledTimes(1);
  });
});
