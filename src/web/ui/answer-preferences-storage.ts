export type AnswerPreferenceEntry = {
  answerId: string;
  answerText: string;
  /** Atomic checked set for a context-matched multi-select question. */
  answerIds?: string[];
  answerTexts?: string[];
  mode: string;
  language?: string;
  talkId?: string;
  questionText?: string;
  allAnswers?: any[];
  timestamp?: string;
  flatKey?: string;
  /** Version-2 rolling context that includes this question and its complete choice set. */
  contextHash?: string;
  contextVersion?: number;
  /** Explicit broad contract metadata; separate from the exact rolling-context hash. */
  questionDefaultKey?: string;
  answerIdentityHash?: string;
  /** Used to keep single-answer contracts out of multi-select question management. */
  answerSelectionMode?: string;
};

import {
  createEmptyExactChatbotMemoryState,
  type ExactChatbotMemoryState,
} from '../../shared/exact-chatbot-memory';
import {
  createEmptyTypedPreferenceState,
  type TypedPreferenceState,
} from '../../shared/typed-preference-store';
import {
  createEmptyTagOppositePairRegistryState,
  type TagOppositePairRegistryState,
} from '../../shared/tag-opposite-pairs';
import { normalizeQuestionKey } from '../../shared/user-utils';
import {
  type QuestionDefaultContract,
  type QuestionDefaultContractMap,
} from '../../shared/question-default-contracts';
import { mapStore, sectionedDocStore, type CoreCollectionView } from '../services/core-collection-view';
import {
  answeredTalkByContentView,
  answerPreferencesView,
  EXACT_CHATBOT_MEMORY_SECTIONS,
  exactChatbotMemoryView,
  flattenedAnswerPreferencesView,
  myQuestionAnswersView,
  questionDefaultContractsView,
  tagOppositePairRegistryView,
  typedPreferenceStateView,
} from '../services/core-views';

export type AnswerPreferenceMap = Record<string, AnswerPreferenceEntry>;

export type MyQuestionAnswerEntry = {
  questionText: string;
  answerId: string;
  answerText: string;
  isIgnored: boolean;
  timestamp: string;
  location?: string;
};

// These live in the device core (OPEN-91 P3, `core-views.ts`), one entry per record; each was one
// localStorage JSON value rewritten whole on every answer. Reads are copies; writes send changes.
const stores = {
  answeredTalkByContent: mapStore(answeredTalkByContentView),
  answerPreferences: mapStore(answerPreferencesView as CoreCollectionView<AnswerPreferenceEntry>),
  flattenedAnswerPreferences: mapStore(flattenedAnswerPreferencesView as CoreCollectionView<AnswerPreferenceEntry>),
  questionDefaultContracts: mapStore(questionDefaultContractsView as CoreCollectionView<QuestionDefaultContract>),
  myQuestionAnswers: mapStore(myQuestionAnswersView as CoreCollectionView<MyQuestionAnswerEntry>),
  exactChatbotMemory: sectionedDocStore(exactChatbotMemoryView, EXACT_CHATBOT_MEMORY_SECTIONS, createEmptyExactChatbotMemoryState),
  typedPreferenceState: sectionedDocStore(typedPreferenceStateView, ['users'], createEmptyTypedPreferenceState),
  tagOppositePairRegistry: sectionedDocStore(tagOppositePairRegistryView, ['pairs'], createEmptyTagOppositePairRegistryState),
};

export function getAnsweredTalkByContent(): Record<string, string> {
  return stores.answeredTalkByContent.get();
}

export function setAnsweredTalkByContent(map: Record<string, string>): void {
  stores.answeredTalkByContent.set(map);
}

export function getAnswerPreferences(): AnswerPreferenceMap {
  return stores.answerPreferences.get();
}

export function setAnswerPreferences(map: AnswerPreferenceMap): void {
  stores.answerPreferences.set(map);
}

