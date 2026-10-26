/** @jest-environment jsdom */
/** OPEN-91 P3: keyed collections in the device core, and the GUI's view of one. */
import { createCoreHandler } from '../../core/core-handler';
import { CollectionStore } from '../../core/collections';
import { memoryGraphStore } from '../../core/graph-store';
import { CoreCollectionView, type CollectionCoreLink } from '../../web/services/core-collection-view';
import { getChatbotTemplate, saveChatbotTemplate } from '../../web/ui/ui-settings-storage';
import { chatbotTemplatesView, talkLedgerView } from '../../web/services/core-views';
import { loadTalkLedger, saveTalkLedger } from '../../web/services/web-talk-ledger-store';

const linkTo = (handle: ReturnType<typeof createCoreHandler>): CollectionCoreLink => ({
  snapshot: (collection) => handle({ name: 'collection.snapshot', collection }) as Promise<Record<string, unknown>>,
  upsert: (collection, entries) => handle({ name: 'collection.upsert', collection, entries }),
  remove: (collection, keys) => handle({ name: 'collection.remove', collection, keys }),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('collections in the device core', () => {
  it('keeps one node per entry under local/collections, keys with slashes included, and refuses unknown names', async () => {
    const store = memoryGraphStore();
    const collections = new CollectionStore(store);
    await collections.upsert('chatbotTemplates', { 'talk/1': { answers: [1] }, t2: { answers: [] } });
    expect(await collections.all('chatbotTemplates')).toEqual({ 'talk/1': { answers: [1] }, t2: { answers: [] } });
    expect(await store.childKeys('local/collections/chatbotTemplates')).toHaveLength(2);
    await collections.remove('chatbotTemplates', ['talk/1']);
    expect(Object.keys(await collections.all('chatbotTemplates'))).toEqual(['t2']);
    await expect(collections.all('typo')).rejects.toThrow('Unknown core collection');
  });
});

describe('a fresh device', () => {
  it('answers snapshots as empty without asking storage, until the first write', async () => {
    const store = memoryGraphStore();
    const childKeys = jest.spyOn(store, 'childKeys');
    const handle = createCoreHandler(store, { freshDevice: true });
    expect(await handle({ name: 'collection.snapshot', collection: 'myTalks' })).toEqual({});
    expect(await handle({ name: 'exchanges.snapshot' })).toEqual([]);
    expect(childKeys).not.toHaveBeenCalled();
    await handle({ name: 'collection.upsert', collection: 'myTalks', entries: { t1: { role: 'created' } } });
    expect(await handle({ name: 'collection.snapshot', collection: 'myTalks' })).toEqual({ t1: { role: 'created' } });
  });

  it('a collection never written reads as empty from its parent listing alone', async () => {
    const store = memoryGraphStore();
    await new CollectionStore(store).upsert('myTalks', { t1: {} });
    const childKeys = jest.spyOn(store, 'childKeys');
    expect(await new CollectionStore(store).all('chatbotTemplates')).toEqual({});
    expect(childKeys).toHaveBeenCalledTimes(1);
  });
});

describe('the GUI’s view of a collection', () => {
  beforeEach(() => localStorage.clear());

  it('imports the old blob once, loads the core, and sends changes to it', async () => {
    localStorage.setItem('chatbotTemplates', JSON.stringify({ old: { answers: ['a'], talkData: {} } }));
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'collection.upsert', collection: 'chatbotTemplates', entries: { stored: { answers: ['s'], talkData: {} } } });
    const view = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    await view.connect(linkTo(handle));
    expect(localStorage.getItem('chatbotTemplates')).toBeNull();
    expect(Object.keys(view.all()).sort()).toEqual(['old', 'stored']);
    view.set({ fresh: { answers: ['f'] } });
    view.remove(['stored']);
    await flush();
    expect(Object.keys(await handle({ name: 'collection.snapshot', collection: 'chatbotTemplates' }) as object).sort()).toEqual(['fresh', 'old']);
    expect(localStorage.getItem('iinpublic_core_unsaved_chatbotTemplates_v1')).toBeNull();
  });

  it('keeps unconfirmed changes, removals included, and applies them over the core at the next start', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    await handle({ name: 'collection.upsert', collection: 'chatbotTemplates', entries: { gone: { answers: [] }, kept: { answers: ['old'] } } });
    const stalled: CollectionCoreLink = { ...linkTo(handle), upsert: () => new Promise(() => undefined), remove: () => new Promise(() => undefined) };
    const before = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    await before.connect(stalled);
    before.set({ kept: { answers: ['new'] } });
    before.remove(['gone']);

    const after = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    await after.connect(linkTo(handle));
    expect(after.all()).toEqual({ kept: { answers: ['new'] } });
    await flush();
    expect(await handle({ name: 'collection.snapshot', collection: 'chatbotTemplates' })).toEqual({ kept: { answers: ['new'] } });
    expect(localStorage.getItem('iinpublic_core_unsaved_chatbotTemplates_v1')).toBeNull();
  });

  it('shows unconfirmed changes from the first read, before the core answers', () => {
    const before = new CoreCollectionView<{ answers: string[] }>('myTalks', 'myTalks');
    before.set({ t1: { answers: ['mine'] } });
    // A fresh view (a reload, or a second module instance) has not connected yet.
    const after = new CoreCollectionView<{ answers: string[] }>('myTalks', 'myTalks');
    expect(after.get('t1')).toEqual({ answers: ['mine'] });
  });

  it('the talk ledger: the old document is imported as one entry per record; a save writes changes and evictions', () => {
    localStorage.setItem('talkLedger', JSON.stringify({ version: 1, outcomes: { 'r::t::a': { outcome: 'match' } }, exchanged: { 'p::k': { version: 1 } }, edges: {}, retracted: {} }));
    expect(loadTalkLedger().outcomes['r::t::a']).toEqual({ outcome: 'match' });
    expect(Object.keys(talkLedgerView.all()).sort()).toEqual(['exchanged::p::k', 'outcomes::r::t::a']);
    const doc = loadTalkLedger();
    doc.exchanged['p::k'] = { version: 2 } as never;
    delete doc.outcomes['r::t::a'];
    doc.sent['p::k2'] = { at: 1 } as never;
    saveTalkLedger(doc);
    expect(talkLedgerView.all()).toEqual({ 'exchanged::p::k': { version: 2 }, 'sent::p::k2': { at: 1 } });
    // Loads are copies: changing one never changes the view.
    loadTalkLedger().exchanged['p::k'].version = 9;
    expect(loadTalkLedger().exchanged['p::k'].version).toBe(2);
  });

  it('chatbot templates are kept by Talk id and content id', async () => {
    await chatbotTemplatesView.connect(linkTo(createCoreHandler(memoryGraphStore())));
    const talkData = { title: 'Pizza', type: 'tag', questions: [{ id: 'q1', text: 'Pizza?', answers: [{ id: 'a', text: 'Yes' }] }] };
    saveChatbotTemplate('talk-1', { answers: [{ questionId: 'q1', answerId: 'a' }], talkData } as never);
    expect(getChatbotTemplate('talk-1')?.talkData).toEqual(talkData);
    expect(Object.keys(chatbotTemplatesView.all()).length).toBeGreaterThanOrEqual(1);
    expect(localStorage.getItem('chatbotTemplates')).toBeNull();
  });
});
