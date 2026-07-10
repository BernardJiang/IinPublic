export type RelationshipLabel = 'friend' | 'relative' | 'coworker' | 'acquaintance' | 'partner' | 'custom';

export interface TalkIntakeFilters {
  minDistanceMiles?: number;
  maxDistanceMiles?: number;
  sentAfter?: string;
  allowedLanguages: string[];
  requireGoodGrammar: boolean;
  blockDirtyWords: boolean;
  allowedTalkTypes: Array<'flow' | 'survey' | 'tag' | 'route'>;
  /** Receiver-defined substrings (normalized server-side) that reject matching talk text. */
  customBlockedTerms?: string[];
}

export interface KnownPerson {
  userId: string;
  label: RelationshipLabel;
  customLabel?: string;
  nickname?: string;
  rating?: number;
  notes?: string;
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
  blockedUserIds?: string[];
  talkFilters?: TalkIntakeFilters;
  networkRole?: 'root-techsupport';
  supportMuted?: boolean;
}

/** Who may see this profile Q&A on peer/contact surfaces (API applies this for non-owners). */
export type ProfileAttributeVisibility = 'public' | 'contacts_only' | 'private';

export interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
  isAuto: boolean; // true = auto (chatbot can reuse), false = manual
  answeredAt: Date;
  /** Omit or `public` — legacy rows treated as public. */
  visibility?: ProfileAttributeVisibility;
}

export interface IpfsAttachment {
  cid: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  enc: 'sea-pair' | 'none';
}

