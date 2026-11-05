/** @jest-environment jsdom */
/** OPEN-91 P3: keyed collections in the device core, and the GUI's view of one. */
import { createCoreHandler } from '../../core/core-handler';
import { CollectionStore } from '../../core/collections';
import { memoryGraphStore } from '../../core/graph-store';
import { CoreCollectionView, type CollectionCoreLink } from '../../web/services/core-collection-view';
import { getChatbotTemplate, saveChatbotTemplate } from '../../web/ui/ui-settings-storage';
import { chatbotTemplatesView } from '../../web/services/core-views';

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
    // Entries sit in bucket nodes, never all in the collection's own node.
    const buckets = await store.childKeys('local/collections/chatbotTemplates');
    expect(buckets.every((b) => /^bucket-[0-9a-f]$/.test(b))).toBe(true);
    await collections.remove('chatbotTemplates', ['talk/1']);
    expect(Object.keys(await collections.all('chatbotTemplates'))).toEqual(['t2']);
    await expect(collections.all('typo')).rejects.toThrow('Unknown core collection');
  });

  it('no node lists more than a few thousand entries, however many a collection holds', async () => {
    const store = memoryGraphStore();
    const collections = new CollectionStore(store);
    await collections.upsert('myTalks', Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`talk-${i}`, { i }])));
    const buckets = await store.childKeys('local/collections/myTalks');
    expect(buckets.length).toBeLessThanOrEqual(16);
    for (const bucket of buckets) expect((await store.childKeys(`local/collections/myTalks/${bucket}`)).length).toBeLessThan(2_000);
    expect(Object.keys(await collections.all('myTalks'))).toHaveLength(20_000);
  });

  it('a read copy follows every write, through any CollectionStore over the same storage', async () => {
    const store = memoryGraphStore();
    const a = new CollectionStore(store);
    const b = new CollectionStore(store);
    await a.upsert('myTalks', { t1: { v: 1 } });
    expect(await a.all('myTalks')).toEqual({ t1: { v: 1 } });
    const reads = jest.spyOn(store, 'get');
    await b.upsert('myTalks', { t2: { v: 2 } });
    await b.remove('myTalks', ['t1']);
    expect(await a.all('myTalks')).toEqual({ t2: { v: 2 } });
    expect(await a.get('myTalks', 't2')).toEqual({ v: 2 });
    expect(reads).not.toHaveBeenCalled(); // answered from the copy
    // Reads hand out copies: changing one changes nothing stored.
    ((await a.all('myTalks')).t2 as { v: number }).v = 9;
    expect(await b.get('myTalks', 't2')).toEqual({ v: 2 });
  });

  it('erases entries left in the layout before buckets, and keeps the bucketed ones', async () => {
    const store = memoryGraphStore();
    const collections = new CollectionStore(store);
    await collections.upsert('settings', { theme: 'dark' });
    await store.put('local/collections/settings/old-flat-key', { key: 'old-flat-key', json: '"x"' });
    expect(await collections.eraseRetired()).toBe(1);
    expect(await collections.all('settings')).toEqual({ theme: 'dark' });
    expect(await store.childKeys('local/collections/settings')).not.toContain('old-flat-key');
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

  it('refreshes a stale view without replacing a local edit made during the snapshot request', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    const base = linkTo(handle);
    let pause = false;
    let release!: () => void;
    let started!: () => void;
    const captured = new Promise<void>((resolve) => { started = resolve; });
    const link: CollectionCoreLink = { ...base, snapshot: async (collection) => {
      const snapshot = await base.snapshot(collection);
      if (pause) {
        pause = false;
        started();
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return snapshot;
    } };
    const view = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    await view.connect(link);
    await handle({ name: 'collection.upsert', collection: 'chatbotTemplates', entries: { remote: { answers: ['remote'] } } });
    pause = true;
    const refreshing = view.refresh();
    await captured;
    view.set({ mine: { answers: ['mine'] } });
    await view.flush();
    release();
    await refreshing;
    expect(view.all()).toEqual({ remote: { answers: ['remote'] }, mine: { answers: ['mine'] } });
  });

  it('keeps a failed local edit visible during refresh without overwriting the host', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    const base = linkTo(handle);
    const unavailable = true;
    const link: CollectionCoreLink = { ...base, upsert: (collection, entries) => unavailable
      ? Promise.reject(new Error('owner died before acknowledgement'))
      : base.upsert(collection, entries) };
    const view = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    await view.connect(link);
    view.set({ mine: { answers: ['mine'] } });
    await expect(view.flush()).rejects.toThrow('unsaved changes remain');
    await view.refresh();
    expect(view.get('mine')).toEqual({ answers: ['mine'] });
    expect(await base.snapshot('chatbotTemplates')).toEqual({});
  });

  it('does not mistake another tab’s recovery journal for a confirmed host update', async () => {
    const handle = createCoreHandler(memoryGraphStore());
    const base = linkTo(handle);
    const first = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    const second = new CoreCollectionView<{ answers: string[] }>('chatbotTemplates', 'chatbotTemplates');
    await first.connect({ ...base, upsert: () => Promise.reject(new Error('owner unavailable')) });
    await second.connect(base);
    first.set({ pending: { answers: ['not yet committed'] } });
    await expect(first.flush()).rejects.toThrow('unsaved changes remain');
    await second.refresh();
    expect(first.get('pending')).toEqual({ answers: ['not yet committed'] });
    expect(second.get('pending')).toBeUndefined();
  });

  it('shows unconfirmed changes from the first read, before the core answers', () => {
    const before = new CoreCollectionView<{ answers: string[] }>('myTalks', 'myTalks');
    before.set({ t1: { answers: ['mine'] } });
    // A fresh view (a reload, or a second module instance) has not connected yet.
    const after = new CoreCollectionView<{ answers: string[] }>('myTalks', 'myTalks');
    expect(after.get('t1')).toEqual({ answers: ['mine'] });
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
