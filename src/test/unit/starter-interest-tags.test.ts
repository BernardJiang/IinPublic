/** @jest-environment jsdom */
/**
 * OPEN-87 starter interest tags: one canonical Talk per tag, ordinary incoming clusters with no
 * sender (interest tags before the demo Talks), the Like copy adopted as the user's own Talk, the
 * one-tap pass of chips scrolled past, and the hand-over from the introduction to Talks.
 */
import { buildTalkIdentityKey } from '../../shared/cid';
import {
  STARTER_TAGS,
  STARTER_TAGS_CONTACT_ID,
  detachStarterTagTalk,
  isStarterTagTalk,
  starterTagTalk,
} from '../../shared/starter-tags';
import {
  STARTER_CONTACTS_DISABLED_KEY,
  adoptLikedStarterTag,
  findStarterTalk,
  starterSeedsFor,
} from '../../web/ui/starter-talk-seeds';
import { getMyTalks, setMyTalks } from '../../web/ui/my-talks-storage';
import { flyTagChips, starterChipsScrolledPast } from '../../web/ui/tag-chip-fly';
import { showFirstRunIfNeeded } from '../../web/ui/first-run-controller';

const fresh = { myTalks: {}, conversations: {}, knownPeople: [] };

describe('starter interest tags', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('gives each tag one identity key in every UI language, and a manual tag with the same word matches it', () => {
    const hiking = STARTER_TAGS.find((tag) => tag.id === 'hiking')!;
    const en = starterTagTalk(hiking, 'en');
    const zh = starterTagTalk(hiking, 'zh');
    expect(zh.title).toBe('🥾 徒步');
    expect(en.id).toBe(zh.id);
    expect(buildTalkIdentityKey({
      type: 'tag', language: 'en',
      questions: [{ id: 'q_0', text: 'Hiking', tagKind: 'simple', answers: [
        { id: 'm', text: 'Hiking', isMatch: true }, { id: 'i', text: 'Ignore', isIgnore: true },
      ] }],
    })).toBe(en.id);
    expect(new Set(STARTER_TAGS.map((tag) => starterTagTalk(tag, 'en').id)).size).toBe(STARTER_TAGS.length);
  });

  it('lists interest tags first, then the demo Talks, from a source that is no sender', () => {
    const { clusters, contacts } = starterSeedsFor('u1', 'en', fresh);
    expect(clusters.slice(0, STARTER_TAGS.length).every((cluster) => cluster.starterContactId === STARTER_TAGS_CONTACT_ID)).toBe(true);
    expect(clusters.length).toBe(STARTER_TAGS.length + 7);
    expect(contacts.map((contact) => contact.id)).not.toContain(STARTER_TAGS_CONTACT_ID);
    // Newer than the demo Talks and in catalog order, so the incoming list shows them first.
    const times = clusters.map((cluster) => Date.parse(cluster.updatedAt));
    expect(times[0]).toBeGreaterThan(times[1]!);
    expect(times[STARTER_TAGS.length - 1]).toBeGreaterThan(times[STARTER_TAGS.length]!);
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
    const hiking = starterTagTalk(STARTER_TAGS[0]!, 'en');
    const { clusters } = starterSeedsFor('u1', 'en', { ...fresh, incoming: [{ identityKey: hiking.id }] });
    expect(clusters.some((cluster) => cluster.identityKey === hiking.id)).toBe(false);
    expect(findStarterTalk(clusters, hiking.id, hiking.id)).toBeNull();
  });

  it("adopts a liked starter copy as the user's own Talk with the same identity key", () => {
    const talk = starterTagTalk(STARTER_TAGS[1]!, 'en');
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