export interface Reputation {
  questionsAnswered: number;
  talksSent: number;
  matchesFound: number;
  friendsCount: number;
  mutualFriendsCount: number;
  likedCount: number;
  dislikedCount: number;
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
 * answer was selected by the user at that step. Used by route-type talks to
 * distinguish otherwise identical questions that appear in different branches.
 */
export interface ContextStep {
  questionId: string;
  answerId: string;
}

// ─── Community ownership (FR-CR-12) ─────────────────────────────────────────

/**
 * Four-level community ownership model for user-defined chatrooms.
 * - owner:     Full control; can transfer ownership, change any role, delete room.
 * - moderator: Content and membership control; cannot change owner role.
 * - member:    Standard participant; can post and broadcast talks.
 * - guest:     Limited interaction; blocked from broadcasting talks by default.
 *
 * Spec: FR-CR-12 (SRS v4.5 §3.3)
 */
export type CommunityRole = 'owner' | 'moderator' | 'member' | 'guest';

/**
 * A single user's role record within a chatroom.
 * Stored at Gun path: chatroomRoles/<chatroomId>/<userId>
 */
export interface CommunityRoleRecord {
  chatroomId: string;
  userId: string;
  role: CommunityRole;
  assignedAt: number;   // unix ms
  assignedBy: string;   // userId of the person who assigned this role
}

/**
 * A flat answer record stored in the user's answer table.
 * Used by the chatbot to decide whether it can auto-reply.
 *
 * Context is represented as a single hash ID (not a full path list):
 *
 * - tag / survey / flow: contextHash is '' (empty string),
 *   meaning no context is required.
 * - route: contextHash is an 8-char FNV-1a hex hash of the ordered
 *   (questionId:answerId) steps that were active before this question was
 *   shown. The chatbot matches by computing the hash of the current path
 *   and comparing it against stored hashes — O(1) lookup, no list traversal.
 *
 * The full contextPath is NOT stored here; it only lives on the talk
 * definition (Question.contextPath) where it is needed for route traversal.
 */
export interface AnswerWithContext {
  questionId: string;
  answerId: string;
  answerText: string;
  /**
   * Hash of the context path that was active when this answer was given.
   * '' (empty) for tag/survey/flow. 8-char hex for route branches.
   * Computed by RouteProcessor.buildContextHash().
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
   * - 'tag'    : The Atom of Interest. Single keyword/phrase (Boolean toggle):
   *              checked = match, unchecked = ignore. Isolated node, no context.
   * - 'flow'   : The Linear Thread. Sequential chain of Q/A (path graph).
   *              Every question uses all prior Q/A as context. The chatbot
   *              auto-replies when the full preceding context matches a stored answer.
   * - 'survey' : The Distributed Collection. Independent Q/A pairs (star graph).
   *              No shared context; ideal for aggregate statistics.
   * - 'route'  : The Logical Map. Branching DAG combining flow and survey logic.
   *              Each question carries a contextPath (for construction only).
   *              The chatbot auto-replies only when the stored contextHash matches
   *              the hash of the current conversation path.
   */
  type: 'flow' | 'survey' | 'tag' | 'route';
  isAdult: boolean;
  language: string;
  tags: Tag[];
  questions: Question[];
  ipfsAttachments?: IpfsAttachment[];
  createdAt: Date;
  isTemplate: boolean;
  usageCount: number;
  /** Expiration timestamp (ms). null/undefined = forever. Once expired, talk is not sent automatically but can be re-activated. */
  expiresAt?: number | null;
  /** Location radius in miles. null/undefined = anywhere. Recipients outside this radius are filtered out. */
  locationRadiusMiles?: number | null;
  /** Author's location when talk was created (for distance filtering). */
  authorLocation?: { latitude: number; longitude: number };
  /**
   * The author's public encryption key (SEA epub), attached at creation AFTER the
   * content-hash id is computed (must never perturb content-addressed identity/dedup).
   * Responders pair-encrypt their responses with it; carrying it inside the talk means
   * every delivery path (mesh body, server IN-index, direct send) hands the responder
   * the key material it needs WITHOUT a network lookup — lookups under simultaneous-boot
   * load failed and permanently dropped responses (mass/02's stable 8/11).
   */
  authorEpub?: string;
}

export interface Question {
  id: string;
  /**
   * CIDv1 content hash of this question's stable content (text + answer ids/texts).
   * Routing-only fields (next, match-flag) are excluded so that routing changes
   * do not invalidate chatbot answer caches keyed by this id.
   * Computed at talk creation/edit time via `computeCIDv1({ text, answers })`.
   * Optional for backward compatibility with talks created before Phase E.
   */
  cidId?: string;
  text: string;
  answers: Answer[];
  nextQuestionId?: string; // for flow (linear) talks
  branchingLogic?: BranchLogic[]; // for route talks
  isAgeGate?: boolean;
  isAggregatable?: boolean; // for surveys
  /**
   * Present on 'route' type questions only.
   * The ordered list of (questionId, answerId) steps that were traversed to
   * reach this question. Two occurrences of the same question text in different
   * branches will have different contextPaths and are stored as separate answers.
   * Empty array means a root question (no prior context).
   */
  contextPath?: ContextStep[];
  /**
   * 8-char FNV-1a hex hash of the preceding (questionId:answerId) chain,
   * or '' when this question has no prior context.
   *
   * - flow   : set on the 2nd question onward (chained from prior Q/A). Q1 is ''.
   * - route  : derived from `contextPath` — set for every question (root = '').
   * - survey : always '' (questions are independent).
   * - tag    : always '' (single isolated question).
   *
   * Computed by `RouteProcessor.buildContextHash` and kept as a denormalized
   * field so the chatbot and UI can look it up without rebuilding the path.
   */
  contextHashId?: string;
}

export interface Answer {
  id: string;
  text: string;
  nextQuestionId?: string;
  isTerminal?: boolean; // ends the talk
  isIgnore?: boolean; // filters out user
  isMatch?: boolean; // "Let's talk in person"
  /**
   * Aggregate counter used by 'survey' talks for statistics. Every time a
   * responder picks this answer the counter is incremented. Absent / undefined
   * for non-survey talks. Initialised to 0 when a survey is created.
   */
  counter?: number;
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
  /** `'withdrawn'` added in step 10: hard retraction by author; read-only both sides. */
  status: 'active' | 'matched' | 'ignored' | 'expired' | 'withdrawn';
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
  /**
   * Two-writer DAG link (REQ-LEDGER-08): the `id` of the last message from the
   * *other* participant that the sender had observed before composing this
   * message. Enables causal ordering and offline merge without a central
   * sequencer — each writer's message tree is a linked list; together they form
   * a DAG whose merge is deterministic.
   */
  prevSeen?: string;
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
  /** Optional — only required when location-based intake filtering is active. */
  location?: {
    enabled: boolean;
    maxDistance: number; // in km
  };
  /** Optional — only required when age-based intake filtering is active. */
  age?: {
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

// ─── Interaction Ledger (Phase E) ─────────────────────────────────────────────

/**
 * Kinds of interaction events recorded in the ledger.
 * Each kind maps to a distinct ledger entry with its own content schema.
 */
export enum InteractionKind {
  TALK_CREATED       = 'TALK_CREATED',
  TALK_BROADCAST     = 'TALK_BROADCAST',
  TALK_RECEIVED      = 'TALK_RECEIVED',
  TALK_ANSWERED      = 'TALK_ANSWERED',
  TALK_SUPERSEDED    = 'TALK_SUPERSEDED',
  TALK_WITHDRAWN     = 'TALK_WITHDRAWN',
  /** Step 10 — hard retraction: author deleted or unchecked the talk; tombstone for all holders. */
  TALK_RETRACTED     = 'TALK_RETRACTED',
  MATCH_CREATED      = 'MATCH_CREATED',
  CONVERSATION_MSG   = 'CONVERSATION_MSG',
}

/**
 * A single event in a user's interaction ledger feed.
 *
 * - `id`        CIDv1 of the canonical JSON of all other fields (self-certifying)
 * - `seq`       Monotonically increasing sequence number within this user's feed
 * - `prev`      CIDv1 of the previous event (`null` for the first event)
 * - `kind`      One of InteractionKind
 * - `pubkey`    SEA public key of the event author (for signature verification)
 * - `timestamp` ISO-8601 UTC string at event creation time
 * - `content`   Kind-specific payload (see per-kind type guards below)
 * - `sig`       SEA signature over `canonicalSerialize({ id, seq, prev, kind, pubkey, timestamp, content })`
 */
export interface InteractionEvent {
  id: string;          // CIDv1
  seq: number;
  prev: string | null; // CIDv1 of preceding event, null for genesis
  kind: InteractionKind;
  pubkey: string;
  timestamp: string;   // ISO-8601 UTC
  content: InteractionEventContent;
  sig: string;         // SEA signature
}

/** Union of all per-kind content shapes */
export type InteractionEventContent =
  | TalkCreatedContent
  | TalkBroadcastContent
  | TalkReceivedContent
  | TalkAnsweredContent
  | TalkSupersededContent
  | TalkWithdrawnContent
  | MatchCreatedContent
  | ConversationMsgContent;

export interface TalkCreatedContent {
  talkId: string;        // CIDv1 of the talk definition
  title: string;
  type: 'flow' | 'tag' | 'survey' | 'route';
  language: string;
}

export interface TalkBroadcastContent {
  talkId: string;
  recipientCount: number;
  chatroomIds: string[];
}

export interface TalkReceivedContent {
  talkId: string;
  senderId: string;
}

export interface TalkAnsweredContent {
  talkId: string;
  responseId: string;   // CIDv1 of { talkId, responderId, responseContentJson }
  outcome: 'match' | 'mismatch' | 'ignore';
}

export interface TalkSupersededContent {
  oldTalkId: string;
  newTalkId: string;
}

export interface TalkWithdrawnContent {
  talkId: string;
  gracePeriodMs: number;
}

export interface MatchCreatedContent {
  talkId: string;
  conversationId: string;
  otherUserId: string;
}

export interface ConversationMsgContent {
  conversationId: string;
  messageId: string;    // CIDv1 of { conversationId, senderPubkey, content, seq }
  seq: number;
}

/**
 * Ledger state snapshot used for delta-sync handshake (REQ-LEDGER-06).
 * Maps userId → highest seq number this peer holds for that user's feed.
 * Peers send only events with seq > the declared value.
 */
export type LedgerState = Record<string, number>;
