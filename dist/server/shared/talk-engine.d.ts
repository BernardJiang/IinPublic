import { Talk } from './types';
/** Answer record as submitted by the user (e.g. from talk response flow) */
export interface SubmittedAnswer {
    questionId: string;
    answerId: string;
    answerText?: string;
    isChecked?: boolean;
}
/**
 * Determines if the last submitted answer is a match (matching/tag talks).
 * Used by both frontend and backend so match logic lives in one place.
 */
export declare function checkIfMatch(talkData: Talk | any, answers: SubmittedAnswer[]): boolean;
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
    /**
     * Tag: simplest form of talk. Single question (keyword/short phrase), one checkbox:
     * checked = match, unchecked = ignore.
     */
    private static validateTagTalk;
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