import { User, Reputation, Filter } from './types';
import { CONFIG } from './config';

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
    userLanguages: string[] = ['en']
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
      if (this.containsDirtyWords(content)) {
        result.passed = false;
        result.rejectedBy.push('dirty_words');
      }
    }
    
    return result;
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
  
  private static containsDirtyWords(content: string): boolean {
    const normalized = content.normalize('NFKC').toLowerCase();
    const words = normalized.match(/[\p{L}\p{N}']+/gu) || [];
    return words.some(word => this.latinBlockedWords.has(word)) ||
      this.cjkBlockedTerms.some(term => normalized.includes(term));
  }
}

export interface FilterResult {
  passed: boolean;
  rejectedBy: string[];
  content: string;
}
