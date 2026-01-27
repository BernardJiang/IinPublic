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
// --- Talk Structure ---
export const QuestionTypeSchema = z.enum(['binary', 'multiple_choice', 'range', 'text']);
export const AnswerOptionSchema = z.object({
    id: z.string(),
    text: z.string(),
    nextQuestionId: z.string().nullable(), // Null means end of talk
    action: z.enum(['next', 'ignore', 'match']).default('next'),
});
export const QuestionSchema = z.object({
    id: z.string(),
    text: z.string(),
    type: QuestionTypeSchema,
    options: z.array(AnswerOptionSchema),
});
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
// --- Messages / Matches ---
// --- Messages / Matches ---
export const MessageContentSchema = z.object({
    type: z.enum(['text', 'talk_invite', 'talk_result']),
    text: z.string().optional(),
    talkId: z.string().optional(),
    talkTitle: z.string().optional(),
    result: z.enum(['match', 'ignore']).optional(),
    answers: z.record(z.string(), z.any()).optional() // QuestionId -> Answer
});
export const MessageSchema = z.object({
    id: z.string(),
    sender: PubKeySchema,
    content: MessageContentSchema,
    timestamp: TimestampSchema,
});
// --- Chatrooms ---
export const ChatroomInfoSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    location: z.object({
        lat: z.number(),
        lng: z.number(),
        radius: z.number(), // meters
    }).optional(),
    type: z.enum(['global', 'local', 'business']).default('local'),
});
