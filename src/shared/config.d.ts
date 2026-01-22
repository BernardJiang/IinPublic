export declare const CONFIG: {
    readonly CHATROOM_CAPACITY: 1000;
    readonly GLOBAL_CHATROOM_ID: "global";
    readonly MAX_BULK_RECIPIENTS: 1000;
    readonly DEFAULT_BULK_LIMIT: 100;
    readonly LOCATION_BLUR_RADIUS: 1000;
    readonly MAX_LOCATION_PRECISION: 100;
    readonly RATE_LIMITS: {
        readonly TALK_SEND_DAILY: 10;
        readonly TALK_SEND_WEEKLY: 50;
        readonly MESSAGE_PER_MINUTE: 60;
        readonly BULK_SEND_DAILY: 5;
    };
    readonly MAX_QUESTIONS_PER_TALK: 20;
    readonly MAX_ANSWERS_PER_QUESTION: 10;
    readonly MAX_TALK_DEPTH: 10;
    readonly GRAMMAR_THRESHOLD: 0.7;
    readonly DIRTY_WORDS_STRICTNESS: "moderate";
    readonly MIN_REPUTATION_FOR_BULK: -10;
    readonly BLOCK_IMPACT_MULTIPLIER: 2;
    readonly MESSAGE_HISTORY_LIMIT: 1000;
    readonly CONVERSATION_EXPIRY_DAYS: 30;
    readonly MIN_SURVEY_RESPONSES: 5;
    readonly MAX_SURVEY_QUESTIONS: 15;
    readonly MIN_AGE_FOR_ADULT_CONTENT: 18;
    readonly AGE_VERIFICATION_THRESHOLD: 3;
    readonly DEBUG_MODE: boolean;
    readonly LOG_LEVEL: string;
};
//# sourceMappingURL=config.d.ts.map