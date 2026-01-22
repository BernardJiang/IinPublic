import { User, Reputation, Filter } from './types';
export declare class ReputationManager {
    /**
     * Calculate reputation score based on various factors
     */
    static calculateReputationScore(reputation: Reputation): number;
    /**
     * Determine bulk send capacity based on reputation
     */
    static getBulkSendCapacity(user: User): number;
    /**
     * Update reputation based on user actions
     */
    static updateReputation(reputation: Reputation, action: ReputationAction, value?: number): Reputation;
}
export type ReputationAction = 'question_answered' | 'talk_sent' | 'match_found' | 'friend_added' | 'star_rating' | 'age_verified' | 'blocked';
export declare class ContentFilter {
    private static dirtyWords;
    /**
     * Apply content filters to a message
     */
    static applyFilters(content: string, filters: Filter, userLanguages?: string[]): FilterResult;
    private static detectLanguage;
    private static assessGrammar;
    private static containsDirtyWords;
}
export interface FilterResult {
    passed: boolean;
    rejectedBy: string[];
    content: string;
}
//# sourceMappingURL=reputation.d.ts.map