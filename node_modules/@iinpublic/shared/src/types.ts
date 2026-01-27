import { z } from 'zod';

// --- Primitives ---

export const TimestampSchema = z.number(); // Date.now()
export const PubKeySchema = z.string(); // Gun SEA Public Key

// --- User Profile ---

export const UserProfileSchema = z.object({
    displayName: z.string().min(1).max(30),
    avatarUrl: z.string().optional(),
    bio: z.string().max(160).optional(),
    languages: z.array(z.string()).default(['en']),
    // Reputation is stored separately, read-only
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// --- Talk Structure ---

export const QuestionTypeSchema = z.enum(['binary', 'multiple_choice', 'range', 'text']);

export const AnswerOptionSchema = z.object({
    id: z.string(),
    text: z.string(),
    nextQuestionId: z.string().nullable(), // Null means end of talk
    action: z.enum(['next', 'ignore', 'match']).default('next'),
});

export type AnswerOption = z.infer<typeof AnswerOptionSchema>;

export const QuestionSchema = z.object({
    id: z.string(),
    text: z.string(),
    type: QuestionTypeSchema,
    options: z.array(AnswerOptionSchema),
});

export type Question = z.infer<typeof QuestionSchema>;

export const TalkSchema = z.object({
    id: z.string(),
    authorPubKey: PubKeySchema,
    title: z.string(),
    rootQuestionId: z.string(),
    nodes: z.record(z.string(), QuestionSchema), // Map<QuestionId, Question>
    isSurvey: z.boolean().default(false),
    tags: z.array(z.string()),
    createdAt: TimestampSchema,
});

export type Talk = z.infer<typeof TalkSchema>;

// --- Messages / Matches ---

export const MessageSchema = z.object({
    id: z.string(),
    sender: PubKeySchema,
    content: z.string(),
    timestamp: TimestampSchema,
    // For Talk answers
    relatedTalkId: z.string().optional(),
    selectedOptionId: z.string().optional(),
});

export type Message = z.infer<typeof MessageSchema>;
