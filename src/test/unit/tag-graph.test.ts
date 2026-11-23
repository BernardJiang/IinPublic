/** @jest-environment jsdom */
/** OPEN-87 S4: the person↔tag graph from local data, and the tag page / directory / person tags. */
import { buildTagGraph, likersOfTag, likesMyTag, sharedTagCount, tagDirectory, tagsOfPeer } from '../../core/tag-graph';
import { configureTagGraphView, renderPeerTagsInto } from '../../web/ui/tag-graph-view';
import { clearContactsFocus, clearMeFocus, clearTalksFocus, getContactsFocus, getMeFocus, getTalksFocus, invalidateTagPopularity, peopleWhoLike, popularityHtml } from '../../web/ui/graph-focus';
import { STARTER_TAGS_SOURCE_ID } from '../../shared/starter-tags';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';

const tagCluster = (key: string, title: string, senders: Record<string, string>) => ({
  identityKey: key, type: 'tag', title,
  senders: Object.fromEntries(Object.entries(senders).map(([id, name]) => [id, { senderId: id, senderName: name }])),
});

const input = {
  currentUserId: 'me',
  incoming: [
    tagCluster('qa_hike', '🥾 Hiking', { bob: 'Bob', [STARTER_TAGS_SOURCE_ID]: 'IinPublic' }),
    tagCluster('qa_books', '📚 Books', { bob: 'Bob', carol: 'Carol', [TECHSUPPORT_ROOT_USER_ID]: 'TechSupport' }),
    { identityKey: 'qa_flow', type: 'flow', title: 'Coffee?', senders: { dan: { senderName: 'Dan' } } },
  ],
  myTalks: {
    qa_hike: { role: 'copied', fullTalk: { id: 'qa_hike', type: 'tag', title: '🥾 Hiking' } },
    qa_chess: { role: 'created', fullTalk: { id: 'qa_chess', type: 'tag', title: '♟️ Chess' } },
    qa_old: { role: 'copied', disabled: true, fullTalk: { id: 'qa_old', type: 'tag', title: 'Old' } },
  },
  exchanges: {
    'carol::qa_hike': { peerId: 'carol', peerName: 'Carol', talkId: 'qa_hike', type: 'tag', title: '🥾 Hiking', outcome: 'match' },
    'erin::qa_chess': { peerId: 'erin', peerName: 'Erin', talkId: 'qa_chess', type: 'tag', title: '♟️ Chess', outcome: 'mismatch' },
  },
};

describe('tag graph: one tag under several Talk ids (OPEN-106 step 2e, e2e stage2/88)', () => {
  it('my starter tag and a peer’s copy of it under a graph id are one tag', () => {
    const coffee = { type: 'tag', title: '☕ Coffee', questions: [{ id: 'q', text: 'Coffee', answers: [{ id: 'like', text: 'Like', isMatch: true }, { id: 'pass', text: 'Pass', isIgnore: true }] }] };
    const peerTalkId = '1793834180561-cb00c56ec994375a9db361178c36da7a-1';
    const graph = buildTagGraph({
      currentUserId: 'me',
      myTalks: { qa_coffee: { role: 'copied', fullTalk: { ...coffee, id: 'qa_coffee' } } },
      incoming: [{ ...tagCluster(`identity-of-coffee`, '☕ Coffee', { bob: 'Bob' }), latestTalkId: peerTalkId }],
      exchanges: { [`bob::${peerTalkId}`]: { peerId: 'bob', peerName: 'Bob', talkId: peerTalkId, type: 'tag', title: '☕ Coffee', outcome: 'match' } },
    });
    // The peer's cluster is keyed by the content identity of the same body as mine.
    const mineOnly = buildTagGraph({ currentUserId: 'me', myTalks: { qa_coffee: { role: 'copied', fullTalk: { ...coffee, id: 'qa_coffee' } } }, incoming: [], exchanges: {} });
    const identity = [...mineOnly.tags.keys()][0]!;
    const same = buildTagGraph({
      currentUserId: 'me',
      myTalks: { qa_coffee: { role: 'copied', fullTalk: { ...coffee, id: 'qa_coffee' } } },
      incoming: [{ ...tagCluster(identity, '☕ Coffee', { bob: 'Bob' }), latestTalkId: peerTalkId }],
      exchanges: { [`bob::${peerTalkId}`]: { peerId: 'bob', peerName: 'Bob', talkId: peerTalkId, type: 'tag', title: '☕ Coffee', outcome: 'match' } },
    });
    expect(tagsOfPeer(same, 'bob')).toEqual([{ key: 'qa_coffee', label: '☕ Coffee', shared: true, talkIds: ['qa_coffee', peerTalkId] }]);
    expect(likersOfTag(same, peerTalkId).map((p) => p.peerId)).toEqual(['bob']);
    expect(likersOfTag(same, 'qa_coffee').map((p) => p.peerId)).toEqual(['bob']);
    // A different identity stays a different tag.
    expect(graph.tags.size).toBe(2);
  });
});

