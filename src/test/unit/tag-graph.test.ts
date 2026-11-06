/** @jest-environment jsdom */
/** OPEN-87 S4: the person↔tag graph from local data, and the tag page / directory / person tags. */
import { buildTagGraph, likersOfTag, sharedTagCount, tagDirectory, tagsOfPeer } from '../../core/tag-graph';
import { configureTagGraphView, renderPeerTagsInto } from '../../web/ui/tag-graph-view';
import { clearContactsFocus, clearMeFocus, clearTalksFocus, getContactsFocus, getMeFocus, getTalksFocus, peopleWhoLike } from '../../web/ui/graph-focus';
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
