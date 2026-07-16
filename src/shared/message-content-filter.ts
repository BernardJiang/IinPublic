import type { TalkIntakeFilters } from './types';
import { ContentFilter } from './reputation';
import { CONFIG } from './config';
import { normalizeDirtyWords } from './talk-intake-filters';

/**
 * Shared message content filtering (redesign §9.3).
 *
 * Single implementation used by every message composer (DM conversation,
 * per-talk threads, peer DM) on both the send and receive paths — never
 * duplicated per call site, the same invariant style as the match engine.
 *
 * Both filters reuse the same engine that gates incoming talks:
 *   - dirty words: `ContentFilter.findDirtyWord`, merging the built-in blocked
 *     words with the user's editable `dirtyWords` list. Whole-word on
 *     NFKC-lowercased text, so "cocktail" never trips "cock".
 *   - grammar: `ContentFilter.grammarScore` vs `CONFIG.GRAMMAR_THRESHOLD`.
 *
 * A disabled filter performs no check. An enabled dirty-word filter with an
 * empty user list still applies the built-ins.
 */

export type MessageFilterReason = 'dirty_words' | 'grammar';

export interface MessageFilterResult {
  /** True when the message passes every enabled filter. */
  passed: boolean;
  /** The first filter that rejected the message, when `passed` is false. */
  reason?: MessageFilterReason;
  /** The offending dirty word (only for reason === 'dirty_words'). */
  word?: string;
}

const PASS: MessageFilterResult = { passed: true };

/**
 * Assess a message against the user's own filters. Dirty words are evaluated
 * before grammar so a blocked word is reported first. Empty/whitespace text
 * always passes (nothing to send/render).
 */
export function assessMessageContent(
  text: string,
  filters: Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'> | null | undefined,
): MessageFilterResult {
  const content = String(text ?? '');
  if (!content.trim() || !filters) return PASS;

  if (filters.blockDirtyWords) {
    const word = ContentFilter.findDirtyWord(content, normalizeDirtyWords(filters.dirtyWords));
    if (word) return { passed: false, reason: 'dirty_words', word };
  }

  if (filters.requireGoodGrammar) {
    if (ContentFilter.grammarScore(content) < CONFIG.GRAMMAR_THRESHOLD) {
      return { passed: false, reason: 'grammar' };
    }
  }

  return PASS;
}

/**
 * Outgoing (send) path: the sender's composer runs this before sending. On a
 * hit the message must not be sent and the composer text is preserved.
 */
export function filterOutgoingMessage(
  text: string,
  filters: Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'> | null | undefined,
): MessageFilterResult {
  return assessMessageContent(text, filters);
}

/**
 * Incoming (receive) path: the receiver's device runs this before rendering.
 * On a hit the message stays in the pair's Gun graph but is suppressed at
 * display (collapsed placeholder). Toggling the filter off reveals it again.
 */
export function filterIncomingMessage(
  text: string,
  filters: Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'> | null | undefined,
): MessageFilterResult {
  return assessMessageContent(text, filters);
}
