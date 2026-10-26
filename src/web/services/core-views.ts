/**
 * The GUI's views of the device core's collections (OPEN-91 P3), one per log that left
 * localStorage. `connectCoreCollections` loads them all once the core is up.
 */
import type { FlatAnswerHistoryRecord } from '../ui/answer-history-storage';
import type { MyTalkEntry } from '../ui/my-talks-storage';
import type { ChatbotTemplate } from '../ui/ui-settings-storage';
import { CoreCollectionView, sectionEntries, type CollectionCoreLink } from './core-collection-view';

/** Answer templates the chatbot reuses, by Talk id (and content id). Old key: `chatbotTemplates`. */
export const chatbotTemplatesView = new CoreCollectionView<ChatbotTemplate>('chatbotTemplates', 'chatbotTemplates');

/** My Talks — created, answered, copied, ignored — by Talk id. Old key: `myTalks`. */
export const myTalksView = new CoreCollectionView<MyTalkEntry>('myTalks', 'myTalks');

/** My Conversations, by conversation id. Old key: `myConversations`. */
export const myConversationsView = new CoreCollectionView<Record<string, unknown>>('myConversations', 'myConversations');

/** Sections of the old talk ledger document, each entry kept as `<section>::<key>`. */
export const TALK_LEDGER_SECTIONS = ['outcomes', 'exchanged', 'edges', 'retracted', 'sent'] as const;

/** The talk ledger (outcomes, exchanged, edge counters, retractions, sent), one entry per record. Old key: `talkLedger`. */
export const talkLedgerView = new CoreCollectionView<unknown>('talkLedger', 'talkLedger', (parsed) => sectionEntries(TALK_LEDGER_SECTIONS, parsed));

/** The Me tab's answer history, by record id. Old key: `myAnswerHistory`. */
export const answerHistoryView = new CoreCollectionView<FlatAnswerHistoryRecord>('myAnswerHistory', 'myAnswerHistory');

/** The deal-eligible Talk of mine each conversation formed through. Old key: `myDealTalkByConversation`. */
export const dealTalkByConversationView = new CoreCollectionView<string>('dealTalkByConversation', 'myDealTalkByConversation');

/** The content-hash "need" each deal-eligible conversation formed through. Old key: `conversationNeedKeyByConversation`. */
export const needKeyByConversationView = new CoreCollectionView<string>('needKeyByConversation', 'conversationNeedKeyByConversation');

// Answer preferences and chatbot memory (answer-preferences-storage.ts), same names as the old keys.
export const answeredTalkByContentView = new CoreCollectionView<string>('answeredTalkByContent', 'answeredTalkByContent');
export const answerPreferencesView = new CoreCollectionView<unknown>('answerPreferences', 'answerPreferences');
export const flattenedAnswerPreferencesView = new CoreCollectionView<unknown>('flattenedAnswerPreferences', 'flattenedAnswerPreferences');
export const questionDefaultContractsView = new CoreCollectionView<unknown>('questionDefaultContracts', 'questionDefaultContracts');
export const myQuestionAnswersView = new CoreCollectionView<unknown>('myQuestionAnswers', 'myQuestionAnswers');
export const EXACT_CHATBOT_MEMORY_SECTIONS = ['users', 'questions', 'answers'] as const;
export const exactChatbotMemoryView = new CoreCollectionView<unknown>('exactChatbotMemory', 'exactChatbotMemory',
  (parsed) => sectionEntries(EXACT_CHATBOT_MEMORY_SECTIONS, parsed));
export const typedPreferenceStateView = new CoreCollectionView<unknown>('typedPreferenceState', 'typedPreferenceState',
  (parsed) => sectionEntries(['users'], parsed));
export const tagOppositePairRegistryView = new CoreCollectionView<unknown>('tagOppositePairRegistry', 'tagOppositePairRegistry',
  (parsed) => sectionEntries(['pairs'], parsed));

/** OPEN-45: the revision of each authored Talk each peer last took, by `<peer>::<talk>`. Old key: `iinpublic_talk_revision_sent_v1`. */
export const talkRevisionSentView = new CoreCollectionView<{ revision: string; at: number }>('talkRevisionSent', 'iinpublic_talk_revision_sent_v1');

/**
 * Smaller app data, one entry per former localStorage key, its value the same string
 * (`core-storage.ts`). No blob of its own to import: each key migrates when first read.
 */
export const appDataView = new CoreCollectionView<string>('appData', 'iinpublic_core_app_data_no_legacy_blob');

/** Settings and UI state, one entry per key; localStorage keeps a start-up copy (`core-storage.ts`). */
export const settingsView = new CoreCollectionView<string>('settings', 'iinpublic_core_settings_no_legacy_blob');

const VIEWS: Array<CoreCollectionView<unknown>> = [
  chatbotTemplatesView, myTalksView, myConversationsView, talkLedgerView, answerHistoryView,
  dealTalkByConversationView, needKeyByConversationView,
  answeredTalkByContentView, answerPreferencesView, flattenedAnswerPreferencesView, questionDefaultContractsView,
  myQuestionAnswersView, exactChatbotMemoryView, typedPreferenceStateView, tagOppositePairRegistryView,
  talkRevisionSentView, appDataView, settingsView,
] as Array<CoreCollectionView<unknown>>;

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
