import type { TalkIntakeFilters } from './types';
import { ContentFilter } from './reputation';
import { CONFIG } from './config';
import { normalizeDirtyWords } from './talk-intake-filters';
import { isTechSupportId } from './techsupport';
import { detectFinancialData } from './financial-data-guard';

/**
 * Shared message content filtering (redesign §9.3).
 *
 * Single implementation used by every message composer (DM conversation,
 * per-talk threads, peer DM) on both the send and receive paths — never
 * duplicated per call site, the same invariant style as the match engine.
 *
 * Three checks, in order:
 *   - financial data (spec §7.4, FR-FIN-2): `detectFinancialData` — mandatory,
 *     non-configurable, runs regardless of `filters` (unlike the two below).
 *   - dirty words: `ContentFilter.findDirtyWord`, merging the built-in blocked
 *     words with the user's editable `dirtyWords` list. Whole-word on
 *     NFKC-lowercased text, so "cocktail" never trips "cock".
 *   - grammar: `ContentFilter.grammarScore` vs `CONFIG.GRAMMAR_THRESHOLD`.
 *
 * The dirty-word/grammar checks are user-configurable: a disabled filter
 * performs no check, an enabled dirty-word filter with an empty user list
 * still applies the built-ins. The financial-data check has no such toggle —
 * no user or business-chatroom setting may disable it (FR-FIN-2).
 */

export type MessageFilterReason = 'financial_data' | 'dirty_words' | 'grammar';

export interface MessageFilterResult {
  /** True when the message passes every enabled filter. */
  passed: boolean;
  /** The first filter that rejected the message, when `passed` is false. */
  reason?: MessageFilterReason;
  /** The offending dirty word (only for reason === 'dirty_words'). */
  word?: string;
  /** The matched substring (only for reason === 'financial_data'). */
  financialMatch?: string;
}

const PASS: MessageFilterResult = { passed: true };

/**
 * Assess a message against the user's own filters, plus the mandatory
 * financial-data check. Financial data is evaluated before dirty words and
 * grammar, and runs even when `filters` is null/absent — it is not part of
 * the user-configurable filter set. Empty/whitespace text always passes
 * (nothing to send/render).
 */
export function assessMessageContent(
  text: string,
  filters: Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'> | null | undefined,
): MessageFilterResult {
  const content = String(text ?? '');
  if (!content.trim()) return PASS;

  const financialMatches = detectFinancialData(content);
  if (financialMatches.length > 0) {
    return { passed: false, reason: 'financial_data', financialMatch: financialMatches[0].match };
  }

  if (!filters) return PASS;

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
 *
 * **TechSupport is exempt from dirty-word/grammar filters only (docs/TODO.md K6).**
 * A message authored by the built-in TechSupport root is never suppressed by the
 * receiver's own dirty-word/grammar filters — otherwise a user who set a strict
 * filter could silently lose the only support channel they have. Pass `senderId`
 * wherever it is known; omitting it keeps the previous behaviour for ordinary peers.
 * **This exemption does NOT extend to the financial-data check (spec §7.4, FR-FIN-5)**
 * — that check is mandatory and safety-critical, not a user-configurable filter the
 * K6 exemption was designed around, so TechSupport messages are still scanned for it.
 */
export function filterIncomingMessage(
  text: string,
  filters: Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'> | null | undefined,
  options?: { senderId?: string | null | undefined },
): MessageFilterResult {
  // TechSupport skips dirty-word/grammar (pass null filters) but the financial-data
  // check inside assessMessageContent still runs unconditionally either way.
  if (isTechSupportId(options?.senderId)) return assessMessageContent(text, null);
  return assessMessageContent(text, filters);
}
