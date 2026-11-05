import {
  createEmptyTagOppositePairRegistryState,
  type TagOppositePairRegistryState,
} from '../../shared/tag-opposite-pairs';
import { sectionedDocStore } from '../services/core-collection-view';
import { tagOppositePairRegistryView } from '../services/core-views';

/**
 * What answering keeps outside the device graph: the opposite-tag pairs I typed myself ("already
 * answered" is derived from My Talks, `answered-talks.ts`). The chatbot's answers are the graph's (OPEN-106 step 2e v,
 * `graph-chatbot.ts`); its old collections are erased at start (`collection.eraseRetired`).
 */
const stores = {
  tagOppositePairRegistry: sectionedDocStore(tagOppositePairRegistryView, ['pairs'], createEmptyTagOppositePairRegistryState),
};

/** docs/TODO.md §BB — local persistence for user-created opposite-tag pairs. Holds only pairs the
 *  author themselves typed (diverging from the app-predefined seed registry in
 *  `tag-opposite-pairs.ts`), never the seed pairs themselves — callers merge the two at read time. */
export function getTagOppositePairRegistryState(): TagOppositePairRegistryState {
  return stores.tagOppositePairRegistry.get();
}

export function setTagOppositePairRegistryState(value: TagOppositePairRegistryState): void {
  stores.tagOppositePairRegistry.set(value);
}
