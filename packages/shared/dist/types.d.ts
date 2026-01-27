import { z } from 'zod';
export declare const TimestampSchema: z.ZodNumber;
export declare const PubKeySchema: z.ZodString;
export declare const UserProfileSchema: z.ZodObject<{
    displayName: z.ZodString;
    avatarUrl: z.ZodOptional<z.ZodString>;
    bio: z.ZodOptional<z.ZodString>;
    languages: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    displayName: string;
    languages: string[];
    avatarUrl?: string | undefined;
    bio?: string | undefined;
}, {
    displayName: string;
    avatarUrl?: string | undefined;
    bio?: string | undefined;
    languages?: string[] | undefined;
}>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export declare const QuestionTypeSchema: z.ZodEnum<["binary", "multiple_choice", "range", "text"]>;
export declare const AnswerOptionSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    nextQuestionId: z.ZodNullable<z.ZodString>;
    action: z.ZodDefault<z.ZodEnum<["next", "ignore", "match"]>>;
}, "strip", z.ZodTypeAny, {
    text: string;
    id: string;
    nextQuestionId: string | null;
    action: "next" | "ignore" | "match";
}, {
    text: string;
    id: string;
    nextQuestionId: string | null;
    action?: "next" | "ignore" | "match" | undefined;
}>;
export type AnswerOption = z.infer<typeof AnswerOptionSchema>;
export declare const QuestionSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    type: z.ZodEnum<["binary", "multiple_choice", "range", "text"]>;
    options: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        nextQuestionId: z.ZodNullable<z.ZodString>;
        action: z.ZodDefault<z.ZodEnum<["next", "ignore", "match"]>>;
    }, "strip", z.ZodTypeAny, {
        text: string;
        id: string;
        nextQuestionId: string | null;
        action: "next" | "ignore" | "match";
    }, {
        text: string;
        id: string;
        nextQuestionId: string | null;
        action?: "next" | "ignore" | "match" | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    options: {
        text: string;
        id: string;
        nextQuestionId: string | null;
        action: "next" | "ignore" | "match";
    }[];
    type: "binary" | "multiple_choice" | "range" | "text";
    text: string;
    id: string;
}, {
    options: {
        text: string;
        id: string;
        nextQuestionId: string | null;
        action?: "next" | "ignore" | "match" | undefined;
    }[];
    type: "binary" | "multiple_choice" | "range" | "text";
    text: string;
    id: string;
}>;
export type Question = z.infer<typeof QuestionSchema>;
export declare const TalkSchema: z.ZodObject<{
    id: z.ZodString;
    authorPubKey: z.ZodString;
    title: z.ZodString;
    rootQuestionId: z.ZodString;
    nodes: z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        type: z.ZodEnum<["binary", "multiple_choice", "range", "text"]>;
        options: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            nextQuestionId: z.ZodNullable<z.ZodString>;
            action: z.ZodDefault<z.ZodEnum<["next", "ignore", "match"]>>;
        }, "strip", z.ZodTypeAny, {
            text: string;
            id: string;
            nextQuestionId: string | null;
            action: "next" | "ignore" | "match";
        }, {
            text: string;
            id: string;
            nextQuestionId: string | null;
            action?: "next" | "ignore" | "match" | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        options: {
            text: string;
            id: string;
            nextQuestionId: string | null;
            action: "next" | "ignore" | "match";
        }[];
        type: "binary" | "multiple_choice" | "range" | "text";
        text: string;
        id: string;
    }, {
        options: {
            text: string;
            id: string;
            nextQuestionId: string | null;
            action?: "next" | "ignore" | "match" | undefined;
        }[];
        type: "binary" | "multiple_choice" | "range" | "text";
        text: string;
        id: string;
    }>>;
    isSurvey: z.ZodDefault<z.ZodBoolean>;
    tags: z.ZodArray<z.ZodString, "many">;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    authorPubKey: string;
    title: string;
    rootQuestionId: string;
    nodes: Record<string, {
        options: {
            text: string;
            id: string;
            nextQuestionId: string | null;
            action: "next" | "ignore" | "match";
        }[];
        type: "binary" | "multiple_choice" | "range" | "text";
        text: string;
        id: string;
    }>;
    isSurvey: boolean;
    tags: string[];
    createdAt: number;
}, {
    id: string;
    authorPubKey: string;
    title: string;
    rootQuestionId: string;
    nodes: Record<string, {
        options: {
            text: string;
            id: string;
            nextQuestionId: string | null;
            action?: "next" | "ignore" | "match" | undefined;
        }[];
        type: "binary" | "multiple_choice" | "range" | "text";
        text: string;
        id: string;
    }>;
    tags: string[];
    createdAt: number;
    isSurvey?: boolean | undefined;
}>;
export type Talk = z.infer<typeof TalkSchema>;
export declare const MessageSchema: z.ZodObject<{
    id: z.ZodString;
    sender: z.ZodString;
    content: z.ZodString;
    timestamp: z.ZodNumber;
    relatedTalkId: z.ZodOptional<z.ZodString>;
    selectedOptionId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    sender: string;
    content: string;
    timestamp: number;
    relatedTalkId?: string | undefined;
    selectedOptionId?: string | undefined;
}, {
    id: string;
    sender: string;
    content: string;
    timestamp: number;
    relatedTalkId?: string | undefined;
    selectedOptionId?: string | undefined;
}>;
export type Message = z.infer<typeof MessageSchema>;