describe('tag graph', () => {
  const graph = buildTagGraph(input);

  it('knows who likes a tag from senders and matched exchanges, never fixtures or TechSupport', () => {
    expect(likersOfTag(graph, 'qa_hike').map((person) => person.peerId).sort()).toEqual(['bob', 'carol']);
    expect(likersOfTag(graph, 'qa_books').map((person) => person.peerId).sort()).toEqual(['bob', 'carol']);
    expect(likersOfTag(graph, 'qa_chess')).toEqual([]);
    expect(graph.tags.has('qa_flow')).toBe(false);
    expect(graph.tags.get('qa_old')).toBeUndefined();
  });

  it('lists a person’s tags with the shared ones first and counts what we share', () => {
    expect(tagsOfPeer(graph, 'bob')).toEqual([
      { key: 'qa_hike', label: '🥾 Hiking', shared: true, talkIds: ['qa_hike'] },
      { key: 'qa_books', label: '📚 Books', shared: false, talkIds: ['qa_books'] },
    ]);
    expect(sharedTagCount(graph, 'bob')).toBe(1);
  });

  it('lists every known tag by how many people like it, searchable', () => {
    expect(tagDirectory(graph).map((tag) => [tag.label, tag.count, tag.mine])).toEqual([
      // Equal counts: my own tag first.
      ['🥾 Hiking', 2, true], ['📚 Books', 2, false], ['♟️ Chess', 0, true],
    ]);
    expect(tagDirectory(graph, 'hik').map((tag) => tag.key)).toEqual(['qa_hike']);
  });
});

describe('tag graph view', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button class="nav-btn" data-view="contacts"></button><button class="nav-btn" data-view="me"></button><button class="nav-btn" data-view="talks"></button><input id="contacts-filter-topic">';
    localStorage.clear();
    localStorage.setItem('localTalkExchanges', JSON.stringify(input.exchanges));
    configureTagGraphView({
      graphInput: () => input, t: (key) => key,
      peerName: (peerId, fallback) => (peerId === 'bob' ? 'Bob Live' : fallback),
    });
  });

  afterEach(() => {
    clearContactsFocus();
    clearMeFocus();
    clearTalksFocus();
  });

  it('a tag lists the people who like it, from senders and matches alike: one list everywhere', () => {
    // Hiking: Bob sent it (no exchange yet), Carol matched it — the most recent exchange first.
    expect(peopleWhoLike(['qa_hike'])).toEqual(['carol', 'bob']);
    // Typed into Contacts' filter by keyword (any case), with or without its emoji.
    const topic = document.getElementById('contacts-filter-topic') as HTMLInputElement;
    topic.value = 'hiking';
    expect(getContactsFocus()).toEqual({ label: '♡ Hiking', peerIds: ['carol', 'bob'] });
    // A tag someone sent me that I never answered is a topic too.
    topic.value = 'Books';
    expect(getContactsFocus()?.peerIds.sort()).toEqual(['bob', 'carol']);
  });

  it('person tags open the people who like each tag, my shared answers on Me, and our Talks', () => {
    const container = document.createElement('div');
    renderPeerTagsInto(container, 'carol', 'Carol');
    const chips = container.querySelectorAll<HTMLElement>('[data-testid="tag-graph-chip"]');
    expect(Array.from(chips).map((chip) => `${chip.dataset.topic}:${chip.dataset.shared ?? ''}`)).toEqual(['Hiking:true', 'Books:']);

    chips[0]!.click();
    expect((document.getElementById('contacts-filter-topic') as HTMLInputElement).value).toBe('Hiking');
    expect(getContactsFocus()?.peerIds).toEqual(['carol', 'bob']);

    container.querySelector<HTMLElement>('[data-testid="peer-shared-tags-link"]')!.click();
    expect(getMeFocus()).toEqual({ label: '♡ Carol', talkIds: ['qa_hike'] });

    container.querySelector<HTMLElement>('[data-testid="peer-talks-link"]')!.click();
    expect(getTalksFocus()).toEqual({ label: '💬 Carol', peerId: 'carol', talkIds: ['qa_hike'] });
  });
});

