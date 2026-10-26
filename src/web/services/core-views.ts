/**
 * The GUI's views of the device core's collections (OPEN-91 P3), one per log that left
 * localStorage. `connectCoreCollections` loads them all once the core is up.
 */
import type { FlatAnswerHistoryRecord } from '../ui/answer-history-storage';
import type { MyTalkEntry } from '../ui/my-talks-storage';
import type { ChatbotTemplate } from '../ui/ui-settings-storage';
import { CoreCollectionView, type CollectionCoreLink } from './core-collection-view';

/** Answer templates the chatbot reuses, by Talk id (and content id). Old key: `chatbotTemplates`. */
export const chatbotTemplatesView = new CoreCollectionView<ChatbotTemplate>('chatbotTemplates', 'chatbotTemplates');

/** My Talks — created, answered, copied, ignored — by Talk id. Old key: `myTalks`. */
export const myTalksView = new CoreCollectionView<MyTalkEntry>('myTalks', 'myTalks');

/** My Conversations, by conversation id. Old key: `myConversations`. */
export const myConversationsView = new CoreCollectionView<Record<string, unknown>>('myConversations', 'myConversations');

/** Sections of the old talk ledger document, each entry kept as `<section>::<key>`. */
export const TALK_LEDGER_SECTIONS = ['outcomes', 'exchanged', 'edges', 'retracted', 'sent'] as const;

/** The talk ledger (outcomes, exchanged, edge counters, retractions, sent), one entry per record. Old key: `talkLedger`. */
export const talkLedgerView = new CoreCollectionView<unknown>('talkLedger', 'talkLedger', (parsed) => {
  const doc = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const entries: Record<string, unknown> = {};
  for (const section of TALK_LEDGER_SECTIONS) {
    const records = doc[section];
    if (records && typeof records === 'object') for (const [key, value] of Object.entries(records)) entries[`${section}::${key}`] = value;
  }
  return entries;
});

/** The Me tab's answer history, by record id. Old key: `myAnswerHistory`. */
export const answerHistoryView = new CoreCollectionView<FlatAnswerHistoryRecord>('myAnswerHistory', 'myAnswerHistory');

const VIEWS: Array<CoreCollectionView<unknown>> = [chatbotTemplatesView, myTalksView, myConversationsView, talkLedgerView, answerHistoryView] as Array<CoreCollectionView<unknown>>;

export async function connectCoreCollections(link: CollectionCoreLink): Promise<void> {
  await Promise.all(VIEWS.map((view) => view.connect(link)));
}

export function resetCoreViewsForTests(): void {
  for (const view of VIEWS) view.resetForTests();
}

/**
 * Tests and diagnostics reach a collection from the page: `window.__iinpublic_collection('myTalks')`
 * reads it (the old blob's shape); `window.__iinpublic_collection_edit('myTalks', { remove: [id] })`
 * changes it (`set`, `remove`, `clear`) as the app would.
 */
if (typeof window !== 'undefined') {
  const find = (name: string): CoreCollectionView<unknown> | undefined => VIEWS.find((view) => view.collection === name);
  Object.assign(window, {
    __iinpublic_collection: (name: string) => find(name)?.all() ?? {},
    __iinpublic_collection_edit: (name: string, edit: { set?: Record<string, unknown>; remove?: string[]; clear?: boolean }) => {
      const view = find(name);
      if (!view) return;
      if (edit.clear) view.remove(Object.keys(view.all()));
      if (edit.remove) view.remove(edit.remove);
      if (edit.set) view.set(edit.set);
    },
  });
}
