export interface User {
    id: string;
    stageName: string;
    headshot?: string;
    profile: QuestionAnswer[];
    reputation: Reputation;
    location: BlurredLocation;
    languages: string[];
    interests: Tag[];
    createdAt: Date;
    lastActive: Date;
}
export interface QuestionAnswer {
    id: string;
    question: string;
    answer: string;
    isAuto: boolean;
    answeredAt: Date;
}
export interface Reputation {
    questionsAnswered: number;
    talksSent: number;
    matchesFound: number;
    friendsCount: number;
    mutualFriendsCount: number;
    starRating: number;
    reviewCount: number;
    ageVerified: boolean;
    ageVerificationVotes: number;
    blockCount: number;
    isHidden: boolean;
}
export interface BlurredLocation {
    region: string;
    chatrooms: string[];
    trueLocation?: GPSCoordinate;
}
export interface GPSCoordinate {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: Date;
}
export interface Chatroom {
    id: string;
    name: string;
    type: 'global' | 'location' | 'business' | 'custom';
    location?: GPSCoordinate;
    capacity: number;
    currentUsers: string[];
    businessInfo?: BusinessInfo;
    createdBy?: string;
    createdAt: Date;
    isActive: boolean;
}
export interface BusinessInfo {
    brandName: string;
    address: string;
    coordinates: GPSCoordinate;
    description: string;
    ownerId: string;
    verified: boolean;
}
export interface Talk {
    id: string;
    title: string;
    authorId: string;
    type: 'matching' | 'survey';
    isAdult: boolean;
    language: string;
    tags: Tag[];
    questions: Question[];
    createdAt: Date;
    isTemplate: boolean;
    usageCount: number;
}
export interface Question {
    id: string;
    text: string;
    answers: Answer[];
    nextQuestionId?: string;
    branchingLogic?: BranchLogic[];
    isAgeGate?: boolean;
    isAggregatable?: boolean;
}
export interface Answer {
    id: string;
    text: string;
    nextQuestionId?: string;
    isTerminal?: boolean;
    isIgnore?: boolean;
    isMatch?: boolean;
}
export interface BranchLogic {
    answerId: string;
    nextQuestionId: string;
}
export interface Tag {
    id: string;
    name: string;
    category: TagCategory;
    popularity: number;
    region?: string;
}
export type TagCategory = 'for-sale' | 'housing' | 'services' | 'community' | 'personals' | 'jobs' | 'gigs' | 'resumes' | 'discussion' | 'other';
export interface Conversation {
    id: string;
    participants: string[];
    talkId?: string;
    messages: Message[];
    status: 'active' | 'matched' | 'ignored' | 'expired';
    createdAt: Date;
    lastActivity: Date;
    isSurvey: boolean;
}
export interface Message {
    id: string;
    senderId: string;
    text: string;
    isFromChatbot: boolean;
    questionId?: string;
    answerId?: string;
    timestamp: Date;
    readBy: string[];
}
export interface Match {
    id: string;
    userIds: string[];
    talkId: string;
    conversationId: string;
    matchedAt: Date;
    status: 'pending' | 'accepted' | 'declined';
}
export interface Survey {
    id: string;
    talkId: string;
    responses: SurveyResponse[];
    aggregatedResults: SurveyAggregation[];
    createdAt: Date;
}
export interface SurveyResponse {
    id: string;
    responderId: string;
    answers: {
        questionId: string;
        answerId: string;
    }[];
    submittedAt: Date;
    isAnonymous: boolean;
}
export interface SurveyAggregation {
    questionId: string;
    answerStats: {
        answerId: string;
        count: number;
        percentage: number;
    }[];
    totalResponses: number;
}
export interface Filter {
    language: boolean;
    grammar: boolean;
    dirtyWords: boolean;
    location: {
        enabled: boolean;
        maxDistance: number;
    };
    age: {
        enabled: boolean;
        minAge: number;
        maxAge: number;
    };
}
export interface BulkSendJob {
    id: string;
    talkId: string;
    senderId: string;
    targetScope: TargetScope;
    maxRecipients: number;
    sentCount: number;
    inProgressCount: number;
    matchedCount: number;
    ignoredCount: number;
    expiredCount: number;
    status: 'pending' | 'sending' | 'completed' | 'failed';
    createdAt: Date;
    completedAt?: Date;
}
export interface TargetScope {
    chatroomIds: string[];
    tags: string[];
    location?: {
        latitude: number;
        longitude: number;
        radius: number;
    };
    excludeUserIds: string[];
}
export interface UserEvent {
    type: 'user.updated' | 'user.status' | 'user.location';
    userId: string;
    data: any;
    timestamp: Date;
}
export interface ChatroomEvent {
    type: 'chatroom.join' | 'chatroom.leave' | 'chatroom.split' | 'chatroom.message';
    chatroomId: string;
    userId?: string;
    data: any;
    timestamp: Date;
}
export interface ConversationEvent {
    type: 'message.sent' | 'message.read' | 'talk.started' | 'talk.completed' | 'match.created';
    conversationId: string;
    userId?: string;
    data: any;
    timestamp: Date;
}
//# sourceMappingURL=types.d.ts.map