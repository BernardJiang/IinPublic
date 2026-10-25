/** @jest-environment jsdom */
/** OPEN-87 S4: the person↔tag graph from local data, and the tag page / directory / person tags. */
import { buildTagGraph, likersOfTag, sharedTagCount, tagDirectory, tagsOfPeer } from '../../web/services/tag-graph';
import { configureTagGraphView, openTagDirectory, openTagPage, renderPeerTagsInto } from '../../web/ui/tag-graph-view';
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
      { key: 'qa_hike', label: '🥾 Hiking', shared: true },
      { key: 'qa_books', label: '📚 Books', shared: false },
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
  const openPerson = jest.fn();
  beforeEach(() => {
    document.body.innerHTML = '';
    openPerson.mockReset();
    configureTagGraphView({
      graphInput: () => input, openPerson, t: (key) => key,
      peerName: (peerId, fallback) => (peerId === 'bob' ? 'Bob Live' : fallback),
    });
  });

  it('opens a tag page, then a person from it', () => {
    openTagPage('qa_hike');
    const rows = document.querySelectorAll<HTMLElement>('[data-testid="tag-page-person"]');
    expect(rows).toHaveLength(2);
    // The best known name wins over the one stored with the tag.
    expect(Array.from(rows).map((row) => row.dataset.userName)).toContain('Bob Live');
    expect(document.querySelector('[data-testid="tag-page-mine"]')?.textContent).toBe('tagPageInMyTags');
    rows[0]!.click();
    expect(openPerson).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="tag-page-modal"]')).toBeNull();
  });

  it('goes from the directory to a tag page, and from person tags to a tag page', () => {
    openTagDirectory();
    const search = document.querySelector<HTMLInputElement>('[data-testid="tag-directory-search"]')!;
    search.value = 'book';
    search.dispatchEvent(new Event('input'));
    const chips = document.querySelectorAll<HTMLElement>('[data-testid="tag-directory-list"] [data-tag-key]');
    expect(Array.from(chips).map((chip) => chip.dataset.tagKey)).toEqual(['qa_books']);
    chips[0]!.click();
    expect(document.querySelector('#tag-page-modal-title')?.textContent).toBe('📚 Books');

    const container = document.createElement('div');
    renderPeerTagsInto(container, 'bob');
    const peerChips = container.querySelectorAll<HTMLElement>('[data-testid="tag-graph-chip"]');
    expect(Array.from(peerChips).map((chip) => chip.dataset.shared ?? '')).toEqual(['true', '']);
    peerChips[0]!.click();
    expect(document.querySelector('#tag-page-modal-title')?.textContent).toBe('🥾 Hiking');
  });
});