describe('a tag I like is mine whether or not I share it (OPEN-113)', () => {
  const tag = (id: string) => ({ id, type: 'tag', title: id });
  it('counts a liked copy that is still private, and a private tag I created and checked', () => {
    expect(likesMyTag({ role: 'copied', disabled: true, outcome: 'match', completedAnswers: [{}], fullTalk: tag('a') })).toBe(true);
    expect(likesMyTag({ role: 'created', disabled: true, likesTag: true, fullTalk: tag('b') })).toBe(true);
  });
  it('does not count a tag I left unchecked, a passed copy, or a bare copy switched off', () => {
    expect(likesMyTag({ role: 'created', disabled: true, likesTag: false, fullTalk: tag('c') })).toBe(false);
    expect(likesMyTag({ role: 'copied', outcome: 'mismatch', completedAnswers: [{}], fullTalk: tag('d') })).toBe(false);
    expect(likesMyTag({ role: 'copied', disabled: true, fullTalk: tag('e') })).toBe(false);
  });
});

describe('a tag shows its popularity on Talks and Me (OPEN-113)', () => {
  const tagTalk = (id: string, title: string) => ({ id, type: 'tag', title, questions: [{ id: 'q_0', text: title, answers: [{ id: 'm', text: title, isMatch: true }] }] });
  const ex = (peerId: string, talkId: string, title: string, outcome: string) => ({ peerId, peerName: peerId, talkId, type: 'tag', title, outcome });
  afterEach(() => {
    invalidateTagPopularity();
    configureTagGraphView({ graphInput: () => ({ currentUserId: '', incoming: [], myTalks: {}, exchanges: {} }), t: (key) => key });
  });

  it('"#rank · ✕ passes" with the counts in data attributes; nothing for a tag nobody rated', () => {
    configureTagGraphView({
      graphInput: () => ({
        currentUserId: 'me',
        incoming: [],
        myTalks: { hike: { role: 'created', likesTag: true, fullTalk: tagTalk('hike', 'Hiking') }, lone: { role: 'created', likesTag: true, fullTalk: tagTalk('lone', 'Lone') } },
        exchanges: { a: ex('ann', 'hike', 'Hiking', 'match'), b: ex('ben', 'hike', 'Hiking', 'mismatch') },
      }),
      t: (key) => key,
    });
    invalidateTagPopularity();
    const deps = { escapeHtml: (text: string) => text, text: (key: string) => (key === 'tagPopularityTitle' ? '{likes}/{passes}/{rank}' : key) } as any;
    const html = popularityHtml(['hike'], deps);
    expect(html).toContain('#1 · ✕ 1');
    expect(html).toContain('data-likes="1" data-passes="1" data-rank="1"');
    expect(html).toContain('title="1/1/1"');
    expect(popularityHtml(['lone'], deps)).toBe('');
  });
});

describe('buildTagGraph: a row\'s Talk ids', () => {
  it('reads the ids from talkIds keys, so tags that came in the same instant stay apart', () => {
    // Browser starter-tags (2026-11-22): talkIds maps id → arrival time; reading the values made two
    // tags with one arrival time one node, and Contacts counted a tag in common too many.
    const at = '2026-11-22T23:00:00.000Z';
    const graph = buildTagGraph({
      currentUserId: 'me',
      incoming: [
        { ...tagCluster('qa_hero', '🦸 Superhero movies', { dee: 'Dee' }), talkIds: { t_hero: at } },
        { ...tagCluster('qa_cats', '🐱 Cats', { eli: 'Eli' }), talkIds: { t_cats: at } },
      ],
      myTalks: { qa_hero: { role: 'copied', fullTalk: { id: 'qa_hero', type: 'tag', title: '🦸 Superhero movies' } } },
      exchanges: {},
    });
    expect(graph.tags.size).toBe(2);
    expect(sharedTagCount(graph, 'eli')).toBe(0);
    expect(sharedTagCount(graph, 'dee')).toBe(1);
    expect(graph.byId.get('t_cats')?.label).toBe('🐱 Cats');
    expect(graph.byId.has(at)).toBe(false);
  });
});
