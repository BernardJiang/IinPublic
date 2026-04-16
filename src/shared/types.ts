export type RelationshipLabel = 'friend' | 'relative' | 'coworker' | 'acquaintance';

export interface KnownPerson {
  userId: string;
  label: RelationshipLabel;
  addedAt: Date;
}

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
  /** SEA signing/encryption public key (hex) */
  pub?: string;
  /** SEA ephemeral public key for ECDH messaging */
  epub?: string;
  knownPeople?: KnownPerson[];
}

export interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
  isAuto: boolean; // true = auto (chatbot can reuse), false = manual
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
  isHidden: boolean; // user can hide reputation display
}

export interface BlurredLocation {
  region: string; // blurred region identifier
  chatrooms: string[]; // chatroom IDs user belongs to
  trueLocation?: GPSCoordinate; // only stored locally, never transmitted
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

/**
 * One step in a context path: identifies which question was asked and which
 * answer was selected by the user at that step. Used by tree-type talks to
 * distinguish otherwise identical questions that appear in different branches.
 */
export interface ContextStep {
  questionId: string;
  answerId: string;
}

/**
 * A flat answer record stored in the user's answer table.
 * Used by the chatbot to decide whether it can auto-reply.
 *
 * Context is represented as a single hash ID (not a full path list):
 *
 * - tag / survey / matching (linear talk): contextHash is '' (empty string),
 *   meaning no context is required.
 * - tree: contextHash is an 8-char FNV-1a hex hash of the ordered
 *   (questionId:answerId) steps that were active before this question was
 *   shown. The chatbot matches by computing the hash of the current path
 *   and comparing it against stored hashes — O(1) lookup, no list traversal.
 *
 * The full contextPath is NOT stored here; it only lives on the talk
 * definition (Question.contextPath) where it is needed for tree traversal.
 */
export interface AnswerWithContext {
  questionId: string;
  answerId: string;
  answerText: string;
  /**
   * Hash of the context path that was active when this answer was given.
   * '' (empty) for tag/survey/matching. 8-char hex for tree branches.
   * Computed by TreeTalkProcessor.buildContextHash().
   */
  contextHash: string;
  visibility: 'auto' | 'manual';
  recordedAt: Date;
}

export interface Talk {
  id: string;
  title: string;
  authorId: string;
  /**
   * The four talk types (see §3.6.1 of the technical specification):
   *
   * - 'tag'      : Single keyword/phrase, checked (match) or unchecked (ignore).
   *                Exactly one question, no sequential context.
   * - 'matching' : Sequential chain of Q/A. Every question uses all prior Q/A
   *                as context. The chatbot auto-replies when the full preceding
   *                context matches a stored answer.
   * - 'survey'   : Independent Q/A pairs. No question uses other questions as
   *                context. The chatbot can always auto-reply; results are
   *                aggregated across all respondents.
   * - 'tree'     : Hierarchical DAG that can contain both talk-style (context-
   *                dependent) and survey-style (context-independent) branches.
   *                Each question carries a contextPath. The chatbot auto-replies
   *                only when the stored answer's contextPath matches the current
   *                conversation path.
   */
  type: 'matching' | 'survey' | 'tag' | 'tree';
  isAdult: boolean;
  language: string;
  tags: Tag[];
  questions: Question[];
  createdAt: Date;
  isTemplate: boolean;
  usageCount: number;
  /** Expiration timestamp (ms). null/undefined = forever. Once expired, talk is not sent automatically but can be re-activated. */
  expiresAt?: number | null;
  /** Location radius in miles. null/undefined = anywhere. Recipients outside this radius are filtered out. */
  locationRadiusMiles?: number | null;
  /** Author's location when talk was created (for distance filtering). */
  authorLocation?: { latitude: number; longitude: number };
}

export interface Question {
  id: string;
  text: string;
  answers: Answer[];
  nextQuestionId?: string; // for linear (matching) talks
  branchingLogic?: BranchLogic[]; // for tree talks
  isAgeGate?: boolean;
  isAggregatable?: boolean; // for surveys
  /**
   * Present on 'tree' type questions only.
   * The ordered list of (questionId, answerId) steps that were traversed to
   * reach this question. Two occurrences of the same question text in different
   * branches will have different contextPaths and are stored as separate answers.
   * Empty array means a root question (no prior context).
   */
  contextPath?: ContextStep[];
}

export interface Answer {
  id: string;
  text: string;
  nextQuestionId?: string;
  isTerminal?: boolean; // ends the talk
  isIgnore?: boolean; // filters out user
  isMatch?: boolean; // "Let's talk in person"
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
  region?: string; // regional popularity
}

export type TagCategory = 
  | 'for-sale'
  | 'housing' 
  | 'services'
  | 'community'
  | 'personals'
  | 'jobs'
  | 'gigs'
  | 'resumes'
  | 'discussion'
  | 'other';

export interface Conversation {
  id: string;
  participants: string[];
  talkId?: string; // if started from a talk
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
  questionId?: string; // if part of a talk flow
  answerId?: string;
  timestamp: Date;
  readBy: string[];
  /** Default `public` — other values use SEA with recipient/sender epub */
  channel?: 'public' | 'known' | 'mutual';
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
  answers: { questionId: string; answerId: string }[];
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
    maxDistance: number; // in km
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

// Event types for Gun.js real-time updates
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