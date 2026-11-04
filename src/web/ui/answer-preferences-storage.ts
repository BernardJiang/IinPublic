import {
  createEmptyTagOppositePairRegistryState,
  type TagOppositePairRegistryState,
} from '../../shared/tag-opposite-pairs';
import { mapStore, sectionedDocStore } from '../services/core-collection-view';
import { answeredTalkByContentView, tagOppositePairRegistryView } from '../services/core-views';

/**
 * What answering keeps outside the device graph: which Talk I answered for a content id, and the
 * opposite-tag pairs I typed myself. The chatbot's answers are the graph's (OPEN-106 step 2e v,
 * `graph-chatbot.ts`); its old collections are erased at start (`collection.eraseRetired`).
 */
const stores = {
  answeredTalkByContent: mapStore(answeredTalkByContentView),
  tagOppositePairRegistry: sectionedDocStore(tagOppositePairRegistryView, ['pairs'], createEmptyTagOppositePairRegistryState),
};

export function getAnsweredTalkByContent(): Record<string, string> {
  return stores.answeredTalkByContent.get();
}

export function setAnsweredTalkByContent(map: Record<string, string>): void {
  stores.answeredTalkByContent.set(map);
}

/** The Talk answered for this content id, without copying the map. */
export function getAnsweredTalkId(contentId: string): string | undefined {
  return answeredTalkByContentView.get(contentId);
}

/** docs/TODO.md §BB — local persistence for user-created opposite-tag pairs. Holds only pairs the
 *  author themselves typed (diverging from the app-predefined seed registry in
 *  `tag-opposite-pairs.ts`), never the seed pairs themselves — callers merge the two at read time. */
export function getTagOppositePairRegistryState(): TagOppositePairRegistryState {
  return stores.tagOppositePairRegistry.get();
}

export function setTagOppositePairRegistryState(value: TagOppositePairRegistryState): void {
  stores.tagOppositePairRegistry.set(value);
}
