import { User, Reputation, Filter } from './types';
import { CONFIG } from './config';

// \p{L}\p{N} Unicode property escapes require a full-ICU build. Built via `new RegExp`
// (not a literal) so the SyntaxError on ICU-less runtimes — nodejs-mobile's embedded Node
// lacks full ICU, and a literal fails to even parse, crashing module load and taking down
// the whole embedded-Node process on Android real hardware (2026-08-08) — is catchable here
// instead of at import time.
const WORD_PATTERN: RegExp = (() => {
  try {
    return new RegExp("[\\p{L}\\p{N}']+", 'gu');
  } catch {
    // No full-ICU support: fall back to a script-agnostic "non-separator" tokenizer.
    // CJK terms are matched separately via substring search (see cjkBlockedTerms below),
    // so this fallback only affects whole-word matching for Latin/Cyrillic/etc. scripts.
    return /[^\s.,!?;:"()[\]{}<>@#$%^&*+=|\\/~`]+/g;
  }
})();

export class ReputationManager {
  /**
   * Calculate reputation score based on various factors
   */
  static calculateReputationScore(reputation: Reputation): number {
    let score = 0;
    
    // Positive factors
    score += reputation.questionsAnswered * 0.1;
    score += reputation.matchesFound * 2;
    score += reputation.friendsCount * 1;
    score += reputation.mutualFriendsCount * 3;
    score += reputation.likedCount * 0.5;
    score -= reputation.dislikedCount * 0.75;
    score += (reputation.starRating - 3) * 5; // 3 is neutral
    
    if (reputation.ageVerified) {
      score += 10;
    }
    
    // Negative factors
    score -= reputation.blockCount * CONFIG.BLOCK_IMPACT_MULTIPLIER;
    
    return Math.max(-50, Math.min(100, score)); // Clamp between -50 and 100
  }
  
  /**
   * Determine bulk send capacity based on reputation
   */
  static getBulkSendCapacity(user: User): number {
    const reputationScore = this.calculateReputationScore(user.reputation);
    const baseCapacity = CONFIG.DEFAULT_BULK_LIMIT;
    
    if (reputationScore < CONFIG.MIN_REPUTATION_FOR_BULK) {
      return 0; // No bulk sending allowed
    }
    
    // Scale capacity based on reputation
    const multiplier = Math.max(0.1, Math.min(2.0, 1 + (reputationScore / 100)));
    const capacity = Math.floor(baseCapacity * multiplier);
    
    return Math.min(capacity, CONFIG.MAX_BULK_RECIPIENTS);
  }
  
  /**
   * Update reputation based on user actions
   */
  static updateReputation(
    reputation: Reputation,
    action: ReputationAction,
    value: number = 1
  ): Reputation {
    const updated = { ...reputation };
    
    switch (action) {
      case 'question_answered':
        updated.questionsAnswered += value;
        break;
      case 'talk_sent':
        updated.talksSent += value;
        break;
      case 'match_found':
        updated.matchesFound += value;
        break;
      case 'friend_added':
        updated.friendsCount += value;
        break;
      case 'liked':
        updated.likedCount += value;
        break;
      case 'disliked':
        updated.dislikedCount += value;
        break;
      case 'star_rating': {
        // Update running average
        const totalRating = updated.starRating * updated.reviewCount + value;
        updated.reviewCount += 1;
        updated.starRating = totalRating / updated.reviewCount;
        break;
      }
      case 'age_verified':
        updated.ageVerificationVotes += value;
        if (updated.ageVerificationVotes >= CONFIG.AGE_VERIFICATION_THRESHOLD) {
          updated.ageVerified = true;
        }
        break;
      case 'blocked':
        updated.blockCount += value;
        break;
    }
    
    return updated;
  }
}

export type ReputationAction =
  | 'question_answered'
  | 'talk_sent'
  | 'match_found'
  | 'friend_added'
  | 'liked'
  | 'disliked'
  | 'star_rating'
  | 'age_verified'
  | 'blocked';

export class ContentFilter {
  private static latinBlockedWords = new Set([
    'spam', 'scam', 'fake', 'bot', 'phishing', 'fraud', 'fuck', 'shit', 'bitch',
  ]);
  private static cjkBlockedTerms = ['垃圾广告', '诈骗', '钓鱼链接'];
  
  /**
   * Apply content filters to a message
   */
  static applyFilters(
    content: string,
    filters: Filter,
    userLanguages: string[] = ['en'],
    customDirtyWords: readonly string[] = []
  ): FilterResult {
    const result: FilterResult = {
      passed: true,
      rejectedBy: [],
      content: content.trim()
    };
    
    // Language filter
    if (filters.language) {
      const detectedLanguage = this.detectLanguage(content);
      if (!userLanguages.includes(detectedLanguage)) {
        result.passed = false;
        result.rejectedBy.push('language');
      }
    }
    
    // Grammar filter
    if (filters.grammar) {
      const grammarScore = this.assessGrammar(content);
      if (grammarScore < CONFIG.GRAMMAR_THRESHOLD) {
        result.passed = false;
        result.rejectedBy.push('grammar');
      }
    }
    
    // Dirty words filter
    if (filters.dirtyWords) {
      if (this.containsDirtyWords(content, customDirtyWords)) {
        result.passed = false;
        result.rejectedBy.push('dirty_words');
      }
    }

    return result;
  }

  /**
   * Grammar score in [0,1] for a message (public accessor over the internal
   * heuristic). Used by the shared message-content filter.
   */
  static grammarScore(content: string): number {
    return this.assessGrammar(content);
  }

  /**
   * Return the first dirty word found in `content`, or null if clean. Merges the
   * built-in blocked words with the caller's custom list. Matching is whole-word
   * on NFKC-lowercased text, so "cocktail" never matches "cock".
   */
  static findDirtyWord(content: string, customWords: readonly string[] = []): string | null {
    const normalized = content.normalize('NFKC').toLowerCase();
    const words = normalized.match(WORD_PATTERN) || [];
    const merged = new Set<string>(this.latinBlockedWords);
    for (const w of customWords) {
      const t = String(w ?? '').normalize('NFKC').trim().toLowerCase();
      if (t) merged.add(t);
    }
    for (const word of words) {
      if (merged.has(word)) return word;
    }
    for (const term of this.cjkBlockedTerms) {
      if (normalized.includes(term)) return term;
    }
    for (const w of customWords) {
      const t = String(w ?? '').normalize('NFKC').trim().toLowerCase();
      // Multi-token custom terms (with spaces) fall back to substring matching.
      if (t.includes(' ') && normalized.includes(t)) return t;
    }
    return null;
  }
  
  private static detectLanguage(content: string): string {
    // Simplified language detection - in real implementation would use a proper library
    const text = content.toLowerCase();
    
    // Simple heuristics for common languages
    if (/\b(the|and|or|but|is|are|was|were)\b/.test(text)) return 'en';
    if (/\b(el|la|y|o|pero|es|son|fue|fueron)\b/.test(text)) return 'es';
    if (/\b(le|la|et|ou|mais|est|sont|était|étaient)\b/.test(text)) return 'fr';
    
    return 'en'; // Default to English
  }
  
  /**
   * Return true when content is predominantly CJK (Chinese/Japanese/Korean).
   * CJK text does not use Latin word boundaries or sentence-ending punctuation,
   * so Latin grammar heuristics must be bypassed to avoid false rejections.
   */
  static isCjkContent(content: string): boolean {
    if (!content) return false;
    // Count CJK Unified Ideographs, CJK Extension A/B, Hiragana, Katakana, Hangul
    const cjkMatches = content.match(/[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g);
    if (!cjkMatches) return false;
    // Treat as CJK when at least 20% of non-whitespace chars are CJK ideographs
    const nonWhitespace = content.replace(/\s/g, '');
    return nonWhitespace.length > 0 && cjkMatches.length / nonWhitespace.length >= 0.2;
  }

  private static assessGrammar(content: string): number {
    // CJK text does not use Latin sentence structure — skip Latin grammar heuristics
    // to avoid incorrectly filtering Chinese/Japanese/Korean talks.
    if (this.isCjkContent(content)) return 1.0;

    // Latin grammar assessment: penalise very short/long sentences, missing
    // punctuation on longer sentences, and heavy word repetition.
    const sentences = content.match(/[^.!?]+[.!?]?/g)?.filter(s => s.trim()) ?? [];
    if (sentences.length === 0) return 0;

    let score = 1.0;

    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/);

      // Penalty for very short or very long sentences
      if (words.length < 2 && sentences.length > 1) score -= 0.1;
      if (words.length > 30) score -= 0.1;

      // Check for basic punctuation
      if (words.length > 5 && !/[.!?]$/.test(sentence.trim())) score -= 0.1;

      // Check for repeated words
      const wordSet = new Set(words.map(w => w.toLowerCase()));
      if (wordSet.size < words.length * 0.7) score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }
  
  static containsDirtyWords(content: string, customWords: readonly string[] = []): boolean {
    return this.findDirtyWord(content, customWords) !== null;
  }
}

export interface FilterResult {
  passed: boolean;
  rejectedBy: string[];
  content: string;
}
