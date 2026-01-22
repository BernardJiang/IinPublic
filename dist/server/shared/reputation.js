"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentFilter = exports.ReputationManager = void 0;
const config_1 = require("./config");
class ReputationManager {
    /**
     * Calculate reputation score based on various factors
     */
    static calculateReputationScore(reputation) {
        let score = 0;
        // Positive factors
        score += reputation.questionsAnswered * 0.1;
        score += reputation.matchesFound * 2;
        score += reputation.friendsCount * 1;
        score += reputation.mutualFriendsCount * 3;
        score += (reputation.starRating - 3) * 5; // 3 is neutral
        if (reputation.ageVerified) {
            score += 10;
        }
        // Negative factors
        score -= reputation.blockCount * config_1.CONFIG.BLOCK_IMPACT_MULTIPLIER;
        return Math.max(-50, Math.min(100, score)); // Clamp between -50 and 100
    }
    /**
     * Determine bulk send capacity based on reputation
     */
    static getBulkSendCapacity(user) {
        const reputationScore = this.calculateReputationScore(user.reputation);
        const baseCapacity = config_1.CONFIG.DEFAULT_BULK_LIMIT;
        if (reputationScore < config_1.CONFIG.MIN_REPUTATION_FOR_BULK) {
            return 0; // No bulk sending allowed
        }
        // Scale capacity based on reputation
        const multiplier = Math.max(0.1, Math.min(2.0, 1 + (reputationScore / 100)));
        const capacity = Math.floor(baseCapacity * multiplier);
        return Math.min(capacity, config_1.CONFIG.MAX_BULK_RECIPIENTS);
    }
    /**
     * Update reputation based on user actions
     */
    static updateReputation(reputation, action, value = 1) {
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
            case 'star_rating':
                // Update running average
                const totalRating = updated.starRating * updated.reviewCount + value;
                updated.reviewCount += 1;
                updated.starRating = totalRating / updated.reviewCount;
                break;
            case 'age_verified':
                updated.ageVerificationVotes += value;
                if (updated.ageVerificationVotes >= config_1.CONFIG.AGE_VERIFICATION_THRESHOLD) {
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
exports.ReputationManager = ReputationManager;
class ContentFilter {
    static dirtyWords = new Set([
        // Basic offensive words - would be loaded from a comprehensive list
        'spam', 'scam', 'fake', 'bot'
    ]);
    /**
     * Apply content filters to a message
     */
    static applyFilters(content, filters, userLanguages = ['en']) {
        const result = {
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
            if (grammarScore < config_1.CONFIG.GRAMMAR_THRESHOLD) {
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
    static detectLanguage(content) {
        // Simplified language detection - in real implementation would use a proper library
        const text = content.toLowerCase();
        // Simple heuristics for common languages
        if (/\b(the|and|or|but|is|are|was|were)\b/.test(text))
            return 'en';
        if (/\b(el|la|y|o|pero|es|son|fue|fueron)\b/.test(text))
            return 'es';
        if (/\b(le|la|et|ou|mais|est|sont|était|étaient)\b/.test(text))
            return 'fr';
        return 'en'; // Default to English
    }
    static assessGrammar(content) {
        // Simplified grammar assessment
        const sentences = content.split(/[.!?]+/).filter(s => s.trim());
        if (sentences.length === 0)
            return 0;
        let score = 1.0;
        for (const sentence of sentences) {
            const words = sentence.trim().split(/\s+/);
            // Penalty for very short or very long sentences
            if (words.length < 2)
                score -= 0.2;
            if (words.length > 30)
                score -= 0.1;
            // Check for basic punctuation
            if (!/[.!?]$/.test(sentence.trim()))
                score -= 0.1;
            // Check for repeated words
            const wordSet = new Set(words.map(w => w.toLowerCase()));
            if (wordSet.size < words.length * 0.7)
                score -= 0.1;
        }
        return Math.max(0, Math.min(1, score));
    }
    static containsDirtyWords(content) {
        const words = content.toLowerCase().split(/\s+/);
        return words.some(word => this.dirtyWords.has(word));
    }
}
exports.ContentFilter = ContentFilter;
//# sourceMappingURL=reputation.js.map