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
export declare const MessageContentSchema: z.ZodObject<{
    type: z.ZodEnum<["text", "talk_invite", "talk_result"]>;
    text: z.ZodOptional<z.ZodString>;
    talkId: z.ZodOptional<z.ZodString>;
    talkTitle: z.ZodOptional<z.ZodString>;
    result: z.ZodOptional<z.ZodEnum<["match", "ignore"]>>;
    answers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    type: "text" | "talk_invite" | "talk_result";
    text?: string | undefined;
    talkId?: string | undefined;
    talkTitle?: string | undefined;
    result?: "ignore" | "match" | undefined;
    answers?: Record<string, any> | undefined;
}, {
    type: "text" | "talk_invite" | "talk_result";
    text?: string | undefined;
    talkId?: string | undefined;
    talkTitle?: string | undefined;
    result?: "ignore" | "match" | undefined;
    answers?: Record<string, any> | undefined;
}>;
export declare const MessageSchema: z.ZodObject<{
    id: z.ZodString;
    sender: z.ZodString;
    content: z.ZodObject<{
        type: z.ZodEnum<["text", "talk_invite", "talk_result"]>;
        text: z.ZodOptional<z.ZodString>;
        talkId: z.ZodOptional<z.ZodString>;
        talkTitle: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodEnum<["match", "ignore"]>>;
        answers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        type: "text" | "talk_invite" | "talk_result";
        text?: string | undefined;
        talkId?: string | undefined;
        talkTitle?: string | undefined;
        result?: "ignore" | "match" | undefined;
        answers?: Record<string, any> | undefined;
    }, {
        type: "text" | "talk_invite" | "talk_result";
        text?: string | undefined;
        talkId?: string | undefined;
        talkTitle?: string | undefined;
        result?: "ignore" | "match" | undefined;
        answers?: Record<string, any> | undefined;
    }>;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    sender: string;
    content: {
        type: "text" | "talk_invite" | "talk_result";
        text?: string | undefined;
        talkId?: string | undefined;
        talkTitle?: string | undefined;
        result?: "ignore" | "match" | undefined;
        answers?: Record<string, any> | undefined;
    };
    timestamp: number;
}, {
    id: string;
    sender: string;
    content: {
        type: "text" | "talk_invite" | "talk_result";
        text?: string | undefined;
        talkId?: string | undefined;
        talkTitle?: string | undefined;
        result?: "ignore" | "match" | undefined;
        answers?: Record<string, any> | undefined;
    };
    timestamp: number;
}>;
export type Message = z.infer<typeof MessageSchema>;
export declare const ChatroomInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    location: z.ZodOptional<z.ZodObject<{
        lat: z.ZodNumber;
        lng: z.ZodNumber;
        radius: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        lat: number;
        lng: number;
        radius: number;
    }, {
        lat: number;
        lng: number;
        radius: number;
    }>>;
    type: z.ZodDefault<z.ZodEnum<["global", "local", "business"]>>;
}, "strip", z.ZodTypeAny, {
    type: "global" | "local" | "business";
    id: string;
    name: string;
    description?: string | undefined;
    location?: {
        lat: number;
        lng: number;
        radius: number;
    } | undefined;
}, {
    id: string;
    name: string;
    type?: "global" | "local" | "business" | undefined;
    description?: string | undefined;
    location?: {
        lat: number;
        lng: number;
        radius: number;
    } | undefined;
}>;
export type ChatroomInfo = z.infer<typeof ChatroomInfoSchema>;