export function getFlattenedAnswerPreferences(): AnswerPreferenceMap {
  return stores.flattenedAnswerPreferences.get();
}

export function setFlattenedAnswerPreferences(map: AnswerPreferenceMap): void {
  stores.flattenedAnswerPreferences.set(map);
}

export function getQuestionDefaultContracts(): QuestionDefaultContractMap {
  return stores.questionDefaultContracts.get();
}

export function setQuestionDefaultContracts(map: QuestionDefaultContractMap): void {
  stores.questionDefaultContracts.set(map);
}

export function clearAnswerPreferences(): void {
  for (const view of [answerPreferencesView, flattenedAnswerPreferencesView, exactChatbotMemoryView, typedPreferenceStateView,
    tagOppositePairRegistryView, questionDefaultContractsView]) {
    view.remove(Object.keys(view.all()));
  }
}

export function getExactChatbotMemory(): ExactChatbotMemoryState {
  return stores.exactChatbotMemory.get();
}

export function setExactChatbotMemory(value: ExactChatbotMemoryState): void {
  stores.exactChatbotMemory.set(value);
}

/** §BB / spec §30.2: local persistence for `typed-preference-store.ts`'s pure state, mirroring
 *  `getExactChatbotMemory`/`setExactChatbotMemory` above. */
export function getTypedPreferenceState(): TypedPreferenceState {
  return stores.typedPreferenceState.get();
}

export function setTypedPreferenceState(value: TypedPreferenceState): void {
  stores.typedPreferenceState.set(value);
}

/** docs/TODO.md §BB — local persistence for user-created opposite-tag pairs, mirroring
 *  `getTypedPreferenceState`/`setTypedPreferenceState` above. Holds only pairs the author
 *  themselves typed (diverging from the app-predefined seed registry in
 *  `tag-opposite-pairs.ts`), never the seed pairs themselves — callers merge the two at
 *  read time, keeping storage limited to genuinely user-created deltas. */
export function getTagOppositePairRegistryState(): TagOppositePairRegistryState {
  return stores.tagOppositePairRegistry.get();
}

export function setTagOppositePairRegistryState(value: TagOppositePairRegistryState): void {
  stores.tagOppositePairRegistry.set(value);
}

export function getMyQuestionAnswers(): Record<string, MyQuestionAnswerEntry> {
  return stores.myQuestionAnswers.get();
}

export function setMyQuestionAnswer(key: string, value: MyQuestionAnswerEntry): void {
  const all = getMyQuestionAnswers();
  all[key] = value;
  stores.myQuestionAnswers.set(all);
}

/**
 * Called when a user completes a talk: saves each question-answer to `myQuestionAnswers`
 * (keyed by normalized question text; last wins). `refreshAnswersListIfOpen` lets the caller
 * re-render the Me-tab Answers list only when it's the currently active view.
 */
export function saveQuestionAnswersFromCompletion(
  talkData: { questions?: Array<{ id: string; text?: string }> },
  answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
  location: { latitude: number; longitude: number } | undefined,
  refreshAnswersListIfOpen: () => void,
): void {
  const locationStr = location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : undefined;
  const timestamp = new Date().toISOString();
  const questions = talkData.questions || [];
  for (const a of answers) {
    const q = questions.find((qu: any) => qu.id === a.questionId);
    const questionText = q?.text?.trim() || '';
    if (!questionText) continue;
    const key = normalizeQuestionKey(questionText);
    const isIgnored = a.answerText === 'ignore' || !a.answerText;
    const entry: MyQuestionAnswerEntry = {
      questionText,
      answerId: a.answerId,
      answerText: isIgnored ? '' : (a.answerText || ''),
      isIgnored,
      timestamp,
    };
    if (locationStr != null) entry.location = locationStr;
    setMyQuestionAnswer(key, entry);
  }
  const meView = document.getElementById('me-view');
  if (meView?.classList.contains('active')) {
    refreshAnswersListIfOpen();
  }
}
