import { Talk } from './types';
export declare class TalkValidator {
    /**
     * Validates that a talk structure forms a DAG (no loops)
     */
    static validateDAGStructure(talk: Talk): void;
    private static hasCycleDFS;
    private static getNextQuestionIds;
    /**
     * Validates talk structure and content
     */
    static validateTalk(talk: Talk): void;
    private static validateQuestion;
    private static validateAnswer;
    private static validateSurveyTalk;
}
export declare class TalkLinearCapture {
    /**
     * Parses a chat line to extract question and answers
     * Format: "Question? Answer1; Answer2; ...; AnswerN."
     */
    static parseChatLine(line: string): {
        question: string;
        answers: string[];
    } | null;
    /**
     * Converts a chat conversation to a linear talk
     */
    static createLinearTalk(userId: string, conversationLines: string[], tags?: string[], _location?: string): Talk;
}
//# sourceMappingURL=talk-engine.d.ts.map