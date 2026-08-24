import {
  User,
  type GPSCoordinate,
  type KnownPerson,
  type ProfileAttributeVisibility,
  type TagCategory,
  type TalkIntakeFilters,
  type QuestionAnswer,
  type Tag,
} from '../../shared/types';
import { EventEmitter } from 'events';
import { formatTimeAgo, formatExpiration, escapeHtml } from './ui-formatters';
import { pickLatestTalkIdFromIncomingCluster, isValidTalkId } from '../../shared/incoming-talk-ids';
import { computeTalkIdFromTalkData } from '../../shared/cid';
import {
  buildAnswerPreferenceLookupKey,
  sessionAnswersToQAPairs,
  type QAPair,
  type TagContext,
} from '../../shared/flattened-answer-keys';
import { normalizeQuestionKey, interestsFromCommaInput } from '../../shared/user-utils';
import { normalizeProfileAttributeVisibility } from '../../shared/profile-privacy';
import { INTEREST_CATEGORY_LABELS, INTEREST_CATEGORY_SELECT_ORDER } from '../../shared/interest-catalog';
import { TalkValidator, TalkAutofix, FlowCapture, encodeCapturedQuestionMessage, decodeCapturedQuestionMessage, getRouteRootChildQuestionIds, singleNonIgnoreAnswer, findTagPairAncestor } from '../../shared/talk-engine';
import { listContactGroups, resolveContactGroupUserIds, type ContactGroupOption } from '../../shared/contact-groups';
import { SORT_STRATEGIES } from '../../shared/find-similar';
import { getFlatChatroomList, getActiveChatroomHierarchy } from '../../shared/chatroom-hierarchy';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { LocationPrivacy } from '../../shared/location';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import {
  verifyTechSupportGreeting,
  TECHSUPPORT_GREETING_TEMPLATES,
  verifySupportAck,
  TECHSUPPORT_SUPPORT_ACK_TEMPLATES,
  type GreetingLocale,
  type SupportAckLocale,
} from '../../shared/techsupport-greeting';
import { verifyFaqBundle } from '../../shared/techsupport-faq-bundle';
import { readCachedFaqBundle } from '../services/techsupport-faq-cache';
import type { SupportInboxEntry } from '../../shared/techsupport-faq';
import { renderSupportInboxSection } from './support-inbox-view';
import type { GraphNodeTarget } from './graph-navigation';
import type { StatsByRegion, StatsByTime, StatsDashboard, StatsSummary, TalkType } from '../../shared/talk-stats';
import {
  summarize,
  aggregateByTime,
  aggregateByRegion,
  aggregateCrossQuestion,
  buildStatsDashboard,
} from '../../shared/talk-stats';
import { displayAnswersList as renderAnswersList } from './answers-view';
import {
  type CustomChatroomRow,
  renderChatroomList as renderChatrooms,
  showChatroomDetail as openChatroomDetail,
  syncStatusBroadcastButtonVisibility as syncChatroomBroadcastVisibility,
  updateChatroomMembers as renderChatroomMembers,
} from './chatrooms-view';
import {
  displayContactsList as renderContactsList,
  openRelationshipDialog,
  renderContactContextSummaryInto,
  showContactsList as openContactsList,
  type ContactsViewDeps,
} from './contacts-view';
import { displayConversationsList as renderConversationsList } from './conversations-view';
import { applyConnectivityPreset, connectivityDiagnosticsText, loadConnectivitySettings, saveConnectivitySettings, type ConnectivityDiagnostics, type ConnectivityPreset } from './connectivity-settings';
import {
  clearAnswerPreferences,
  getAnswerPreferences,
  getAnsweredTalkByContent,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getTypedPreferenceState,
  setAnswerPreferences,
  setAnsweredTalkByContent,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setMyQuestionAnswer,
  setTypedPreferenceState,
  type AnswerPreferenceEntry,
  type AnswerPreferenceMap,
  type MyQuestionAnswerEntry,
} from './answer-preferences-storage';
import { pickBuiltInAnswer, resolveBuiltInQuestion } from '../../shared/built-in-question-resolution';
import { makeTypedPreferenceScopeKey, saveTypedPreference } from '../../shared/typed-preference-store';
import {
  findAutoAnswer,
  findAutoAnswerMultiple,
  getSelfTagForQuestionText,
  LOCAL_EXACT_CHATBOT_USER_ID,
  makeQuestionId,
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import {
  clearMyTalks,
  deleteMyTalkEntry,
  getMyTalks,
  patchMyTalk,
  setMyTalks,
  type MyTalkEntry,
} from './my-talks-storage';
import {
  getFlatAnswerHistory,
  upsertFlatAnswerHistory,
  type FlatAnswerHistoryItem,
} from './answer-history-storage';
import {
  COLOR_SCHEMES,
  getChatbotEnabled,
  getChatbotTemplate as loadChatbotTemplate,
  getColorSchemePreference,
  getCopyTalkAutoSave,
  getDefaultTalkLanguagePreference,
  getKeepOldTalkOnEdit,
  getUiLanguagePreference,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setColorSchemePreference,
  setCopyTalkAutoSave,
  setDefaultTalkLanguagePreference,
  setKeepOldTalkOnEdit,
  setUiLanguagePreference,
  type ColorScheme,
} from './ui-settings-storage';
import { showMyTalksDialog as openMyTalksDialog } from './my-talks-dialog';
import { showPreferencesDialog as openPreferencesDialog, type AnswerPreferenceUiMode } from './preferences-dialog';
import { showTalkResponseDialog as openTalkResponseDialog } from './talk-response-dialog';
import {
  addAnswerToQuestion as addTalkEditorAnswerToQuestion,
  addQuestionToForm as addTalkEditorQuestionToForm,
  appendIgnoreRow as appendTalkEditorIgnoreRow,
  applyBuiltInKindToQuestion,
  applyTagKindVisibilityToQuestion,
  readBuiltInSpecFromQuestion,
  setupTalkFormHandlers as setupTalkEditorFormHandlers,
  updateAllAnswerDropdowns as updateTalkEditorAnswerDropdowns,
} from './talk-editor-form-helpers';
import { showTalkEditorDialog as openTalkEditorDialog } from './talk-editor-dialog';
import { openPeerDetailView, refreshPeerThreadList, closePeerDetailView } from './user-detail-view';
import { avatarInnerHtml } from './profile-avatar';
import { renderListProgressively } from './render-list-progressively';
import { languageOptionLabel, uiLanguageFromProfile, uiText, type UiTranslationKey } from './ui-translations';
import {
  deriveLocalCreatorReplies,
  readLocalTalkExchanges,
  buildTalkResponsesFromExchanges,
  buildAllLocalTalkResponses,
} from '../services/local-peer-derivation';
import {
  filterIncomingTalkClusters,
  getTalkIntakeFilters,
  getTalkIntakeFiltersOwner,
  hasStoredTalkIntakeFilters,
  setTalkIntakeFilters,
  setTalkIntakeFiltersOwner,
} from './talk-intake-filters';
import { normalizeCustomBlockedTerms, normalizeDirtyWords, DEFAULT_DIRTY_WORDS } from '../../shared/talk-intake-filters';
import { filterOutgoingMessage, filterIncomingMessage, type MessageFilterResult } from '../../shared/message-content-filter';
import { containsFinancialData } from '../../shared/financial-data-guard';
import { CONFIG } from '../../shared/config';
import { showLinkedDevicesDialog, type LinkedDeviceRow } from './linked-devices-dialog';
import { showIdentityUnlockDialog as openIdentityUnlockDialog } from './identity-password-dialog';
import { decodePairingCode, isPairingExpired, type PairingPayload } from '../../shared/identity-linking';
import { showEraseDeviceDialog } from './erase-device-dialog';
import { eraseDevice } from '../services/device-wipe';
import {
  detectLocalDevicePlatform,
  getOrCreateLocalDeviceMetadata,
  renameLocalDevice,
} from '../services/local-device-metadata';
import { getTalkLedgerDoc, shouldSuppressForPeer } from '../services/web-talk-ledger-store';
import { buildTagIdentityKeys } from '../../shared/talk-ledger';

function resolveExpiresAtMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return new Date(value).getTime();
  return Number.NaN;
}

const TALK_TYPE_VALUES: TalkIntakeFilters['allowedTalkTypes'] = ['flow', 'survey', 'tag', 'route'];
// Settings → Appearance: decorative swatch + label per scheme, matching the
// [data-color-scheme] token blocks in main.css's :root.
const SETTINGS_SCHEME_SWATCHES: Record<ColorScheme, string> = {
  goldenHour: '#cc6b1c',
  tropicalForest: '#2f7a4f',
  snowMountain: '#1f8fc4',
  beachSunset: '#e8637a',
};
const SETTINGS_SCHEME_LABEL_KEYS: Record<ColorScheme, UiTranslationKey> = {
  goldenHour: 'schemeGoldenHour',
  tropicalForest: 'schemeTropicalForest',
  snowMountain: 'schemeSnowMountain',
  beachSunset: 'schemeBeachSunset',
};

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
];

/**
 * Best-effort language auto-detect for a talk's title/question text, so the author never has
 * to pick a language per-talk (that's now a one-time setting: Settings > Languages > Default
 * Talk Language, `getDefaultTalkLanguagePreference`). Short, keyword-only titles ("buy",
 * "iPhone") rarely carry enough signal to detect from — those fall through to `fallback`.
 */
function detectTalkLanguage(text: string, fallback: string): string {
  const normalized = text.normalize('NFKC');
  if (/[぀-ヿ]/.test(normalized)) return 'ja'; // Hiragana/Katakana
  if (/[가-힯]/.test(normalized)) return 'ko'; // Hangul
  if (/[一-鿿]/.test(normalized)) return 'zh'; // CJK ideographs, no kana/hangul present
  const lower = normalized.toLowerCase();
  if (/[àâçéèêëîïôûùüÿœæ]/.test(lower) || /\b(le|la|les|et|ou|mais|est|sont|bonjour|merci)\b/.test(lower)) return 'fr';
  if (/[äöüß]/.test(lower) || /\b(der|die|das|und|oder|aber|ist|sind|danke|hallo)\b/.test(lower)) return 'de';
  if (/[ñ¿¡]/.test(lower) || /\b(el|la|los|las|y|o|pero|es|son|hola|gracias)\b/.test(lower)) return 'es';
  if (/\b(the|and|or|but|is|are|hello|thanks)\b/.test(lower)) return 'en';
  return fallback;
}

type CreatorReplyRow = {
  responseId: string;
  talkId: string;
  title: string;
  type: string;
  language: string;
  responderId: string;
  responderName: string;
  outcome: 'match' | 'ignore' | 'mismatch';
  answerMode: 'manual' | 'auto';
  date: string;
  answers: Array<{ questionId: string; answerId: string; answerText: string }>;
};

type CreatorReplyFilterState = {
  query: string;
  outcome: string;
  relationship: string;
  type: string;
  language: string;
  from: string;
  to: string;
  sort: string;
  group: string;
};

const TALKS_TAB_STATE_KEY = 'iinpublic_talks_tab_state';
const CREATOR_REPLY_FILTERS_KEY = 'creatorReplyFilterState';
/** Spec §7.4 FR-FIN-1: the mandatory safety reminder is a toast, not a layout-shifting
 * banner, and is throttled to once per checkpoint per day rather than every occurrence. */
const SAFETY_TOAST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SAFETY_TOAST_T1_KEY = 'iinpublic_safety_toast_t1_last_shown';
const SAFETY_TOAST_T2_KEY = 'iinpublic_safety_toast_t2_last_shown';
function shouldShowCooldownToast(storageKey: string): boolean {
  const last = Number(localStorage.getItem(storageKey) || '0');
  if (Date.now() - last < SAFETY_TOAST_COOLDOWN_MS) return false;
  localStorage.setItem(storageKey, String(Date.now()));
  return true;
}
const CREATOR_REPLY_PAGE_SIZE = 25;
/** TODO §R2: first-chunk size for the Talks tab's OUT/IN lists, same precedent as above. */
const TALKS_FIRST_CHUNK_SIZE = 25;

export type BroadcastAudiencePreview = {
  talkId: string;
  title: string;
  totalCandidates: number;
  eligibleReceivers: number;
  /** Server preview ids (P0 mesh uses this instead of registering on hub). */
  eligibleReceiverIds?: string[];
  rejectedByCounts: Record<string, number>;
  eligibleReceiverNames?: string[];
  rejectedReceiverDetails?: Array<{ name: string; rejectedBy: string[] }>;
  supportExcludedCount?: number;
  previewUnavailable?: boolean;
  /** Sender-side omission: talk cannot be broadcast or peer-sent (expired/disabled). */
  senderOmittedBy?: string[];
};

type PublicProfileFoundationReader = (userId: string) => Promise<{
  headshot?: string | null;
  languagesJson?: string;
  profileJson?: string;
  interestsJson?: string;
  reputation?: { questionsAnswered?: number; matchesFound?: number; blockCount?: number; isHidden?: boolean };
} | null>;

type ContactPreRenderSync = () => Promise<void>;
type PeerLocationReader = (userId: string) => Promise<GPSCoordinate | undefined>;

function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const normalized = raw
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeTalkFilterShape(
  value: unknown,
  fallbackLanguages: string[] = ['en'],
): TalkIntakeFilters {
  const stored = value && typeof value === 'object' ? value as Partial<TalkIntakeFilters> : {};
  const defaults = getTalkIntakeFilters();
  const allowedTalkTypes = Array.isArray(stored.allowedTalkTypes)
    ? stored.allowedTalkTypes.filter((type): type is TalkIntakeFilters['allowedTalkTypes'][number] =>
        TALK_TYPE_VALUES.includes(type as TalkIntakeFilters['allowedTalkTypes'][number]),
      )
    : [];

  return {
    ...defaults,
    ...stored,
    allowedLanguages: normalizeStringList(stored.allowedLanguages, fallbackLanguages).map((lang) => lang.toLowerCase()),
    allowedTalkTypes: allowedTalkTypes.length > 0 ? allowedTalkTypes : TALK_TYPE_VALUES,
    customBlockedTerms: normalizeCustomBlockedTerms(normalizeStringList(stored.customBlockedTerms, [])),
    dirtyWords: stored.dirtyWords === undefined
      ? [...DEFAULT_DIRTY_WORDS]
      : normalizeDirtyWords(stored.dirtyWords),
  };
}

function datetimeLocalValue(value: string | undefined): string {
  if (!value) return '';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '';
  const localTimestamp = new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60_000);
  return localTimestamp.toISOString().slice(0, 16);
}

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;
  private currentUser?: User;
  private currentChatroom: string = 'global';
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];
  /** docs/TODO.md K5 — the TechSupport-root session's own pending-question inbox, fed by app.ts's live `techsupport-inbox/*` subscription (never read directly from Gun here). */
  private currentSupportInboxEntries: SupportInboxEntry[] = [];
  private talksShowIncoming = true;
  private talksShowOutgoing = true;
  private talksEnabledTypes = new Set<string>(['tag', 'flow', 'survey', 'route']);
  private talksOutSortMode: 'recent' | 'oldest' | 'latest-reply' | 'matches' | 'responses' | 'match-rate' | 'weighted' | 'title' = 'recent';
  private talksQuery = '';
  private talksCompletionFilter: 'all' | 'unanswered' | 'answered' = 'all';
  private talksOutcomeFilter: 'all' | 'match' | 'mismatch' = 'all';
  private talksDateFrom = '';
  private talksDateTo = '';
  private contactsSortId: string = 'matched-tags'; // Sort strategy for contacts view
  private apiBase: string = '';
  private currentUserId: string = '';
  private currentLocation: GPSCoordinate | undefined = undefined;
  private publicProfileFoundationReader: PublicProfileFoundationReader | undefined;
  private contactPreRenderSync: ContactPreRenderSync | undefined;
  private peerLocationReader: PeerLocationReader | undefined;
  private peerLocationCache = new Map<string, GPSCoordinate | null>();
  private peerHeadshotCache = new Map<string, string | null>();
  /** Incoming messages already surfaced via a "hidden by your filters" toast (dedupe, §9). */
  private hiddenMessageToastIds = new Set<string>();
  /** Last message set rendered into the open conversation, for filter-toggle re-render (§9). */
  private lastConversationMessages: any[] = [];
  /**
   * docs/TODO.md §V — Auto Linear Capture in-progress sessions, keyed by conversationId.
   * `scopeTalkId` is read once, when the session starts, from `currentThreadTalkId` — set
   * means "append to this existing talk," unset means "start a brand-new draft." `lines`
   * accumulates the raw confirmed captured-question lines; `FlowCapture.assembleCapturedTalk`
   * turns them into a real `Talk` once the session finalizes (a terminator line, or any
   * non-captured message sent while a session is active).
   */
  private captureSessionsByConversationId = new Map<string, { scopeTalkId: string | undefined; lines: string[] }>();
  /** docs/TODO.md §V — captured-question chip messages already tapped, so re-render disables them. */
  private answeredCaptureChipMessageIds = new Set<string>();
  /** One-time delegated click binding for `.captured-question-answer-btn` (see `bindCapturedQuestionChipDelegation`). */
  private captureChipDelegationBound = false;

  /** Other users in the current chatroom detail view (excludes self); used for broadcast delivery. */
  getCurrentChatroomMembers(): Array<{ userId: string; stageName: string }> {
    return [...this.currentChatroomMembers];
  }
  private currentConversationId: string | undefined = undefined;
  /** Per-talk Thread scope of the open conversation view (redesign §5); undefined = DM. */
  private currentThreadTalkId: string | undefined = undefined;
  /** Resolver for a shared IPFS attachment's viewable object URL (set by app.ts). */
  private sharedAttachmentResolver?: (cid: string, mimeType: string) => Promise<string | null>;
  // Last message id we've already surfaced a "new message" toast for, per conversation. Seeded
  // (without notifying) on a conversation's first summary sync so boot/history loads stay quiet;
  // subsequent deltas from the peer raise a toast when that conversation isn't the one on screen.
  private lastNotifiedMessageIdByConversation: Map<string, string> = new Map();
  private chatroomMemberCounts: Map<string, number> = new Map(); // Track member count per chatroom
  private chatroomVisitCounts: Map<string, { visitCount: number; uniqueVisitorCount: number }> = new Map();
  private expandedChatrooms: Set<string> = new Set([
    'global',
    'north-america',
    'usa',
    'california',
    'europe',
    'uk',
    'england',
  ]); // Track which chatrooms are expanded by default so first-run home/travel paths are visible.
  private matchedUserIds: Set<string> = new Set(); // Users who matched with me (for green indicator)
  // private newMatchesCount: number = 0; // TODO: implement match count tracking
  private talkStatsMap: Record<string, { responses: number; matches: number; ignores: number }> = {};
  private creatorReplyRows: CreatorReplyRow[] = [];
  private creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
  /** §M1: when set (via showCreatorRepliesForTalk), scopes #creator-replies-panel to one talk. */
  private creatorReplyScopedTalkId: string | null = null;
  private creatorReplyScopedTalkTitle = '';
  private talksListDelegationBound = false;
  /**
   * TODO §R2: delegated (bound once) click handler for talk-row and matched/sender-people
   * clicks — replaces two per-render `querySelectorAll(...).forEach(...)` listener-binding
   * loops so a row rendered into `renderListProgressively`'s deferred remainder is
   * interactive immediately, with nothing to (re-)attach.
   */
  private talksListClickDelegationBound = false;
  /** Broadcast on/off checkbox — bound once, separate from the mousedown-capture block above. */
  private talksBroadcastCheckboxBound = false;
  /** Row-drag gesture recognizer (ignore/copy/delete) — bound once. */
  private talksRowGestureBound = false;
  private talksRowGestureState: {
    row: HTMLElement;
    talkId: string;
    identityKey: string;
    role: string;
    cluster: any;
    startX: number;
    startY: number;
    dragging: boolean;
    committedAt: number;
  } | null = null;
  /** A committed or cancelled drag swallows the click that would otherwise follow release. */
  private talksGestureSuppressClickUntil = 0;
  /** TODO §R2: lets a newer `displayTalksList()` call's deferred remainder win over a stale one. */
  private talksRenderSeq = 0;
  private chatroomActionDelegationBound = false;
  /** Settings drill-down: id of the section currently shown in detail view, or null for the menu list. */
  private settingsActiveSectionId: string | null = null;
  private incomingTalkClusters: any[] = [];
  private customChatrooms: CustomChatroomRow[] = [];
  private travelModeActive: boolean = false;
  private travelHomeChatroomId: string | undefined = undefined;
  private notificationsSuppressedForE2e: boolean = false;
  private static readonly SURVEY_ANONYMITY_MIN_COUNT = 3;

  private getUiLanguage() {
    return getUiLanguagePreference(uiLanguageFromProfile(this.currentUser?.languages));
  }

  private t(key: UiTranslationKey): string {
    return uiText(this.getUiLanguage(), key);
  }

  private tf(key: UiTranslationKey, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
      (label, [placeholder, value]) => label.replace(`{${placeholder}}`, String(value)),
      this.t(key),
    );
  }

  private formatProfileVisibility(visibility: ProfileAttributeVisibility): string {
    if (visibility === 'contacts_only') return this.t('meVisibilityContacts');
    if (visibility === 'private') return this.t('meVisibilityPrivate');
    return this.t('meVisibilityEveryone');
  }

  private formatInterestCategory(category: TagCategory): string {
    const keys: Record<TagCategory, UiTranslationKey> = {
      community: 'interestCategoryCommunity',
      discussion: 'interestCategoryDiscussion',
      personals: 'interestCategoryPersonals',
      jobs: 'interestCategoryJobs',
      gigs: 'interestCategoryGigs',
      resumes: 'interestCategoryResumes',
      'for-sale': 'interestCategoryForSale',
      housing: 'interestCategoryHousing',
      services: 'interestCategoryServices',
      other: 'interestCategoryOther',
    };
    return this.t(keys[category]);
  }

  private formatTalkRelativeTime(date: Date): string {
    if (this.getUiLanguage() !== 'zh') return formatTimeAgo(date);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return this.t('talksJustNow');
    if (diffMins < 60) return this.tf('talksMinutesAgo', { count: diffMins });
    if (diffHours < 24) return this.tf('talksHoursAgo', { count: diffHours });
    if (diffDays < 7) return this.tf('talksDaysAgo', { count: diffDays });
    return date.toLocaleDateString('zh-CN');
  }

  private formatTalkExpiration(expiresAt: number | null | undefined): string {
    if (this.getUiLanguage() !== 'zh') return formatExpiration(expiresAt);
    if (expiresAt == null) return this.t('talksForever');
    if (Date.now() > expiresAt) return this.t('talksExpired');
    const oneDay = 24 * 60 * 60 * 1000;
    const left = expiresAt - Date.now();
    if (left <= oneDay) return this.tf('talksExpiresIn', { value: '&lt;1 天' });
    if (left <= 7 * oneDay) return this.tf('talksExpiresIn', { value: `${Math.floor(left / oneDay)} 天` });
    if (left <= 30 * oneDay) return this.tf('talksExpiresIn', { value: `${Math.floor(left / (7 * oneDay))} 周` });
    if (left <= 365 * oneDay) return this.tf('talksExpiresIn', { value: `${Math.floor(left / (30 * oneDay))} 个月` });
    return this.tf('talksExpiresIn', { value: `${Math.floor(left / (365 * oneDay))} 年` });
  }

  private formatTalkLocation(radiusMiles: number | null | undefined): string {
    return radiusMiles == null ? this.t('talksAnywhere') : this.tf('talksMiles', { count: radiusMiles });
  }

  // docs/TODO.md §LL: "buy?sell" notation — a small muted suffix showing the accepted answer
  // word when it differs from the tag word itself (opposite-pair). Self-match talks (answer ===
  // question, e.g. "Tennis") render no suffix — the plain word already says everything.
  // Two sources, checked in order: a root Pair-tag question (Q1 with `reciprocalTagContext` and
  // exactly one real answer — same shape the old root-level `selfTag`/`preferenceSet` fields
  // used to carry, now expressed as an ordinary question instead of talk-level metadata), else a
  // `type: 'tag'` talk's own (title, match-answer) pair (§LL: a tag is just 1 question/1 answer).
  private tagAnswerSuffix(talk: {
    title?: string;
    questions?: Array<{ text?: string; reciprocalTagContext?: boolean; answers?: Array<{ text?: string; isMatch?: boolean; isIgnore?: boolean }> }>;
    fullTalk?: {
      title?: string;
      questions?: Array<{ text?: string; reciprocalTagContext?: boolean; answers?: Array<{ text?: string; isMatch?: boolean; isIgnore?: boolean }> }>;
    };
  }): string {
    const questions = talk?.questions ?? talk?.fullTalk?.questions;
    const rootQuestion = Array.isArray(questions) ? questions[0] : undefined;
    if (rootQuestion?.reciprocalTagContext) {
      const only = singleNonIgnoreAnswer(rootQuestion);
      const declaredAnswer = only?.text;
      const keyword = rootQuestion.text;
      if (keyword && declaredAnswer) {
        return declaredAnswer === keyword ? '' : this.renderTagAnswerSuffixHtml(declaredAnswer);
      }
    }
    const keyword = talk?.title ?? talk?.fullTalk?.title;
    const matchAnswerText = rootQuestion?.answers?.find((a) => a?.isMatch)?.text;
    if (!keyword || !matchAnswerText || matchAnswerText === keyword) return '';
    return this.renderTagAnswerSuffixHtml(matchAnswerText);
  }

  private renderTagAnswerSuffixHtml(answer: string): string {
    return `<span class="talk-tag-answer-suffix" style="color:var(--text-tertiary);font-weight:400;margin-left:2px;">?${escapeHtml(answer)}</span>`;
  }

  private formatTalkDistanceFromAuthor(authorLocation: { latitude?: number; longitude?: number } | null | undefined): string {
    if (!this.currentLocation || !authorLocation) return '';
    const latitude = Number(authorLocation.latitude);
    const longitude = Number(authorLocation.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
    const meters = LocationPrivacy.calculateDistance(this.currentLocation, {
      latitude,
      longitude,
      accuracy: 100,
      timestamp: new Date(),
    });
    const miles = meters / 1609.344;
    if (!Number.isFinite(miles)) return '';
    if (miles < 0.1) return '<0.1 mi';
    if (miles < 10) return `~${miles.toFixed(1)} mi`;
    return `~${Math.round(miles)} mi`;
  }

  private formatTalkExpiryTone(expiresAt: unknown): 'neutral' | 'green' | 'amber' | 'red' {
    const ms = resolveExpiresAtMs(expiresAt);
    if (!Number.isFinite(ms)) return 'neutral';
    const left = ms - Date.now();
    if (left <= 0 || left <= 2 * 60 * 60 * 1000) return 'red';
    if (left <= 24 * 60 * 60 * 1000) return 'amber';
    return 'green';
  }

  private getIncomingQuestionCount(cluster: any): number {
    const explicit = Number(cluster?.questionCount);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const questions = cluster?.latestTalk?.questions;
    if (Array.isArray(questions)) return questions.length;
    try {
      const parsed = JSON.parse(String(cluster?.questionsJson || '[]'));
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  private getPreferredTalkLanguage(): string {
    const languages = Array.isArray(this.currentUser?.languages) ? this.currentUser.languages : [];
    const primary = String(languages[0] || '').trim().toLowerCase();
    return primary || getDefaultTalkLanguagePreference(this.getUiLanguage());
  }

  private getIncomingResponseCount(talkId: string): number {
    if (!talkId) return 0;
    const stats = this.talkStatsMap[talkId];
    if (stats?.responses) return stats.responses;
    return readLocalTalkExchanges().filter((exchange) => exchange.talkId === talkId).length;
  }

  private formatUiDate(date: Date): string {
    return date.toLocaleString(this.getUiLanguage() === 'zh' ? 'zh-CN' : 'en-US');
  }

  private formatTalkLanguage(code: string): string {
    const language = LANGUAGE_OPTIONS.find((candidate) => candidate.code === code);
    return languageOptionLabel(this.getUiLanguage(), code, language?.label || code);
  }

  private formatTalkType(type: string): string {
    const key = ({
      tag: 'talkTypeTag',
      flow: 'talkTypeFlow',
      survey: 'talkTypeSurvey',
      route: 'talkTypeRoute',
    } as const)[type.toLowerCase() as 'tag' | 'flow' | 'survey' | 'route'];
    return key ? this.t(key) : type;
  }

  private deliveryReasonLabel(reason: string): string {
    const translationKey = ({
      intake_language: 'reasonIntakeLanguage',
      intake_talk_type: 'reasonIntakeTalkType',
      intake_min_distance: 'reasonIntakeMinDistance',
      intake_max_distance: 'reasonIntakeMaxDistance',
      intake_sent_after: 'reasonIntakeSentAfter',
      intake_grammar: 'reasonIntakeGrammar',
      intake_dirty_words: 'reasonIntakeDirtyWords',
      intake_custom_blocked_terms: 'reasonIntakeCustomTerms',
      talk_expired: 'reasonTalkExpired',
      broadcast_disabled: 'reasonBroadcastDisabled',
      peer_already_sent: 'peerOmitAlreadySent',
      age_gate: 'reasonAgeGate',
      blocked_user: 'reasonBlockedUser',
      broadcast_max_distance: 'reasonBroadcastMaxDistance',
      tag_targeting: 'reasonTagTargeting',
      sender_capacity: 'reasonCapacity',
      symmetric_rate_limit: 'reasonRateLimit',
      daily_talk_send_rate_limit: 'reasonRateLimit',
      daily_talk_receive_rate_limit: 'reasonRateLimit',
      weekly_talk_send_rate_limit: 'reasonRateLimit',
      weekly_talk_receive_rate_limit: 'reasonRateLimit',
    } as Record<string, UiTranslationKey>)[reason];
    return translationKey ? this.t(translationKey) : reason.replace(/_/g, ' ');
  }

  private formatReasonCounts(counts: Record<string, number>): string {
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => `${this.deliveryReasonLabel(reason)}: ${count}`)
      .join(' · ');
  }

  private applyShellTranslations(): void {
    const textBySelector: Array<[string, UiTranslationKey]> = [
      ['.nav-btn[data-view="chatrooms"] .nav-label', 'navChatrooms'],
      ['.nav-btn[data-view="contacts"] .nav-label', 'navContacts'],
      ['.nav-btn[data-view="talks"] .nav-label', 'navTalks'],
      ['.nav-btn[data-view="me"] .nav-label', 'navMe'],
      ['.nav-btn[data-view="settings"] .nav-label', 'navSettings'],
      ['#me-status-text', 'statusMe'],
      ['#settings-status-text', 'statusSettings'],
      ['#create-custom-chatroom-btn .app-bar-btn-label', 'newRoom'],
      ['#return-home-btn .app-bar-btn-label', 'returnHome'],
      ['#broadcast-talk-btn .app-bar-btn-label', 'broadcast'],
      ['#creator-replies-panel strong', 'repliesTitle'],
      ['#reply-clear-filters', 'clear'],
      ['#settings-refresh-location-btn .app-bar-btn-label', 'refreshLocation'],
      ['#me-talk-type-filter-label', 'meTalkTypeFilters'],
      ['.me-talk-type-filter[data-me-talk-type="tag"] .me-talk-type-label', 'talkTypeTag'],
      ['.me-talk-type-filter[data-me-talk-type="flow"] .me-talk-type-label', 'talkTypeFlow'],
      ['.me-talk-type-filter[data-me-talk-type="survey"] .me-talk-type-label', 'talkTypeSurvey'],
      ['.me-talk-type-filter[data-me-talk-type="route"] .me-talk-type-label', 'talkTypeRoute'],
      ['#me-tag-state-filter-label', 'meTagStateFilters'],
      ['.me-tag-state-filter[data-me-tag-state="checked"] .me-tag-state-label', 'meChecked'],
      ['.me-tag-state-filter[data-me-tag-state="unchecked"] .me-tag-state-label', 'meUnchecked'],
      ['.me-tag-state-filter[data-me-tag-state="indeterminate"] .me-tag-state-label', 'meIndeterminate'],
    ];
    for (const [selector, key] of textBySelector) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.textContent = this.t(key);
    }
    // AppBar icon buttons: translated label doubles as the tooltip.
    for (const id of ['create-custom-chatroom-btn', 'return-home-btn', 'broadcast-talk-btn', 'settings-refresh-location-btn']) {
      const btn = document.getElementById(id);
      const label = btn?.querySelector<HTMLElement>('.app-bar-btn-label');
      if (btn && label && id !== 'return-home-btn') btn.title = label.textContent || '';
    }
    for (const id of ['back-to-chatrooms', 'back-to-contacts-list', 'back-to-settings-menu']) {
      const btn = document.getElementById(id);
      if (btn) btn.title = this.t('back');
    }
    document.querySelectorAll<HTMLElement>('.filter-bar-toggle').forEach((toggle) => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.textContent = open ? `${this.t('filters')} ▴` : `${this.t('filters')} ▾`;
    });
    const contactsFilter = document.getElementById('contacts-filter-name') as HTMLInputElement | null;
    if (contactsFilter) contactsFilter.placeholder = this.t('filterByName');
    const replyFilter = document.getElementById('reply-filter-query') as HTMLInputElement | null;
    if (replyFilter) replyFilter.placeholder = this.t('repliesSearchPlaceholder');
    const optionTextBySelector: Array<[string, UiTranslationKey]> = [
      ['#contacts-filter-relation option[value="all"]', 'allRelations'],
      ['#contacts-filter-relation option[value="friend"]', 'friends'],
      ['#contacts-filter-relation option[value="relative"]', 'relatives'],
      ['#contacts-filter-relation option[value="coworker"]', 'coworkers'],
      ['#contacts-filter-relation option[value="acquaintance"]', 'acquaintances'],
      ['#contacts-filter-relation option[value="partner"]', 'partners'],
      ['#contacts-filter-relation option[value="custom"]', 'custom'],
      ['#contacts-filter-outcome option[value="all"]', 'contactsOutcomeAll'],
      ['#contacts-filter-outcome option[value="matched"]', 'contactsOutcomeMatched'],
      ['#contacts-filter-outcome option[value="unmatched"]', 'contactsOutcomeUnmatched'],
      ['#contacts-sort-order option[value="recent"]', 'recent'],
      ['#contacts-sort-order option[value="talks"]', 'talkCount'],
      ['#contacts-sort-order option[value="matches"]', 'matchedTalks'],
      ['#contacts-sort-order option[value="match-rate"]', 'matchRate'],
      ['#contacts-sort-order option[value="weighted"]', 'relevanceScore'],
      ['#contacts-sort-order option[value="name"]', 'name'],
      ['#contacts-sort-order option[value="relationship"]', 'relationship'],
      ['#talks-out-sort-order option[value="recent"]', 'talksLatestActivity'],
      ['#talks-out-sort-order option[value="oldest"]', 'talksOldestCreation'],
      ['#talks-out-sort-order option[value="latest-reply"]', 'talksLatestReply'],
      ['#talks-out-sort-order option[value="matches"]', 'talksMostMatches'],
      ['#talks-out-sort-order option[value="responses"]', 'talksMostReplies'],
      ['#talks-out-sort-order option[value="match-rate"]', 'talksBestMatchRate'],
      ['#talks-out-sort-order option[value="weighted"]', 'talksWeightedPerformance'],
      ['#talks-out-sort-order option[value="title"]', 'talksTitle'],
      ['#reply-filter-outcome option[value="all"]', 'repliesAllOutcomes'],
      ['#reply-filter-outcome option[value="match"]', 'repliesMatches'],
      ['#reply-filter-outcome option[value="mismatch"]', 'repliesMismatches'],
      ['#reply-filter-outcome option[value="ignore"]', 'repliesIgnored'],
      ['#reply-filter-outcome option[value="auto"]', 'repliesAutomatic'],
      ['#reply-filter-relationship option[value="all"]', 'allRelations'],
      ['#reply-filter-relationship option[value="stranger"]', 'repliesStrangers'],
      ['#reply-filter-relationship option[value="friend"]', 'friends'],
      ['#reply-filter-relationship option[value="relative"]', 'relatives'],
      ['#reply-filter-relationship option[value="coworker"]', 'coworkers'],
      ['#reply-filter-relationship option[value="acquaintance"]', 'acquaintances'],
      ['#reply-filter-relationship option[value="partner"]', 'partners'],
      ['#reply-filter-relationship option[value="custom"]', 'custom'],
      ['#reply-filter-type option[value="all"]', 'repliesAllTypes'],
      ['#reply-filter-language option[value="all"]', 'repliesAllLanguages'],
      ['#reply-sort-order option[value="recent"]', 'repliesNewestFirst'],
      ['#reply-sort-order option[value="oldest"]', 'repliesOldestFirst'],
      ['#reply-sort-order option[value="user"]', 'repliesStageName'],
      ['#reply-sort-order option[value="talk"]', 'repliesTalkTitle'],
      ['#reply-sort-order option[value="relationship"]', 'repliesRelationship'],
      ['#reply-sort-order option[value="matches"]', 'repliesMatches'],
      ['#reply-sort-order option[value="talk-matches"]', 'repliesMatchesPerTalk'],
      ['#reply-sort-order option[value="talk-replies"]', 'repliesPerTalk'],
      ['#reply-sort-order option[value="weighted"]', 'relevanceScore'],
      ['#reply-group-order option[value="none"]', 'repliesNoGrouping'],
      ['#reply-group-order option[value="responder"]', 'repliesGroupUser'],
      ['#reply-group-order option[value="talk"]', 'repliesGroupTalk'],
      ['#reply-group-order option[value="relationship"]', 'repliesGroupRelation'],
      ['#reply-group-order option[value="day"]', 'repliesGroupDay'],
    ];
    for (const [selector, key] of optionTextBySelector) {
      const option = document.querySelector<HTMLOptionElement>(selector);
      if (option) option.textContent = this.t(key);
    }
    for (const language of LANGUAGE_OPTIONS) {
      const option = document.querySelector<HTMLOptionElement>(`#reply-filter-language option[value="${language.code}"]`);
      if (option) option.textContent = languageOptionLabel(this.getUiLanguage(), language.code, language.label);
    }
  }

  // Callback for stage name changes
  public onStageNameChange?: (userId: string, newStageName: string) => Promise<void>;
  public onProfileChange?: (
    userId: string,
    updates: { headshot?: string; languages: string[]; profile: QuestionAnswer[]; interests: Tag[] },
  ) => Promise<void>;

  getChatroomMemberCount(chatroomId: string): number {
    return this.chatroomMemberCounts.get(chatroomId) || 0;
  }

  setApiBase(base: string): void {
    this.apiBase = base;
  }

  setCurrentLocation(location: GPSCoordinate | undefined): void {
    this.currentLocation = location;
    this.syncReturnHomeButton();
    if (this.currentUser) this.renderSettingsView(this.currentUser);
  }

  setPublicProfileFoundationReader(reader: PublicProfileFoundationReader | undefined): void {
    this.publicProfileFoundationReader = reader;
  }

  setContactPreRenderSync(sync: ContactPreRenderSync | undefined): void {
    this.contactPreRenderSync = sync;
  }

  setPeerLocationReader(reader: PeerLocationReader | undefined): void {
    this.peerLocationReader = reader;
  }

  private async getPeerLocation(peerId: string): Promise<GPSCoordinate | null> {
    if (this.peerLocationCache.has(peerId)) {
      return this.peerLocationCache.get(peerId) ?? null;
    }
    if (!this.peerLocationReader) return null;
    try {
      const loc = await this.peerLocationReader(peerId);
      const result = loc ?? null;
      this.peerLocationCache.set(peerId, result);
      return result;
    } catch {
      this.peerLocationCache.set(peerId, null);
      return null;
    }
  }

  private async prefetchPeerLocations(peerIds: string[]): Promise<void> {
    const uncached = peerIds.filter((id) => !this.peerLocationCache.has(id));
    if (uncached.length === 0) return;
    await Promise.race([
      Promise.all(uncached.map((id) => this.getPeerLocation(id))),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  /**
   * TODO §M6: cache modeled on peerLocationCache above, but deliberately NOT awaited in
   * beforeRender (unlike prefetchPeerLocations) — R's audit found Contacts already has a
   * blocking pre-render chain, and this shouldn't add another wait on top of it. Called
   * per-peer, non-blocking, from contacts-view.ts's row-patch loop instead; a headshot is a
   * full base64 payload so this is worth caching, not re-fetching on every re-sort/filter.
   */
  private async resolvePeerHeadshot(peerId: string): Promise<string | null> {
    if (this.peerHeadshotCache.has(peerId)) return this.peerHeadshotCache.get(peerId) ?? null;
    if (!this.publicProfileFoundationReader) return null;
    try {
      const foundation = await this.publicProfileFoundationReader(peerId);
      const headshot = foundation?.headshot ?? null;
      this.peerHeadshotCache.set(peerId, headshot);
      return headshot;
    } catch {
      this.peerHeadshotCache.set(peerId, null);
      return null;
    }
  }

  private distanceMilesFromCache(userId: string): number | undefined {
    if (!this.currentLocation || !this.peerLocationReader) return undefined;
    const peerLoc = this.peerLocationCache.get(userId);
    if (!peerLoc) return undefined;
    return LocationPrivacy.calculateDistance(this.currentLocation, peerLoc) / 1609.34;
  }

  private getHomeChatroomId(): string {
    if (this.travelModeActive && this.travelHomeChatroomId) return this.travelHomeChatroomId;
    if (this.currentLocation) {
      const path = getLocationChatroomPath(this.currentLocation);
      return path[path.length - 1] || 'global';
    }
    return 'global';
  }

  private syncReturnHomeButton(): void {
    const btn = document.getElementById('return-home-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const home = this.getHomeChatroomId();
    let effectiveRoom = this.currentChatroom;
    if (!effectiveRoom) {
      const fromApp = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { chatroomService?: { getCurrentChatroomId: () => string } } };
        }
      ).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.();
      if (fromApp) effectiveRoom = fromApp;
    }
    effectiveRoom = effectiveRoom || 'global';
    const away = effectiveRoom !== home;
    btn.disabled = !away;
    btn.title = away ? `Return to ${this.resolveChatroomTitle(home)}` : 'Already in your home room';
  }

  setCustomChatroomsFromServer(rows: CustomChatroomRow[]): void {
    this.customChatrooms = Array.isArray(rows) ? [...rows] : [];
    this.renderChatroomList();
  }

  upsertCustomChatroomFromServer(row: CustomChatroomRow): void {
    if (!row?.id) return;
    const existingIndex = this.customChatrooms.findIndex((candidate) => candidate.id === row.id);
    if (existingIndex >= 0) {
      this.customChatrooms[existingIndex] = row;
    } else {
      this.customChatrooms.push(row);
    }
    this.renderChatroomList();
  }

  getCustomChatroomIds(): string[] {
    return this.customChatrooms.map((r) => r.id).filter(Boolean);
  }

  getCustomChatroomMeta(chatroomId: string): CustomChatroomRow | undefined {
    return this.customChatrooms.find((c) => c.id === chatroomId);
  }

  /**
   * Title for status bar and headers: custom/business rooms, hierarchy, then formatted id.
   */
  resolveChatroomTitle(chatroomId: string): string {
    const custom = this.customChatrooms.find((c) => c.id === chatroomId);
    if (custom) {
      const icon = custom.type === 'business' ? '🏪' : '💬';
      return `${icon} ${custom.name}`;
    }
    const flat = getFlatChatroomList();
    const node = flat.find((n) => n.id === chatroomId);
    if (node) return `${node.icon} ${node.name}`;
    const findInTree = (node: ReturnType<typeof getActiveChatroomHierarchy>): string | null => {
      if (node.id === chatroomId) return node.name;
      if (node.children) {
        for (const ch of node.children) {
          const r = findInTree(ch);
          if (r) return r;
        }
      }
      return null;
    };
    const treeName = findInTree(getActiveChatroomHierarchy());
    if (treeName) return treeName;
    return chatroomId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private getMyTalks(): Record<string, any> {
    return getMyTalks();
  }

  /**
   * True when `receiverId` has not yet been sent `talkId` at its current content identity.
   * docs/TODO.md §W Gap 2 — this used to be a room-scoped localStorage revision-key check
   * (`broadcastConversationHistory`); now delegates to the same ledger `sent`/`exchanged`
   * suppression `deliverTalkToReceiversOverMesh` itself enforces, so there is one source of
   * truth instead of two. `chatroomId` is accepted for call-site compatibility but unused —
   * suppression is peer+identity scoped, not room-scoped: if this exact talk content was
   * already sent to `receiverId` in a different room, it should stay suppressed here too.
   * Content-hash keyed (`computeTalkIdFromTalkData`), so a genuinely revised talk (different
   * title/questions) always reads as unsent; a metadata-only touch (e.g. `lastInteraction`)
   * does not.
   *
   * For `type: 'tag'` talks, `deliverTalkToReceiversOverMesh` records `sent` under per-tag
   * identity keys (`buildTagIdentityKeys`), never the whole-talk key — so this must check the
   * same per-tag keys (any one still unsent = a partial resend is still owed to this receiver),
   * not the whole-talk key, or a tag talk would always read as "unsent" for everyone forever.
   */
  private isBroadcastUnsentForReceiver(_chatroomId: string, receiverId: string, talkId: string): boolean {
    const talk = this.getMyTalks()[talkId];
    const fullTalk = talk?.fullTalk || talk;
    if (!fullTalk) return true;
    const wholeTalkIdentityKey = computeTalkIdFromTalkData(fullTalk);
    const identityKeys = buildTagIdentityKeys(fullTalk, wholeTalkIdentityKey);
    return identityKeys.some((identityKey) => !shouldSuppressForPeer(receiverId, identityKey));
  }

  private getUnsentBroadcastTalkIds(chatroomId: string, receiverIds: string[]): string[] {
    return this.getBroadcastableTalkIds().filter((talkId) => receiverIds.some((receiverId) =>
      this.isBroadcastUnsentForReceiver(chatroomId, receiverId, talkId)));
  }

  private getUnsentBroadcastTalkIdsForReceiver(chatroomId: string, receiverId: string): string[] {
    return this.getBroadcastableTalkIds().filter((talkId) =>
      this.isBroadcastUnsentForReceiver(chatroomId, receiverId, talkId));
  }

  /**
   * docs/TODO.md §W Gap 1: `getUnsentBroadcastTalkIds` above is room-wide — a talk stays in
   * everyone's batch if *any* member still needs it, which can re-attempt delivery to a
   * receiver who already has it. This computes the same per-receiver truth
   * `getUnsentBroadcastTalkIdsForReceiver` already uses, but keyed by talk instead of by
   * receiver, so a single broadcast call can pass each talk its own narrower receiver list
   * instead of the full room.
   */
  getUnsentBroadcastTalkReceiverIds(
    chatroomId: string,
    talkIds: string[],
    receiverIds: string[],
  ): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const talkId of talkIds) {
      result[talkId] = receiverIds.filter((receiverId) =>
        this.isBroadcastUnsentForReceiver(chatroomId, receiverId, talkId));
    }
    return result;
  }

  initialize(): void {
    const container = document.getElementById('app');
    if (!container) {
      throw new Error('App container not found');
    }
    this.appContainer = container;
    this.setupBaseUI();
    this.setupMediaGallery();
    this.setupLightbox();
    this.applyShellTranslations();
    // Diagnostic conversation lines (transport / fallback / last-contact) are hidden by
    // default; enable with ?debug=1 or localStorage iinpublic_debug=1.
    document.body.classList.toggle('iinpublic-debug', this.isDebugModeEnabled());
  }

  /** First paint: render the deterministic room hierarchy before identity/network hydration. */
  showStartupInterface(): void {
    const headerStatus = document.getElementById('header-status');
    if (headerStatus) headerStatus.style.display = 'flex';
    this.currentChatroom = localStorage.getItem('iinpublic_last_chatroom') || 'global';
    this.showChatroomList();
  }

  /** Debug view flag: ?debug=1 in the URL, or localStorage iinpublic_debug=1. */
  private isDebugModeEnabled(): boolean {
    try {
      if (new URLSearchParams(window.location.search).get('debug') === '1') return true;
      return localStorage.getItem('iinpublic_debug') === '1';
    } catch {
      return false;
    }
  }

  private setupBaseUI(): void {
    if (!this.appContainer) return;

    this.appContainer.innerHTML = `
      <div class="app-container">
        <!-- Single AppBar (replaces the old top-header + per-view tab-action-bar double row) -->
        <div class="app-bar top-header" id="top-header">
          <div class="app-bar-left" id="app-bar-left">
            <button class="app-bar-back-btn" id="back-to-chatrooms" data-testid="back-to-chatrooms" data-appbar-view="chatrooms" title="Back" style="display:none;">‹</button>
            <button class="app-bar-back-btn" id="back-to-contacts-list" data-testid="back-to-contacts-list" data-appbar-view="contacts" title="Back" style="display:none;">‹</button>
            <button class="app-bar-back-btn" id="back-to-settings-menu" data-testid="back-to-settings-menu" data-appbar-view="settings" title="Back" style="display:none;">‹</button>
          </div>
          <div class="app-bar-center" id="app-bar-center">
            <div class="header-title" id="header-title"></div>
            <div class="header-status" id="header-status" style="display: none;">
              <div class="header-user-info" id="header-user-info"></div>
              <span class="header-status-text" id="status-bar-text" data-header-status-view="chatrooms">Connecting...</span>
              <span class="header-status-text" id="me-status-text" data-header-status-view="me" hidden>Answered question history</span>
              <span class="header-status-text" id="settings-status-text" data-header-status-view="settings" hidden>Feature and filter controls</span>
              <span id="broadcast-bulk-ack" data-testid="broadcast-bulk-ack" hidden></span>
            </div>
          </div>
          <div class="header-actions app-bar-right" id="header-actions">
            <!-- TODO §N2: visible from every tab (no data-appbar-view, so syncAppBarActionsForView's
                 per-view hide/show never touches it) — opens a sorted list of senders with unread
                 messages, badge-driven off the same aggregate unread count updateMatchBadge computes. -->
            <button type="button" class="header-btn" id="dm-inbox-btn" data-testid="dm-inbox-btn" title="Direct messages">
              <span class="app-bar-btn-icon">💬</span>
            </button>
            <span class="app-bar-actions" id="app-bar-actions">
              <button class="header-btn app-bar-action-btn" id="create-talk-btn" data-testid="create-talk-btn" data-appbar-view="chatrooms talks" data-appbar-priority="0" title="Create talk"><span class="app-bar-btn-icon">➕</span><span class="app-bar-btn-label">Create talk</span></button>
              <button type="button" class="header-btn app-bar-action-btn status-broadcast-btn" id="broadcast-talk-btn" data-testid="broadcast-talk-btn" data-appbar-view="chatrooms" data-appbar-priority="1" title="Send every talk in your OUT list to everyone in this chatroom"><span class="app-bar-btn-icon">📣</span><span class="app-bar-btn-label">Broadcast</span></button>
              <button type="button" class="header-btn app-bar-action-btn" id="return-home-btn" data-testid="return-home-btn" data-appbar-view="chatrooms" data-appbar-priority="2" disabled title="Return Home"><span class="app-bar-btn-icon">🏠</span><span class="app-bar-btn-label">Return Home</span></button>
              <button type="button" class="header-btn app-bar-action-btn" id="create-custom-chatroom-btn" data-testid="create-custom-chatroom-btn" data-appbar-view="chatrooms" data-appbar-priority="3" title="New Room"><span class="app-bar-btn-icon">🆕</span><span class="app-bar-btn-label">New Room</span></button>
              <button type="button" class="header-btn app-bar-action-btn" id="settings-refresh-location-btn" data-testid="settings-refresh-location-btn" data-appbar-view="settings" data-appbar-priority="4" title="Refresh Location"><span class="app-bar-btn-icon">📍</span><span class="app-bar-btn-label">Refresh Location</span></button>
            </span>
            <div class="app-bar-overflow-menu" id="app-bar-overflow-menu" style="display:none;">
              <button type="button" class="header-btn app-bar-overflow-btn" id="app-bar-overflow-btn" data-testid="app-bar-overflow-btn" title="More">⋯</button>
              <div class="app-bar-overflow-panel" id="app-bar-overflow-panel"></div>
            </div>
          </div>
        </div>

        <!-- Main View Container -->
        <div class="view-container">

          <!-- Chatrooms View (Default) -->
          <div class="view-panel active" id="chatrooms-view">
            <!-- Chatroom List -->
            <div class="chatroom-list-container" id="chatroom-list-container">
              <div class="chatroom-list" id="chatroom-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading chatrooms...</p>
              </div>
            </div>

            <!-- Chatroom Detail (Hidden by default) -->
            <div class="chatroom-detail-container" id="chatroom-detail-container" style="display: none;">
              <div class="chatroom-detail-header">
                <div class="chatroom-detail-info" id="chatroom-detail-info">
                  <div class="chatroom-detail-title" id="current-chatroom-title">Global Chatroom</div>
                  <div class="chatroom-detail-status" id="current-chatroom-status">Loading...</div>
                </div>
              </div>
              <div id="chatroom-owner-bar" style="display: none; padding: 0 16px;"></div>
              <div id="chatroom-metadata" style="display: none;"></div>
              <div class="chatroom-members-list" id="chatroom-members-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading members...</p>
              </div>
            </div>
          </div>

          <!-- Contacts View (users who have matches with current user) -->
          <div class="view-panel" id="contacts-view">
            <div class="view-content">
              <div class="filter-bar contacts-action-bar">
                <button type="button" class="filter-bar-toggle" data-testid="contacts-filter-toggle" aria-expanded="false">Filters ▾</button>
                <button type="button" class="btn contacts-broadcast-icon-btn" id="contacts-broadcast-group-btn" data-testid="contacts-broadcast-group-btn" title="${this.t('contactsBroadcastGroupBtn')}" aria-label="${this.t('contactsBroadcastGroupBtn')}">📣</button>
                <div class="filter-bar-content">
                <input class="form-input" id="contacts-filter-name" type="search" placeholder="Filter by name" style="flex:1 1 160px; min-width:0;">
                <select class="form-input" id="contacts-filter-relation" style="flex:0 0 150px;">
                  <option value="all">All relations</option>
                  <option value="friend">Friends</option>
                  <option value="relative">Relatives</option>
                  <option value="coworker">Coworkers</option>
                  <option value="acquaintance">Acquaintances</option>
                  <option value="partner">Partners</option>
                  <option value="custom">Custom</option>
                </select>
                <select class="form-input" id="contacts-filter-outcome" style="flex:0 0 140px;">
                  <option value="all">All outcomes</option>
                  <option value="matched">Matched</option>
                  <option value="unmatched">Not matched</option>
                </select>
                <select class="form-input" id="contacts-sort-order" style="flex:0 0 150px;">
                  <option value="recent">Recent</option>
                  <option value="talks">Talk count</option>
                  <option value="matches">Matched talks</option>
                  <option value="match-rate">Match rate</option>
                  <option value="weighted">Relevance score</option>
                  <option value="name">Name</option>
                  <option value="relationship">Relationship</option>
                </select>
                </div>
              </div>
              <div class="embedded-stats-strip" id="contacts-stats-strip" style="padding:8px 12px;color:var(--text-tertiary);font-size:0.88em;"></div>
              <div class="contacts-list-container" id="contacts-list-container">
                <div class="contacts-list" id="contacts-list">
                  <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Match with others via Talks to see them here.</p>
                </div>
              </div>
              <!-- The old contact-detail page is retired (redesign §5): contact rows land
                   on the shared ⟨User⟩ layout (#peer-detail-overlay) via rule N2a. -->
            </div>
          </div>

          <!-- Talks View -->
          <div class="view-panel" id="talks-view">
            <div class="view-content" id="talks-view-content">
              <div class="filter-bar talks-action-bar">
                <div class="talks-primary-filters" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; flex:1 1 auto; font-size:0.88em;">
                  <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" id="talks-filter-incoming" checked> In
                  </label>
                  <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" id="talks-filter-outgoing" checked> Out
                  </label>
                  <span style="width:1px;align-self:stretch;background:var(--border);"></span>
                  <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" class="talks-type-checkbox" value="tag" checked> Tag
                  </label>
                  <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" class="talks-type-checkbox" value="flow" checked> Flow
                  </label>
                  <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" class="talks-type-checkbox" value="survey" checked> Survey
                  </label>
                  <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" class="talks-type-checkbox" value="route" checked> Route
                  </label>
                </div>
                <button type="button" class="filter-bar-toggle" data-testid="talks-filter-toggle" aria-expanded="false">Filters ▾</button>
                <div class="filter-bar-content">
                <select class="form-input" id="talks-out-sort-order" aria-label="Sort outgoing talks" style="flex:0 0 180px;">
                  <option value="recent">Latest activity</option>
                  <option value="oldest">Oldest creation</option>
                  <option value="latest-reply">Latest reply</option>
                  <option value="matches">Most matches</option>
                  <option value="responses">Most replies</option>
                  <option value="match-rate">Best match rate</option>
                  <option value="weighted">Weighted performance</option>
                  <option value="title">Title</option>
                </select>
                <input class="form-input" id="talks-filter-query" aria-label="Search talks" type="search" placeholder="Search talks" style="flex:1 1 150px; min-width:0;">
                <select class="form-input" id="talks-filter-completion" aria-label="Filter talks by completion" style="flex:0 0 135px;">
                  <option value="all">Any status</option>
                  <option value="unanswered">Unanswered</option>
                  <option value="answered">Answered</option>
                </select>
                <select class="form-input" id="talks-filter-outcome" aria-label="Filter talks by outcome" style="flex:0 0 130px;">
                  <option value="all">Any outcome</option>
                  <option value="match">Matched</option>
                  <option value="mismatch">Unmatched</option>
                </select>
                <input class="form-input" id="talks-filter-date-from" aria-label="Talks from date" type="date" style="flex:0 0 140px;">
                <input class="form-input" id="talks-filter-date-to" aria-label="Talks through date" type="date" style="flex:0 0 140px;">
                </div>
              </div>
              <div class="embedded-stats-strip" id="talks-stats-strip" style="padding:8px 12px;color:var(--text-tertiary);font-size:0.88em;"></div>
              <section id="creator-replies-panel" style="display:none;padding:12px;border-bottom:1px solid var(--border);background:var(--surface);">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px;">
                  <strong>Replies To My Talks</strong>
                  <span id="creator-replies-summary" style="font-size:0.85em;color:var(--text-tertiary);">Loading...</span>
                </div>
                <button type="button" class="filter-bar-toggle" data-testid="replies-filter-toggle" aria-expanded="false" style="margin-bottom:8px;">Filters ▾</button>
                <div class="filter-bar-content" style="margin-bottom:8px;">
                  <input class="form-input" id="reply-filter-query" type="search" placeholder="Stage name or talk" style="flex:1 1 170px;">
                  <select class="form-input" id="reply-filter-outcome" style="flex:0 0 125px;">
                    <option value="all">All outcomes</option>
                    <option value="match">Matches</option>
                    <option value="mismatch">Mismatches</option>
                    <option value="ignore">Ignored</option>
                    <option value="auto">Automatic</option>
                  </select>
                  <select class="form-input" id="reply-filter-relationship" style="flex:0 0 145px;">
                    <option value="all">All relations</option>
                    <option value="stranger">Strangers</option>
                    <option value="friend">Friends</option>
                    <option value="relative">Relatives</option>
                    <option value="coworker">Coworkers</option>
                    <option value="acquaintance">Acquaintances</option>
                    <option value="partner">Partners</option>
                    <option value="custom">Custom</option>
                  </select>
                  <select class="form-input" id="reply-filter-type" aria-label="Filter replies by talk type" style="flex:0 0 125px;">
                    <option value="all">All types</option>
                    <option value="flow">Flow</option>
                    <option value="tag">Tag</option>
                    <option value="survey">Survey</option>
                    <option value="route">Route</option>
                  </select>
                  <select class="form-input" id="reply-filter-language" aria-label="Filter replies by language" style="flex:0 0 145px;">
                    <option value="all">All languages</option>
                    ${LANGUAGE_OPTIONS.map((lang) => `<option value="${lang.code}">${lang.label}</option>`).join('')}
                  </select>
                  <input class="form-input" id="reply-filter-from" type="date" aria-label="Replies from date" style="flex:0 0 145px;">
                  <input class="form-input" id="reply-filter-to" type="date" aria-label="Replies to date" style="flex:0 0 145px;">
                  <select class="form-input" id="reply-sort-order" style="flex:0 0 165px;">
                    <option value="recent">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="user">Stage name</option>
                    <option value="talk">Talk title</option>
                    <option value="relationship">Relationship</option>
                    <option value="matches">Most matches</option>
                    <option value="talk-matches">Matches per talk</option>
                    <option value="talk-replies">Replies per talk</option>
                    <option value="weighted">Relevance score</option>
                    <option value="match-percent">Match % (highest first)</option>
                  </select>
                  <select class="form-input" id="reply-group-order" aria-label="Group replies" style="flex:0 0 150px;">
                    <option value="none">No grouping</option>
                    <option value="responder">Group by user</option>
                    <option value="talk">Group by talk</option>
                    <option value="relationship">Group by relation</option>
                    <option value="day">Group by day</option>
                  </select>
                  <button class="btn" id="reply-clear-filters" type="button">Clear</button>
                </div>
                <div id="creator-replies-active-filters" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>
                <div id="creator-replies-list" style="display:grid;gap:6px;max-height:280px;overflow:auto;"></div>
              </section>
              <div class="talks-list" id="talks-list">
                <p style="text-align: center; padding: 40px 20px; color: #999;">No talks yet. Create your first talk!</p>
              </div>
            </div>
          </div>

          <!-- Conversations View (Hidden overlay, opened when clicking on a user) -->
          <div class="conversation-detail-overlay" id="conversation-detail-overlay" style="display: none;">
            <div class="conversation-detail-container">
              <div class="conversation-detail-header">
                <button class="back-btn" id="back-from-conversation">‹ Back</button>
                <div class="conversation-detail-info" id="conversation-detail-info">
                  <div class="conversation-detail-name" id="conversation-user-name">User</div>
                  <div class="conversation-thread-scope" id="conversation-thread-scope" style="display:none;font-size:0.82em;color:var(--accent);font-weight:600;"></div>
                  <div class="conversation-deal-bar" id="conversation-deal-bar" style="display:none;align-items:center;gap:8px;font-size:0.85em;">
                    <span id="conversation-deal-status"></span>
                    <button class="btn" id="conversation-confirm-deal-btn" type="button" style="display:none;padding:4px 10px;font-size:0.85em;">Confirm Deal</button>
                  </div>
                  <div class="conversation-detail-status" id="conversation-status">Online</div>
                  <div class="conversation-transport-status" id="conversation-transport-status"></div>
                  <div class="conversation-fallback-status" id="conversation-fallback-status"></div>
                  <div class="conversation-health-status" id="conversation-health-status"></div>
                </div>
                <button class="conversation-media-btn" id="conversation-media-btn" type="button" title="Shared media" aria-label="Shared media">🖼</button>
              </div>
              <div class="conversation-messages" id="conversation-messages">
                <p style="text-align: center; padding: 20px; color: #999;">Start your conversation!</p>
              </div>
              <div class="conversation-media-gallery" id="conversation-media-gallery" style="display:none;">
                <div class="conversation-media-gallery-header">
                  <button class="back-btn" id="back-from-media">‹ Back</button>
                  <div class="conversation-media-title" id="conversation-media-title">Shared media</div>
                </div>
                <div class="conversation-media-tabs" role="tablist">
                  <button class="conversation-media-tab active" data-media-tab="media" type="button">Media</button>
                  <button class="conversation-media-tab" data-media-tab="files" type="button">Files</button>
                  <button class="conversation-media-tab" data-media-tab="links" type="button">Links</button>
                </div>
                <div class="conversation-media-grid" id="conversation-media-grid"></div>
              </div>
              <div class="conversation-input-container">
                <input class="visually-hidden" type="file" id="conversation-attach-input" aria-hidden="true">
                <button class="conversation-attach-btn" id="conversation-attach-btn" type="button" title="Share media link" aria-label="Share media link">📎</button>
                <textarea id="conversation-message-input" placeholder="Type a message..." rows="2"></textarea>
                <button class="btn send-btn" id="send-conversation-message">Send</button>
              </div>
            </div>
          </div>

          <!-- In-app full-size photo viewer (lightbox) -->
          <div class="media-lightbox" id="media-lightbox" style="display:none;">
            <div class="media-lightbox-backdrop" id="media-lightbox-backdrop"></div>
            <div class="media-lightbox-bar">
              <span class="media-lightbox-name" id="media-lightbox-name"></span>
              <button class="media-lightbox-action" id="media-lightbox-download" type="button">⬇</button>
              <button class="media-lightbox-action" id="media-lightbox-close" type="button" aria-label="Close">✕</button>
            </div>
            <img class="media-lightbox-img" id="media-lightbox-img" alt="" />
          </div>

          <!-- Shared ⟨User⟩ layout (peer + contact detail — redesign §5): AppBar header,
               relationship context, stats, merged messaging (threads + DM), talk history -->
          <div class="peer-detail-overlay" id="peer-detail-overlay" style="display: none;">
            <div class="peer-detail-container">
              <div class="app-bar peer-detail-header">
                <div class="app-bar-left">
                  <button class="app-bar-back-btn" id="back-from-peer-detail" data-testid="back-from-peer-detail" title="Back">‹</button>
                </div>
                <div class="app-bar-center peer-detail-info">
                  <div class="peer-detail-name" id="peer-detail-name">User</div>
                  <div class="peer-detail-subtitle" id="peer-detail-subtitle">Loading...</div>
                </div>
                <div class="app-bar-right">
                  <span class="app-bar-actions">
                    <button class="header-btn app-bar-action-btn" id="peer-send-talks-btn" data-testid="peer-send-talks-btn" title="Send My Talks"><span class="app-bar-btn-icon">📤</span><span class="app-bar-btn-label">Send My Talks</span></button>
                  </span>
                  <div class="app-bar-overflow-menu" style="display:flex;">
                    <button class="header-btn app-bar-overflow-btn" id="peer-overflow-btn" data-testid="peer-overflow-btn" title="More">⋯</button>
                    <div class="app-bar-overflow-panel" id="peer-overflow-panel">
                      <button class="app-bar-action-btn" id="peer-block-user-btn" data-testid="peer-block-user-btn"><span class="app-bar-btn-icon">🚫</span><span class="app-bar-btn-label">Block User</span></button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="peer-detail-body">
                <div id="peer-context-section"></div>
                <div id="peer-linked-identity-section"></div>
                <div id="peer-stats-section"></div>
                <div class="peer-messaging-section" id="peer-messaging-section">
                  <div class="peer-section-title" id="peer-messaging-title" style="font-weight:700;padding:12px 16px 4px;">Messages</div>
                  <div id="peer-conversations-section"></div>
                  <div class="peer-dm-compose" style="padding:8px 16px 12px;">
                    <div id="peer-dm-label" style="font-size:0.85em;color:var(--text-tertiary);margin-bottom:4px;">Send a direct message</div>
                    <textarea id="peer-dm-input" rows="2" placeholder="Type a message…" data-testid="peer-dm-input" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border-strong);border-radius:8px;font-size:0.9em;resize:none;"></textarea>
                    <button class="btn primary-btn" id="peer-dm-send-btn" data-testid="peer-dm-send-btn" style="width:100%;margin-top:6px;">💬 Send Message</button>
                  </div>
                </div>
                <div class="peer-section-header">
                  <div class="peer-section-title" id="peer-talk-history-title" style="font-weight:700;padding:12px 16px 4px;">Talk History</div>
                  <div id="peer-history-controls" style="display:none;padding:8px 16px;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;gap:6px;">
                      <button class="btn peer-sort-btn active" data-sort="date" style="padding:4px 10px;font-size:0.85em;">Date</button>
                      <button class="btn peer-sort-btn" data-sort="outcome" style="padding:4px 10px;font-size:0.85em;">Outcome</button>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button class="btn peer-filter-tab active" data-filter="all" style="padding:4px 10px;font-size:0.85em;">All</button>
                      <button class="btn peer-filter-tab" data-filter="sent" style="padding:4px 10px;font-size:0.85em;">Sent</button>
                      <button class="btn peer-filter-tab" data-filter="received" style="padding:4px 10px;font-size:0.85em;">Received</button>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button class="btn peer-outcome-tab active" data-outcome="all" style="padding:4px 10px;font-size:0.85em;">All</button>
                      <button class="btn peer-outcome-tab" data-outcome="match" style="padding:4px 10px;font-size:0.85em;">Match</button>
                      <button class="btn peer-outcome-tab" data-outcome="mismatch" style="padding:4px 10px;font-size:0.85em;">Mismatch</button>
                    </div>
                  </div>
                </div>
                <div id="peer-talk-history-list"></div>
                <div class="peer-send-section">
                  <label class="peer-auto-mode-label" style="display:flex;align-items:center;gap:8px;padding:12px 16px 16px;font-size:0.9em;cursor:pointer;">
                    <input type="checkbox" id="peer-auto-mode-checkbox" checked>
                    <span id="peer-auto-mode-text">Auto mode - send all new talks automatically</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Me View -->
          <div class="view-panel" id="me-view">
            <div class="view-content">
              <div class="filter-bar me-action-bar" style="gap:12px;">
                <button type="button" class="filter-bar-toggle" data-testid="me-filter-toggle" aria-expanded="false">Filters ▾</button>
                <div class="filter-bar-content" style="gap:12px;">
                <span id="me-talk-type-filter-label" style="font-size:0.82em;color:var(--text-tertiary);font-weight:700;">Talk types</span>
                <label class="me-talk-type-filter" data-me-talk-type="tag" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-talk-type-checkbox" value="tag" checked>
                  <span class="me-talk-type-label">Tag</span>
                </label>
                <label class="me-talk-type-filter" data-me-talk-type="flow" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-talk-type-checkbox" value="flow" checked>
                  <span class="me-talk-type-label">Flow</span>
                </label>
                <label class="me-talk-type-filter" data-me-talk-type="survey" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-talk-type-checkbox" value="survey" checked>
                  <span class="me-talk-type-label">Survey</span>
                </label>
                <label class="me-talk-type-filter" data-me-talk-type="route" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-talk-type-checkbox" value="route" checked>
                  <span class="me-talk-type-label">Route</span>
                </label>
                <span id="me-tag-state-filter-label" style="font-size:0.82em;color:var(--text-tertiary);font-weight:700;margin-left:6px;">Tag states</span>
                <label class="me-tag-state-filter" data-me-tag-state="checked" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-tag-state-checkbox" value="checked" checked>
                  <span class="me-tag-state-label">Checked</span>
                </label>
                <label class="me-tag-state-filter" data-me-tag-state="unchecked" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-tag-state-checkbox" value="unchecked" checked>
                  <span class="me-tag-state-label">Unchecked</span>
                </label>
                <label class="me-tag-state-filter" data-me-tag-state="indeterminate" style="display:flex;align-items:center;gap:5px;font-size:0.86em;">
                  <input type="checkbox" class="me-tag-state-checkbox" value="indeterminate" checked>
                  <span class="me-tag-state-label">Indeterminate</span>
                </label>
                <select class="form-input" id="me-outcome-filter" aria-label="Filter answers by outcome" style="flex:0 0 145px;">
                  <option value="all">All outcomes</option>
                  <option value="match">Liked / matched</option>
                  <option value="mismatch">Disliked / unmatched</option>
                </select>
                <select class="form-input" id="me-answer-sort" aria-label="Sort answered questions" style="flex:0 0 165px;">
                  <option value="answered-desc">Newest answers</option>
                  <option value="answered-asc">Oldest answers</option>
                  <option value="chatbot-recent">Recent chatbot use</option>
                  <option value="chatbot-count">Most chatbot use</option>
                </select>
                <input class="form-input" id="me-answer-filter" aria-label="Filter by selected answer" type="search" placeholder="Selected answer" style="flex:1 1 130px;min-width:0;">
                <input class="form-input" id="me-answer-date-from" aria-label="Answers from date" type="date" style="flex:0 0 142px;">
                <input class="form-input" id="me-answer-date-to" aria-label="Answers through date" type="date" style="flex:0 0 142px;">
                <button class="btn" id="me-clear-filters" type="button">Clear</button>
                </div>
              </div>
              <div class="answers-section">
                <div id="answers-content">
                  <div style="padding: 20px; text-align: center; color: #999;">
                    <p>Your answered questions will appear here.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Settings View -->
          <div class="view-panel" id="settings-view">
            <div class="view-content">
              <div id="settings-content" style="padding:16px;max-width:min(980px,96%);margin:0 auto;"></div>
            </div>
          </div>

        </div>

        <!-- Bottom Navigation Bar -->
        <div class="bottom-nav">
          <button class="nav-btn active" data-view="chatrooms" data-testid="bottom-navigation-button-chat">
            <div class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
            <div class="nav-label">Chatrooms</div>
          </button>
          <button class="nav-btn" data-view="contacts" data-testid="bottom-navigation-button-contacts">
            <div class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <div class="nav-label">Contacts</div>
          </button>
          <button class="nav-btn" data-view="talks">
            <div class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg></div>
            <div class="nav-label">Talks</div>
          </button>
          <button class="nav-btn" data-view="me" data-testid="bottom-navigation-button-me">
            <div class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
            <div class="nav-label">Me</div>
          </button>
          <button class="nav-btn" data-view="settings" data-testid="bottom-navigation-button-settings">
            <div class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></div>
            <div class="nav-label">Settings</div>
          </button>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.setupBottomNavigation();
    this.setupAppBarChrome();
    this.syncAppBarActionsForView('chatrooms');
  }

  /**
   * Wires the single AppBar chrome: the `⋯` overflow menu, the responsive width
   * measurement, and the mobile "Filters ▾" disclosure toggles (redesign §1–§3, §6).
   */
  private setupAppBarChrome(): void {
    const overflowBtn = document.getElementById('app-bar-overflow-btn');
    const panel = document.getElementById('app-bar-overflow-panel');
    if (overflowBtn && panel) {
      overflowBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        panel.classList.toggle('open');
      });
      document.addEventListener('click', (event) => {
        if (!panel.classList.contains('open')) return;
        const target = event.target;
        if (target instanceof Node && (panel.contains(target) || overflowBtn.contains(target))) return;
        panel.classList.remove('open');
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') panel.classList.remove('open');
      });
      // Action buttons keep working from inside the panel (same elements, same
      // listeners); close the panel on any action click. Capture phase, because
      // some button handlers stopPropagation.
      panel.addEventListener(
        'click',
        (event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('.app-bar-action-btn')) {
            panel.classList.remove('open');
          }
        },
        true,
      );
    }
    window.addEventListener('resize', () => this.syncAppBarOverflow());
    // Mobile filter disclosure: every .filter-bar-toggle opens its sibling content panel.
    document.querySelectorAll<HTMLButtonElement>('.filter-bar-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const content = toggle.parentElement?.querySelector<HTMLElement>('.filter-bar-content');
        if (!content) return;
        const open = content.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? `${this.t('filters')} ▴` : `${this.t('filters')} ▾`;
      });
    });
    // docs/TODO.md §U — broadcast to a contact group, from the Contacts tab.
    document.getElementById('contacts-broadcast-group-btn')?.addEventListener('click', () => {
      this.showBroadcastToGroupDialog();
    });
    this.syncAppBarOverflow();
  }

  /**
   * Shows only the AppBar controls scoped to the active tab (`data-appbar-view`),
   * then re-measures the overflow. View scoping uses a dedicated class so it never
   * fights the per-feature `style.display` toggles (travel mode, sub-view backs).
   */
  private syncAppBarActionsForView(viewName: string): void {
    document.querySelectorAll<HTMLElement>('#top-header [data-appbar-view]').forEach((el) => {
      const views = (el.dataset.appbarView || '').split(/\s+/);
      el.classList.toggle('appbar-view-hidden', !views.includes(viewName));
    });
    this.syncAppBarOverflow();
  }

  /**
   * Responsive overflow for the AppBar right zone. Buttons that do not fit move
   * (as the same live elements, ids/testids/handlers intact) into the `⋯` panel,
   * lowest priority first (➕ stays inline longest, then 📣, 🏠, 🆕).
   */
  private syncAppBarOverflow(): void {
    const bar = document.getElementById('top-header');
    const inlineZone = document.getElementById('app-bar-actions');
    const menu = document.getElementById('app-bar-overflow-menu');
    const panel = document.getElementById('app-bar-overflow-panel');
    if (!bar || !inlineZone || !menu || !panel) return;
    const all = [
      ...Array.from(inlineZone.querySelectorAll<HTMLElement>('.app-bar-action-btn')),
      ...Array.from(panel.querySelectorAll<HTMLElement>('.app-bar-action-btn')),
    ].sort((a, b) => Number(a.dataset.appbarPriority || 0) - Number(b.dataset.appbarPriority || 0));
    for (const btn of all) inlineZone.appendChild(btn);
    const active = all.filter((btn) => !btn.classList.contains('appbar-view-hidden') && btn.style.display !== 'none');
    const BTN_W = 40;
    const CENTER_MIN = 150;
    const LEFT_W = 40;
    const PADDING = 30;
    const barWidth = bar.clientWidth;
    if (!barWidth) {
      menu.style.display = 'none';
      return;
    }
    const available = barWidth - LEFT_W - CENTER_MIN - PADDING - BTN_W;
    const overflowing: HTMLElement[] = [];
    let used = 0;
    for (const btn of active) {
      used += BTN_W;
      if (used > available) overflowing.push(btn);
    }
    // If everything fits once the ⋯ slot is reclaimed, keep it all inline.
    if (overflowing.length > 0 && active.length * BTN_W <= available + BTN_W) overflowing.length = 0;
    for (const btn of overflowing) panel.appendChild(btn);
    menu.style.display = overflowing.length > 0 ? 'flex' : 'none';
    if (overflowing.length === 0) panel.classList.remove('open');
  }

  private setupEventListeners(): void {
    // TODO §N2: always-visible DM inbox affordance, reachable from every tab.
    document.getElementById('dm-inbox-btn')?.addEventListener('click', () => this.showDmInboxPicker());

    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
    const createTalkBtn = document.getElementById('create-talk-btn');

    if (sendButton && messageInput) {
      sendButton.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message) {
          if (!this.allowOutgoingMessage(message)) return;
          this.emit('sendMessage', { conversationId: 'default', message });
          messageInput.value = '';
        }
      });

      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendButton.click();
        }
      });

      // Auto-resize textarea
      messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      });
    }

    if (createTalkBtn) {
      createTalkBtn.addEventListener('click', () => {
        this.showTalkEditorDialog();
      });
    }

    const viewPreferencesBtn = document.getElementById('view-preferences-btn');
    if (viewPreferencesBtn) {
      viewPreferencesBtn.addEventListener('click', () => {
        this.showPreferencesDialog();
      });
    }

    // Back to chatrooms button
    const backToChatroomsBtn = document.getElementById('back-to-chatrooms');
    if (backToChatroomsBtn) {
      backToChatroomsBtn.addEventListener('click', () => {
        this.showChatroomList();
      });
    }

    if (!this.chatroomActionDelegationBound) {
      this.chatroomActionDelegationBound = true;
      document.body.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('#create-custom-chatroom-btn')) {
          e.preventDefault();
          void this.handleCreateCustomChatroomClick();
        }
      });
    }

    const returnHomeBtn = document.getElementById('return-home-btn');
    if (returnHomeBtn) {
      returnHomeBtn.addEventListener('click', () => {
        this.emit('returnHomeFromTravel', {});
      });
    }
    const settingsRefreshLocationBtn = document.getElementById('settings-refresh-location-btn');
    if (settingsRefreshLocationBtn) {
      settingsRefreshLocationBtn.addEventListener('click', () => {
        this.emit('requestLocationUpdate', {});
      });
    }
    document.querySelectorAll('.me-talk-type-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => this.applyMeAnswerFilter());
    });
    document.querySelectorAll('.me-tag-state-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => this.applyMeAnswerFilter());
    });
    ['me-outcome-filter', 'me-answer-sort', 'me-answer-date-from', 'me-answer-date-to'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => this.applyMeAnswerFilter());
    });
    document.getElementById('me-answer-filter')?.addEventListener('input', () => this.applyMeAnswerFilter());
    document.getElementById('me-clear-filters')?.addEventListener('click', () => {
      document.querySelectorAll<HTMLInputElement>('.me-talk-type-checkbox').forEach((checkbox) => { checkbox.checked = true; });
      document.querySelectorAll<HTMLInputElement>('.me-tag-state-checkbox').forEach((checkbox) => { checkbox.checked = true; });
      const outcome = document.getElementById('me-outcome-filter') as HTMLSelectElement | null;
      const sort = document.getElementById('me-answer-sort') as HTMLSelectElement | null;
      const answer = document.getElementById('me-answer-filter') as HTMLInputElement | null;
      const from = document.getElementById('me-answer-date-from') as HTMLInputElement | null;
      const to = document.getElementById('me-answer-date-to') as HTMLInputElement | null;
      const search = document.getElementById('answers-search-input') as HTMLInputElement | null;
      if (outcome) outcome.value = 'all';
      if (sort) sort.value = 'answered-desc';
      if (answer) answer.value = '';
      if (from) from.value = '';
      if (to) to.value = '';
      if (search) search.value = '';
      this.applyMeAnswerFilter();
    });

    // Back to contacts list button
    const backToContactsListBtn = document.getElementById('back-to-contacts-list');
    if (backToContactsListBtn) {
      backToContactsListBtn.addEventListener('click', () => {
        this.showContactsList();
      });
    }

    // Back to settings menu button
    const backToSettingsMenuBtn = document.getElementById('back-to-settings-menu');
    if (backToSettingsMenuBtn) {
      backToSettingsMenuBtn.addEventListener('click', () => {
        this.settingsActiveSectionId = null;
        this.applySettingsSectionView(null);
      });
    }

    const broadcastTalkBtn = document.getElementById('broadcast-talk-btn');
    if (broadcastTalkBtn) {
      // Tap: send immediately, no confirmation — the user's own priority, real delivery
      // work (resolving receivers, fetching talk payloads) happens after, and a "Sent"
      // toast (formatBroadcastSent) reports completion. Long-press: open the read-only
      // eligible/excluded-recipients review modal first, for anyone who wants to check
      // before sending — Send/Cancel inside that modal is unchanged.
      const LONG_PRESS_MS = 500;
      let longPressTimer: ReturnType<typeof setTimeout> | null = null;
      let longPressFired = false;
      const clearLongPressTimer = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };
      broadcastTalkBtn.addEventListener('pointerdown', () => {
        longPressFired = false;
        clearLongPressTimer();
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          this.handleBroadcastTalkFromCurrentRoom(false);
        }, LONG_PRESS_MS);
      });
      broadcastTalkBtn.addEventListener('pointerup', clearLongPressTimer);
      broadcastTalkBtn.addEventListener('pointerleave', clearLongPressTimer);
      broadcastTalkBtn.addEventListener('pointercancel', clearLongPressTimer);
      broadcastTalkBtn.addEventListener('click', () => {
        if (longPressFired) {
          longPressFired = false;
          return;
        }
        this.handleBroadcastTalkFromCurrentRoom(true);
      });
    }

    this.restoreTalksTabState();
    document.getElementById('talks-filter-incoming')?.addEventListener('change', (event) => {
      this.talksShowIncoming = (event.currentTarget as HTMLInputElement).checked;
      this.persistTalksTabState();
      this.displayTalksList();
    });
    document.getElementById('talks-filter-outgoing')?.addEventListener('change', (event) => {
      this.talksShowOutgoing = (event.currentTarget as HTMLInputElement).checked;
      this.persistTalksTabState();
      this.displayTalksList();
    });
    document.querySelectorAll<HTMLInputElement>('.talks-type-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const type = checkbox.value;
        if (checkbox.checked) this.talksEnabledTypes.add(type);
        else this.talksEnabledTypes.delete(type);
        this.persistTalksTabState();
        this.displayTalksList();
      });
    });
    document.getElementById('talks-out-sort-order')?.addEventListener('change', (event) => {
      this.talksOutSortMode = (event.currentTarget as HTMLSelectElement).value as typeof this.talksOutSortMode;
      this.persistTalksTabState();
      this.displayTalksList();
    });
    document.getElementById('talks-filter-query')?.addEventListener('input', (event) => {
      this.talksQuery = (event.currentTarget as HTMLInputElement).value;
      this.persistTalksTabState();
      this.displayTalksList();
    });
    document.getElementById('talks-filter-completion')?.addEventListener('change', (event) => {
      this.talksCompletionFilter = (event.currentTarget as HTMLSelectElement).value as typeof this.talksCompletionFilter;
      this.persistTalksTabState();
      this.displayTalksList();
    });
    document.getElementById('talks-filter-outcome')?.addEventListener('change', (event) => {
      this.talksOutcomeFilter = (event.currentTarget as HTMLSelectElement).value as typeof this.talksOutcomeFilter;
      this.persistTalksTabState();
      this.displayTalksList();
    });
    ['talks-filter-date-from', 'talks-filter-date-to'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', (event) => {
        if (id.endsWith('from')) this.talksDateFrom = (event.currentTarget as HTMLInputElement).value;
        else this.talksDateTo = (event.currentTarget as HTMLInputElement).value;
        this.persistTalksTabState();
        this.displayTalksList();
      });
    });
    this.restoreCreatorReplyFilterState();
    ['reply-filter-query', 'reply-filter-outcome', 'reply-filter-relationship', 'reply-filter-type', 'reply-filter-language', 'reply-filter-from', 'reply-filter-to', 'reply-sort-order', 'reply-group-order'].forEach((id) => {
      document.getElementById(id)?.addEventListener(id === 'reply-filter-query' ? 'input' : 'change', () => {
        this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
        this.persistCreatorReplyFilterState();
        // §M1: the panel is normally hidden (display:none) until showCreatorRepliesForTalk
        // opens it — only re-render while it's actually visible.
        if (document.getElementById('creator-replies-panel')?.style.display !== 'none') {
          this.renderCreatorReplies();
        }
      });
    });
    document.getElementById('reply-clear-filters')?.addEventListener('click', () => {
      ['reply-filter-query', 'reply-filter-from', 'reply-filter-to'].forEach((id) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input) input.value = '';
      });
      ['reply-filter-outcome', 'reply-filter-relationship', 'reply-filter-type', 'reply-filter-language', 'reply-sort-order', 'reply-group-order'].forEach((id) => {
        const select = document.getElementById(id) as HTMLSelectElement | null;
        if (select) select.value = id === 'reply-sort-order' ? 'recent' : id === 'reply-group-order' ? 'none' : 'all';
      });
      this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
      this.creatorReplyScopedTalkId = null;
      this.creatorReplyScopedTalkTitle = '';
      this.persistCreatorReplyFilterState();
      if (document.getElementById('creator-replies-panel')?.style.display !== 'none') {
        this.renderCreatorReplies();
      }
    });

  }

  /**
   * Send all broadcastable OUT talks to everyone in the current chatroom (Gun announce + server IN registration).
   */
  private handleBroadcastTalkFromCurrentRoom(automatic: boolean): void {
    void this.runBroadcastFromCurrentRoom(automatic);
  }

  /** Auto-send only the OUT talk revisions not yet delivered to each individual peer. */
  public broadcastPendingTalksOnRoomEntry(): void {
    if (!this.currentChatroom) return;
    this.broadcastPendingTalksToMembers(this.getCurrentChatroomMembers());
  }

  /**
   * Catch a newly-arrived room member up on active broadcasts without replaying anything that
   * this sender has already delivered to that SEA identity. Keeping this receiver-scoped avoids
   * re-flooding the whole room every time one phone appears or reconnects.
   */
  public broadcastPendingTalksToMembers(
    members: Array<{ userId: string; stageName: string }>,
  ): void {
    if (!this.currentChatroom) return;
    for (const peer of members) {
      const talkIds = this.getUnsentBroadcastTalkIdsForReceiver(this.currentChatroom, peer.userId);
      if (talkIds.length > 0) {
        this.emit('broadcastTalk', { chatroomId: this.currentChatroom, members: [peer], talkIds, automatic: true });
      }
    }
  }

  private async runBroadcastFromCurrentRoom(automatic: boolean): Promise<void> {
    let chatroomId = this.currentChatroom;
    if (!chatroomId) {
      const fromApp = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { chatroomService?: { getCurrentChatroomId: () => string } } };
        }
      ).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.();
      if (fromApp) {
        chatroomId = fromApp;
        this.currentChatroom = fromApp;
      }
    }
    if (!chatroomId) {
      this.showNotification(this.t('chatroomOpenFirst'), 'info');
      return;
    }

    // `saveCreatedTalk` runs after `await talkService.createTalk()`; the editor closes synchronously on submit,
    // so a fast Broadcast click can run before OUT rows exist. Briefly retry before opening the editor.
    let broadcastableIds = this.getBroadcastableTalkIds();
    if (broadcastableIds.length === 0) {
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 75);
        });
        broadcastableIds = this.getBroadcastableTalkIds();
        if (broadcastableIds.length > 0) break;
      }
    }

    const broadcastableCount = broadcastableIds.length;
    if (broadcastableCount === 0) {
      this.showTalkEditorDialog();
      setTimeout(() => {
        this.showNotification(this.t('chatroomNoTalksToBroadcast'), 'info');
      }, 0);
      return;
    }

    const fromDom = Array.from(document.querySelectorAll('#chatroom-members-list .chatroom-member-item[data-user-id]')).map(
      (el) => {
        const node = el as HTMLElement;
        return {
          userId: node.dataset.userId || '',
          stageName: (node.dataset.stageName || 'User').trim() || 'User',
        };
      },
    );
    const byId = new Map<string, { userId: string; stageName: string }>();
    for (const m of [...this.currentChatroomMembers, ...fromDom]) {
      const id = (m.userId || '').trim();
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, { userId: id, stageName: m.stageName || id });
    }
    const members = Array.from(byId.values());

    const talkIds = this.getPendingBroadcastTalkIds();
    if (talkIds.length === 0) {
      this.showNotification(this.t('chatroomAlreadyBroadcast'), 'info');
      return;
    }

    // docs/TODO.md §W Gap 1: talkIds above is the room-wide union (a talk stays in it if any
    // member still needs it) — pass each talk's own narrower receiver list too, so a member
    // who already has a given talk isn't re-attempted just because someone else needs it.
    const talkReceiverIds = this.getUnsentBroadcastTalkReceiverIds(
      chatroomId,
      talkIds,
      members.map((m) => m.userId),
    );

    this.maybeShowPreSendSafetyToast();
    this.emit('broadcastTalk', {
      chatroomId,
      members,
      talkIds,
      talkReceiverIds,
      automatic,
    });

    const list = document.getElementById('chatroom-members-list');
    if (list) {
      list.querySelectorAll('.chatroom-member-item').forEach((el) => {
        el.classList.add('broadcast-sent-to');
      });
      setTimeout(() => {
        list.querySelectorAll('.chatroom-member-item').forEach((el) => {
          el.classList.remove('broadcast-sent-to');
        });
      }, 2500);
    }
  }

  private syncStatusBroadcastButtonVisibility(): void {
    syncChatroomBroadcastVisibility(this.currentChatroom);
  }

  private setupBottomNavigation(): void {
    const navButtons = document.querySelectorAll('.nav-btn');
    const viewPanels = document.querySelectorAll('.view-panel');
    const headerTitle = document.getElementById('header-title');
    const headerActions = document.getElementById('header-actions');

    navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetView = (button as HTMLElement).dataset.view;
        if (!targetView) return;
        document.getElementById('broadcast-preamble-modal')?.remove();

        // Update active nav button
        navButtons.forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');

        // Update active view panel
        viewPanels.forEach((panel) => panel.classList.remove('active'));
        const targetPanel = document.getElementById(`${targetView}-view`);
        if (targetPanel) {
          targetPanel.classList.add('active');
        }

        // Update header title and actions
        if (headerTitle) {
          headerTitle.textContent = '';
        }
        this.syncHeaderStatusView(targetView);

        // Show only the AppBar controls scoped to this view (redesign §1–§3).
        if (headerActions) headerActions.style.display = 'flex';
        this.syncAppBarActionsForView(targetView);

        // Special handling for chatrooms view
        if (targetView === 'chatrooms') {
          this.showChatroomList();
        }

        // Special handling for contacts view
        if (targetView === 'contacts') {
          this.dismissMatchNotifications();
          // showContactsList()'s render flow now calls updateStatsStrip itself (with the
          // row-count prefix merged in) once the count is known — calling
          // displayContextualStatistics separately here would flash an un-prefixed version first.
          this.showContactsList();
        }

        // Special handling for talks view
        if (targetView === 'talks') {
          this.emit('needIncomingTalkClusters');
          this.displayTalksList();
          void this.refreshCreatorReplies();
        }

        // Special handling for me view: refresh conversations list and request a source sync.
        if (targetView === 'me') {
          if (this.currentUser) this.showMainInterface(this.currentUser);
          this.emit('needConversationSync');
          this.displayAnswersList();
        }

        if (targetView === 'settings') {
          this.settingsActiveSectionId = null;
          if (this.currentUser) this.renderSettingsView(this.currentUser);
        }
      });
    });
  }

  private syncHeaderStatusView(viewName: string): void {
    document.querySelectorAll<HTMLElement>('.header-status-text[data-header-status-view]').forEach((status) => {
      status.hidden = status.dataset.headerStatusView !== viewName;
    });
  }

  /**
   * Point session state at the app's current `User` reference after server-backed updates
   * (e.g. block/unblock) so `isBlockedByMe` is not stale on a divergent object.
   */
  adoptSessionUser(user: User): void {
    user.languages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.talkFilters = normalizeTalkFilterShape(user.talkFilters, user.languages);
    this.currentUser = user;
    this.currentUserId = user.id;
    this.applyShellTranslations();
  }

  showMainInterface(user: User): void {
    user.languages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.talkFilters = normalizeTalkFilterShape(user.talkFilters, user.languages);
    const hadUserId = !!this.currentUserId;
    this.currentUser = user;
    this.currentUserId = user.id;
    this.applyShellTranslations();
    // If the Contacts tab was opened before the user record finished loading (fast tab
    // click right after a reload), displayContactsList hit its `!currentUserId` guard and
    // rendered a permanent "Could not load contacts." with no retry. Now that the user is
    // known, re-render the list once if that tab is showing.
    if (!hadUserId && document.getElementById('contacts-view')?.classList.contains('active')) {
      this.displayContactsList();
    }
    // Update the persistent header identity without duplicating the generated stage name.
    const headerStatus = document.getElementById('header-status');
    const headerUserInfo = document.getElementById('header-user-info');
    if (headerUserInfo) {
      // K3 (docs/TODO.md): a permanent, always-visible badge whenever the current identity IS
      // the TechSupport root — gated on the id, not on dev-mode, so it also shows for a real
      // production operator device (a developer/operator must always be able to tell they are
      // signed in as TechSupport and not their own ordinary identity).
      const isTechSupportRoot = user.id === TECHSUPPORT_ROOT_USER_ID;
      const techSupportBadge = isTechSupportRoot
        ? `<span class="techsupport-root-badge" data-testid="techsupport-root-badge">${escapeHtml(this.t('techSupportRootBadge'))}</span>`
        : '';
      headerUserInfo.innerHTML = `
        <div class="user-avatar">
          ${avatarInnerHtml(user.headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
        </div>
        <span class="visually-hidden" data-testid="user-stage-name">${user.stageName}</span>
        ${techSupportBadge}
      `;
    }
    if (headerStatus) {
      headerStatus.style.display = 'flex';
    }

    this.renderSettingsView(user);
    this.displayAnswersList();

    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">Global Chatroom</div>
        <div class="chatroom-status">Connected • Ready to meet people nearby</div>
      `;
    }

    // The startup path already painted the deterministic hierarchy. Do not tear it down and
    // render it a second time when identity hydration finishes; live count subscriptions patch
    // it later. Non-startup callers still get the normal list initialization fallback.
    const startupList = document.getElementById('chatroom-list');
    if (!startupList?.querySelector('.chatroom-item')) {
      this.showChatroomList();
    } else {
      this.syncReturnHomeButton();
      this.syncAppBarOverflow();
    }
  }

  showChatroomList(): void {
    // Hide chatroom detail view, show chatroom list
    const listContainer = document.getElementById('chatroom-list-container');
    const detailContainer = document.getElementById('chatroom-detail-container');

    if (listContainer) listContainer.style.display = 'block';
    if (detailContainer) detailContainer.style.display = 'none';
    const backBtn = document.getElementById('back-to-chatrooms') as HTMLElement | null;
    if (backBtn) backBtn.style.display = 'none';
    const createCustomRoomBtn = document.getElementById('create-custom-chatroom-btn') as HTMLButtonElement | null;
    if (createCustomRoomBtn) {
      createCustomRoomBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.handleCreateCustomChatroomClick();
      };
    }

    const ownerBar = document.getElementById('chatroom-owner-bar');
    if (ownerBar) {
      ownerBar.style.display = 'none';
      ownerBar.innerHTML = '';
    }
    const metadata = document.getElementById('chatroom-metadata');
    if (metadata) {
      metadata.style.display = 'none';
      metadata.innerHTML = '';
    }

    // Chatrooms is already identified in the bottom navigation; keep the header focused on status.
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = '';

    // Render the chatroom list
    this.renderChatroomList();
    this.syncReturnHomeButton();
  }

  setTravelModeState(state: { active: boolean; homeChatroomId?: string }): void {
    this.travelModeActive = !!state.active;
    this.travelHomeChatroomId = state.homeChatroomId;
    const homeBtn = document.getElementById('return-home-btn');
    if (homeBtn) {
      homeBtn.style.display = 'inline-flex';
    }
    this.syncReturnHomeButton();
    this.syncAppBarOverflow();
  }

  isTravelModeActive(): boolean {
    return this.travelModeActive;
  }

  getTravelHomeChatroomId(): string | undefined {
    return this.travelHomeChatroomId;
  }

  /**
   * The single ContactsViewDeps builder — every contacts-view entry point uses this
   * object (key invariant: the deps object must stay complete at every call site).
   */
  private contactsViewDeps(onSortRerender?: () => void): ContactsViewDeps {
    return {
      apiBase: this.apiBase,
      currentUserId: this.currentUserId,
      escapeHtml: escapeHtml,
      getKnownPeople: this.getKnownPeople.bind(this),
      getKnownPerson: this.getKnownPerson.bind(this),
      isBlockedByMe: this.isBlockedByMe.bind(this),
      getPeerName: this.getPeerName.bind(this),
      resolvePeerStageName: this.resolvePeerStageNameLive.bind(this),
      // Rule N2a (redesign §5): tapping the contact's NAME lands on the DM Conversation
      // directly, with the shared User layout underneath — identical to a chatroom member
      // click. Tapping the row anywhere else opens the User layout alone (openPeerDetailOnly).
      openPeerDetail: this.openUserConversationFirst.bind(this),
      openPeerDetailOnly: this.openPeerDetailForUser.bind(this),
      updateStatsStrip: (prefix: string) => this.displayContextualStatistics('contacts-stats-strip', prefix),
      getMyConversations: this.getMyConversations.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      saveKnownPerson: this.saveKnownPerson.bind(this),
      submitPeerReview: this.submitPeerReview.bind(this),
      vouchAgeVerified: this.vouchAgeVerified.bind(this),
      setBlocked: this.setBlocked.bind(this),
      hasSupportContact: this.hasSupportContact.bind(this),
      isSupportNotificationsMuted: this.isSupportNotificationsMuted.bind(this),
      setSupportNotificationsMuted: this.setSupportNotificationsMuted.bind(this),
      isTechSupportOnline: this.isTechSupportOnline.bind(this),
      isUserOnline: this.isUserOnline.bind(this),
      text: this.t.bind(this),
      formatLanguage: this.formatTalkLanguage.bind(this),
      getProfileLanguages: () => this.currentUser?.languages || ['en'],
      sortStrategies: SORT_STRATEGIES,
      activeSortId: this.contactsSortId,
      onSortChange: (sortId: string) => {
        this.contactsSortId = sortId;
        onSortRerender?.();
      },
      beforeRender: async () => {
        if (this.contactPreRenderSync) await this.contactPreRenderSync();
        await this.prefetchPeerLocations(this.getKnownPeople().map((p) => p.userId));
      },
      distanceMiles: (userId: string) => this.distanceMilesFromCache(userId),
      getCachedHeadshot: (userId: string) => this.peerHeadshotCache.get(userId) ?? null,
      resolvePeerHeadshot: (userId: string) => this.resolvePeerHeadshot(userId),
      ...(this.publicProfileFoundationReader ? { getPublicProfileFoundation: this.publicProfileFoundationReader } : {}),
    };
  }

  showContactsList(): void {
    openContactsList(this.contactsViewDeps(() => this.showContactsList()));
  }

  displayContactsList(): void {
    renderContactsList(this.contactsViewDeps(() => this.displayContactsList()));
  }

  /** Legacy contact-detail entry — now lands on the shared ⟨User⟩ layout (redesign §5). */
  showContactDetail(otherUserId: string, otherUserName: string): void {
    this.openUserConversationFirst(otherUserId, otherUserName);
  }

  /**
   * Single dispatcher every click-to-traverse handler should route through (docs/TODO.md §Q,
   * build order item 1). Delegates to the existing show-/open- implementations per node type —
   * this only creates the shape; no new call sites are wired up yet.
   */
  navigateToGraphNode(target: GraphNodeTarget): void {
    switch (target.type) {
      case 'chatroom':
        this.showChatroomDetail(target.id);
        break;
      case 'conversation':
        this.showConversationDetail(target.id, target.threadTalkId);
        break;
      case 'person':
        this.showContactDetail(target.id, target.name);
        break;
    }
  }

  /**
   * TODO §N3 (build-order item 8): a talk row's matched-names/sender-name click, when there's
   * more than one exchange partner, opens this picker instead of navigating directly — modeled
   * on the existing `#peer-send-picker-modal` skeleton (`user-detail-view.ts:952-1000`), adapted
   * from "pick which talks to send" to "pick which person to DM." Picking a row navigates via
   * the same `navigateToGraphNode` 'person' destination N1/item 6 already settled on.
   */
  private showChooseWhoToDmPicker(people: Array<{ id: string; name: string }>): void {
    document.getElementById('talk-dm-picker-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'talk-dm-picker-modal';
    modal.className = 'modal-overlay';
    const rows = people
      .map(
        (person) => `
      <div class="talk-dm-picker-row" data-user-id="${escapeHtml(person.id)}" data-user-name="${escapeHtml(person.name)}" style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-muted);border-radius:8px;margin-bottom:6px;cursor:pointer;">
        <span style="font-weight:600;">${escapeHtml(person.name)}</span>
      </div>
    `,
      )
      .join('');
    modal.innerHTML = `
      <div class="modal-content" style="max-width:380px;">
        <div class="modal-header">
          <h2 class="modal-title">${this.t('talksChooseWhoToDm')}</h2>
          <button class="close-button" id="close-talk-dm-picker">&times;</button>
        </div>
        <div style="padding:16px;">${rows}</div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    document.getElementById('close-talk-dm-picker')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
    modal.querySelectorAll<HTMLElement>('.talk-dm-picker-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.userId || '';
        const name = row.dataset.userName || '';
        close();
        if (id) this.navigateToGraphNode({ type: 'person', id, name });
      });
    });
  }

  /**
   * TODO §N2: the "no matter which tab" affordance — reachable from every tab via #dm-inbox-btn
   * (badge-driven off the same aggregate unread count updateMatchBadge computes), lists senders
   * with unread messages sorted most-recent-first. Modeled on showChooseWhoToDmPicker's modal
   * skeleton; picking a row navigates via the same navigateToGraphNode 'person' destination.
   */
  private showDmInboxPicker(): void {
    document.getElementById('dm-inbox-modal')?.remove();
    const conversations = this.getMyConversations();
    const unread = Object.entries(conversations)
      .filter(([, conv]: [string, any]) => conv?.unread && conv.supportChannel !== true && conv.otherUserId)
      .map(([, conv]: [string, any]) => ({
        id: String(conv.otherUserId),
        name: this.getPeerName(conv.otherUserId, conv.otherUserName),
        unreadCount: Number(conv.unreadCount || 0) || 1,
        lastMessageTime: conv.lastMessageTime || conv.createdAt || '',
      }))
      .sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());

    const modal = document.createElement('div');
    modal.id = 'dm-inbox-modal';
    modal.className = 'modal-overlay';
    const rows = unread.length > 0
      ? unread
          .map(
            (person) => `
      <div class="dm-inbox-row" data-user-id="${escapeHtml(person.id)}" data-user-name="${escapeHtml(person.name)}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;background:var(--bg-muted);border-radius:8px;margin-bottom:6px;cursor:pointer;">
        <span style="font-weight:600;">${escapeHtml(person.name)}</span>
        <span class="notification-badge" style="position:static;">${person.unreadCount > 99 ? '99+' : person.unreadCount}</span>
      </div>
    `,
          )
          .join('')
      : `<p style="text-align:center;color:#999;padding:16px 0;">${this.t('dmInboxEmpty')}</p>`;
    modal.innerHTML = `
      <div class="modal-content" style="max-width:380px;">
        <div class="modal-header">
          <h2 class="modal-title">${this.t('dmInboxTitle')}</h2>
          <button class="close-button" id="close-dm-inbox-modal">&times;</button>
        </div>
        <div style="padding:16px;">${rows}</div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    document.getElementById('close-dm-inbox-modal')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
    modal.querySelectorAll<HTMLElement>('.dm-inbox-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.userId || '';
        const name = row.dataset.userName || '';
        close();
        if (id) this.navigateToGraphNode({ type: 'person', id, name });
      });
    });
  }

  /**
   * TODO §M2/§M3: relocates (not clones) a row's hidden `.talk-item-details`/`.answer-item-details`
   * into a shared popup, so already-wired interactive content inside it (matched-names click-to-DM,
   * §N3/item 6) keeps its real event listeners intact — DOM nodes carry their listeners with them
   * across a reparent. Moves it back to its original row on close, restoring display:none.
   */
  private showDetailsPopupFor(detailsEl: HTMLElement, originalParent: HTMLElement): void {
    document.getElementById('item-details-popup')?.remove();
    const modal = document.createElement('div');
    modal.id = 'item-details-popup';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <h2 class="modal-title">${this.t('talksDetails')}</h2>
          <button class="close-button" id="close-item-details-popup">&times;</button>
        </div>
        <div class="item-details-popup-body" style="padding:16px;"></div>
      </div>
    `;
    document.body.appendChild(modal);
    const body = modal.querySelector('.item-details-popup-body') as HTMLElement;
    body.appendChild(detailsEl);
    detailsEl.style.display = 'block';
    const close = () => {
      detailsEl.style.display = 'none';
      originalParent.appendChild(detailsEl);
      modal.remove();
    };
    document.getElementById('close-item-details-popup')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
  }


  /**
   * TODO §Q "Talk -> people I've separately exchanged this with" edge (build-order item 17).
   * Privacy-scoped by construction: reads only the local talkLedger (`web-talk-ledger-store.ts`),
   * this device's own record of talks *I* personally authored or answered — never a mesh-wide
   * identityKey query. Combines both ledger roles for the given identityKey:
   *   - role:'author' entries — responders who answered a talk *I created* with this content
   *     (possibly via a different talkId than the one currently in view, e.g. a separate
   *     broadcast round or a re-created copy).
   *   - role:'responder' entries — authors whose talk *I answered* with this same content
   *     (excludes version:0 "received but not yet answered" seed rows — only real exchanges).
   * `excludePeerIds` drops people already shown by the row's own N3 matched-names/sender-name
   * line, so this surfaces only *additional* co-exchangers, not a duplicate listing.
   */
  private getCoExchangedPeople(
    identityKey: string,
    excludePeerIds: Set<string>,
  ): Array<{ id: string; name: string }> {
    if (!identityKey) return [];
    const doc = getTalkLedgerDoc();
    const resolved = new Map<string, string>();
    for (const entry of Object.values(doc.exchanged)) {
      if (entry.identityKey !== identityKey) continue;
      if (entry.role === 'responder' && entry.outcome === 'no-reply') continue;
      if (excludePeerIds.has(entry.peerId) || resolved.has(entry.peerId)) continue;
      resolved.set(entry.peerId, this.getPeerName(entry.peerId, entry.peerName));
    }
    return Array.from(resolved, ([id, name]) => ({ id, name }));
  }

  private chatroomsDeps(): Parameters<typeof renderChatrooms>[0] {
    return {
      currentChatroom: this.currentChatroom,
      chatroomMemberCounts: this.chatroomMemberCounts,
      chatroomVisitCounts: this.chatroomVisitCounts,
      expandedChatrooms: this.expandedChatrooms,
      matchedUserIds: this.matchedUserIds,
      customChatrooms: this.customChatrooms,
      setCurrentChatroom: (chatroomId) => {
        this.currentChatroom = chatroomId;
        this.syncReturnHomeButton();
      },
      setCurrentChatroomMembers: (members) => { this.currentChatroomMembers = members; },
      escapeHtml: escapeHtml,
      renderChatroomList: this.renderChatroomList.bind(this),
      // Rule N2a (redesign §5): a member click lands on the DM Conversation directly,
      // with the User layout underneath.
      openPeerDetail: this.openUserConversationFirst.bind(this),
      emit: (eventName, payload) => this.emit(eventName, payload),
      currentUserId: this.currentUserId,
      apiBase: this.apiBase,
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
      isTechSupportOnline: this.isTechSupportOnline.bind(this),
      isUserOnline: this.isUserOnline.bind(this),
    };
  }

  private async handleCreateCustomChatroomClick(): Promise<void> {
    const payload = await this.showCreateCustomChatroomDialog();
    if (payload) {
      const creatorId = this.currentUserId || this.currentUser?.id || localStorage.getItem('iinpublic_user_id') || 'local-user';
      try {
        const res = await fetch(`${this.apiBase}/api/chatrooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.name,
            type: payload.type,
            createdBy: creatorId,
            ...(payload.description != null ? { description: payload.description } : {}),
            ...(payload.capacity != null ? { capacity: payload.capacity } : {}),
            ...(payload.businessInfo != null ? { businessInfo: payload.businessInfo } : {}),
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          this.showNotification(text || this.t('chatroomCreateFailed'), 'error');
          return;
        }
        const created = text
          ? JSON.parse(text) as {
              id?: string;
              name?: string;
              type?: string;
              description?: string;
              createdBy?: string;
              capacity?: number;
              createdAt?: string;
              businessInfo?: { headline?: string };
            }
          : null;
        const createdId = String(created?.id || '').trim();
        if (createdId) {
          this.upsertCustomChatroomFromServer({
            id: createdId,
            name: String(created?.name || payload.name),
            type: created?.type === 'business' ? 'business' : 'custom',
            description: String(created?.description || payload.description || ''),
            createdBy: String(created?.createdBy || creatorId),
            ...(created?.capacity != null || payload.capacity != null
              ? { capacity: created?.capacity ?? payload.capacity! }
              : {}),
            ...(created?.createdAt != null ? { createdAt: created.createdAt } : {}),
            ...(created?.businessInfo != null || payload.businessInfo != null
              ? { businessInfo: created?.businessInfo ?? payload.businessInfo! }
              : {}),
          });
          this.showChatroomDetail(createdId);
        }
        this.showNotification(this.tf('chatroomCreated', { name: created?.name || payload.name }), 'success');
      } catch (e) {
        this.showNotification(this.tf('chatroomCreateFailedWithReason', { reason: (e as Error).message }), 'error');
      }
    }
  }

  showCreateCustomChatroomDialog(): Promise<{
    type: 'business' | 'custom';
    name: string;
    description?: string;
    capacity?: number;
    businessInfo?: { headline?: string };
  } | null> {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHtml(this.t('chatroomCreateTitle'))}</h2>
            <p style="color:#666;font-size:0.9em;">${escapeHtml(this.t('chatroomCreateHelp'))}</p>
          </div>
          <form id="create-custom-chatroom-form">
            <div class="form-group">
              <label class="form-label">${escapeHtml(this.t('chatroomType'))}</label>
              <select class="form-input" id="custom-room-type" name="type">
                <option value="custom">${escapeHtml(this.t('chatroomTypeCommunity'))}</option>
                <option value="business">${escapeHtml(this.t('chatroomTypeBusiness'))}</option>
              </select>
            </div>
            <div class="form-group" id="custom-room-business-headline-group" style="display:none;">
              <label class="form-label">${escapeHtml(this.t('chatroomBusinessHeadline'))}</label>
              <input type="text" class="form-input" id="custom-room-business-headline" maxlength="120" placeholder="${escapeHtml(this.t('chatroomBusinessPlaceholder'))}" />
            </div>
            <div class="form-group">
              <label class="form-label">${escapeHtml(this.t('chatroomName'))}</label>
              <input type="text" class="form-input" id="custom-room-name" name="name" required minlength="2" maxlength="80" data-testid="custom-room-name-input" />
            </div>
            <div class="form-group">
              <label class="form-label">${escapeHtml(this.t('chatroomDescriptionOptional'))}</label>
              <textarea class="form-input" id="custom-room-description" rows="2" maxlength="500"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">${escapeHtml(this.t('chatroomCapacityOptional'))}</label>
              <input type="number" class="form-input" id="custom-room-capacity" min="1" max="50000" placeholder="${escapeHtml(this.t('chatroomCapacityPlaceholder'))}" />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-custom-room-btn" style="background:var(--text-tertiary);">${escapeHtml(this.t('chatroomCancel'))}</button>
              <button type="submit" class="btn primary-btn" data-testid="custom-room-submit-btn">${escapeHtml(this.t('chatroomCreate'))}</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);

      const typeSel = modal.querySelector('#custom-room-type') as HTMLSelectElement;
      const bizGroup = modal.querySelector('#custom-room-business-headline-group') as HTMLElement;
      const syncBiz = () => {
        bizGroup.style.display = typeSel.value === 'business' ? 'block' : 'none';
      };
      typeSel.addEventListener('change', syncBiz);
      syncBiz();

      const cleanup = () => {
        document.body.removeChild(modal);
      };

      modal.querySelector('#cancel-custom-room-btn')?.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(null);
        }
      });

      const form = modal.querySelector('#create-custom-chatroom-form') as HTMLFormElement;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const type = typeSel.value === 'business' ? 'business' : 'custom';
        const name = (modal.querySelector('#custom-room-name') as HTMLInputElement).value.trim();
        const description = (modal.querySelector('#custom-room-description') as HTMLTextAreaElement).value.trim();
        const capRaw = (modal.querySelector('#custom-room-capacity') as HTMLInputElement).value.trim();
        const capacity = capRaw ? Math.floor(Number(capRaw)) : undefined;
        const headline = (modal.querySelector('#custom-room-business-headline') as HTMLInputElement).value.trim();
        if (name.length < 2) {
          this.showNotification(this.t('chatroomNameTooShort'), 'warning');
          return;
        }
        const out: {
          type: 'business' | 'custom';
          name: string;
          description?: string;
          capacity?: number;
          businessInfo?: { headline?: string };
        } = { type, name };
        if (description) out.description = description;
        if (capacity != null && Number.isFinite(capacity) && capacity > 0) out.capacity = capacity;
        if (type === 'business' && headline) out.businessInfo = { headline };
        cleanup();
        resolve(out);
      });
    });
  }

  showRenameCustomChatroomDialog(currentName: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:400px;">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHtml(this.t('chatroomRenameTitle'))}</h2>
            <p class="rename-custom-room-current" style="color:#666;font-size:0.9em;"></p>
          </div>
          <form id="rename-custom-chatroom-form">
            <div class="form-group">
              <label class="form-label">${escapeHtml(this.t('chatroomNewName'))}</label>
              <input type="text" class="form-input" id="rename-custom-room-name" required minlength="2" maxlength="80" data-testid="rename-custom-room-input" />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-rename-room-btn" style="background:var(--text-tertiary);">${escapeHtml(this.t('chatroomCancel'))}</button>
              <button type="submit" class="btn primary-btn">${escapeHtml(this.t('chatroomSave'))}</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);
      const curEl = modal.querySelector('.rename-custom-room-current');
      if (curEl) curEl.textContent = this.tf('chatroomCurrentName', { name: currentName });
      (modal.querySelector('#rename-custom-room-name') as HTMLInputElement).value = currentName;

      const cleanup = () => {
        document.body.removeChild(modal);
      };

      modal.querySelector('#cancel-rename-room-btn')?.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(null);
        }
      });
      const form = modal.querySelector('#rename-custom-chatroom-form') as HTMLFormElement;
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const next = (modal.querySelector('#rename-custom-room-name') as HTMLInputElement).value.trim();
        if (next.length < 2) {
          this.showNotification(this.t('chatroomNameTooShort'), 'warning');
          return;
        }
        cleanup();
        resolve(next);
      });
    });
  }

  private renderChatroomList(): void {
    renderChatrooms(this.chatroomsDeps());
  }

  showChatroomDetail(chatroomId: string): void {
    openChatroomDetail(this.chatroomsDeps(), chatroomId);
    const backBtn = document.getElementById('back-to-chatrooms') as HTMLElement | null;
    if (backBtn) backBtn.style.display = 'inline-flex';
    this.syncReturnHomeButton();
  }

  /**
   * Programmatic room switches (outside the Chatrooms detail click path) still need
   * the chatroom list highlight to stay in sync.
   */
  setCurrentChatroomId(chatroomId: string): void {
    if (!chatroomId) return;
    this.currentChatroom = chatroomId;
    this.renderChatroomList();
    const detailContainer = document.getElementById('chatroom-detail-container');
    if (detailContainer && detailContainer.style.display !== 'none') {
      const roomName = this.resolveChatroomTitle(chatroomId);
      const chatroomTitle = document.getElementById('current-chatroom-title');
      const chatroomStatus = document.getElementById('current-chatroom-status');
      if (chatroomTitle) chatroomTitle.textContent = roomName;
      if (chatroomStatus) chatroomStatus.textContent = this.t('chatroomLoadingMembers');
      const membersList = document.getElementById('chatroom-members-list');
      if (membersList) {
        membersList.innerHTML =
          `<div style="padding: 20px; text-align: center; color: #999;">${escapeHtml(this.t('chatroomLoadingOnlineUsers'))}</div>`;
      }
    }
    this.syncReturnHomeButton();
  }

  displayTalksList(): void {
    const talksList = document.getElementById('talks-list');
    if (!talksList) return;
    const renderSeq = ++this.talksRenderSeq;
    this.syncStatusBarMatchCount();

    const myTalks = getMyTalks();

    // One-time delegation on body: use mousedown so we run before any re-render can replace the DOM (click fires later and target can be gone)
    if (!this.talksListDelegationBound) {
      this.talksListDelegationBound = true;
      document.body.addEventListener(
        'mousedown',
        (e) => {
          if (e.button !== 0) return; // only left button
          const target = e.target as HTMLElement;
          // #item-details-popup: the long-press details popup relocates a row's
          // .talk-item-details out of #talks-list (showDetailsPopupFor) — its surviving
          // interactive content (survey-stats-btn) needs to still be reachable there.
          if (!target.closest('#talks-list') && !target.closest('#item-details-popup')) return;
          const outgoingTagCheckbox = target.closest('.talk-tag-out-checkbox') as HTMLInputElement | null;
          if (outgoingTagCheckbox) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = outgoingTagCheckbox.dataset.talkId;
            if (talkId) setTimeout(() => this.deleteMyTalk(talkId), 0);
            return;
          }
          const incomingTagCheckbox = target.closest('.talk-tag-in-checkbox') as HTMLInputElement | null;
          if (incomingTagCheckbox) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = incomingTagCheckbox.dataset.talkId || '';
            const identityKey = incomingTagCheckbox.dataset.identityKey || '';
            const checked = !e.shiftKey;
            setTimeout(() => this.quickAnswerIncomingTag(talkId, identityKey || undefined, checked), 0);
            return;
          }
          // view-talk-btn only remains on tag pills (the title is itself the button);
          // card rows dropped it — the whole row opens the talk now (click delegation below).
          const viewBtn = target.closest('.view-talk-btn');
          if (viewBtn) {
            e.preventDefault();
            e.stopPropagation();
            const el = viewBtn as HTMLElement;
            const talkId = el.dataset.talkId || '';
            const identityKey = el.dataset.identityKey || '';
            if (talkId || identityKey) {
              setTimeout(() => this.showTalkDetail(talkId, identityKey || undefined), 0);
            }
            return;
          }
          // Only reachable now from inside the long-press details popup (survey OUT rows).
          const surveyStatsBtn = target.closest('.survey-stats-btn');
          if (surveyStatsBtn) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = (surveyStatsBtn as HTMLElement).dataset.talkId;
            if (talkId) {
              setTimeout(() => void this.showSurveyStatsDialog(talkId), 0);
            }
            return;
          }
          // Only reachable from inside the long-press details popup (OUT rows with ≥1 response).
          const viewResponsesBtn = target.closest('.talk-view-responses-btn');
          if (viewResponsesBtn) {
            e.preventDefault();
            e.stopPropagation();
            const el = viewResponsesBtn as HTMLElement;
            const talkId = el.dataset.talkId || '';
            const talkTitle = el.dataset.talkTitle || '';
            if (talkId) {
              setTimeout(() => {
                // Close via the popup's own close button (not a raw .remove()) so it
                // properly returns .talk-item-details — this button's own container —
                // to its row first, instead of deleting it along with the modal.
                document.getElementById('close-item-details-popup')?.click();
                this.showCreatorRepliesForTalk(talkId, talkTitle);
              }, 0);
            }
            return;
          }
        },
        { capture: true },
      );
    }
    // Broadcast on/off is now a real checkbox (same widget as the tag pill's own checkbox),
    // so it uses 'change' — not the mousedown-capture pattern above, which exists to hijack
    // custom-behavior elements before a native default (checked state, focus) applies. A
    // native checkbox's own toggle is exactly the behavior wanted here.
    if (!this.talksBroadcastCheckboxBound) {
      this.talksBroadcastCheckboxBound = true;
      document.body.addEventListener('change', (e) => {
        const checkbox = (e.target as HTMLElement).closest('.talk-broadcast-toggle-checkbox') as HTMLInputElement | null;
        if (!checkbox) return;
        const talkId = checkbox.dataset.talkId;
        if (!talkId) return;
        const disabled = !checkbox.checked;
        this.setTalkDisabled(talkId, disabled);
        this.showNotification(this.t(disabled ? 'talksBroadcastDisabled' : 'talksBroadcastEnabled'), 'success');
      });
    }
    this.bindTalksRowGestures();

    // Sort all talks by last interaction
    const allEntries = Object.entries(myTalks)
      .sort(
        ([, a]: [string, any], [, b]: [string, any]) =>
          new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime(),
      );
    // OUT: talks this user created or copied (can broadcast)
    const conversations = this.getMyConversations();
    const outMetrics = (talkId: string): {
      responses: number;
      matches: number;
      ignores: number;
      mismatches: number;
      matchRate: number;
      latestResponseAt: number;
      weighted: number;
    } => {
      const stats = this.talkStatsMap[talkId];
      const replies = this.creatorReplyRows.filter((reply) => reply.talkId === talkId);
      const derivedMatches = Object.values(conversations).filter((c: any) => c.talkId === talkId).length;
      const matches = Math.max(stats?.matches ?? 0, derivedMatches, replies.filter((reply) => reply.outcome === 'match').length);
      const responses = Math.max(stats?.responses ?? 0, derivedMatches, replies.length);
      const ignores = Math.max(stats?.ignores ?? 0, replies.filter((reply) => reply.outcome === 'ignore').length);
      const mismatches = Math.max(0, replies.filter((reply) => reply.outcome === 'mismatch').length || responses - matches - ignores);
      const matchRate = responses > 0 ? matches / responses : 0;
      const latestResponseAt = replies.reduce((latest, reply) => Math.max(latest, new Date(reply.date).getTime()), 0);
      // Visible factors only: matches dominate, then match rate and reply volume; ignores/mismatches lower rank.
      const weighted = matches * 100 + Math.round(matchRate * 25) + Math.min(responses, 20) - ignores * 4 - mismatches * 2;
      return { responses, matches, ignores, mismatches, matchRate, latestResponseAt, weighted };
    };
    // OUT: talks this user created or copied (can broadcast), with creator-selectable ranking.
    const outEntries = allEntries
      .filter(([, t]: [string, any]) => t.role === 'created' || t.role === 'copied')
      .sort(([idA, a]: [string, any], [idB, b]: [string, any]) => {
        const aa = outMetrics(idA);
        const bb = outMetrics(idB);
        if (this.talksOutSortMode === 'oldest') return new Date(a.lastInteraction || 0).getTime() - new Date(b.lastInteraction || 0).getTime();
        if (this.talksOutSortMode === 'latest-reply' && bb.latestResponseAt !== aa.latestResponseAt) return bb.latestResponseAt - aa.latestResponseAt;
        if (this.talksOutSortMode === 'matches' && bb.matches !== aa.matches) return bb.matches - aa.matches;
        if (this.talksOutSortMode === 'responses' && bb.responses !== aa.responses) return bb.responses - aa.responses;
        if (this.talksOutSortMode === 'match-rate' && bb.matchRate !== aa.matchRate) return bb.matchRate - aa.matchRate;
        if (this.talksOutSortMode === 'weighted' && bb.weighted !== aa.weighted) return bb.weighted - aa.weighted;
        if (this.talksOutSortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
        return new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime();
      });
    // IN: backend-consolidated incoming talks (content-hash merged)
    const rawIncomingEntries = (this.incomingTalkClusters || []).filter((c: any) => c && c.identityKey);
    const incomingFilterResult = filterIncomingTalkClusters(
      rawIncomingEntries,
      this.currentUser?.talkFilters || getTalkIntakeFilters(),
      this.currentLocation,
    );
    const hiddenReasonsText = this.formatReasonCounts(incomingFilterResult.hiddenByReason);
    const answeredByContent = getAnsweredTalkByContent();
    const backendInEntries = incomingFilterResult.visible.filter((cluster: any) => {
      if (cluster?.isAnswered) return false;
      const identityKey = String(cluster?.identityKey || '');
      if (identityKey && answeredByContent[identityKey]) return false;
      try {
        const latestTalk = cluster?.latestTalk;
        if (latestTalk && answeredByContent[UIManager.getTalkContentKey(latestTalk)]) return false;
        if (latestTalk && answeredByContent[computeTalkIdFromTalkData(latestTalk)]) return false;
      } catch {
        /* keep visible if the cluster cannot be locally identified */
      }
      return true;
    });
    // Answered talks are retained locally after they leave the actionable inbox. Put
    // them back in IN as read-only history so All/IN remains a complete talk ledger.
    const answeredIncomingEntries = allEntries
      .filter(([, talk]: [string, any]) => talk?.role === 'answered')
      .map(([talkId, talk]: [string, any]) => {
        const fullTalk = talk?.fullTalk || {};
        const senderNames = Array.isArray(talk?.senders) ? talk.senders : [];
        const primaryName = String(senderNames[0] || talk?.senderName || this.t('settingsUnknown'));
        return {
          identityKey: `answered:${talkId}`,
          title: String(talk?.title || fullTalk?.title || this.t('talksIncomingFallback')),
          type: String(talk?.type || fullTalk?.type || 'flow'),
          language: String(fullTalk?.language || talk?.language || 'en'),
          latestTalk: fullTalk,
          senders: { [talkId]: { senderName: primaryName } },
          isAnswered: true,
          outcome: talk?.outcome,
          questionCount: Array.isArray(fullTalk?.questions) ? fullTalk.questions.length : 0,
          updatedAt: talk?.lastInteraction || talk?.timestamp || Date.now(),
          expiresAt: fullTalk?.expiresAt ?? talk?.expiresAt,
          locationRadiusMiles: fullTalk?.locationRadiusMiles ?? talk?.locationRadiusMiles,
          latestTalkId: talkId,
        };
      });
    const allIncomingEntries = [...answeredIncomingEntries, ...backendInEntries];
    const matchesTalkFilter = (entry: any, isIncoming: boolean): boolean => {
      const talk = isIncoming ? entry : entry[1];
      const type = String(talk?.type || talk?.fullTalk?.type || talk?.latestTalk?.type || 'flow').toLowerCase();
      const title = String(talk?.title || talk?.fullTalk?.title || talk?.latestTalk?.title || '').toLowerCase();
      const query = this.talksQuery.trim().toLowerCase();
      const answered = isIncoming ? !!talk?.isAnswered : false;
      const outcome = String(talk?.outcome || talk?.latestTalk?.outcome || '').toLowerCase();
      const timestamp = new Date(talk?.updatedAt || talk?.lastInteraction || talk?.timestamp || 0).getTime();
      const from = this.talksDateFrom ? new Date(`${this.talksDateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
      const to = this.talksDateTo ? new Date(`${this.talksDateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
      return (!query || title.includes(query))
        && this.talksEnabledTypes.has(type)
        && (this.talksOutcomeFilter === 'all' || outcome === this.talksOutcomeFilter)
        && timestamp >= from && timestamp <= to
        && (this.talksCompletionFilter === 'all'
          || (this.talksCompletionFilter === 'answered' && answered)
          || (this.talksCompletionFilter === 'unanswered' && !answered));
    };
    const filteredOutEntries = this.talksShowOutgoing
      ? outEntries.filter((entry) => matchesTalkFilter(entry, false))
      : [];
    const inEntries = this.talksShowIncoming
      ? allIncomingEntries
          .filter((entry) => matchesTalkFilter(entry, true))
          .sort((a: any, b: any) => {
            if (a.isAnswered !== b.isAnswered) return a.isAnswered ? 1 : -1;
            if (this.talksOutSortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
            if (this.talksOutSortMode === 'oldest') return new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
            return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
          })
      : [];
    // One combined summary line instead of two (app-bar direction counts + a separate
    // "Stats: ..." row below) — direction counts prefix the same response/match line.
    this.displayContextualStatistics(
      'talks-stats-strip',
      this.tf('talksStatusSummary', { incoming: inEntries.length, outgoing: filteredOutEntries.length }) + ' · ',
    );
    const talksIncomingCheckbox = document.getElementById('talks-filter-incoming') as HTMLInputElement | null;
    if (talksIncomingCheckbox) talksIncomingCheckbox.checked = this.talksShowIncoming;
    const talksOutgoingCheckbox = document.getElementById('talks-filter-outgoing') as HTMLInputElement | null;
    if (talksOutgoingCheckbox) talksOutgoingCheckbox.checked = this.talksShowOutgoing;
    document.querySelectorAll<HTMLInputElement>('.talks-type-checkbox').forEach((checkbox) => {
      checkbox.checked = this.talksEnabledTypes.has(checkbox.value);
    });
    const talksSort = document.getElementById('talks-out-sort-order') as HTMLSelectElement | null;
    if (talksSort) talksSort.value = this.talksOutSortMode;
    const talksQuery = document.getElementById('talks-filter-query') as HTMLInputElement | null;
    if (talksQuery && talksQuery.value !== this.talksQuery) talksQuery.value = this.talksQuery;
    const talksCompletionFilter = document.getElementById('talks-filter-completion') as HTMLSelectElement | null;
    if (talksCompletionFilter) talksCompletionFilter.value = this.talksCompletionFilter;
    const talksOutcomeFilter = document.getElementById('talks-filter-outcome') as HTMLSelectElement | null;
    if (talksOutcomeFilter) talksOutcomeFilter.value = this.talksOutcomeFilter;
    const talksDateFrom = document.getElementById('talks-filter-date-from') as HTMLInputElement | null;
    const talksDateTo = document.getElementById('talks-filter-date-to') as HTMLInputElement | null;
    if (talksDateFrom) talksDateFrom.value = this.talksDateFrom;
    if (talksDateTo) talksDateTo.value = this.talksDateTo;

    if (filteredOutEntries.length === 0 && inEntries.length === 0) {
      talksList.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">${this.t('talksNoTalks')}</p>
          <p style="font-size: 0.9em; color: #999;">${this.t('talksNoTalksHelp')}</p>
          ${hiddenReasonsText ? `<p style="font-size: 0.85em; color: #999; margin-top: 8px;">${escapeHtml(hiddenReasonsText)}</p>` : ''}
        </div>
      `;
    } else {
      // TODO §R2: named so it can be passed to renderListProgressively as `renderRow`,
      // instead of an inline .map() callback over the entire list at once.
      const renderOutRow = ([talkId, talk]: [string, any]): string => {
                  const stats = this.talkStatsMap[talkId];
                  const matchedPeople = Object.values(conversations)
                    .filter((c: any) => c.talkId === talkId && c.otherUserId)
                    .map((c: any) => ({
                      id: String(c.otherUserId),
                      name: c.respondedByBot ? `${c.otherUserName} 🤖` : String(c.otherUserName || ''),
                    }));
                  const matchedNames = matchedPeople.map((p) => p.name);
                  const metrics = outMetrics(talkId);
                  const statsLine = stats || metrics.responses > 0
                    ? this.tf('talksStats', {
                        responses: metrics.responses,
                        matches: metrics.matches,
                        mismatches: metrics.mismatches,
                        ignores: metrics.ignores,
                        rate: Math.round(metrics.matchRate * 100),
                      })
                    : this.t('talksNoStats');
                  const rankLine = this.talksOutSortMode === 'weighted'
                    ? `<div class="talk-weighted-score" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${this.tf('talksWeightedScore', { score: metrics.weighted })}</div>`
                    : this.talksOutSortMode === 'latest-reply' && metrics.latestResponseAt > 0
                      ? `<div class="talk-weighted-score" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${this.tf('talksLatestReplyLabel', { date: escapeHtml(new Date(metrics.latestResponseAt).toLocaleString()) })}</div>`
                      : '';
                  const matchedLine =
                    matchedPeople.length > 0
                      ? `<div class="talk-item-matched talk-matched-people" data-matched-people="${escapeHtml(JSON.stringify(matchedPeople))}" style="font-size: 0.85em; color: var(--success-text); margin-top: 4px; cursor: pointer;">${this.tf('talksMatchedWith', { names: escapeHtml(matchedNames.join(', ')) })}</div>`
                      : '';
                  // TODO §Q build-order item 17: "people I've separately exchanged this same
                  // content with" — a different talkId sharing the same identityKey (e.g. a
                  // separate broadcast round), scoped to this device's own talkLedger only.
                  // Excludes people already shown by matchedLine above (this row's own partners).
                  const coExchangedPeople = talk.fullTalk
                    ? this.getCoExchangedPeople(
                        computeTalkIdFromTalkData(talk.fullTalk),
                        new Set(matchedPeople.map((p) => p.id)),
                      )
                    : [];
                  const coExchangedLine =
                    coExchangedPeople.length > 0
                      ? `<div class="talk-item-co-exchanged talk-matched-people" data-matched-people="${escapeHtml(JSON.stringify(coExchangedPeople))}" style="font-size: 0.85em; color: var(--accent-text); margin-top: 4px; cursor: pointer;">${this.tf('talksAlsoExchangedWith', { names: escapeHtml(coExchangedPeople.map((p) => p.name).join(', ')) })}</div>`
                      : '';
                  const disabled = !!talk.disabled;
                  const expText = this.formatTalkExpiration(talk.expiresAt);
                  const locText = this.formatTalkLocation(talk.locationRadiusMiles);
                  // TODO §Z popup-variant review: match the IN details popup's tone-colored
                  // expiry chip (formatTalkExpiryTone) instead of OUT's own plain, uncolored
                  // text — my own sent talks approaching expiry deserve the same at-a-glance
                  // urgency cue an incoming talk's expiry already gets.
                  const expiryTone = this.formatTalkExpiryTone(talk.expiresAt);
                  // Icon-only badges, not text: direction/copy-state and type are already
                  // conveyed by shape (this icon) and color (typeAccent border) — a text
                  // label alongside both would just repeat the same fact in words. The
                  // translated label still exists for a11y/tooltip/screen-reader purposes.
                  const roleBadge = talk.role === 'copied'
                    ? `<span class="talk-badge talk-badge-copied" title="${escapeHtml(this.t('talksCopied'))}" style="background:var(--accent-soft);color:var(--accent-text);">📋<span class="visually-hidden"> ${this.t('talksCopied')}</span></span>`
                    : `<span class="talk-badge talk-badge-created" title="${escapeHtml(this.t('talksCreated'))}" style="background:var(--accent-soft);color:var(--accent-text);">📝<span class="visually-hidden"> ${this.t('talksCreated')}</span></span>`;
                  const talkTypeLower = String(talk.type || talk.fullTalk?.type || '').toLowerCase();
                  const talkLanguage = String(talk.language || talk.fullTalk?.language || 'en').toLowerCase();
                  const typeAccent =
                    talkTypeLower === 'tag' ? '#7c3aed'
                    : talkTypeLower === 'survey' ? 'var(--success)'
                    : talkTypeLower === 'route' ? '#d97706'
                    : 'var(--accent)';
                  const typeIcon =
                    talkTypeLower === 'tag' ? '🏷️'
                    : talkTypeLower === 'survey' ? '📊'
                    : talkTypeLower === 'route' ? '🔀'
                    : '➡️';
                  if (talkTypeLower === 'tag') {
                    return `
        <div class="talk-list-item talk-tag-chip talk-tag-out ${disabled ? 'talk-broadcast-disabled' : 'talk-broadcast-enabled'}" data-talk-id="${talkId}" data-role="${talk.role || 'created'}" data-talk-type="tag">
          <label class="talk-tag-checkbox-wrap" aria-label="${escapeHtml(this.t('talksTagChecked'))}">
            <input type="checkbox" class="talk-tag-checkbox talk-tag-out-checkbox" data-talk-id="${escapeHtml(talkId)}" checked>
          </label>
          <span class="talk-tag-text">${escapeHtml(talk.title)}${this.tagAnswerSuffix(talk)}</span>
        </div>
      `;
                  }
                  // Row is a single tap target (opens the editor) plus a gesture, not a row of
                  // buttons: the checkbox in the top-left badge is the one persistent explicit
                  // control (broadcast on/off — same widget as the tag pill's own checkbox, so
                  // both "is this actively going out" toggles look and feel the same); everything
                  // else that used to be a button moved to a different mechanism — 🗑️ delete ->
                  // swipe-left gesture, ℹ️ details -> long-press (still the exact same
                  // .talk-item-details/showDetailsPopupFor content, nothing dropped), 📊 survey
                  // results -> the at-a-glance number now lives in the stats line, with the full
                  // breakdown dashboard one tap away inside that same long-press popup instead of
                  // its own row button. matchedLine stays visible on the row: it's the interactive
                  // N3 click-to-DM affordance, not decorative detail.
                  return `
        <div class="talk-list-item talk-direction-out talk-type-${escapeHtml(talkTypeLower || 'flow')} ${disabled ? 'talk-broadcast-disabled' : 'talk-broadcast-enabled'}" data-talk-id="${talkId}" data-role="${talk.role || 'created'}" data-talk-type="${escapeHtml(talkTypeLower || 'flow')}" style="border-right:5px solid ${typeAccent};background:var(--surface);">
          <div class="talk-item-header">
            <label class="talk-icon-badge" title="${disabled ? this.t('talksBroadcastOff') : this.t('talksBroadcastOn')}">
              <input type="checkbox" class="talk-broadcast-toggle-checkbox" data-talk-id="${talkId}" ${disabled ? '' : 'checked'}>
              <span aria-hidden="true">${typeIcon}</span>
            </label>
            <div class="talk-item-title">${escapeHtml(talk.title)}${this.tagAnswerSuffix(talk)}</div>
            <span class="talk-item-chevron" aria-hidden="true">›</span>
          </div>
          <div class="talk-item-status-line" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;">
            <span class="talk-item-status-summary" style="font-size:0.85em;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(statsLine)} · ${escapeHtml(this.formatTalkRelativeTime(new Date(talk.lastInteraction || 0)))}</span>
          </div>
          ${matchedLine}
          <div class="talk-item-details" data-talk-id="${talkId}" style="display:none;">
            ${roleBadge}
            <span class="talk-badge talk-badge-type" title="${escapeHtml(this.formatTalkType(String(talk.type || 'flow')))}">${typeIcon}<span class="visually-hidden"> ${this.formatTalkType(String(talk.type || 'flow'))}</span></span>
            <span class="talk-badge talk-badge-language" data-language="${escapeHtml(talkLanguage)}">${escapeHtml(this.formatTalkLanguage(talkLanguage))}</span>
            <div class="talk-item-meta">
              <span class="talk-item-time">${this.formatTalkRelativeTime(new Date(talk.lastInteraction || 0))}</span>
            </div>
            <div class="talk-info-chips">
              <span class="talk-info-chip talk-expiry-${expiryTone}">${escapeHtml(this.tf('talksExpiration', { value: expText }))}</span>
              <span class="talk-info-chip">${escapeHtml(this.tf('talksLocation', { value: locText }))}</span>
            </div>
            <div class="talk-item-stats" style="font-size: 0.85em; color: #666; margin-top: 6px;">
              ${statsLine}
            </div>
            ${rankLine}
            ${talkTypeLower === 'survey' ? `<button type="button" class="btn survey-stats-btn talk-icon-btn" data-talk-id="${escapeHtml(talkId)}" data-testid="survey-stats-button" style="margin-top:6px;color:var(--accent-text);">📊 ${this.t('talksResults')}</button>` : ''}
            ${metrics.responses > 0 ? `<button type="button" class="btn talk-view-responses-btn talk-icon-btn" data-talk-id="${escapeHtml(talkId)}" data-talk-title="${escapeHtml(talk.title)}" data-testid="talk-view-responses-button" style="margin-top:6px;color:var(--accent-text);">👥 ${escapeHtml(this.tf('talksViewResponses', { count: metrics.responses }))}</button>` : ''}
            ${coExchangedLine}
          </div>
        </div>
      `;
      };

      // TODO §R2: named so it can be passed to renderListProgressively as `renderRow`.
      const renderInRow = (cluster: any): string => {
                const sendersObj = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
                const senderNames = Array.from(
                  new Set(
                    Object.values(sendersObj)
                      .map((s: any) => String(s?.senderName || '').trim())
                      .filter(Boolean),
                  ),
                );
                const senderList = Object.values(sendersObj) as Array<{ senderId?: string; senderName?: string; headshot?: string }>;
                const primarySender = senderList[0] || {};
                const primarySenderName = String(primarySender.senderName || senderNames[0] || this.t('settingsUnknown'));
                const senderPeopleById = new Map<string, string>();
                for (const s of senderList) {
                  if (s?.senderId && s?.senderName) senderPeopleById.set(String(s.senderId), String(s.senderName));
                }
                const senderPeople = Array.from(senderPeopleById, ([id, name]) => ({ id, name }));
                const senderPeopleJson = escapeHtml(JSON.stringify(senderPeople));
                const senderInitial = primarySenderName.trim().charAt(0).toUpperCase() || '?';
                const talkId = this.pickIncomingRowTalkId(cluster);
                const identityKey = String(cluster?.identityKey || '');
                // TODO §Q build-order item 17: other people I've separately exchanged this same
                // content with (e.g. a different sender who sent me the identical talk), scoped
                // to this device's own talkLedger only. Excludes this cluster's own sender(s).
                const coExchangedPeople = identityKey
                  ? this.getCoExchangedPeople(identityKey, new Set(senderPeople.map((p) => p.id)))
                  : [];
                const coExchangedLine =
                  coExchangedPeople.length > 0
                    ? `<div class="talk-item-co-exchanged talk-matched-people" data-matched-people="${escapeHtml(JSON.stringify(coExchangedPeople))}" style="font-size: 0.85em; color: var(--accent-text); margin-top: 4px; cursor: pointer;">${this.tf('talksAlsoExchangedWith', { names: escapeHtml(coExchangedPeople.map((p) => p.name).join(', ')) })}</div>`
                    : '';
                const isAnswered = !!cluster?.isAnswered;
                const titleStyle = isAnswered
                  ? 'font-weight: 500; color: var(--text-muted);'
                  : 'font-weight: 700; color: var(--accent-hover);';
                const metaStyle = isAnswered ? 'color: var(--text-muted);' : 'color: var(--text-tertiary);';
                const statusBadge = isAnswered
                  ? `<span class="talk-badge" style="background:var(--bg-muted);color:var(--text-tertiary);">✅ ${this.t('talksAnswered')}</span>`
                  : `<span class="talk-badge" style="background:var(--accent-soft);color:var(--accent-hover);font-weight:700;">🆕 ${this.t('talksNew')}</span>`;
                const incomingType = String(cluster?.type || 'flow').toLowerCase();
                const incomingLanguage = String(cluster?.language || cluster?.latestTalk?.language || 'en').toLowerCase();
                const questionCount = this.getIncomingQuestionCount(cluster);
                const responseCount = this.getIncomingResponseCount(talkId);
                const expiresAt = cluster?.expiresAt ?? cluster?.latestTalk?.expiresAt;
                const expiryTone = this.formatTalkExpiryTone(expiresAt);
                const expText = this.formatTalkExpiration(Number.isFinite(resolveExpiresAtMs(expiresAt)) ? resolveExpiresAtMs(expiresAt) : null);
                const locRadius = cluster?.locationRadiusMiles ?? cluster?.latestTalk?.locationRadiusMiles;
                const locText = this.formatTalkLocation(locRadius);
                const distanceText = this.formatTalkDistanceFromAuthor(cluster?.authorLocation || cluster?.latestTalk?.authorLocation);
                const showLanguageBadge = incomingLanguage && incomingLanguage !== this.getPreferredTalkLanguage();
                const progressChip = (incomingType === 'flow' || incomingType === 'route') && questionCount > 0
                  ? `<span class="talk-info-chip talk-progress-chip" style="--progress: 0%;"><span class="talk-progress-ring" aria-hidden="true"></span>${escapeHtml(`Q1/${questionCount}`)}</span>`
                  : questionCount > 0
                    ? `<span class="talk-info-chip">${escapeHtml(`${questionCount} Q`)}</span>`
                    : '';
                const languageChip = showLanguageBadge
                  ? `<span class="talk-info-chip talk-language-alert">${escapeHtml(this.formatTalkLanguage(incomingLanguage))}</span>`
                  : '';
                const responseChip = responseCount > 0
                  ? `<span class="talk-info-chip">${escapeHtml(this.tf(responseCount === 1 ? 'talksResponseOne' : 'talksResponses', { count: responseCount }))}</span>`
                  : '';
                const distanceChip = distanceText
                  ? `<span class="talk-info-chip">${escapeHtml(distanceText)}</span>`
                  : '';
                const typeAccent =
                  incomingType === 'tag' ? '#7c3aed'
                  : incomingType === 'survey' ? 'var(--success)'
                  : incomingType === 'route' ? '#d97706'
                  : 'var(--accent)';
                const typeIcon =
                  incomingType === 'tag' ? '🏷️'
                  : incomingType === 'survey' ? '📊'
                  : incomingType === 'route' ? '🔀'
                  : '➡️';
                if (incomingType === 'tag') {
                  return `
        <div class="talk-list-item talk-tag-chip talk-tag-in ${isAnswered ? 'talk-incoming-answered' : 'talk-incoming-new'}" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="tag">
          <label class="talk-tag-checkbox-wrap" aria-label="${escapeHtml(this.t('talksTagUndetermined'))}">
            <input type="checkbox" class="talk-tag-checkbox talk-tag-in-checkbox" data-talk-id="${escapeHtml(talkId)}" data-identity-key="${escapeHtml(identityKey)}" data-indeterminate="true" title="${escapeHtml(this.t('talksTagQuickDecision'))}">
          </label>
          <button type="button" class="talk-tag-text talk-tag-text-button view-talk-btn" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}">${escapeHtml(cluster?.title || this.t('talksIncomingFallback'))}</button>
        </div>
      `;
                }
                // Row is a single tap target (opens the talk to answer, with the details below
                // already visible rather than a separate popup) plus two gestures — drag up to
                // ignore the whole talk, drag down to copy it into my own outgoing list without
                // answering — replacing the 🔍/ℹ️ buttons. Long-press still reaches the exact
                // same .talk-item-details/showDetailsPopupFor content the ℹ️ button used to
                // (full sender identity + co-exchanged people), nothing dropped, just a different
                // trigger. Row 2 now carries what fit in the freed-up space: time, sender count,
                // location, question progress — the "quick glance" subset of the popup's fuller
                // detail set.
                const questionProgressText = (incomingType === 'flow' || incomingType === 'route') && questionCount > 0
                  ? `Q1/${questionCount}`
                  : questionCount > 0 ? `${questionCount} Q` : '';
                const senderCountText = senderNames.length > 1
                  ? `👥 ${this.tf('talksSenders', { count: senderNames.length })}`
                  : `👤 ${this.tf('talksSenderOne', { count: 1 })}`;
                const row2Parts = [
                  this.formatTalkRelativeTime(new Date(cluster?.updatedAt || Date.now())),
                  senderCountText,
                  `📍 ${locText}`,
                  questionProgressText,
                ].filter(Boolean);
                return `
        <div class="talk-list-item talk-direction-in talk-type-${escapeHtml(incomingType)} ${isAnswered ? 'talk-incoming-answered' : 'talk-incoming-new'}" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="${escapeHtml(incomingType)}" style="border-left:5px solid ${typeAccent};background:var(--accent-soft);">
          <div class="talk-item-header">
            <span class="talk-icon-badge" title="${escapeHtml(this.formatTalkType(String(cluster?.type || 'flow')))}" aria-hidden="true">📥 ${typeIcon}</span>
            <button type="button" class="talk-item-title view-talk-btn" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" style="${titleStyle}background:none;border:none;padding:0;text-align:left;cursor:pointer;font:inherit;">${escapeHtml(cluster?.title || this.t('talksIncomingFallback'))}</button>
            <span class="talk-item-chevron" aria-hidden="true">›</span>
          </div>
          <div class="talk-item-status-line" style="margin-top:4px;">
            <span class="talk-item-status-summary" style="${metaStyle}font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(row2Parts.join(' · '))}</span>
          </div>
          <div class="talk-item-details" data-talk-id="${talkId}" style="display:none;">
            ${statusBadge}
            <span class="talk-badge talk-badge-type" title="${escapeHtml(this.formatTalkType(String(cluster?.type || 'flow')))}">${typeIcon}<span class="visually-hidden"> ${this.formatTalkType(String(cluster?.type || 'flow'))}</span></span>
            <div class="talk-incoming-sender talk-sender-people" data-sender-people="${senderPeopleJson}" style="cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:8px;margin-top:8px;">
              <span class="talk-incoming-avatar">${avatarInnerHtml(primarySender.headshot, senderInitial, escapeHtml)}</span>
              <span class="talk-incoming-sender-name">${escapeHtml(primarySenderName)}</span>
              ${senderNames.length > 1 ? `<span class="talk-info-chip">${this.tf('talksSenders', { count: senderNames.length })}</span>` : ''}
            </div>
            <div class="talk-info-chips">
              ${progressChip}
              ${languageChip}
              <span class="talk-info-chip talk-expiry-${expiryTone}">${escapeHtml(expText)}</span>
              <span class="talk-info-chip">${escapeHtml(locText)}</span>
              ${distanceChip}
              ${responseChip}
            </div>
            <div class="talk-item-meta" style="${metaStyle}">
              <span class="talk-item-time">${this.formatTalkRelativeTime(new Date(cluster?.updatedAt || Date.now()))}</span>
            </div>
            ${coExchangedLine}
          </div>
        </div>
      `;
      };

      const isStale = () => renderSeq !== this.talksRenderSeq;

      // TODO §R2: re-applies the indeterminate-checkbox JS property (not representable as
      // a plain HTML attribute) after any render pass — first chunk or deferred remainder.
      const markIndeterminateTagCheckboxes = () => {
        talksList.querySelectorAll<HTMLInputElement>('.talk-tag-in-checkbox[data-indeterminate="true"]').forEach((checkbox) => {
          checkbox.indeterminate = true;
        });
      };

      // One merged, chronologically-sorted list — like an email inbox, not two
      // direction-labeled sections. Direction/type are already conveyed per-row via
      // color (type accent) and icon (direction), so a section header would be
      // redundant wording on top of that. When only one direction is checked, the
      // richer OUT-specific sort modes (matches/responses/weighted/...) still apply;
      // mixing both directions together only makes sense sorted by recency.
      type MergedTalkRow = { direction: 'in' | 'out'; sortTime: number; needsAnswer: boolean; payload: any };
      const outRows: MergedTalkRow[] = filteredOutEntries.map(([id, talk]: [string, any]) => ({
        direction: 'out' as const,
        sortTime: new Date(talk.lastInteraction || 0).getTime(),
        needsAnswer: false,
        payload: [id, talk] as [string, any],
      }));
      const inRows: MergedTalkRow[] = inEntries.map((cluster: any) => ({
        direction: 'in' as const,
        sortTime: new Date(cluster?.updatedAt || 0).getTime(),
        needsAnswer: !cluster?.isAnswered,
        payload: cluster,
      }));
      const mergedRows: MergedTalkRow[] = (this.talksShowIncoming && this.talksShowOutgoing)
        // Unanswered incoming talks are actionable, so they keep floating to the top
        // (an existing invariant, unrelated to this merge) — recency only breaks ties
        // within that same tier, both for the "needs answer" group and everything else.
        ? [...outRows, ...inRows].sort((a, b) => {
            if (a.needsAnswer !== b.needsAnswer) return a.needsAnswer ? -1 : 1;
            return b.sortTime - a.sortTime;
          })
        : [...inRows, ...outRows];
      const renderMergedRow = (row: MergedTalkRow): string =>
        row.direction === 'out' ? renderOutRow(row.payload) : renderInRow(row.payload);

      // mergedRows is guaranteed non-empty here — the outer `filteredOutEntries.length
      // === 0 && inEntries.length === 0` check above already handled the true-empty case.
      renderListProgressively(talksList, mergedRows, {
        firstChunkSize: TALKS_FIRST_CHUNK_SIZE,
        renderRow: renderMergedRow,
        isStale,
        onFirstChunkRendered: markIndeterminateTagCheckboxes,
        onRemainderRendered: markIndeterminateTagCheckboxes,
      });

      // Request stats for out talks (created/copied) only
      if (filteredOutEntries.length > 0) {
        const talkIds = filteredOutEntries.map(([id]) => id);
        this.emit('needTalkStats', { talkIds });
      }

      // TODO §R2: delegated (bound once) — replaces two per-render listener-binding loops
      // so a row landing in renderListProgressively's deferred remainder is interactive
      // immediately, with nothing to (re-)attach. `getMyTalks()` is re-read at click time
      // (not closed over), so a stale snapshot from an earlier render can't be used either.
      if (!this.talksListClickDelegationBound) {
        this.talksListClickDelegationBound = true;
        // Delegated on body, not #talks-list: the sender/matched-people click-to-DM
        // affordance (§N3) now also lives inside `.talk-item-details`, which the details
        // popup relocates to document.body when opened (showDetailsPopupFor) — a listener
        // scoped to #talks-list would stop catching it once moved. The row-click-to-edit
        // branch below is unaffected: it requires a `.talk-list-item` ancestor, which
        // popup content never has once relocated, so it naturally no-ops there.
        document.body.addEventListener('click', (e) => {
          // A row-drag gesture (ignore/copy/delete) or a long-press-for-details just
          // committed or cancelled — the click that naturally follows pointerup should
          // not also open the talk.
          if (Date.now() < this.talksGestureSuppressClickUntil) return;
          const target = e.target as HTMLElement;

          // TODO §N3: trace back from a talk row to whom it was exchanged with, then DM
          // them. Single exchange partner navigates straight through the dispatcher;
          // multiple partners opens the "choose who to DM" picker.
          const peopleEl = target.closest('.talk-matched-people, .talk-sender-people') as HTMLElement | null;
          if (peopleEl) {
            e.stopPropagation();
            let people: Array<{ id: string; name: string }> = [];
            try {
              people = JSON.parse(peopleEl.dataset.matchedPeople || peopleEl.dataset.senderPeople || '[]');
            } catch {
              return;
            }
            if (people.length === 1) {
              this.navigateToGraphNode({ type: 'person', id: people[0].id, name: people[0].name });
            } else if (people.length > 1) {
              this.showChooseWhoToDmPicker(people);
            }
            return;
          }

          // Row click opens edit/detail only when not clicking an action button (handled
          // in the mousedown-capture delegation above).
          if (target.closest('.talk-item-actions, .talk-item-inline-actions, .talk-tag-checkbox-wrap, .talk-icon-badge, .view-talk-btn, .talk-matched-people, .talk-sender-people, .talk-item-details')) return;
          const item = target.closest('.talk-list-item') as HTMLElement | null;
          if (!item) return;
          const talkId = item.dataset.talkId || '';
          const identityKey = item.dataset.identityKey || '';
          const role = item.dataset.role;
          if (role === 'incoming' && !talkId && !identityKey) return;
          if (role !== 'incoming' && !talkId) return;
          if (role === 'copied') {
            const copied = this.getMyTalks()[talkId];
            if (copied?.fullTalk) {
              // docs/TODO.md §Y1: pass the talk as-is (original authorship intact) — the
              // editor dialog itself decides create-vs-update-in-place by comparing
              // existingTalk.authorId to currentUserId. Pre-stamping here would make every
              // copied talk look self-authored before the user has actually edited anything.
              this.showTalkEditorDialog(copied.fullTalk);
            } else {
              this.showNotification(this.t('talksCouldNotLoad'), 'error');
            }
          } else if (role === 'created') {
            this.emit('loadTalkForEdit', { talkId });
          } else {
            this.showTalkDetail(talkId, identityKey || undefined);
          }
        });
      }
    }

    // Restore the remembered scroll "spot" for this tab — deferred a tick so it applies
    // after the just-rendered content lands. `.talks-list`'s own `overflow-y:auto` never
    // actually engages (its flex parent, `.view-content`, isn't itself a flex container),
    // so `#talks-view-content` — not `#talks-list` — is the element that really scrolls.
    const talksScrollContainer = document.getElementById('talks-view-content');
    if (talksScrollContainer) {
      if (talksScrollContainer.dataset.talksScrollRestored !== '1') {
        talksScrollContainer.dataset.talksScrollRestored = '1';
        try {
          const raw = localStorage.getItem(TALKS_TAB_STATE_KEY);
          const savedScrollTop = raw ? (JSON.parse(raw) as { scrollTop?: number }).scrollTop : undefined;
          if (typeof savedScrollTop === 'number') {
            window.setTimeout(() => { talksScrollContainer.scrollTop = savedScrollTop; }, 0);
          }
        } catch {
          /* local-only preference persistence is optional */
        }
      }
      if (talksScrollContainer.dataset.talksScrollBound !== '1') {
        talksScrollContainer.dataset.talksScrollBound = '1';
        talksScrollContainer.addEventListener('scroll', () => this.persistTalksTabState(), { passive: true });
      }
    }

    this.syncStatusBarMatchCount();
  }

  setTalkStats(statsMap: Record<string, { responses: number; matches: number; ignores: number }>): void {
    const orderDependsOnStats = !['recent', 'oldest', 'title'].includes(this.talksOutSortMode);
    const changed = JSON.stringify(statsMap) !== JSON.stringify(this.talkStatsMap);
    this.talkStatsMap = { ...statsMap };
    const talksList = document.getElementById('talks-list');
    if (talksList) {
      Object.entries(statsMap).forEach(([talkId, stats]) => {
        const row = talksList.querySelector(`.talk-list-item[data-talk-id="${talkId}"][data-role="created"],
          .talk-list-item[data-talk-id="${talkId}"][data-role="copied"]`) as HTMLElement | null;
        const statsEl = row?.querySelector('.talk-item-stats') as HTMLElement | null;
        if (statsEl) {
          const matchRate = stats.responses > 0 ? Math.round((stats.matches / stats.responses) * 100) : 0;
          const mismatches = Math.max(0, stats.responses - stats.matches - stats.ignores);
          statsEl.textContent = this.tf('talksStats', {
            responses: stats.responses,
            matches: stats.matches,
            mismatches,
            ignores: stats.ignores,
            rate: matchRate,
          });
        }
      });
    }
    if (changed && orderDependsOnStats) this.displayTalksList();
    this.syncStatusBarMatchCount();
  }

  setIncomingTalkClusters(clusters: any[]): void {
    this.incomingTalkClusters = Array.isArray(clusters) ? clusters : [];
    for (const cluster of this.incomingTalkClusters) {
      const senders = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
      for (const sender of Object.values(senders) as Array<{ senderId?: string; senderName?: string }>) {
        const senderId = String(sender?.senderId || '').trim();
        const senderName = String(sender?.senderName || '').trim();
        if (senderId && senderName) this.rememberPeerName(senderId, senderName);
      }
    }
  }

  private readCreatorReplyFilterState(): CreatorReplyFilterState {
    return {
      query: ((document.getElementById('reply-filter-query') as HTMLInputElement | null)?.value || '').trim(),
      outcome: (document.getElementById('reply-filter-outcome') as HTMLSelectElement | null)?.value || 'all',
      relationship: (document.getElementById('reply-filter-relationship') as HTMLSelectElement | null)?.value || 'all',
      type: (document.getElementById('reply-filter-type') as HTMLSelectElement | null)?.value || 'all',
      language: (document.getElementById('reply-filter-language') as HTMLSelectElement | null)?.value || 'all',
      from: (document.getElementById('reply-filter-from') as HTMLInputElement | null)?.value || '',
      to: (document.getElementById('reply-filter-to') as HTMLInputElement | null)?.value || '',
      sort: (document.getElementById('reply-sort-order') as HTMLSelectElement | null)?.value || 'recent',
      group: (document.getElementById('reply-group-order') as HTMLSelectElement | null)?.value || 'none',
    };
  }

  /** Remembers the Talks tab's direction/type/sort/search/date filters and scroll position
   * across reloads — mirrors the Contacts tab's `iinpublic_contacts_tab_state` pattern. */
  private persistTalksTabState(): void {
    try {
      const talksScrollContainer = document.getElementById('talks-view-content');
      localStorage.setItem(TALKS_TAB_STATE_KEY, JSON.stringify({
        showIncoming: this.talksShowIncoming,
        showOutgoing: this.talksShowOutgoing,
        enabledTypes: Array.from(this.talksEnabledTypes),
        sort: this.talksOutSortMode,
        query: this.talksQuery,
        completion: this.talksCompletionFilter,
        outcome: this.talksOutcomeFilter,
        dateFrom: this.talksDateFrom,
        dateTo: this.talksDateTo,
        scrollTop: talksScrollContainer?.scrollTop || 0,
      }));
    } catch {
      /* local-only preference persistence is optional */
    }
  }

  private restoreTalksTabState(): void {
    try {
      const raw = localStorage.getItem(TALKS_TAB_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as {
        showIncoming?: boolean;
        showOutgoing?: boolean;
        enabledTypes?: string[];
        sort?: 'recent' | 'oldest' | 'latest-reply' | 'matches' | 'responses' | 'match-rate' | 'weighted' | 'title';
        query?: string;
        completion?: 'all' | 'unanswered' | 'answered';
        outcome?: 'all' | 'match' | 'mismatch';
        dateFrom?: string;
        dateTo?: string;
      };
      if (typeof state.showIncoming === 'boolean') this.talksShowIncoming = state.showIncoming;
      if (typeof state.showOutgoing === 'boolean') this.talksShowOutgoing = state.showOutgoing;
      if (Array.isArray(state.enabledTypes) && state.enabledTypes.length > 0) {
        this.talksEnabledTypes = new Set(state.enabledTypes);
      }
      if (state.sort) this.talksOutSortMode = state.sort;
      if (state.query) this.talksQuery = state.query;
      if (state.completion) this.talksCompletionFilter = state.completion;
      if (state.outcome) this.talksOutcomeFilter = state.outcome;
      if (state.dateFrom) this.talksDateFrom = state.dateFrom;
      if (state.dateTo) this.talksDateTo = state.dateTo;
    } catch {
      /* local-only preference persistence is optional */
    }
  }

  private persistCreatorReplyFilterState(): void {
    try {
      localStorage.setItem(CREATOR_REPLY_FILTERS_KEY, JSON.stringify(this.readCreatorReplyFilterState()));
    } catch {
      /* local-only preference persistence is optional */
    }
  }

  private restoreCreatorReplyFilterState(): void {
    let state: Partial<CreatorReplyFilterState> = {};
    try {
      const raw = localStorage.getItem(CREATOR_REPLY_FILTERS_KEY);
      state = raw ? JSON.parse(raw) as Partial<CreatorReplyFilterState> : {};
    } catch {
      state = {};
    }
    const values: Array<[string, string | undefined]> = [
      ['reply-filter-query', state.query],
      ['reply-filter-outcome', state.outcome],
      ['reply-filter-relationship', state.relationship],
      ['reply-filter-type', state.type],
      ['reply-filter-language', state.language],
      ['reply-filter-from', state.from],
      ['reply-filter-to', state.to],
      ['reply-sort-order', state.sort],
      ['reply-group-order', state.group],
    ];
    for (const [id, value] of values) {
      if (!value) continue;
      const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (element) element.value = value;
    }
  }

  private async refreshCreatorReplies(): Promise<void> {
    if (!this.currentUserId) return;
    // P0 step 5: replies derived from localTalkExchanges — no server call to /api/users/:id/replies.
    // creatorReplyRows also feeds the OUT-row matched-names line in displayTalksList (line ~2313).
    this.creatorReplyRows = deriveLocalCreatorReplies(this.currentUserId) as CreatorReplyRow[];
    if (document.getElementById('talks-view')?.classList.contains('active')) this.displayTalksList();
  }

  /**
   * §M1: opens #creator-replies-panel scoped to one talk — "who answered this?" from a
   * talk row's "View Responses" button, or from a peer-history item in the ⟨User⟩ layout
   * (peer-detail-view.ts's openTalkResponses dep). Switches to the Talks tab first (via the
   * real nav-button click, so the whole tab-switch side effect chain — header, view panel,
   * refreshCreatorReplies — runs exactly as it would for a manual click) then shows the
   * panel scoped to talkId; showAllTalks=false leaves scope on for repeat visits, cleared by
   * the panel's own Clear-filters button or by picking a different talk.
   */
  showCreatorRepliesForTalk(talkId: string, talkTitle: string): void {
    // The ⟨User⟩ layout (#peer-detail-overlay) is a separate full-screen overlay, not a
    // .view-panel — switching the bottom-nav tab underneath it does not hide it, so a
    // trigger from inside peer-detail (a peer-history item's title) would otherwise leave
    // it stacked on top of the Talks tab, blocking the panel it just opened.
    closePeerDetailView();
    (document.querySelector('.nav-btn[data-view="talks"]') as HTMLElement | null)?.click();
    this.creatorReplyScopedTalkId = talkId;
    this.creatorReplyScopedTalkTitle = talkTitle;
    const panel = document.getElementById('creator-replies-panel');
    if (panel) panel.style.display = 'block';
    this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
    this.renderCreatorReplies();
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private renderCreatorReplies(): void {
    const list = document.getElementById('creator-replies-list');
    const summary = document.getElementById('creator-replies-summary');
    if (!list || !summary) return;
    const state = this.readCreatorReplyFilterState();
    const query = state.query.toLowerCase();
    const fromTime = state.from ? new Date(`${state.from}T00:00:00`).getTime() : undefined;
    const toTime = state.to ? new Date(`${state.to}T23:59:59.999`).getTime() : undefined;
    const metricsByResponder = new Map<string, { replies: number; matches: number; relevance: number }>();
    const metricsByTalk = new Map<string, { replies: number; matches: number; matchRate: number }>();
    // Spec §30.2 matchThreshold routes: a matched row's own conversation (if the responder's
    // reply actually formed one — see conversationId, otherUserId keyed lookup, robust to
    // bidirectional-exchange talkId ambiguity the same way maybeFinalizeConfirmedDeal is,
    // app.ts) carries the stored score/total for the "Matched items" percentage display/sort.
    const conversationsById = this.getMyConversations();
    const matchInfoByResponder = new Map<string, { conversationId: string; matchScore?: number; matchTotal?: number }>();
    for (const [conversationId, conversation] of Object.entries(conversationsById) as Array<[string, any]>) {
      const otherUserId = conversation?.otherUserId;
      if (!otherUserId || matchInfoByResponder.has(otherUserId)) continue;
      matchInfoByResponder.set(otherUserId, {
        conversationId,
        matchScore: conversation?.matchScore,
        matchTotal: conversation?.matchTotal,
      });
    }
    const matchPercent = (responderId: string): number | null => {
      const info = matchInfoByResponder.get(responderId);
      if (!info || info.matchScore == null || !info.matchTotal) return null;
      return Math.round((info.matchScore / info.matchTotal) * 100);
    };
    for (const row of this.creatorReplyRows) {
      const metrics = metricsByResponder.get(row.responderId) || { replies: 0, matches: 0, relevance: 0 };
      metrics.replies += 1;
      if (row.outcome === 'match') metrics.matches += 1;
      metrics.relevance = metrics.matches * 100 + metrics.replies;
      metricsByResponder.set(row.responderId, metrics);
      const talkMetrics = metricsByTalk.get(row.talkId) || { replies: 0, matches: 0, matchRate: 0 };
      talkMetrics.replies += 1;
      if (row.outcome === 'match') talkMetrics.matches += 1;
      talkMetrics.matchRate = talkMetrics.matches / talkMetrics.replies;
      metricsByTalk.set(row.talkId, talkMetrics);
    }
    const filtered = this.creatorReplyRows
      .filter((row) => {
        const known = this.getKnownPerson(row.responderId);
        const labels = known?.labels && known.labels.length > 0
          ? known.labels.map((l) => l.toLowerCase())
          : ['stranger'];
        const time = new Date(row.date).getTime();
        if (this.creatorReplyScopedTalkId && row.talkId !== this.creatorReplyScopedTalkId) return false;
        if (query && !`${row.responderName} ${row.title}`.toLowerCase().includes(query)) return false;
        if (state.outcome !== 'all' && row.outcome !== state.outcome && row.answerMode !== state.outcome) return false;
        if (state.relationship !== 'all' && !labels.includes(state.relationship)) return false;
        if (state.type !== 'all' && String(row.type || 'flow').toLowerCase() !== state.type) return false;
        if (state.language !== 'all' && String(row.language || 'en').toLowerCase() !== state.language) return false;
        if (fromTime != null && time < fromTime) return false;
        if (toTime != null && time > toTime) return false;
        return true;
      })
      .sort((a, b) => {
        const aMetrics = metricsByResponder.get(a.responderId)!;
        const bMetrics = metricsByResponder.get(b.responderId)!;
        const aTalk = metricsByTalk.get(a.talkId)!;
        const bTalk = metricsByTalk.get(b.talkId)!;
        // Pre-sort by group field so contiguous group blocks are formed (prevents duplicate group headers).
        if (state.group === 'responder') {
          const g = a.responderName.localeCompare(b.responderName);
          if (g !== 0) return g;
        } else if (state.group === 'talk') {
          const g = a.title.localeCompare(b.title);
          if (g !== 0) return g;
        } else if (state.group === 'day') {
          const g = new Date(a.date).toLocaleDateString().localeCompare(new Date(b.date).toLocaleDateString());
          if (g !== 0) return g;
        } else if (state.group === 'relationship') {
          const aRel = (this.getKnownPerson(a.responderId)?.labels || []).join(', ') || 'stranger';
          const bRel = (this.getKnownPerson(b.responderId)?.labels || []).join(', ') || 'stranger';
          const g = aRel.localeCompare(bRel);
          if (g !== 0) return g;
        }
        if (state.sort === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
        if (state.sort === 'user') return a.responderName.localeCompare(b.responderName) || a.title.localeCompare(b.title);
        if (state.sort === 'talk') return a.title.localeCompare(b.title) || a.responderName.localeCompare(b.responderName);
        if (state.sort === 'relationship') {
          const byRelationship = ((this.getKnownPerson(a.responderId)?.labels || []).join(', ') || 'Stranger')
            .localeCompare((this.getKnownPerson(b.responderId)?.labels || []).join(', ') || 'Stranger');
          if (byRelationship !== 0) return byRelationship;
        }
        if (state.sort === 'match-percent') {
          const aPct = matchPercent(a.responderId) ?? -1;
          const bPct = matchPercent(b.responderId) ?? -1;
          if (bPct !== aPct) return bPct - aPct;
        }
        if (state.sort === 'matches' && bMetrics.matches !== aMetrics.matches) return bMetrics.matches - aMetrics.matches;
        if (state.sort === 'talk-matches' && bTalk.matches !== aTalk.matches) return bTalk.matches - aTalk.matches;
        if (state.sort === 'talk-replies' && bTalk.replies !== aTalk.replies) return bTalk.replies - aTalk.replies;
        if (state.sort === 'weighted' && bMetrics.relevance !== aMetrics.relevance) return bMetrics.relevance - aMetrics.relevance;
        return new Date(b.date).getTime() - new Date(a.date).getTime() || a.responseId.localeCompare(b.responseId);
      });
    const shown = Math.min(this.creatorReplyVisibleCount, filtered.length);
    summary.textContent = this.getUiLanguage() === 'zh'
      ? `显示 ${shown}/${filtered.length} 条筛选回复（共 ${this.creatorReplyRows.length} 条）`
      : `Showing ${shown} of ${filtered.length} filtered replies (${this.creatorReplyRows.length} total)`;
    const activeFilters = document.getElementById('creator-replies-active-filters');
    if (activeFilters) {
      const chips = [
        state.query ? `${this.getUiLanguage() === 'zh' ? '搜索' : 'Search'}: ${state.query}` : '',
        state.outcome !== 'all' ? `${this.getUiLanguage() === 'zh' ? '结果' : 'Outcome'}: ${state.outcome}` : '',
        state.relationship !== 'all' ? `${this.getUiLanguage() === 'zh' ? '关系' : 'Relation'}: ${state.relationship}` : '',
        state.type !== 'all' ? `${this.getUiLanguage() === 'zh' ? '类型' : 'Type'}: ${state.type}` : '',
        state.language !== 'all' ? `${this.getUiLanguage() === 'zh' ? this.t('languagesLabel') : 'Language'}: ${this.formatTalkLanguage(state.language)}` : '',
        state.from ? `${this.getUiLanguage() === 'zh' ? '起始日期' : 'From'}: ${state.from}` : '',
        state.to ? `${this.getUiLanguage() === 'zh' ? '结束日期' : 'To'}: ${state.to}` : '',
      ].filter(Boolean);
      activeFilters.innerHTML = chips.map((chip) =>
        `<span class="reply-filter-chip" style="font-size:0.8em;background:var(--border);border-radius:999px;padding:3px 8px;">${escapeHtml(chip)}</span>`,
      ).join('') + (this.creatorReplyScopedTalkId
        ? `<span class="reply-filter-chip reply-scope-chip" id="reply-scope-chip" style="font-size:0.8em;background:var(--accent-soft);color:var(--accent-text);border-radius:999px;padding:3px 8px;cursor:pointer;font-weight:600;" title="${escapeHtml(this.t('repliesClearScope'))}">${escapeHtml(this.tf('repliesScopedToTalk', { title: this.creatorReplyScopedTalkTitle }))} ×</span>`
        : '');
      document.getElementById('reply-scope-chip')?.addEventListener('click', () => {
        this.creatorReplyScopedTalkId = null;
        this.creatorReplyScopedTalkTitle = '';
        this.renderCreatorReplies();
      });
    }
    if (filtered.length === 0) {
      list.innerHTML = `<div style="color:var(--text-muted);padding:8px;">${this.t('repliesNoMatch')}</div>`;
      return;
    }
    let previousGroup = '';
    list.innerHTML = filtered.slice(0, this.creatorReplyVisibleCount).map((row) => {
      const known = this.getKnownPerson(row.responderId);
      const label = known?.labels?.length ? known.labels.join(', ') : this.t('stranger');
      const metrics = metricsByResponder.get(row.responderId)!;
      const score = state.sort === 'weighted'
        ? this.getUiLanguage() === 'zh'
          ? ` · 得分 ${metrics.relevance}（${metrics.matches} 匹配 x100 + ${metrics.replies} 回复）`
          : ` · Score ${metrics.relevance} (${metrics.matches} matches x100 + ${metrics.replies} replies)`
        : '';
      const answerPreview = row.answers
        .map((answer) => String(answer.answerText || '').trim())
        .filter(Boolean)
        .join(', ');
      const group = state.group === 'responder'
        ? row.responderName
        : state.group === 'talk'
          ? row.title
          : state.group === 'relationship'
            ? String(label)
            : state.group === 'day'
              ? new Date(row.date).toLocaleDateString()
              : '';
      const groupHeader = group && group !== previousGroup
        ? `<div class="creator-reply-group" style="font-weight:700;color:var(--text-secondary);margin-top:5px;">${escapeHtml(group)}</div>`
        : '';
      previousGroup = group;
      // Spec §30.2: a matched row with a stored route matchThreshold score shows its match %
      // (Adam's "Matched items" list) and, when a conversation actually formed, is clickable
      // straight through to it instead of the profile view — review candidates, then DM.
      // Scoped to matchThreshold-route matches only (pct != null) — an ordinary (non-route, or
      // route without matchThreshold) match row keeps its long-standing behavior of navigating
      // to the responder's contact detail instead (09-contacts-talks-cross-navigation.spec.ts).
      const pct = row.outcome === 'match' ? matchPercent(row.responderId) : null;
      const matchConversationId = pct != null ? matchInfoByResponder.get(row.responderId)?.conversationId : undefined;
      const percentChip = pct != null
        ? `<span class="creator-reply-match-percent" data-match-percent="${pct}" style="font-size:0.8em;font-weight:700;color:var(--success-text);margin-left:8px;">${pct}%</span>`
        : '';
      return `${groupHeader}
        <div class="creator-reply-row" data-response-id="${escapeHtml(row.responseId)}" data-responder-id="${escapeHtml(row.responderId)}" data-responder-name="${escapeHtml(row.responderName)}" data-talk-id="${escapeHtml(row.talkId)}" ${matchConversationId ? `data-conversation-id="${escapeHtml(matchConversationId)}"` : ''} style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);cursor:pointer;" role="button" tabindex="0" title="${escapeHtml(this.t('repliesViewContact'))}">
          <div style="display:flex;justify-content:space-between;gap:10px;">
            <strong>${escapeHtml(row.responderName)}</strong>
            <span>
              <span style="color:${row.outcome === 'match' ? 'var(--success-text)' : 'var(--text-tertiary)'};">${escapeHtml(row.outcome === 'match' ? this.t('match') : row.outcome === 'mismatch' ? this.t('mismatch') : row.outcome)}</span>${percentChip}
            </span>
          </div>
          <div style="font-size:0.86em;color:var(--text-secondary);">${escapeHtml(row.title)} · ${escapeHtml(row.type)} · ${escapeHtml(this.formatTalkLanguage(String(row.language || 'en').toLowerCase()))} · ${escapeHtml(row.answerMode || 'manual')} · ${escapeHtml(String(label))} · ${escapeHtml(new Date(row.date).toLocaleString())}${escapeHtml(score)}</div>
          ${answerPreview ? `<div class="creator-reply-answers" style="font-size:0.84em;color:var(--text-primary);margin-top:4px;">${this.t('repliesAnswers')}: ${escapeHtml(answerPreview)}</div>` : ''}
        </div>
      `;
    }).join('');
    list.querySelectorAll<HTMLElement>('.creator-reply-row').forEach((row) => {
      row.addEventListener('click', () => {
        const conversationId = row.dataset.conversationId || '';
        if (conversationId) {
          this.showConversationDetail(conversationId);
          return;
        }
        const id = row.dataset.responderId || '';
        const name = row.dataset.responderName || '';
        if (id) this.navigateToGraphNode({ type: 'person', id, name });
      });
    });
    if (filtered.length > this.creatorReplyVisibleCount) {
      const moreCount = Math.min(CREATOR_REPLY_PAGE_SIZE, filtered.length - this.creatorReplyVisibleCount);
      list.innerHTML += `<button class="btn" id="reply-load-more" type="button" style="margin-top:6px;">${this.getUiLanguage() === 'zh' ? `再显示 ${moreCount} 条回复` : `Show ${moreCount} more replies`}</button>`;
      document.getElementById('reply-load-more')?.addEventListener('click', () => {
        this.creatorReplyVisibleCount += CREATOR_REPLY_PAGE_SIZE;
        this.renderCreatorReplies();
      });
    }
  }

  displayAnswersList(): void {
    renderAnswersList({
      getCurrentIdentity: () =>
        this.currentUser
          ? { stageName: this.currentUser.stageName, ...(this.currentUser.headshot ? { headshot: this.currentUser.headshot } : {}) }
          : null,
      getMyTalks: this.getMyTalks.bind(this),
      getExactChatbotMemory,
      escapeHtml: escapeHtml,
      getFlatAnswerHistory,
      copyAnsweredTalkToTalks: this.copyAnsweredTalkToTalks.bind(this),
      showTalkDetail: this.showTalkDetailAsAnswer.bind(this),
      openTalkResponses: (talkId: string, talkTitle: string) => {
        this.showCreatorRepliesForTalk(talkId, talkTitle);
      },
      viewContact: (userId: string) => {
        this.navigateToGraphNode({ type: 'person', id: userId, name: this.getPeerName(userId) });
      },
      showPreferencesDialog: this.showPreferencesDialog.bind(this),
      showItemDetailsPopup: this.showDetailsPopupFor.bind(this),
      getTalkContentKey: UIManager.getTalkContentKey,
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
      formatType: this.formatTalkType.bind(this),
      formatLanguage: this.formatTalkLanguage.bind(this),
      // TODO §R3: fires after both the first chunk and the deferred remainder, so a
      // filter applied before the remainder lands still reaches the rows that arrive
      // after it — a single call right after renderAnswersList returns (the old
      // behavior) would miss those.
      onRowsRendered: () => this.applyMeAnswerFilter(),
    });
    document.getElementById('answers-search-input')?.addEventListener('input', () => this.applyMeAnswerFilter());
  }

  private applyMeAnswerFilter(): void {
    const activeTypes = Array.from(document.querySelectorAll<HTMLInputElement>('.me-talk-type-checkbox:checked'))
      .map((checkbox) => checkbox.value.toLowerCase())
      .filter(Boolean);
    const allowedTagStates = Array.from(document.querySelectorAll<HTMLInputElement>('.me-tag-state-checkbox:checked'))
      .map((checkbox) => checkbox.value);
    const query = ((document.getElementById('answers-search-input') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
    const outcome = (document.getElementById('me-outcome-filter') as HTMLSelectElement | null)?.value || 'all';
    const sort = (document.getElementById('me-answer-sort') as HTMLSelectElement | null)?.value || 'answered-desc';
    const answerQuery = ((document.getElementById('me-answer-filter') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
    const fromDate = (document.getElementById('me-answer-date-from') as HTMLInputElement | null)?.value || '';
    const toDate = (document.getElementById('me-answer-date-to') as HTMLInputElement | null)?.value || '';
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    let visibleCount = 0;

    document.querySelectorAll<HTMLElement>('#answers-content .answer-talk-item').forEach((item) => {
      // A merged row can carry more than one contributing talk type (data-talk-type is a
      // space-separated set) since the same question may have been asked via several talk
      // types — matches if ANY contributing type is active, rather than requiring one exact type.
      const talkTypes = String(item.dataset.talkType || 'flow').toLowerCase().split(' ').filter(Boolean);
      const tagState = String(item.dataset.tagState || '');
      // docs/TODO.md §LL.2 follow-up: rows no longer have a distinct checkbox-pill CSS class —
      // whether this row's most-recent variant is a boolean (Checked/Unchecked) tag is now
      // carried directly in data-tag-state itself (non-empty only for that case; see
      // renderQuestionRow, answers-view.ts).
      const isTagRow = tagState !== '';
      const matchesType = activeTypes.length === 0 ? false : talkTypes.some((type) => activeTypes.includes(type));
      const matchesTagState = !isTagRow || allowedTagStates.includes(tagState);
      const matchesQuery = !query || String(item.dataset.searchText || '').toLowerCase().includes(query);
      const answeredAt = Number(item.dataset.answeredAt || 0);
      const matchesAnswer = !answerQuery || String(item.dataset.answerText || '').includes(answerQuery);
      const matchesDate = answeredAt >= fromMs && answeredAt <= toMs;
      const visible = matchesType && matchesTagState && matchesQuery && matchesAnswer && matchesDate
        && (outcome === 'all' || item.dataset.outcome === outcome);
      item.style.display = visible ? 'flex' : 'none';
      if (visible) visibleCount += 1;
    });

    const list = document.getElementById('answers-list');
    let empty = document.getElementById('answers-filter-empty');
    if (list && !empty) {
      empty = document.createElement('div');
      empty.id = 'answers-filter-empty';
      empty.style.cssText = 'display:none;padding:20px;text-align:center;color:var(--text-tertiary);border:1px dashed var(--border-strong);border-radius:8px;background:var(--bg-subtle);';
      empty.textContent = this.t('meNoMatchingAnswers');
      list.appendChild(empty);
    }
    if (list) {
      const rank = (item: HTMLElement): number => {
        if (sort === 'answered-asc') return Number(item.dataset.answeredAt || 0);
        if (sort === 'chatbot-recent') return -Number(item.dataset.chatbotLastUsedAt || 0);
        if (sort === 'chatbot-count') return -Number(item.dataset.chatbotUseCount || 0);
        return -Number(item.dataset.answeredAt || 0);
      };
      // docs/TODO.md §LL.2 follow-up: rows live directly under the single flat `#answers-list`
      // now (no more per-talk section containers) — sort them all together.
      Array.from(list.querySelectorAll<HTMLElement>('.answer-talk-item'))
        .sort((a, b) => rank(a) - rank(b))
        .forEach((row) => list.appendChild(row));
    }
    if (empty) empty.style.display = visibleCount === 0 && document.querySelector('#answers-content .answer-talk-item') ? 'block' : 'none';
  }

  /**
   * TODO §M4: shared section-wrapper for Settings — one consistent border/background/padding
   * and one heading convention (title + optional subtitle + optional right-aligned action)
   * instead of the 9 copy-pasted inline-style `<section>` strings this replaces. Uses `<details
   * open>` (the one existing precedent in this UI layer, `answers-view.ts`'s context-group
   * `<details>`) so every section is independently collapsible — open by default, so nothing
   * about current visibility/interaction changes unless the user chooses to collapse it. The
   * action control renders in the body, below the summary (not inside it), so its own click
   * handler never fights the browser's native summary-click-toggles-open/closed behavior.
   */
  private renderSettingsSection(
    opts: { id?: string; title: string; subtitle?: string; action?: string; danger?: boolean },
    bodyHtml: string,
  ): string {
    // A plain header, not a collapsible <details>/<summary>: now that the drill-down (see
    // applySettingsSectionView) shows exactly one section at a time, a second, independent
    // collapse control on top of that would be redundant and just a way to accidentally hide
    // the only content on the page.
    return `
      <div class="settings-section" ${opts.id ? `id="${opts.id}"` : ''} style="background:var(--surface);border:1px solid ${opts.danger ? 'var(--danger-border)' : 'var(--border)'};border-radius:8px;">
        <div class="settings-section-summary" style="padding:16px;">
          <div style="font-weight:700;color:${opts.danger ? 'var(--danger-hover)' : 'var(--text-primary)'};display:inline;">${opts.title}</div>
          ${opts.subtitle ? `<div style="font-size:0.82em;color:var(--text-tertiary);margin-top:2px;">${opts.subtitle}</div>` : ''}
        </div>
        <div class="settings-section-body" style="padding:0 16px 16px 16px;">
          ${opts.action ? `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">${opts.action}</div>` : ''}
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  private renderSettingsView(user: User): void {
    const connectivity = loadConnectivitySettings();
    const nativeHost = (window as unknown as {
      iinpublicNative?: { version?: string; platform?: string };
    }).iinpublicNative;
    const nativeQuery = new URLSearchParams(window.location.search);
    const queryPlatform = nativeQuery.get('native_platform') || '';
    const appVersion = String(nativeHost?.version || nativeQuery.get('app_version') || 'web');
    const appPlatform = nativeHost?.platform || queryPlatform;
    const container = document.getElementById('settings-content');
    if (!container) return;
    const currentColorScheme = getColorSchemePreference();
    const profileLanguages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.languages = profileLanguages;
    // Intake filters are persisted synchronously to localStorage on every settings change
    // (setTalkIntakeFilters, called from ui-manager's sync()), while user.talkFilters comes
    // from an async, eventually-consistent server round-trip (WebUserService.updateTalkFilters
    // queues one getUser+put per change via withPrivateDataLock) that can be caught mid-drain —
    // e.g. by a page reload — and return a partially-applied intermediate state that isn't the
    // hardcoded default shape but also isn't the true latest value (see: e2e
    // 31-intake-filters-persist regression, 2026-08-09, where this silently clobbered the
    // correct localStorage value on reload). localStorage for THIS device is never subject to
    // that race, so prefer it — but ONLY when it was actually saved for the user being rendered
    // now: a stored value tagged for a *different* user id (a device previously used by someone
    // else, or an identity swap) must not be applied to this one, so user.talkFilters wins then.
    const hasUserFilters =
      user.talkFilters && typeof user.talkFilters === 'object' && Object.keys(user.talkFilters).length > 0;
    const normalizedUserFilters = hasUserFilters
      ? normalizeTalkFilterShape(user.talkFilters, profileLanguages)
      : null;
    const localStorageOwnedByThisUser =
      hasStoredTalkIntakeFilters() && getTalkIntakeFiltersOwner() === user.id;
    const talkFilters = localStorageOwnedByThisUser
      ? getTalkIntakeFilters()
      : normalizedUserFilters ?? normalizeTalkFilterShape(undefined, profileLanguages);
    user.talkFilters = talkFilters;
    setTalkIntakeFilters(talkFilters);
    setTalkIntakeFiltersOwner(user.id);
    const reputation = user.reputation || ({} as typeof user.reputation);
    const reviewCount = reputation.reviewCount ?? 0;
    const starRating = Number(reputation.starRating ?? 0);
    const friendsCount = reputation.friendsCount ?? 0;
    const matchesFound = reputation.matchesFound ?? 0;
    const likedCount = reputation.likedCount ?? 0;
    const dislikedCount = reputation.dislikedCount ?? 0;
    const ageVerified = reputation.ageVerified === true;
    const isCreditVisible = reputation.isHidden !== true;
    const home = this.getHomeChatroomId();
    const headshot = String(user.headshot || '').trim();
    const interestNames = Array.isArray(user.interests)
      ? user.interests.map((t: Tag) => String(t?.name || '').trim()).filter(Boolean)
      : [];
    const profileAnswers = Array.isArray(user.profile) ? user.profile : [];
    const profilePreview = profileAnswers.length > 0
      ? profileAnswers
          .slice(0, 4)
          .map((qa) => {
            const vis = normalizeProfileAttributeVisibility(qa.visibility);
            const canonicalSupportRole =
              qa.id === 'techsupport_profile_role' &&
              qa.question === 'Role' &&
              qa.answer === 'IinPublic network support';
            const visNote =
              vis === 'public'
                ? ''
                : `<div style="font-size:0.72em;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(
                    vis === 'contacts_only' ? this.t('meVisibilityContacts') : this.t('meVisibilityPrivate'),
                  )}</div>`;
            const question = canonicalSupportRole ? this.t('meTechSupportRole') : qa.question;
            const answer = canonicalSupportRole ? this.t('meTechSupportRoleValue') : qa.answer;
            return `<div style="padding:8px 10px;border-radius:8px;background:var(--bg-subtle);border:1px solid var(--border);"><div style="font-size:0.78em;color:var(--text-tertiary);">${escapeHtml(question)}</div>${visNote}<div style="font-size:0.92em;font-weight:600;color:var(--text-primary);margin-top:2px;">${escapeHtml(answer)}</div></div>`;
          })
          .join('')
      : `<div style="font-size:0.88em;color:var(--text-tertiary);">${escapeHtml(this.t('meNoPublicProfile'))}</div>`;
    const locationText = this.currentLocation
      ? `${this.currentLocation.latitude.toFixed(3)}, ${this.currentLocation.longitude.toFixed(3)}`
      : this.t('settingsUnknown');
    const filteredIncoming = filterIncomingTalkClusters(
      (this.incomingTalkClusters || []).filter((cluster: any) => cluster && cluster.identityKey),
      talkFilters,
      this.currentLocation,
    );
    const hiddenIncomingText = this.formatReasonCounts(filteredIncoming.hiddenByReason);
    const dirtyWordList = talkFilters.dirtyWords === undefined
      ? [...DEFAULT_DIRTY_WORDS]
      : normalizeDirtyWords(talkFilters.dirtyWords);
    const homeOptions = [
      ...getFlatChatroomList().map((room) => ({
        id: room.id,
        label: `${'-- '.repeat(room.level)}${room.icon} ${room.name}`,
      })),
      ...this.customChatrooms.map((room) => ({
        id: room.id,
        label: `${room.type === 'business' ? '🏪' : '💬'} ${room.name}`,
      })),
    ];
    const uiLanguage = this.getUiLanguage();
    const defaultTalkLanguage = getDefaultTalkLanguagePreference(uiLanguage);
    const languageOptions = LANGUAGE_OPTIONS.map((language) => ({
      ...language,
      label: languageOptionLabel(uiLanguage, language.code, language.label),
    }));
    const headshotChoices = ['🙂', '😎', '🤠', '🎾', '☕', '🌟', '🐱', '🦊'];
    // Drill-down menu: a flat list of section names is the default view; tapping one hides the
    // menu and every OTHER section, leaving just the tapped section + a back button (app-bar
    // #back-to-settings-menu) — same list-then-detail pattern as Chatrooms/Contacts. Sections
    // themselves are still rendered up front (renderSettingsSection's <details open> markup is
    // unchanged) — applySettingsSectionView() below only toggles which one is display:none, it
    // never removes/re-adds DOM, so ids stay stable across a section switch.
    const jumpMenuItems: Array<{ icon: string; label: string; target: string }> = [
      { icon: '👤', label: this.t('profile'), target: 'settings-section-profile' },
      { icon: '🎨', label: this.t('settingsAppearance'), target: 'settings-section-appearance' },
      { icon: '⭐', label: this.t('credit'), target: 'settings-section-credit' },
      { icon: '🌐', label: this.t('settingsLanguages'), target: 'settings-section-languages' },
      { icon: '🗣️', label: this.t('settingsTalkBehavior'), target: 'settings-section-talk-behavior' },
      { icon: '📍', label: this.t('settingsDistanceHome'), target: 'settings-section-distance-home' },
      { icon: '🚫', label: this.t('settingsContentFilters'), target: 'settings-section-content-filters' },
      { icon: '📡', label: 'Connectivity', target: 'settings-section-connectivity' },
      { icon: '🔐', label: this.t('settingsIdentityDevices'), target: 'settings-section-linked-devices' },
      { icon: '🗑️', label: this.t('settingsEraseDevice'), target: 'settings-section-erase-device' },
      { icon: '💾', label: this.t('settingsStorage'), target: 'settings-storage-inspector' },
    ];
    const jumpMenuHtml = `
      <div class="settings-jump-menu" id="settings-jump-menu" style="display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        ${jumpMenuItems.map((item, index) => `
          <button type="button" class="settings-jump-menu-item" data-target="${item.target}" style="display:flex;align-items:center;gap:10px;padding:12px 16px;border:none;${index < jumpMenuItems.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}background:none;text-align:left;cursor:pointer;font:inherit;color:var(--text-primary);">
            <span aria-hidden="true" style="font-size:1.05em;flex-shrink:0;">${item.icon}</span>
            <span style="flex:1 1 auto;">${item.label}</span>
            <span aria-hidden="true" style="color:var(--text-tertiary);">›</span>
          </button>
        `).join('')}
      </div>
      <div id="settings-app-version" data-testid="settings-app-version" style="padding:2px 4px;text-align:center;font-size:0.78em;color:var(--text-tertiary);">
        IinPublic version ${escapeHtml(appVersion)}${appPlatform ? ` · ${escapeHtml(appPlatform)}` : ''}
      </div>
    `;
    container.innerHTML = `
      <div id="settings-menu-container" data-testid="settings-menu-container" style="display:grid;gap:14px;">
        ${jumpMenuHtml}
      </div>
      <div id="settings-detail-container" data-testid="settings-detail-container" style="display:none;">
        <div style="display:grid;gap:14px;">
        ${this.renderSettingsSection({ id: 'settings-section-profile', title: this.t('profile') }, `
          <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start;">
            <div style="display:grid;gap:8px;min-width:0;">
              <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
                <span>${this.t('settingsStageName')}</span>
                <input type="text" class="form-input" id="settings-stage-name-input" data-testid="settings-stage-name-input" value="${escapeHtml(user.stageName)}" minlength="3">
              </label>
              <div id="settings-stage-name-error" role="alert" style="display:none;font-size:0.82em;color:var(--danger-hover);margin-top:5px;"></div>
              ${interestNames.length > 0 ? `<div style="font-size:0.86em;color:var(--text-tertiary);">${this.t('interestsLabel')}: ${escapeHtml(interestNames.join(', '))}</div>` : ''}
            </div>
            <div style="display:grid;gap:8px;font-size:0.9em;">
              <span>${this.t('settingsHeadshot')}</span>
              <div class="user-avatar" style="width:72px;height:72px;font-size:1.7em;">
                ${avatarInnerHtml(headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
              </div>
              <select class="form-input" id="settings-headshot-select" data-testid="settings-headshot-select">
                <option value="">${this.t('settingsInitial')}</option>
                ${headshotChoices
                  .map((choice) => `<option value="${choice}" ${choice === headshot ? 'selected' : ''}>${choice}</option>`)
                  .join('')}
              </select>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn" type="button" id="settings-choose-photo-btn">${this.t('settingsChoosePhoto')}</button>
                <button class="btn" type="button" id="settings-take-photo-btn">${this.t('settingsTakePhoto')}</button>
                <button class="btn" type="button" id="settings-remove-photo-btn">${this.t('settingsRemove')}</button>
              </div>
              <input class="visually-hidden" type="file" id="settings-photo-input" accept="image/png,image/jpeg,image/webp,image/gif">
              <input class="visually-hidden" type="file" id="settings-camera-input" accept="image/*" capture="user">
              <div style="font-size:0.78em;color:var(--text-tertiary);">${this.t('settingsPhotoHelp')}</div>
              <div id="settings-camera-status" role="status" style="display:none;font-size:0.8em;color:var(--danger-hover);"></div>
            </div>
            <div style="display:grid;gap:10px;border-top:1px solid var(--border);padding-top:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <div>
                  <div style="font-weight:700;color:var(--text-primary);">${this.t('profile')}</div>
                  <div style="font-size:0.82em;color:var(--text-tertiary);">${this.t('meProfileVisibilityHelp')}</div>
                </div>
                <button class="btn" type="button" id="settings-edit-profile-btn" data-testid="settings-edit-profile-button">${this.t('editProfile')}</button>
              </div>
              <div style="font-size:0.88em;color:var(--text-secondary);">
                ${this.t('languagesLabel')}: ${escapeHtml(profileLanguages.map((code) => this.formatTalkLanguage(code)).join(', '))}
              </div>
              <div style="display:grid;gap:8px;">${profilePreview}</div>
            </div>
          </div>
        `)}
        ${this.renderSettingsSection(
          { id: 'settings-section-appearance', title: this.t('settingsAppearance'), subtitle: this.t('settingsAppearanceHelp') },
          `
          <div id="settings-scheme-picker" style="display:grid;gap:8px;">
            ${COLOR_SCHEMES.map((scheme) => {
              const swatch = SETTINGS_SCHEME_SWATCHES[scheme];
              const checked = currentColorScheme === scheme;
              return `
                <label class="settings-scheme-option" data-scheme="${scheme}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:10px;cursor:pointer;">
                  <input type="radio" name="settings-color-scheme" class="settings-scheme-radio" value="${scheme}" ${checked ? 'checked' : ''}>
                  <span style="width:26px;height:26px;border-radius:50%;flex:none;background:${swatch};border:1px solid rgba(0,0,0,0.08);"></span>
                  <span style="font-weight:600;font-size:0.92em;">${this.t(SETTINGS_SCHEME_LABEL_KEYS[scheme])}</span>
                </label>
              `;
            }).join('')}
          </div>
        `,
        )}
        ${this.renderSettingsSection(
          {
            id: 'settings-section-credit',
            title: this.t('credit'),
            subtitle: this.t('meCreditHelp'),
            action: `
              <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;">
                <input type="checkbox" id="settings-credit-visible" ${isCreditVisible ? 'checked' : ''}>
                <span>${this.t('settingsCreditVisible')}</span>
              </label>
            `,
          },
          `
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meReviews')}</div><div style="font-size:1.15em;font-weight:700;">${reviewCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meStarRating')}</div><div style="font-size:1.15em;font-weight:700;">${starRating.toFixed(1)}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meFriends')}</div><div style="font-size:1.15em;font-weight:700;">${friendsCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meLiked')}</div><div style="font-size:1.15em;font-weight:700;">${likedCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meDisliked')}</div><div style="font-size:1.15em;font-weight:700;">${dislikedCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meMatches')}</div><div style="font-size:1.15em;font-weight:700;">${matchesFound}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);grid-column:span 2;"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meAgeVerified')}</div><div style="font-size:1.15em;font-weight:700;">${ageVerified ? '18+' : this.t('unavailable')}</div></div>
          </div>
        `,
        )}
        ${this.renderSettingsSection({ id: 'settings-section-languages', title: this.t('settingsLanguages') }, `
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
            <span>${this.t('settingsUiLanguage')}</span>
            <select class="form-input" id="settings-ui-language" data-testid="settings-ui-language-select">
              ${languageOptions
                .filter((lang) => lang.code === 'en' || lang.code === 'zh')
                .map((lang) => `<option value="${lang.code}" ${uiLanguage === lang.code ? 'selected' : ''}>${lang.label}</option>`)
                .join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsProfileLanguage')}</span>
            <select class="form-input" id="settings-profile-languages" data-testid="settings-profile-language-select">
              ${languageOptions
                .map((lang) => `<option value="${lang.code}" ${profileLanguages[0] === lang.code ? 'selected' : ''}>${lang.label}</option>`)
                .join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsDefaultTalkLanguage')}</span>
            <select class="form-input" id="settings-default-talk-language" data-testid="settings-default-talk-language-select">
              ${languageOptions
                .map((lang) => `<option value="${lang.code}" ${defaultTalkLanguage === lang.code ? 'selected' : ''}>${lang.label}</option>`)
                .join('')}
            </select>
          </label>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsIncomingLanguage')}</span>
            <div id="settings-filter-languages" data-testid="settings-incoming-language-select" style="display:flex;flex-wrap:wrap;gap:8px;">
              ${languageOptions
                .map((lang) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);">
                    <input type="checkbox" class="settings-filter-language-option" value="${lang.code}" ${talkFilters.allowedLanguages.includes(lang.code) ? 'checked' : ''}>
                    <span>${lang.label}</span>
                  </label>
                `)
                .join('')}
            </div>
            <div id="settings-filter-languages-count" style="font-size:0.82em;color:var(--text-tertiary);">${talkFilters.allowedLanguages.length} ${this.t('settingsActive')}</div>
          </div>
        `)}
        ${this.renderSettingsSection({ id: 'settings-section-talk-behavior', title: this.t('settingsTalkBehavior') }, `
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;">
            <input type="checkbox" id="settings-copy-talk-autosave" ${getCopyTalkAutoSave() ? 'checked' : ''}>
            <span>${this.t('settingsCopyTalk')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-chatbot-enabled" ${getChatbotEnabled() ? 'checked' : ''}>
            <span>${this.t('settingsChatbot')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-keep-old-talk-on-edit" ${getKeepOldTalkOnEdit() ? 'checked' : ''}>
            <span>${this.t('settingsKeepOldTalkOnEdit')}</span>
          </label>
        `)}
        ${this.renderSettingsSection({ id: 'settings-section-distance-home', title: this.t('settingsDistanceHome') }, `
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${this.t('settingsMinDistance')}</span>
              <input type="number" class="form-input" id="settings-min-distance" min="0" step="1" value="${talkFilters.minDistanceMiles ?? ''}">
            </label>
            <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${this.t('settingsMaxDistance')}</span>
              <input type="number" class="form-input" id="settings-max-distance" min="0" step="1" value="${talkFilters.maxDistanceMiles ?? ''}">
            </label>
          </div>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsHomeRoom')}</span>
            <select class="form-input" id="settings-home-room">
              ${homeOptions
                .map((room) => `
                  <option value="${escapeHtml(room.id)}" ${room.id === home ? 'selected' : ''}>${escapeHtml(room.label)}</option>
                `)
                .join('')}
            </select>
          </label>
          <div style="margin-top:4px;font-size:0.82em;color:var(--text-tertiary);">${this.t('settingsLocation')}: ${escapeHtml(locationText)}</div>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsSentAfter')}</span>
            <input type="datetime-local" class="form-input" id="settings-sent-after" value="${escapeHtml(datetimeLocalValue(talkFilters.sentAfter))}">
          </label>
        `)}
        ${this.renderSettingsSection({ id: 'settings-section-content-filters', title: this.t('settingsContentFilters') }, `
          <div style="font-size:0.85em;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">${this.t('settingsMessageFiltersHeading')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-grammar-filter" ${talkFilters.requireGoodGrammar ? 'checked' : ''}> ${this.t('settingsGrammar')}</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-dirty-words-filter" ${talkFilters.blockDirtyWords ? 'checked' : ''}> ${this.t('settingsDirtyWords')}</label>
          </div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:8px;">${this.t('settingsGrammarHelp')} ${this.tf('settingsGrammarStrictness', { threshold: String(CONFIG.GRAMMAR_THRESHOLD) })}</div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:4px;">${this.t('settingsDirtyWordsHelp')}</div>
          <div id="settings-dirty-words-editor" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:0.9em;font-weight:600;margin-bottom:6px;">${this.t('settingsDirtyWordsListLabel')}</div>
            <div id="dirty-word-chips" data-testid="dirty-word-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
              ${dirtyWordList
                .map((word) => `
                  <span class="dirty-word-chip" data-testid="dirty-word-chip" data-word="${escapeHtml(word)}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border-strong);border-radius:999px;background:var(--bg-subtle);font-size:0.85em;">
                    <span>${escapeHtml(word)}</span>
                    <button type="button" class="dirty-word-chip-remove" data-testid="dirty-word-chip-remove" data-word="${escapeHtml(word)}" aria-label="remove ${escapeHtml(word)}" style="border:none;background:none;cursor:pointer;color:var(--text-tertiary);font-size:1em;line-height:1;padding:0;">✕</button>
                  </span>
                `)
                .join('')}
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <input type="text" class="form-input" id="dirty-word-add-input" data-testid="dirty-word-add-input" placeholder="${this.t('settingsDirtyWordAddPlaceholder')}" maxlength="48" style="flex:1;min-width:140px;">
              <button type="button" class="btn" id="dirty-word-add-btn" data-testid="dirty-word-add-btn">${this.t('settingsDirtyWordAdd')}</button>
              <button type="button" class="btn" id="dirty-word-reset-btn" data-testid="dirty-word-reset-btn">${this.t('settingsDirtyWordReset')}</button>
            </div>
            <div id="dirty-word-error" data-testid="dirty-word-error" style="font-size:0.8em;color:var(--danger);margin-top:4px;min-height:1em;"></div>
            <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:2px;">${this.t('settingsDirtyWordsListHelp')}</div>
          </div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:0.9em;font-weight:600;margin-bottom:6px;">${this.t('settingsAllowedTypes')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${(['tag', 'flow', 'route', 'survey'] as const)
                .map((type) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);">
                    <input type="checkbox" class="settings-talk-filter-type" value="${type}" ${talkFilters.allowedTalkTypes.includes(type) ? 'checked' : ''}>
                    <span>${type}</span>
                  </label>
                `)
                .join('')}
            </div>
          </div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${this.t('settingsBlockedPhrases')}</span>
              <textarea class="form-input" id="settings-custom-blocked" rows="3">${escapeHtml((talkFilters.customBlockedTerms || []).join(', '))}</textarea>
            </label>
          </div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
            <div style="font-size:0.9em;font-weight:600;margin-bottom:6px;">${this.t('settingsFilteredIncomingHeading')}</div>
            <div id="settings-filtered-incoming-summary" style="font-size:0.84em;color:var(--text-tertiary);">
              ${this.t('settingsHiddenIncoming')}: ${filteredIncoming.hiddenCount}
              ${hiddenIncomingText ? `<div>${escapeHtml(hiddenIncomingText)}</div>` : ''}
              ${!this.currentLocation && (this.incomingTalkClusters || []).some((c: any) => c?.latestTalk?.locationRadiusMiles != null || c?.locationRadiusMiles != null) ? `<div style="color:var(--warning-text);font-style:italic;margin-top:4px;">${escapeHtml(this.t('filterLocationPending'))}</div>` : ''}
            </div>
          </div>
        `)}
        ${this.renderSettingsSection(
          { id: 'settings-section-connectivity', title: 'Connectivity', subtitle: 'Choose routes automatically or tune data, battery, and forwarding policy.' },
          `<div style="display:grid;gap:12px;">
            <label>Preset
              <select id="settings-connectivity-preset" class="form-input" data-testid="settings-connectivity-preset">
                ${(['automatic', 'data-saver', 'fastest', 'local-event', 'private', 'advanced'] as ConnectivityPreset[]).map((preset) => `<option value="${preset}" ${connectivity.preset === preset ? 'selected' : ''}>${preset.replace('-', ' ')}</option>`).join('')}
              </select>
            </label>
            <div id="settings-connectivity-status" role="status">Automatic route selection · forwarding ${connectivity.forwarding.enabled ? 'on' : 'off'}</div>
            <label><input id="settings-connectivity-free-first" type="checkbox" ${connectivity.freeFirst ? 'checked' : ''}> Free routes first</label>
            <label><input id="settings-connectivity-direct-first" type="checkbox" ${connectivity.directFirst ? 'checked' : ''}> Direct routes first</label>
            <label><input id="settings-connectivity-battery-aware" type="checkbox" ${connectivity.batteryAware ? 'checked' : ''}> Battery-aware</label>
            <label>Metered network permission
              <select id="settings-connectivity-metered-permission" class="form-input">
                ${(['ask', 'allow-once', 'always-allow', 'wait-for-free'] as const).map((permission) => `<option value="${permission}" ${connectivity.meteredPermission === permission ? 'selected' : ''}>${permission.replaceAll('-', ' ')}</option>`).join('')}
              </select>
              <small>IinPublic asks before using a newly metered route. Nearby OS permission enables local discovery; denying it leaves Internet connectivity available.</small>
            </label>
            <label><input id="settings-connectivity-forwarding" type="checkbox" ${connectivity.forwarding.enabled ? 'checked' : ''}> Forward for peers</label>
            <label><input id="settings-connectivity-cellular-forwarding" type="checkbox" ${connectivity.forwarding.cellularForwarding ? 'checked' : ''}> Allow cellular forwarding</label>
            <label>Cellular byte budget <input id="settings-connectivity-cellular-budget" class="form-input" type="number" min="0" value="${connectivity.forwarding.cellularByteBudget}"></label>
            <details><summary>Advanced diagnostics</summary><div id="settings-connectivity-diagnostics" data-testid="settings-connectivity-diagnostics">Providers and verified SEA bindings appear here when active. Transport identifiers are diagnostics only.</div></details>
          </div>`,
        )}
        ${this.renderSettingsSection(
          {
            id: 'settings-section-linked-devices',
            title: this.t('settingsIdentityDevices'),
            subtitle: this.t('settingsIdentityDevicesHelp'),
            action: `<button type="button" class="btn" id="settings-linked-devices-btn" data-testid="settings-linked-devices-btn">${this.t('settingsManage')}</button>`,
          },
          '',
        )}
        ${this.renderSettingsSection(
          {
            id: 'settings-section-erase-device',
            title: this.t('settingsEraseDevice'),
            subtitle: this.t('settingsEraseDeviceHelp'),
            action: `<button type="button" class="btn" id="settings-erase-device-btn" data-testid="settings-erase-device-btn" style="background:var(--danger);color:#fff;">${this.t('settingsEraseDevice')}</button>`,
            danger: true,
          },
          '',
        )}
        ${this.renderSettingsSection(
          {
            id: 'settings-storage-inspector',
            title: this.t('settingsStorage'),
            action: `<button type="button" class="btn" id="settings-refresh-storage-btn">${this.t('settingsRefresh')}</button>`,
          },
          `<div id="settings-storage-inspector-body" style="font-size:0.9em;color:var(--text-tertiary);">${this.t('settingsStorageLoading')}</div>`,
        )}
        </div>
      </div>
    `;
    // TechSupport's support-inbox is an operator inbox, not a settings section — it stays
    // permanently visible above the menu/detail split rather than gated behind a menu tap.
    if (user.id === TECHSUPPORT_ROOT_USER_ID) {
      container.insertAdjacentHTML('afterbegin', '<div id="support-inbox-section" style="margin-bottom:14px;"></div>');
    }
    this.bindSettingsControls();
    void this.refreshStorageInspector();
    this.renderSupportInboxSectionIfPresent();
    this.applySettingsSectionView(this.settingsActiveSectionId);
  }

  /**
   * Settings drill-down: shows either the menu list (sectionId === null) or exactly one
   * section's detail view (every other `.settings-section` display:none, back button visible).
   * Never touches DOM node identity — safe to call after any renderSettingsView() re-render to
   * restore whichever page the user was on (e.g. a language change re-renders the whole view).
   */
  private applySettingsSectionView(sectionId: string | null): void {
    const menu = document.getElementById('settings-menu-container');
    const detail = document.getElementById('settings-detail-container');
    const backBtn = document.getElementById('back-to-settings-menu') as HTMLElement | null;
    const sections = document.querySelectorAll<HTMLElement>('#settings-detail-container .settings-section');
    const target = sectionId ? document.getElementById(sectionId) : null;
    if (sectionId && !target) {
      // The remembered section no longer exists in this render (shouldn't happen — the same 9
      // ids are always rendered — but fall back to the menu rather than show a blank detail).
      this.settingsActiveSectionId = null;
      this.applySettingsSectionView(null);
      return;
    }
    if (target) {
      sections.forEach((section) => { section.style.display = section === target ? '' : 'none'; });
      if (menu) menu.style.display = 'none';
      if (detail) detail.style.display = 'block';
      if (backBtn) backBtn.style.display = 'inline-flex';
    } else {
      sections.forEach((section) => { section.style.display = ''; });
      if (menu) menu.style.display = '';
      if (detail) detail.style.display = 'none';
      if (backBtn) backBtn.style.display = 'none';
    }
  }

  /**
   * The message filters currently in effect for this device (dirty-word list +
   * grammar). Falls back to persisted intake filters when the user record is not
   * loaded, so the same rules apply everywhere. (redesign §9.3)
   */
  private messageFilters(): Pick<TalkIntakeFilters, 'blockDirtyWords' | 'requireGoodGrammar' | 'dirtyWords'> {
    return this.currentUser?.talkFilters ?? getTalkIntakeFilters();
  }

  /**
   * Send-path guard (redesign §9.1/§9.2). Runs the shared outgoing filter; on a
   * hit it fires a warning toast (with `data-content-filter-notification`) and
   * returns false so the caller leaves the composer text intact and sends nothing.
   */
  private allowOutgoingMessage(message: string): boolean {
    const result = filterOutgoingMessage(message, this.messageFilters());
    if (result.passed) return true;
    this.showContentFilterToast(result, 'send');
    return false;
  }

  /**
   * Receive-path check (redesign §9.1/§9.2). Returns true when an incoming message
   * should be hidden at render (it stays in the Gun graph). Fires one toast per
   * hidden message.
   */
  public shouldHideIncomingMessage(message: string, senderId?: string): MessageFilterResult {
    // TechSupport is exempt (docs/TODO.md K6): a strict dirty-word or grammar filter
    // must never silence the only support channel the user has.
    return filterIncomingMessage(message, this.messageFilters(), { senderId });
  }

  private showContentFilterToast(result: MessageFilterResult, direction: 'send' | 'receive'): void {
    let text: string;
    let attr: string;
    if (result.reason === 'financial_data') {
      // Mandatory, non-configurable (FR-FIN-2) — same message on both paths since a
      // financial-data hit is never rendered for the receiver either (FR-FIN-4).
      text = this.t('messageBlockedFinancialData');
      attr = direction === 'send' ? 'financial-send' : 'financial-receive';
    } else if (result.reason === 'dirty_words') {
      text =
        direction === 'send'
          ? `${this.t('messageBlockedDirtyWord')}${result.word ? ` ('${result.word}')` : ''}`
          : this.t('messageHiddenDirtyWord');
      attr = direction === 'send' ? 'send' : 'receive';
    } else {
      text = direction === 'send' ? this.t('messageBlockedGrammar') : this.t('messageHiddenGrammar');
      attr = direction === 'send' ? 'grammar-send' : 'grammar-receive';
    }
    this.showNotification(text, 'error', { contentFilter: attr });
  }

  /** T1 (spec §7.4 FR-FIN-1): before a talk is sent/broadcast, at most once per day. */
  private maybeShowPreSendSafetyToast(): void {
    if (!shouldShowCooldownToast(SAFETY_TOAST_T1_KEY)) return;
    this.showNotification(this.t('safetyToastPreSend'), 'warning', { safetyToast: 'pre-send' });
  }

  /** T2 (spec §7.4 FR-FIN-1): immediately after a match is found, at most once per day. */
  maybeShowMatchSafetyToast(): void {
    if (!shouldShowCooldownToast(SAFETY_TOAST_T2_KEY)) return;
    this.showNotification(this.t('safetyToastPostMatch'), 'warning', { safetyToast: 'post-match' });
  }

  /**
   * Wire the dirty-word list editor (chips + add/remove/reset). `onChange` is the
   * settings `sync()` closure — every mutation re-reads the chips and persists.
   */
  private bindDirtyWordEditor(onChange: () => void): void {
    const chips = document.getElementById('dirty-word-chips');
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement | null;
    const addBtn = document.getElementById('dirty-word-add-btn');
    const resetBtn = document.getElementById('dirty-word-reset-btn');
    const errorEl = document.getElementById('dirty-word-error');
    if (!chips) return;

    const showError = (message: string): void => {
      if (errorEl) errorEl.textContent = message;
    };
    const currentWords = (): string[] =>
      Array.from(chips.querySelectorAll<HTMLElement>('.dirty-word-chip'))
        .map((el) => el.getAttribute('data-word') || '')
        .filter(Boolean);
    const renderChips = (words: string[]): void => {
      chips.innerHTML = words
        .map((word) => {
          const safe = escapeHtml(word);
          return `<span class="dirty-word-chip" data-testid="dirty-word-chip" data-word="${safe}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border-strong);border-radius:999px;background:var(--bg-subtle);font-size:0.85em;"><span>${safe}</span><button type="button" class="dirty-word-chip-remove" data-testid="dirty-word-chip-remove" data-word="${safe}" aria-label="remove ${safe}" style="border:none;background:none;cursor:pointer;color:var(--text-tertiary);font-size:1em;line-height:1;padding:0;">✕</button></span>`;
        })
        .join('');
    };

    const addWord = (): void => {
      if (!input) return;
      const raw = input.value.trim().toLowerCase();
      showError('');
      if (raw.length < 2) {
        showError(this.t('settingsDirtyWordTooShort'));
        return;
      }
      const existing = currentWords();
      if (existing.length >= 50) {
        showError(this.t('settingsDirtyWordLimit'));
        return;
      }
      const [normalized] = normalizeDirtyWords([raw]);
      if (!normalized) {
        showError(this.t('settingsDirtyWordTooShort'));
        return;
      }
      if (existing.includes(normalized)) {
        showError(this.t('settingsDirtyWordDuplicate'));
        return;
      }
      renderChips([...existing, normalized]);
      input.value = '';
      onChange();
    };

    addBtn?.addEventListener('click', addWord);
    input?.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        addWord();
      }
    });
    chips.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement)?.closest('.dirty-word-chip-remove') as HTMLElement | null;
      if (!target) return;
      const word = target.getAttribute('data-word');
      if (!word) return;
      showError('');
      renderChips(currentWords().filter((w) => w !== word));
      onChange();
    });
    resetBtn?.addEventListener('click', () => {
      showError('');
      renderChips([...DEFAULT_DIRTY_WORDS]);
      onChange();
    });
  }

  /**
   * Open the Identity & devices page (identity architecture WP1). Uses the local display model for
   * the list and the shared pairing protocol for code validation. Pairing-code
   * retention and signed-attestation publishing are delegated to the identity-link
   * service wired by the app. A one-sided attestation is shown as waiting, never as
   * a verified link.
   */
  private async openLinkedDevicesDialog(prefillLinkCode?: string): Promise<void> {
    const LOCAL_KEY = 'iinpublic_linked_devices';
    let graphStateResolved = false;
    const listRecords = (): LinkedDeviceRow[] => {
      try {
        const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
        if (!Array.isArray(arr)) return [];
        // localStorage supplies candidate identities and display labels only. A
        // persisted row cannot claim a verified link until this page has resolved
        // the signed graph state in the current view.
        return graphStateResolved
          ? arr
          : arr.map((row: LinkedDeviceRow) => ({ ...row, state: 'waiting' as const }));
      } catch {
        return [];
      }
    };
    const saveRecords = (rows: LinkedDeviceRow[]): void => localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
    const nativeHost = (window as unknown as {
      iinpublicNative?: { version?: string; platform?: string };
    }).iinpublicNative;
    const nativeQuery = new URLSearchParams(window.location.search);
    const explicitPlatform = nativeHost?.platform || nativeQuery.get('native_platform') || '';
    const appVersion = String(nativeHost?.version || nativeQuery.get('app_version') || 'web');
    const platform = detectLocalDevicePlatform(explicitPlatform, navigator.userAgent || '');
    const createdAt = new Date(this.currentUser?.createdAt || Date.now()).getTime();
    const defaultDeviceName = platform === 'android'
      ? this.t('defaultAndroidDeviceName')
      : platform === 'ios'
        ? this.t('defaultIosDeviceName')
        : platform === 'desktop'
          ? this.t('defaultDesktopDeviceName')
          : this.t('defaultBrowserDeviceName');
    let deviceMetadata = getOrCreateLocalDeviceMetadata(localStorage, {
      name: defaultDeviceName,
      platform,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    });
    const identityPub = this.currentUser?.pub || '';
    let protection = this.identityPasswordStatusReader
      ? await this.identityPasswordStatusReader().catch(() => ({ state: 'not-set' as const }))
      : { state: 'not-set' as const };
    let incomingHandoff = this.deviceHandoffCheckIncoming
      ? await this.deviceHandoffCheckIncoming().catch(() => null)
      : null;
    showLinkedDevicesDialog({
      text: (key: string, fallback?: string) => {
        const value = this.t(key as any);
        return value && value !== key ? value : (fallback ?? key);
      },
      listRecords,
      identity: {
        pub: identityPub,
        stageName: this.currentUser?.stageName || this.t('unavailable'),
        ...(this.currentUser?.headshot ? { headshot: this.currentUser.headshot } : {}),
        createdAt: Number.isFinite(createdAt) ? createdAt : deviceMetadata.createdAt,
        status: identityPub ? 'available' : 'needs-attention',
      },
      device: () => deviceMetadata,
      appVersion,
      protection: () => ({ state: protection.state === 'locked' ? 'set' : 'not-set' }),
      ...(this.identityPasswordSetter
        ? { setIdentityPassword: async (password: string) => {
          await this.identityPasswordSetter!(password);
          protection = { state: 'locked' };
        } }
        : {}),
      ...(this.identityPasswordChanger
        ? { changeIdentityPassword: this.identityPasswordChanger }
        : {}),
      ...(this.identityPasswordRemover
        ? { removeIdentityPassword: async (currentPassword: string) => {
          await this.identityPasswordRemover!(currentPassword);
          protection = { state: 'not-set' };
        } }
        : {}),
      ...(this.identityPasswordLocker
        ? { lockIdentityNow: this.identityPasswordLocker }
        : {}),
      renameDevice: (name: string) => {
        deviceMetadata = renameLocalDevice(localStorage, deviceMetadata, name);
        return deviceMetadata;
      },
      selfPub: () => identityPub,
      randomSecret: () => {
        const bytes = new Uint8Array(18);
        (globalThis.crypto || (window as any).crypto).getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      },
      ...(this.identityLinkCodeCreator
        ? { createLinkCode: (now: number) => this.identityLinkCodeCreator!(now) }
        : {}),
      ...(this.identityLinkRequestReader
        ? { readIncomingRequest: () => this.identityLinkRequestReader!() }
        : {}),
      ...(this.identityLinkRequestApprover
        ? { approveIncomingRequest: (pub: string) => this.identityLinkRequestApprover!(pub) }
        : {}),
      ...(this.identityLinkPendingCanceler
        ? { cancelPendingRequest: (requestId: string) => this.identityLinkPendingCanceler!(requestId) }
        : {}),
      ...(this.identityLinkRefresher
        ? { refreshRecords: async () => {
            await this.identityLinkRefresher!();
            graphStateResolved = true;
          } }
        : {}),
      completeFromCode: async (code: string) => {
        const decoded = decodePairingCode(code);
        if (!decoded) return 'invalid';
        if (decoded.pub === identityPub) return 'self';
        if (isPairingExpired(decoded)) return 'expired';
        const rows = listRecords();
        if (rows.some((r) => r.pub === decoded.pub)) return 'reused';
        if (!this.identityLinkCompleter) return 'invalid';
        const err = await this.identityLinkCompleter(code).catch(() => 'unavailable' as const);
        if (err) return err;
        rows.push({
          pub: decoded.pub,
          stageName: this.t('linkedDeviceDefaultName'),
          platform: 'web',
          linkedAt: Date.now(),
          state: 'waiting',
        });
        saveRecords(rows);
        return null;
      },
      unlink: async (pub: string) => {
        const state = this.identityLinkUnlinker
          ? await this.identityLinkUnlinker(pub)
          : 'revocation-pending';
        saveRecords(listRecords().map((row) => row.pub === pub ? { ...row, state } : row));
        return state;
      },
      ...(incomingHandoff
        ? {
            incomingHandoff: { fromPub: incomingHandoff.fromPub, fromName: incomingHandoff.fromName },
            importHandoff: async () => {
              if (!incomingHandoff || !this.deviceHandoffImport) return;
              await this.deviceHandoffImport(incomingHandoff.fromPub, incomingHandoff.archive);
              incomingHandoff = null;
            },
          }
        : {}),
    }, prefillLinkCode ? { prefillLinkCode } : undefined);
  }

  /**
   * TODO §I — URL-fragment same-device linking shortcut's entry point from `app.ts`:
   * a `#link=<code>` fragment decoded and cleared at boot lands here, opening the
   * Identity & devices overlay straight to the Enter-code dialog, pre-filled.
   */
  openLinkedDevicesWithCode(code: string): void {
    void this.openLinkedDevicesDialog(code);
  }

  /**
   * Open the Erase-this-device flow (§11 / item J). Offers a handoff sync when a
   * linked personal device is recorded; otherwise a plain type-`ERASE` wipe. The
   * wipe clears all device storage and reloads to a fresh boot.
   */
  private openEraseDeviceDialog(): void {
    let linked: LinkedDeviceRow[] = [];
    try {
      const arr = JSON.parse(localStorage.getItem('iinpublic_linked_devices') || '[]');
      // Only graph-verified active links are eligible sync/revocation targets.
      // Historical Removed/Invalid rows must not imply a receiver is available.
      linked = Array.isArray(arr)
        ? arr.filter((row: LinkedDeviceRow) => row.state === 'linked')
        : [];
    } catch {
      linked = [];
    }
    showEraseDeviceDialog({
      text: (key: string, fallback?: string) => {
        const value = this.t(key as any);
        return value && value !== key ? value : (fallback ?? key);
      },
      hasLinkedDevice: linked.length > 0,
      ...(linked[0]?.stageName ? { linkedDeviceName: linked[0].stageName } : {}),
      onErase: async () => {
        await eraseDevice({
          revokeLinks: async () => {
            if (this.identityLinkUnlinker) {
              for (const r of linked) await this.identityLinkUnlinker(r.pub).catch(() => {});
            }
          },
        });
      },
      ...(this.deviceHandoffSync && linked[0]?.pub
        ? { onSyncFirst: (progress: (category: import('../../shared/device-handoff').HandoffCategory) => void) =>
            this.deviceHandoffSync!(linked[0].pub, progress) }
        : {}),
    });
  }

  /** Optional handoff-sync hook the app wires for §11.2 (encrypted archive transfer). */
  private deviceHandoffSync?: (
    toPub: string,
    progress: (category: import('../../shared/device-handoff').HandoffCategory) => void,
  ) => Promise<void>;
  setDeviceHandoffSync(fn: (
    toPub: string,
    progress: (category: import('../../shared/device-handoff').HandoffCategory) => void,
  ) => Promise<void>): void {
    this.deviceHandoffSync = fn;
  }

  /** Optional receiver-side handoff hooks the app wires for §11.2 (import + ack). */
  private deviceHandoffCheckIncoming?: () => Promise<{
    fromPub: string;
    fromName: string;
    archive: import('../../shared/device-handoff').HandoffArchive;
  } | null>;
  private deviceHandoffImport?: (
    fromPub: string,
    archive: import('../../shared/device-handoff').HandoffArchive,
  ) => Promise<void>;
  setDeviceHandoffReceive(hooks: {
    checkIncoming: () => Promise<{
      fromPub: string;
      fromName: string;
      archive: import('../../shared/device-handoff').HandoffArchive;
    } | null>;
    importArchive: (
      fromPub: string,
      archive: import('../../shared/device-handoff').HandoffArchive,
    ) => Promise<void>;
  }): void {
    this.deviceHandoffCheckIncoming = hooks.checkIncoming;
    this.deviceHandoffImport = hooks.importArchive;
  }

  /** Optional hooks the app wires to publish real signed attestations/revocations (§10). */
  private identityLinkCodeCreator?: (now: number) => { payload: PairingPayload; code: string };
  private identityLinkRequestReader?: () => Promise<import('./linked-devices-dialog').IncomingLinkRequestSummary | null>;
  private identityLinkRequestApprover?: (pub: string) => Promise<boolean>;
  private identityLinkPendingCanceler?: (requestId: string) => void;
  private identityLinkRefresher?: () => Promise<void>;
  private identityLinkCompleter?: (code: string) => Promise<'invalid' | 'expired' | 'reused' | 'self' | 'unavailable' | null>;
  private identityLinkUnlinker?: (pub: string) => Promise<'removed' | 'revocation-pending'>;
  /** TODO §I — resolves whether `pub` has a verified, mutual link to the viewer's own identity. */
  private identityLinkChecker?: (pub: string) => Promise<boolean>;
  private identityPasswordStatusReader?: () => Promise<{ state: 'not-set' | 'locked' }>;
  private identityPasswordSetter?: (password: string) => Promise<void>;
  private identityPasswordChanger?: (currentPassword: string, newPassword: string) => Promise<void>;
  private identityPasswordRemover?: (currentPassword: string) => Promise<void>;
  private identityPasswordLocker?: () => Promise<void>;
  setIdentityLinkHooks(hooks: {
    createLinkCode?: (now: number) => { payload: PairingPayload; code: string };
    readIncomingRequest?: () => Promise<import('./linked-devices-dialog').IncomingLinkRequestSummary | null>;
    approveIncomingRequest?: (pub: string) => Promise<boolean>;
    cancelPendingRequest?: (requestId: string) => void;
    refreshRecords?: () => Promise<void>;
    completeFromCode?: (code: string) => Promise<'invalid' | 'expired' | 'reused' | 'self' | 'unavailable' | null>;
    unlink?: (pub: string) => Promise<'removed' | 'revocation-pending'>;
    isLinked?: (pub: string) => Promise<boolean>;
  }): void {
    if (hooks.createLinkCode) this.identityLinkCodeCreator = hooks.createLinkCode;
    if (hooks.readIncomingRequest) this.identityLinkRequestReader = hooks.readIncomingRequest;
    if (hooks.approveIncomingRequest) this.identityLinkRequestApprover = hooks.approveIncomingRequest;
    if (hooks.cancelPendingRequest) this.identityLinkPendingCanceler = hooks.cancelPendingRequest;
    if (hooks.refreshRecords) this.identityLinkRefresher = hooks.refreshRecords;
    if (hooks.completeFromCode) this.identityLinkCompleter = hooks.completeFromCode;
    if (hooks.unlink) this.identityLinkUnlinker = hooks.unlink;
    if (hooks.isLinked) this.identityLinkChecker = hooks.isLinked;
  }

  setIdentityPasswordHooks(hooks: {
    getStatus: () => Promise<{ state: 'not-set' | 'locked' }>;
    setPassword?: (password: string) => Promise<void>;
    changePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
    removePassword?: (currentPassword: string) => Promise<void>;
    lockNow?: () => Promise<void>;
  }): void {
    this.identityPasswordStatusReader = hooks.getStatus;
    if (hooks.setPassword) this.identityPasswordSetter = hooks.setPassword;
    if (hooks.changePassword) this.identityPasswordChanger = hooks.changePassword;
    if (hooks.removePassword) this.identityPasswordRemover = hooks.removePassword;
    if (hooks.lockNow) this.identityPasswordLocker = hooks.lockNow;
  }

  showIdentityUnlock(
    publicIdentity: string,
    onUnlock: (password: string) => Promise<void>,
    onErase: () => Promise<void> | void,
  ): Promise<void> {
    return openIdentityUnlockDialog({
      text: (key: string, fallback?: string) => {
        const value = this.t(key as any);
        return value && value !== key ? value : (fallback ?? key);
      },
      publicIdentity,
      onUnlock,
      onErase,
    });
  }

  private bindSettingsControls(): void {
    document.getElementById('settings-jump-menu')?.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('.settings-jump-menu-item') as HTMLElement | null;
      const sectionId = target?.dataset.target;
      if (!sectionId) return;
      this.settingsActiveSectionId = sectionId;
      this.applySettingsSectionView(sectionId);
    });

    document.getElementById('settings-scheme-picker')?.addEventListener('change', (event) => {
      const radio = event.target as HTMLInputElement;
      if (!radio.classList.contains('settings-scheme-radio')) return;
      const scheme = radio.value as ColorScheme;
      setColorSchemePreference(scheme);
      // Applies instantly via the [data-color-scheme] attribute (main.css tokens do the
      // rest) — no full re-render needed, just move the selected-option border highlight.
      document.querySelectorAll<HTMLElement>('.settings-scheme-option').forEach((label) => {
        label.style.borderColor = label.dataset.scheme === scheme ? 'var(--accent)' : 'var(--border)';
      });
    });

    const persistConnectivity = (): void => {
      const preset = (document.getElementById('settings-connectivity-preset') as HTMLSelectElement | null)?.value as ConnectivityPreset | undefined;
      if (!preset) return;
      const value = applyConnectivityPreset(preset);
      value.preset = preset;
      value.freeFirst = !!(document.getElementById('settings-connectivity-free-first') as HTMLInputElement | null)?.checked;
      value.directFirst = !!(document.getElementById('settings-connectivity-direct-first') as HTMLInputElement | null)?.checked;
      value.batteryAware = !!(document.getElementById('settings-connectivity-battery-aware') as HTMLInputElement | null)?.checked;
      value.meteredPermission = ((document.getElementById('settings-connectivity-metered-permission') as HTMLSelectElement | null)?.value || 'ask') as typeof value.meteredPermission;
      value.forwarding.enabled = !!(document.getElementById('settings-connectivity-forwarding') as HTMLInputElement | null)?.checked;
      value.forwarding.cellularForwarding = !!(document.getElementById('settings-connectivity-cellular-forwarding') as HTMLInputElement | null)?.checked;
      value.forwarding.cellularByteBudget = Math.max(0, Number((document.getElementById('settings-connectivity-cellular-budget') as HTMLInputElement | null)?.value || 0));
      saveConnectivitySettings(value);
      this.emit('connectivitySettingsChanged', value);
    };
    document.querySelectorAll('#settings-section-connectivity input, #settings-section-connectivity select').forEach((element) => {
      element.addEventListener('change', persistConnectivity);
    });

    const selectedValues = (id: string): string[] => {
      const el = document.getElementById(id) as HTMLSelectElement | HTMLInputElement | null;
      if (!el) return [];
      if (el instanceof HTMLSelectElement && el.multiple) {
        return Array.from(el.selectedOptions).map((option) => option.value.trim().toLowerCase()).filter(Boolean);
      }
      return String(el.value || '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    };

    const sync = () => {
      const filterLanguages = Array.from(document.querySelectorAll<HTMLInputElement>('.settings-filter-language-option'))
        .filter((el) => el.checked)
        .map((el) => el.value.trim().toLowerCase())
        .filter(Boolean);
      const profileLanguages = selectedValues('settings-profile-languages');
      const minDistanceEl = document.getElementById('settings-min-distance') as HTMLInputElement | null;
      const maxDistanceEl = document.getElementById('settings-max-distance') as HTMLInputElement | null;
      const sentAfterEl = document.getElementById('settings-sent-after') as HTMLInputElement | null;
      const customBlockedEl = document.getElementById('settings-custom-blocked') as HTMLTextAreaElement | null;
      const typeEls = Array.from(document.querySelectorAll('.settings-talk-filter-type')) as HTMLInputElement[];
      const dirtyWordEls = Array.from(document.querySelectorAll<HTMLElement>('#dirty-word-chips .dirty-word-chip'));
      const nextFilters: TalkIntakeFilters = {
        allowedLanguages: filterLanguages,
        requireGoodGrammar: !!(document.getElementById('settings-grammar-filter') as HTMLInputElement | null)?.checked,
        blockDirtyWords: !!(document.getElementById('settings-dirty-words-filter') as HTMLInputElement | null)?.checked,
        allowedTalkTypes: typeEls.filter((el) => el.checked).map((el) => el.value as any),
        customBlockedTerms: normalizeCustomBlockedTerms((customBlockedEl?.value || '').split(/[\n,]+/).map((part) => part.trim()).filter(Boolean)),
        dirtyWords: normalizeDirtyWords(dirtyWordEls.map((el) => el.getAttribute('data-word') || '')),
      };
      if (nextFilters.allowedLanguages.length === 0) nextFilters.allowedLanguages = ['en'];
      if (nextFilters.allowedTalkTypes.length === 0) nextFilters.allowedTalkTypes = ['flow', 'survey', 'tag', 'route'];
      if (minDistanceEl?.value) nextFilters.minDistanceMiles = Number(minDistanceEl.value);
      if (maxDistanceEl?.value) nextFilters.maxDistanceMiles = Number(maxDistanceEl.value);
      if (sentAfterEl?.value) nextFilters.sentAfter = new Date(sentAfterEl.value).toISOString();
      if (
        typeof nextFilters.minDistanceMiles === 'number' &&
        typeof nextFilters.maxDistanceMiles === 'number' &&
        nextFilters.minDistanceMiles > nextFilters.maxDistanceMiles
      ) {
        this.showNotification(this.t('settingsDistanceInvalid'), 'error');
        if (this.currentUser?.talkFilters) {
          if (minDistanceEl) minDistanceEl.value = String(this.currentUser.talkFilters.minDistanceMiles ?? '');
          if (maxDistanceEl) maxDistanceEl.value = String(this.currentUser.talkFilters.maxDistanceMiles ?? '');
        }
        return;
      }
      setTalkIntakeFilters(nextFilters);
      if (this.currentUser) setTalkIntakeFiltersOwner(this.currentUser.id);
      // Message filters changed: re-render any open conversation so toggling a
      // filter off reveals previously hidden messages (and on reveals fresh
      // toasts can fire if re-enabled later). (redesign §9.1)
      if (this.currentUser) this.currentUser.talkFilters = nextFilters;
      this.hiddenMessageToastIds.clear();
      this.rerenderOpenConversation();
      const langCount = document.getElementById('settings-filter-languages-count');
      if (langCount) langCount.textContent = `${nextFilters.allowedLanguages.length} ${this.t('settingsActive')}`;
      const filteredIncomingSummary = document.getElementById('settings-filtered-incoming-summary');
      if (filteredIncomingSummary) {
        const filteredIncoming = filterIncomingTalkClusters(
          (this.incomingTalkClusters || []).filter((cluster: any) => cluster && cluster.identityKey),
          nextFilters,
          this.currentLocation,
        );
        const reasonText = this.formatReasonCounts(filteredIncoming.hiddenByReason);
        filteredIncomingSummary.innerHTML = `${this.t('settingsHiddenIncoming')}: ${filteredIncoming.hiddenCount}${reasonText ? `<div>${escapeHtml(reasonText)}</div>` : ''}`;
      }
      if (this.currentUser) {
        const nextProfileLanguages = profileLanguages.length > 0 ? profileLanguages : ['en'];
        const profileLanguageChanged = nextProfileLanguages.join(',') !== (this.currentUser.languages || []).join(',');
        this.currentUser.languages = nextProfileLanguages;
        this.currentUser.talkFilters = nextFilters;
        if (profileLanguageChanged) {
          this.applyShellTranslations();
          this.renderSettingsView(this.currentUser);
          void this.onProfileChange?.(this.currentUser.id, {
            ...(this.currentUser.headshot ? { headshot: this.currentUser.headshot } : {}),
            languages: nextProfileLanguages,
            profile: this.currentUser.profile || [],
            interests: this.currentUser.interests || [],
          });
        }
      }
      this.emit('updateTalkFilters', nextFilters);
      if (document.getElementById('talks-view')?.classList.contains('active')) this.displayTalksList();
    };
    ['settings-profile-languages', 'settings-min-distance', 'settings-max-distance', 'settings-sent-after', 'settings-grammar-filter', 'settings-dirty-words-filter'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', sync);
    });
    document.querySelectorAll('.settings-filter-language-option').forEach((el) => {
      el.addEventListener('change', sync);
    });
    document.querySelectorAll('.settings-talk-filter-type').forEach((el) => {
      el.addEventListener('change', sync);
    });
    document.getElementById('settings-ui-language')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value === 'zh' ? 'zh' : 'en';
      setUiLanguagePreference(value);
      this.applyShellTranslations();
      if (this.currentUser) this.renderSettingsView(this.currentUser);
    });
    document.getElementById('settings-default-talk-language')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value === 'zh' ? 'zh' : 'en';
      setDefaultTalkLanguagePreference(value);
    });
    document.getElementById('settings-custom-blocked')?.addEventListener('input', sync);
    this.bindDirtyWordEditor(sync);
    document.getElementById('settings-linked-devices-btn')?.addEventListener('click', () => {
      void this.openLinkedDevicesDialog();
    });
    document.getElementById('settings-erase-device-btn')?.addEventListener('click', () => this.openEraseDeviceDialog());
    document.getElementById('settings-home-room')?.addEventListener('change', (event) => {
      this.emit('setHomeChatroom', {
        chatroomId: (event.currentTarget as HTMLSelectElement).value,
      });
    });
    document.getElementById('settings-copy-talk-autosave')?.addEventListener('change', (event) => {
      setCopyTalkAutoSave((event.currentTarget as HTMLInputElement).checked);
    });
    document.getElementById('settings-chatbot-enabled')?.addEventListener('change', (event) => {
      setChatbotEnabled((event.currentTarget as HTMLInputElement).checked);
    });
    document.getElementById('settings-keep-old-talk-on-edit')?.addEventListener('change', (event) => {
      setKeepOldTalkOnEdit((event.currentTarget as HTMLInputElement).checked);
    });
    document.getElementById('settings-stage-name-input')?.addEventListener('change', async (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const errorText = document.getElementById('settings-stage-name-error') as HTMLElement | null;
      const showStageNameError = (message: string): void => {
        if (errorText) {
          errorText.textContent = message;
          errorText.style.display = message ? 'block' : 'none';
        }
      };
      const next = input.value.trim();
      if (!this.currentUser || next === this.currentUser.stageName) return;
      showStageNameError('');
      if (next.length < 3) {
        const message = this.t('settingsStageNameTooShort');
        showStageNameError(message);
        this.showNotification(message, 'error');
        input.value = this.currentUser.stageName;
        return;
      }
      try {
        await this.onStageNameChange?.(this.currentUser.id, next);
      } catch (error) {
        input.value = this.currentUser.stageName;
        const message = error instanceof Error && /reserved/i.test(error.message)
          ? this.t('settingsStageNameReserved')
          : this.t('settingsStageNameUpdateFailed');
        showStageNameError(message);
        this.showNotification(message, 'error');
      }
    });
    document.getElementById('settings-headshot-select')?.addEventListener('change', async (event) => {
      if (!this.currentUser) return;
      const headshot = (event.currentTarget as HTMLSelectElement).value.trim();
      await this.onProfileChange?.(this.currentUser.id, {
        ...(headshot ? { headshot } : {}),
        languages: this.currentUser.languages || ['en'],
        profile: this.currentUser.profile || [],
        interests: this.currentUser.interests || [],
      });
    });
    const saveHeadshot = async (headshot?: string): Promise<void> => {
      if (!this.currentUser) return;
      await this.onProfileChange?.(this.currentUser.id, {
        ...(headshot ? { headshot } : {}),
        languages: this.currentUser.languages || ['en'],
        profile: this.currentUser.profile || [],
        interests: this.currentUser.interests || [],
      });
    };
    const showCameraStatus = (message: string): void => {
      const status = document.getElementById('settings-camera-status') as HTMLElement | null;
      if (!status) return;
      status.textContent = message;
      status.style.display = message ? 'block' : 'none';
    };
    const confirmPhoto = async (dataUrl: string): Promise<boolean> => {
      document.getElementById('settings-photo-preview-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'settings-photo-preview-modal';
      modal.dataset.testid = 'settings-photo-preview-modal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
          <div class="modal-header">
            <h2 class="modal-title">${this.t('settingsPhotoPreviewTitle')}</h2>
            <p>${this.t('settingsPhotoPreviewHelp')}</p>
          </div>
          <div class="user-avatar" style="width:160px;height:160px;margin:12px auto;font-size:2em;">
            ${avatarInnerHtml(dataUrl, this.currentUser?.stageName.charAt(0).toUpperCase() || '?', escapeHtml)}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" data-testid="settings-photo-preview-cancel">${this.t('settingsPhotoPreviewCancel')}</button>
            <button type="button" class="btn primary-btn" data-testid="settings-photo-preview-confirm">${this.t('settingsPhotoPreviewSave')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      return new Promise<boolean>((resolve) => {
        const finish = (confirmed: boolean): void => {
          modal.remove();
          resolve(confirmed);
        };
        modal.querySelector('[data-testid="settings-photo-preview-confirm"]')?.addEventListener('click', () => finish(true));
        modal.querySelector('[data-testid="settings-photo-preview-cancel"]')?.addEventListener('click', () => finish(false));
        modal.addEventListener('click', (event) => {
          if (event.target === modal) finish(false);
        });
      });
    };
    const readPhoto = async (file?: File): Promise<void> => {
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        this.showNotification(this.t('settingsPhotoInvalidType'), 'error');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.showNotification(this.t('settingsPhotoTooLarge'), 'error');
        return;
      }
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.addEventListener('load', () => resolve(String(reader.result || '')));
        reader.addEventListener('error', () => reject(reader.error || new Error(this.t('settingsPhotoReadFailed'))));
        reader.readAsDataURL(file);
      });
      showCameraStatus('');
      if (await confirmPhoto(dataUrl)) await saveHeadshot(dataUrl);
    };
    const takePhoto = async (): Promise<void> => {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const message = this.t('settingsCameraUnavailable');
        showCameraStatus(message);
        this.showNotification(message, 'error');
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      } catch {
        const message = this.t('settingsCameraDenied');
        showCameraStatus(message);
        this.showNotification(message, 'error');
        return;
      }
      document.getElementById('settings-camera-capture-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'settings-camera-capture-modal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:480px;">
          <div class="modal-header">
            <h2 class="modal-title">${this.t('settingsCameraCaptureTitle')}</h2>
            <p>${this.t('settingsCameraCaptureHelp')}</p>
          </div>
          <video id="settings-camera-preview-video" autoplay muted playsinline style="display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:14px;background:var(--text-primary);"></video>
          <div class="modal-actions">
            <button type="button" class="btn" data-testid="settings-camera-cancel">${this.t('settingsPhotoPreviewCancel')}</button>
            <button type="button" class="btn primary-btn" data-testid="settings-camera-capture" disabled>${this.t('settingsCameraCapture')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const video = modal.querySelector('#settings-camera-preview-video') as HTMLVideoElement | null;
      const capture = modal.querySelector('[data-testid="settings-camera-capture"]') as HTMLButtonElement | null;
      const stopAndClose = (): void => {
        stream.getTracks().forEach((track) => track.stop());
        modal.remove();
      };
      if (video) {
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', () => {
          if (capture) capture.disabled = false;
        }, { once: true });
        void video.play().catch(() => undefined);
      }
      modal.querySelector('[data-testid="settings-camera-cancel"]')?.addEventListener('click', stopAndClose);
      capture?.addEventListener('click', async () => {
        if (!video || video.videoWidth < 1 || video.videoHeight < 1) return;
        const size = Math.min(video.videoWidth, video.videoHeight);
        const sx = Math.max(0, (video.videoWidth - size) / 2);
        const sy = Math.max(0, (video.videoHeight - size) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        canvas.getContext('2d')?.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        stopAndClose();
        showCameraStatus('');
        if (await confirmPhoto(dataUrl)) await saveHeadshot(dataUrl);
      });
    };
    const photoInput = document.getElementById('settings-photo-input') as HTMLInputElement | null;
    const cameraInput = document.getElementById('settings-camera-input') as HTMLInputElement | null;
    document.getElementById('settings-choose-photo-btn')?.addEventListener('click', () => photoInput?.click());
    document.getElementById('settings-take-photo-btn')?.addEventListener('click', () => void takePhoto());
    photoInput?.addEventListener('change', () => void readPhoto(photoInput.files?.[0]));
    cameraInput?.addEventListener('change', () => void readPhoto(cameraInput.files?.[0]));
    document.getElementById('settings-remove-photo-btn')?.addEventListener('click', () => void saveHeadshot());
    document.getElementById('settings-edit-profile-btn')?.addEventListener('click', () => {
      if (this.currentUser) this.showEditProfileDialog(this.currentUser);
    });
    document.getElementById('settings-credit-visible')?.addEventListener('change', (event) => {
      const visible = (event.currentTarget as HTMLInputElement).checked;
      if (this.currentUser?.reputation) this.currentUser.reputation.isHidden = !visible;
      this.emit('setCreditVisibility', { visible });
    });
    document.getElementById('settings-refresh-storage-btn')?.addEventListener('click', () => {
      void this.refreshStorageInspector();
    });
  }

  updateConnectivityDiagnostics(value: ConnectivityDiagnostics): void {
    const totalBytes = Object.values(value.bytesByRoute ?? {}).reduce((sum, bytes) => sum + bytes, 0);
    const status = document.getElementById('settings-connectivity-status');
    if (status) status.textContent = `Forwarded ${totalBytes} bytes · ${value.forwardedFrames} frames · ${value.droppedFrames} policy drops`;
    const diagnostics = document.getElementById('settings-connectivity-diagnostics');
    if (diagnostics) diagnostics.textContent = connectivityDiagnosticsText(value);
  }

  private async getBrowserStorageSnapshot(): Promise<{
    localStorageKeys: Array<{ key: string; bytes: number }>;
    indexedDBNames: string[];
  }> {
    const localStorageKeys = Object.keys(localStorage)
      .sort()
      .map((key) => ({
        key,
        bytes: new Blob([localStorage.getItem(key) || '']).size,
      }));
    let indexedDBNames: string[] = [];
    try {
      const dbs = typeof indexedDB !== 'undefined' && 'databases' in indexedDB
        ? await (indexedDB as any).databases()
        : [];
      indexedDBNames = dbs.map((db: { name?: string }) => db.name || '(unnamed)').filter(Boolean).sort();
    } catch {
      indexedDBNames = ['unavailable'];
    }
    return { localStorageKeys, indexedDBNames };
  }

  private storageValue(value: string): string {
    const keys: Partial<Record<string, UiTranslationKey>> = {
      unknown: 'storageUnknown',
      durable: 'storageDurable',
      enabled: 'storageEnabled',
      disabled: 'storageDisabled',
      stopped: 'storageStopped',
      starting: 'storageStarting',
      running: 'storageRunning',
      unhealthy: 'storageUnhealthy',
      stopping: 'storageStopping',
      wiped: 'storageWiped',
      unconfigured: 'storageUnconfigured',
      'local-only': 'storageLocalOnly',
      'gun-local': 'storageLocalOnly',
      available: 'storageAvailable',
      active: 'storageActiveValue',
      required: 'storageRequired',
      optional: 'storageOptional',
      clean: 'storageClean',
      'needs review': 'storageNeedsReview',
      supported: 'storageSupported',
      local: 'storageLocal',
      off: 'storageOff',
      shared: 'storageShared',
      private: 'storagePrivate',
      published: 'storagePublished',
      clears: 'storageClears',
      'not run': 'storageNotRun',
      none: 'storageNone',
      queued: 'storageQueued',
      review: 'storageReview',
      'telemetry-free': 'storageTelemetryFree',
      'local-visible': 'storageLocalVisible',
      'star fallback': 'storageStarFallback',
    };
    const key = keys[value];
    return key ? this.t(key) : value;
  }

  private storagePathPurpose(path: string, purpose: string): string {
    const keys: Partial<Record<string, UiTranslationKey>> = {
      'users/{userId}/profile': 'storagePurposeProfile',
      'users/{userId}/publicProfile': 'storagePurposePublicProfile',
      'users/{userId}/reputation': 'storagePurposeReputation',
      'chatrooms/{chatroomId}': 'storagePurposeChatrooms',
      'talks/{talkId}': 'storagePurposeTalks',
      'incomingTalksByUser/{userId}': 'storagePurposeIncoming',
      'conversations/{conversationId}': 'storagePurposeConversations',
      'talkAnswerTemplateByUser/{userId}': 'storagePurposeTemplates',
      'exactChatbotMemoryByUser/{userId}': 'storagePurposeExactMemory',
      'stats/*': 'storagePurposeStats',
    };
    const key = keys[path];
    return key ? this.t(key) : purpose;
  }

  private storageDisclosureLabel(value: string): string {
    const keys: Partial<Record<string, UiTranslationKey>> = {
      Storage: 'storageDisclosureStorage',
      Bandwidth: 'storageDisclosureBandwidth',
      Battery: 'storageDisclosureBattery',
      'Background behavior': 'storageDisclosureBackground',
      'Local port': 'storageDisclosurePort',
      'Stop and delete': 'storageDisclosureStopDelete',
    };
    const key = keys[value];
    return key ? this.t(key) : value;
  }

  private storagePolicyLabel(value: string | undefined): string {
    if (value === "Delete this device's local data") return this.t('storageDeleteDeviceLocal');
    if (value === 'Request/delete server-held data') return this.t('storageRequestServerData');
    return value || this.t('storageAvailable');
  }

  private async refreshStorageInspector(): Promise<void> {
    const body = document.getElementById('settings-storage-inspector-body');
    if (!body) return;
    const browserStorage = await this.getBrowserStorageSnapshot();
    let serverStorage: any = null;
    let serverError = '';
    if (this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/debug/storage`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        serverStorage = await res.json();
      } catch (error) {
        serverError = (error as Error).message;
      }
    }

    const flags = serverStorage?.flags || {};
    const transport = serverStorage?.conversationTransport || {};
    const serverRows = serverStorage?.pathClassifications || [];
    body.innerHTML = `
      <div style="display:grid;gap:12px;">
        <div id="storage-inspector-flags" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${this.renderStoragePill(this.t('storageMode'), serverStorage?.mode || 'star')}
          ${this.renderStoragePill(this.t('storagePersistence'), this.storageValue(flags.starServerPersistence || 'unknown'))}
          ${this.renderStoragePill(this.t('storageLocalNode'), this.storageValue(flags.p2pNodeEnabled ? 'enabled' : 'disabled'))}
          ${this.renderStoragePill(this.t('storageDirectChat'), this.storageValue('enabled'))}
        </div>
        <div id="storage-inspector-runtime-features" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${this.renderStoragePill(this.t('storageTransportFallback'), transport.fallback || this.t('storageNone'))}
          ${this.renderStoragePill(this.t('storageSupportBootstrap'), this.storageValue(this.hasSupportContact() ? 'active' : 'not run'))}
        </div>
        ${this.renderAppStateInspector()}
        ${this.renderLocalNodeInspector(serverStorage?.localNode)}
        ${this.renderSeaIdentityInspector(serverStorage?.seaIdentityPolicy, serverStorage?.seaStorageScan)}
        ${this.renderConversationTransportInspector(serverStorage?.conversationTransport)}
        ${this.renderP2PNetworkProtocolInspector(serverStorage?.p2pNetworkProtocol)}
        ${this.renderP2PNeighborMemoryInspector(serverStorage?.neighborMemory)}
        ${this.renderDataOwnershipInspector(serverStorage?.dataOwnership, serverStorage?.relayTtlPolicy, serverStorage?.transportDiagnostics)}
        <div>
          <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">${this.t('storageBrowserLocal')}</div>
          <div id="storage-inspector-local" style="display:flex;flex-wrap:wrap;gap:6px;">
            ${
              browserStorage.localStorageKeys.length === 0
                ? `<span style="color:var(--text-muted);">${this.t('storageNoLocalKeys')}</span>`
                : browserStorage.localStorageKeys
                    .map((item) => this.renderStoragePill(item.key, `${item.bytes} B`))
                    .join('')
            }
          </div>
          <div id="storage-inspector-indexeddb" style="margin-top:6px;color:var(--text-secondary);">
            ${this.t('storageIndexedDb')}: ${browserStorage.indexedDBNames.length > 0 ? browserStorage.indexedDBNames.map(escapeHtml).join(', ') : this.t('storageNone')}
          </div>
        </div>
        <div>
          <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">${this.t('storageServerPaths')}</div>
          ${
            serverError
              ? `<div id="storage-inspector-server-error" style="color:var(--warning-text);">${escapeHtml(serverError)}</div>`
              : `<div id="storage-inspector-server" style="display:grid;gap:6px;">
                  ${serverRows
                    .map((row: any) => `
                      <div style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
                        <div style="font-weight:600;color:var(--text-primary);">${escapeHtml(row.path)} <span style="font-weight:500;color:var(--text-tertiary);">${escapeHtml(row.category)}</span></div>
                        <div style="color:var(--text-tertiary);">${escapeHtml(this.storagePathPurpose(row.path, row.purpose))}</div>
                      </div>
                    `)
                    .join('')}
                </div>`
          }
        </div>
      </div>
    `;
  }

  private renderStoragePill(label: string, value: string): string {
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-subtle);color:var(--text-primary);"><span style="font-weight:600;">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></span>`;
  }

  private renderAppStateInspector(): string {
    const filters = getTalkIntakeFilters();
    const allowedLanguages = filters.allowedLanguages.map((language) => this.formatTalkLanguage(language)).join(', ');
    const defaultTalkLanguage = this.formatTalkLanguage(getDefaultTalkLanguagePreference(this.getUiLanguage()));
    const supportActive = this.hasSupportContact();
    const currentUserIsRoot = this.currentUserId === TECHSUPPORT_ROOT_USER_ID;
    const roomCounts = Array.from(this.chatroomVisitCounts.entries())
      .filter(([, counts]) => counts.visitCount > 0 || counts.uniqueVisitorCount > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    return `
      <div id="storage-inspector-app-state" style="display:grid;gap:8px;padding:10px;border:1px solid var(--accent-border);border-radius:8px;background:var(--accent-soft);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:var(--accent-text);">${this.t('storageAppState')}</div>
          ${this.renderStoragePill(this.t('storageTechSupportRoot'), currentUserIsRoot ? this.t('storageCurrentIdentity') : TECHSUPPORT_ROOT_USER_ID)}
          ${this.renderStoragePill(this.t('storageSupportChannel'), this.storageValue(supportActive ? 'active' : 'not run'))}
          ${this.renderStoragePill(this.t('storageIncomingLanguages'), allowedLanguages || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageDefaultTalkLanguage'), defaultTalkLanguage)}
        </div>
        <div id="storage-inspector-room-visits" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${
            roomCounts.length === 0
              ? this.renderStoragePill(this.t('storageRoomVisits'), this.t('storageNone'))
              : roomCounts.map(([roomId, counts]) =>
                  this.renderStoragePill(
                    `${this.t('storageRoomVisits')} · ${roomId}`,
                    `${counts.visitCount} / ${counts.uniqueVisitorCount}`,
                  )).join('')
          }
        </div>
      </div>
    `;
  }

  private renderLocalNodeInspector(localNode: any): string {
    if (!localNode) return '';
    const disclosures = Array.isArray(localNode.permissionDisclosures) ? localNode.permissionDisclosures : [];
    const controls = Array.isArray(localNode.persistenceControls) ? localNode.persistenceControls : [];
    return `
      <div id="storage-inspector-local-node" style="display:grid;gap:8px;padding:10px;border:1px solid var(--accent-soft);border-radius:8px;background:var(--accent-soft);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:var(--accent-text);">${this.t('storageLocalNodeSupervisor')}</div>
          ${this.renderStoragePill(this.t('storageStatus'), this.storageValue(localNode.status || 'unknown'))}
          ${this.renderStoragePill(this.t('storagePairing'), localNode.sessionPairing?.trustModel || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageBridge'), localNode.sessionPairing?.bridgeUrl || this.t('storageUnconfigured'))}
        </div>
        <div id="storage-inspector-local-node-disclosures" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${disclosures.map((item: any) => this.renderStoragePill(this.storageDisclosureLabel(item.label || item.key), this.storageValue(item.required ? 'required' : 'optional'))).join('')}
        </div>
        <div id="storage-inspector-local-node-controls" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${controls.map((item: any) => this.renderStoragePill(item.dataClass, this.storageValue(item.enabled ? 'local' : 'off'))).join('')}
        </div>
      </div>
    `;
  }

  private renderSeaIdentityInspector(policy: any, scan: any): string {
    if (!policy) return '';
    const custodyFormats = Array.isArray(policy.keyCustodyFormats) ? policy.keyCustodyFormats : [];
    const publicKeys = Array.isArray(policy.publicKeys) ? policy.publicKeys : [];
    const forbidden = Array.isArray(policy.forbiddenPrivateKeys) ? policy.forbiddenPrivateKeys : [];
    return `
      <div id="storage-inspector-sea-identity" style="display:grid;gap:8px;padding:10px;border:1px solid var(--success-soft);border-radius:8px;background:var(--success-soft);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:var(--success-text);">${this.t('storageSeaCustody')}</div>
          ${this.renderStoragePill(this.t('storageRelayScan'), this.storageValue(scan?.ok ? 'clean' : 'needs review'))}
          ${this.renderStoragePill(this.t('storagePublicKeys'), publicKeys.join(', ') || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageForbidden'), forbidden.join(', ') || this.t('storageUnknown'))}
        </div>
        <div id="storage-inspector-sea-custody" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${custodyFormats.map((format: string) => this.renderStoragePill(format, this.t('storageSupported'))).join('')}
        </div>
        <div id="storage-inspector-sea-rules" style="color:var(--text-secondary);">
          ${this.t('storageRelayRule')}
        </div>
      </div>
    `;
  }

  private renderConversationTransportInspector(transport: any): string {
    if (!transport) return '';
    const modes = Array.isArray(transport.availableModes) ? transport.availableModes : [];
    return `
      <div id="storage-inspector-conversation-transport" style="display:grid;gap:8px;padding:10px;border:1px solid var(--warning-border);border-radius:8px;background:var(--warning-soft);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:var(--warning-text);">${this.t('storageConversationTransport')}</div>
          ${this.renderStoragePill(this.t('storageActive'), transport.activeMode || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageMessages'), transport.messageBodyStorage || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageReceipts'), transport.receiptsStorage || this.t('storageUnknown'))}
          ${transport.fallback ? this.renderStoragePill(this.t('storageFallback'), transport.fallback) : ''}
        </div>
        <div id="storage-inspector-conversation-transport-modes" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${modes.map((mode: string) => this.renderStoragePill(mode, this.storageValue(mode === transport.activeMode ? 'active' : 'available'))).join('')}
        </div>
      </div>
    `;
  }

  private renderP2PNetworkProtocolInspector(protocol: any): string {
    if (!protocol) return '';
    const platforms = Array.isArray(protocol.platforms) ? protocol.platforms : [];
    const capabilities = Array.isArray(protocol.capabilities) ? protocol.capabilities : [];
    return `
      <div id="storage-inspector-p2p-protocol" style="display:grid;gap:8px;padding:10px;border:1px solid #e9d5ff;border-radius:8px;background:#faf5ff;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:#581c87;">${this.t('storageProtocol')}</div>
          ${this.renderStoragePill(this.t('storageVersion'), String(protocol.version || this.t('storageUnknown')))}
          ${this.renderStoragePill(this.t('storageSubstrate'), protocol.substrate || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageDiscoveryTtl'), `${protocol.peerDiscovery?.ttlSeconds ?? this.t('storageUnknown')}s`)}
          ${this.renderStoragePill(this.t('storageSignature'), protocol.identity?.signature || this.t('storageUnknown'))}
        </div>
        <div id="storage-inspector-p2p-platforms" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${platforms.map((item: any) => this.renderStoragePill(item.platform || 'platform', item.nodeAvailability || 'unknown')).join('')}
        </div>
        <div id="storage-inspector-p2p-capabilities" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${capabilities.map((capability: string) => this.renderStoragePill(capability, 'capability')).join('')}
        </div>
      </div>
    `;
  }

  private renderP2PNeighborMemoryInspector(memory: any): string {
    if (!memory) return '';
    const neighbors = Array.isArray(memory.neighbors) ? memory.neighbors : [];
    const candidates = Array.isArray(memory.bootstrapCandidates) ? memory.bootstrapCandidates : [];
    const blocked = Array.isArray(memory.blockedPeerIds) ? memory.blockedPeerIds : [];
    return `
      <div id="storage-inspector-p2p-neighbor-memory" style="display:grid;gap:8px;padding:10px;border:1px solid var(--success-border);border-radius:8px;background:var(--success-soft);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:var(--success-text);">${this.t('storageNeighborMemory')}</div>
          ${this.renderStoragePill(this.t('storageStatus'), this.storageValue(memory.controls?.enabled ? 'enabled' : 'disabled'))}
          ${this.renderStoragePill(this.t('storageScope'), this.storageValue(memory.controls?.localOnly ? 'local-only' : 'shared'))}
          ${this.renderStoragePill(this.t('storageGraph'), this.storageValue(memory.controls?.privateGraphPublishedByDefault === false ? 'private' : 'published'))}
          ${this.renderStoragePill(this.t('storageFallback'), memory.publicStarFallback || this.t('storageUnknown'))}
        </div>
        <div id="storage-inspector-p2p-neighbor-controls" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${this.renderStoragePill(this.t('storageClearNeighbors'), this.t('storageAvailable'))}
          ${this.renderStoragePill(this.t('storageDisableMemory'), this.storageValue(memory.controls?.enabled ? 'available' : 'active'))}
          ${this.renderStoragePill(this.t('storageExportEncrypted'), memory.controls?.exportFormat || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageBlockPeer'), blocked.length > 0 ? this.t('storageBlockedCount').replace('{count}', String(blocked.length)) : this.t('storageAvailable'))}
        </div>
        <div id="storage-inspector-p2p-neighbor-candidates" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${
            candidates.length === 0
              ? this.renderStoragePill(this.t('storageBootstrap'), this.t('storageStarFallback'))
              : candidates.map((item: any) => this.renderStoragePill(item.peerId || 'peer', item.transportType || 'candidate')).join('')
          }
        </div>
        <div id="storage-inspector-p2p-neighbor-records" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${neighbors.map((item: any) => this.renderStoragePill(item.peerId || 'peer', item.endpointStatus || 'unknown')).join('')}
        </div>
      </div>
    `;
  }

  private renderDataOwnershipInspector(dataOwnership: any, ttlPolicy: any, diagnostics: any): string {
    if (!dataOwnership) return '';
    const policy = dataOwnership.policy || {};
    const clears = Array.isArray(policy.deviceLocalDelete?.clears) ? policy.deviceLocalDelete.clears : [];
    const requests = Array.isArray(dataOwnership.serverHeldRequests) ? dataOwnership.serverHeldRequests : [];
    const migrationItems = Array.isArray(dataOwnership.migrationPlan?.items) ? dataOwnership.migrationPlan.items : [];
    const ttlEntries = ttlPolicy && typeof ttlPolicy === 'object' ? Object.entries(ttlPolicy) : [];
    const events = Array.isArray(diagnostics) ? diagnostics : [];
    return `
      <div id="storage-inspector-data-ownership" style="display:grid;gap:8px;padding:10px;border:1px solid var(--warning-border);border-radius:8px;background:var(--warning-soft);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:var(--warning-text);">${this.t('storageDataOwnership')}</div>
          ${this.renderStoragePill(this.t('storageDeviceLocalDelete'), this.storagePolicyLabel(policy.deviceLocalDelete?.label))}
          ${this.renderStoragePill(this.t('storageServerHeldData'), this.storagePolicyLabel(policy.serverHeldDataRequest?.label))}
          ${this.renderStoragePill(this.t('storageMigrationTarget'), policy.migration?.target || this.t('storageUnknown'))}
        </div>
        <div id="storage-inspector-data-ownership-local" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${clears.map((item: string) => this.renderStoragePill(item, this.t('storageClears'))).join('')}
          ${this.renderStoragePill(this.t('storageLastLocalDelete'), dataOwnership.localDeletion?.deletedAt || this.t('storageNotRun'))}
        </div>
        <div id="storage-inspector-data-ownership-server" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${
            requests.length === 0
              ? this.renderStoragePill(this.t('storageServerRequests'), this.t('storageNone'))
              : requests.map((item: any) => this.renderStoragePill(item.requestType || 'request', this.storageValue(item.status || 'queued'))).join('')
          }
        </div>
        <div id="storage-inspector-data-ownership-migration" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${this.renderStoragePill(this.t('storageMoveEligible'), `${dataOwnership.migrationPlan?.movedCount ?? 0}`)}
          ${migrationItems.slice(0, 4).map((item: any) => this.renderStoragePill(item.path || 'path', this.storageValue(item.action || 'review'))).join('')}
        </div>
        <div id="storage-inspector-relay-ttl-policy" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${ttlEntries.map(([kind, item]: [string, any]) => this.renderStoragePill(kind, `${item.ttlSeconds ?? 'unknown'}s`)).join('')}
        </div>
        <div id="storage-inspector-transport-diagnostics" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${
            events.length === 0
              ? this.renderStoragePill(this.t('storageTransportDiagnostics'), this.t('storageTelemetryFree'))
              : events.map((item: any) => this.renderStoragePill(item.mode || 'mode', this.storageValue(item.storedTelemetry === false ? 'local-visible' : 'review'))).join('')
          }
        </div>
      </div>
    `;
  }

  private displayContextualStatistics(elementId: string, prefix = ''): void {
    const element = document.getElementById(elementId);
    if (!element) return;
    try {
      const exchanges = readLocalTalkExchanges();
      const responsesByTalk = buildAllLocalTalkResponses(exchanges);
      const dashboard = buildStatsDashboard({
        responsesByTalk,
        ...(this.currentUserId && { viewerId: this.currentUserId }),
      });
      const totals = dashboard.totals || { talks: 0, responses: 0, matches: 0, ignores: 0, matchRate: 0 };
      const room = dashboard.chatrooms?.regions?.[0];
      const roomText = room
        ? this.tf('contextualStatsRoom', { room: room.masked ? this.t('contextualStatsHidden') : room.region })
        : '';
      element.textContent = prefix + this.tf('contextualStatsSummary', {
        responses: totals.responses,
        matches: totals.matches,
        rate: totals.matchRate,
        room: roomText,
      });
    } catch {
      element.textContent = prefix + this.t('contextualStatsEmpty');
    }
  }

  private async displayStatisticsDashboard(): Promise<void> {
    const container = document.getElementById('statistics-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;color:var(--text-tertiary);">Building local statistics…</div>';

    // Build local dashboard from LocalTalkExchanges (all talk types).
    const exchanges = readLocalTalkExchanges();
    const responsesByTalk = buildAllLocalTalkResponses(exchanges);

    // Best-effort: fetch broadcast-tag popularity from server to augment the dashboard.
    let broadcastTagPopularity: Array<{ id: string; count: number }> | undefined;
    let broadcastTagTrends: { days: string[]; tags: Array<{ id: string; total: number; byDay: number[] }> } | undefined;
    const base = (this.apiBase || '').trim();
    if (base) {
      try {
        const [tagRes, trendRes] = await Promise.all([
          fetch(`${base}/api/stats/broadcast-tags`, { cache: 'no-store' }),
          fetch(`${base}/api/stats/broadcast-tags/trends`, { cache: 'no-store' }),
        ]);
        if (tagRes.ok) {
          const tagData = (await tagRes.json()) as { tags?: Array<{ id: string; count: number }> };
          broadcastTagPopularity = tagData.tags ?? [];
        }
        if (trendRes.ok) {
          broadcastTagTrends = await trendRes.json() as { days: string[]; tags: Array<{ id: string; total: number; byDay: number[] }> };
        }
      } catch {
        // Ignore — broadcast tags are supplementary
      }
    }

    const dashboard = buildStatsDashboard({
      responsesByTalk,
      ...(broadcastTagPopularity !== undefined && { broadcastTagPopularity }),
      ...(broadcastTagTrends !== undefined && { broadcastTagTrends }),
      ...(this.currentUserId && { viewerId: this.currentUserId }),
    });
    this.renderStatisticsDashboard(container, dashboard);
  }

  private renderStatisticsDashboard(container: HTMLElement, dashboard: StatsDashboard): void {
    const totals = dashboard.totals || { talks: 0, responses: 0, matches: 0, ignores: 0, matchRate: 0 };
    const typeRows = (dashboard.byTalkType || [])
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(row.talkType)}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.responses}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matches}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matchRate}%</td>
        </tr>`)
      .join('');
    const talkRows = (dashboard.topTalks || [])
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid var(--border);max-width:220px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.talkId)}</td>
          <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(row.talkType)}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.responses}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matches}</td>
        </tr>`)
      .join('');
    const roomRows = (dashboard.chatrooms?.regions || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid var(--border);">${row.masked ? 'Hidden region' : escapeHtml(row.region)}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.masked ? '—' : row.count}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.masked ? '—' : `${row.matchRate}%`}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.masked ? '—' : `${row.localCount}/${row.travellerCount}`}</td>
        </tr>`)
      .join('');
    const peerRows = (dashboard.peers?.peers || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid var(--border);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.peerId)}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.responses}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matches}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.ignores}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.matchRate}%</td>
        </tr>`)
      .join('');
    // Broadcast tag popularity + optional trend data from server.
    const tagRows = (dashboard.broadcastTags?.popularity || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(row.id)}</td>
          <td style="padding:8px;border-top:1px solid var(--border);text-align:right;">${row.count}</td>
        </tr>`)
      .join('');
    const trendTags = (dashboard.broadcastTags?.trends?.tags || []).slice(0, 5);
    const trendDays = (dashboard.broadcastTags?.trends?.days || []).slice(-7);
    const tagTrendSection = trendTags.length > 0 ? `
      <div style="margin-top:12px;">
        <div style="font-weight:600;font-size:0.88em;color:var(--text-secondary);margin-bottom:6px;">${this.t('statsTimeTrendHeader')} (last ${trendDays.length} days)</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82em;">
          <thead><tr>
            <th style="text-align:left;padding:4px 6px;">Tag</th>
            ${trendDays.map((d) => `<th style="text-align:right;padding:4px 6px;">${escapeHtml(d)}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${trendTags.map((tag) => {
              const recentByDay = tag.byDay.slice(-trendDays.length);
              return `<tr>
                <td style="padding:4px 6px;border-top:1px solid var(--border);">${escapeHtml(tag.id)}</td>
                ${recentByDay.map((n) => `<td style="padding:4px 6px;border-top:1px solid var(--border);text-align:right;">${n}</td>`).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : '';
    // Time-series trend section (day-level, up to 14 recent buckets).
    const recentDayBuckets = (dashboard.timeSeries?.day || []).slice(-14);
    const responseSparkline = this.renderStatsSparkline(recentDayBuckets);
    const tagFrequencyBars = this.renderStatsBarList((dashboard.broadcastTags?.popularity || []).slice(0, 8));
    const trendRows = recentDayBuckets
      .map((item) => `<tr>
        <td style="padding:6px 8px;border-top:1px solid var(--border);">${escapeHtml(item.bucket)}</td>
        <td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;">${item.count}</td>
      </tr>`)
      .join('');
    // Chatroom aggregate totals for local/traveller split.
    const chatroomTotals = (dashboard.chatrooms?.regions || []).reduce(
      (acc, r) => ({ local: acc.local + r.localCount, traveller: acc.traveller + r.travellerCount }),
      { local: 0, traveller: 0 },
    );
    const latestBucket = recentDayBuckets[recentDayBuckets.length - 1]?.bucket || '—';
    container.innerHTML = `
      <div style="padding:16px;max-width:min(1040px,96%);margin:0 auto;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px;">
          <div>
            <h2 style="margin:0 0 4px;font-size:1.25em;color:var(--text-primary);">${this.t('statsLocalDashboard')}</h2>
            <p style="margin:0;color:var(--text-tertiary);font-size:0.9em;">${this.t('statsLocalNote')} · ${escapeHtml(new Date(dashboard.generatedAt).toLocaleString())}</p>
          </div>
          <button type="button" class="btn" id="statistics-refresh-btn" style="padding:6px 10px;">Refresh</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px;">
          ${this.surveyMetricCard('Talks', String(totals.talks))}
          ${this.surveyMetricCard('Responses', String(totals.responses))}
          ${this.surveyMetricCard('Matches', String(totals.matches))}
          ${this.surveyMetricCard('Match rate', `${totals.matchRate}%`)}
          ${this.surveyMetricCard('Latest day', latestBucket)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
          ${this.renderStatsTable(this.t('statsByTypeHeader'), ['Type', 'Responses', 'Matches', 'Match rate'], typeRows)}
          ${this.renderStatsTable(this.t('statsTopTalksHeader'), ['Talk', 'Type', 'Responses', 'Matches'], talkRows)}
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${this.t('statsChatroomHeader')}</div>
            <div style="font-size:0.8em;color:var(--text-tertiary);margin-bottom:8px;">Local: ${chatroomTotals.local} · Traveller: ${chatroomTotals.traveller}</div>
            <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
              <thead><tr>
                <th style="text-align:left;padding:6px 8px;">Region</th>
                <th style="text-align:right;padding:6px 8px;">Responses</th>
                <th style="text-align:right;padding:6px 8px;">Match rate</th>
                <th style="text-align:right;padding:6px 8px;">Local/Travel</th>
              </tr></thead>
              <tbody>${roomRows || `<tr><td colspan="4" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
            </table>
          </div>
          ${this.renderStatsTable(this.t('statsPeerHeader'), ['Peer', 'Responses', 'Matches', 'Ignores', 'Match rate'], peerRows)}
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${this.t('statsBroadcastTagsHeader')}</div>
            ${tagFrequencyBars}
            <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">Tag</th><th style="text-align:right;padding:6px 8px;">Uses</th></tr></thead>
              <tbody>${tagRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
            </table>
            ${tagTrendSection}
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${this.t('statsTimeTrendHeader')}</div>
            ${responseSparkline}
            <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">Day</th><th style="text-align:right;padding:6px 8px;">Responses</th></tr></thead>
              <tbody>${trendRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
            </table>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">Privacy and source of truth</div>
            <p style="margin:0 0 6px;color:var(--text-secondary);font-size:0.88em;">Minimum cohort: ${dashboard.privacy?.minCohortSize ?? 3}; location: blurred regions only.</p>
            <p style="margin:0;color:var(--text-secondary);font-size:0.88em;">${this.t('statsLocalNote')}</p>
          </div>
        </div>
      </div>`;
    container.querySelector('#statistics-refresh-btn')?.addEventListener('click', () => {
      void this.displayStatisticsDashboard();
    });
  }

  private renderStatsTable(title: string, headers: string[], rows: string): string {
    return `
      <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:auto;">
        <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${escapeHtml(title)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
          <thead><tr>${headers.map((header, index) => `<th style="text-align:${index === 0 ? 'left' : 'right'};padding:6px 8px;">${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${headers.length}" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  private renderStatsBarList(rows: Array<{ id: string; count: number }>): string {
    if (rows.length === 0) return '';
    const max = Math.max(...rows.map((row) => row.count), 1);
    return `<div class="stats-bar-list" aria-label="Tag frequency chart">${rows.map((row) => {
      const width = Math.max(2, Math.round((row.count / max) * 100));
      return `<div class="stats-bar-row"><span title="${escapeHtml(row.id)}">${escapeHtml(row.id)}</span><div class="stats-bar-track"><i style="width:${width}%"></i></div><b>${row.count}</b></div>`;
    }).join('')}</div>`;
  }

  private renderStatsSparkline(rows: Array<{ bucket: string; count: number }>): string {
    if (rows.length === 0) return '';
    const width = 280;
    const height = 56;
    const max = Math.max(...rows.map((row) => row.count), 1);
    const points = rows.map((row, index) => {
      const x = rows.length === 1 ? width / 2 : (index / (rows.length - 1)) * width;
      const y = height - 6 - ((row.count / max) * (height - 14));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<div class="stats-sparkline" aria-label="Response volume over the last ${rows.length} days"><svg viewBox="0 0 ${width} ${height}" role="img"><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline></svg><span>${rows.length} days · ${rows.reduce((sum, row) => sum + row.count, 0)} responses</span></div>`;
  }

  private copyAnsweredTalkToTalks(talkId: string): void {
    const myTalks = getMyTalks();
    const talk = myTalks[talkId];
    if (!talk?.fullTalk) {
      this.showNotification(this.t('talksDataNotFound'), 'error');
      return;
    }
    if (talk.role === 'copied') {
      this.showNotification(this.t('talksAlreadyCopied'), 'info');
      return;
    }
    this.saveMyTalk({
      talkId,
      title: talk.title,
      type: talk.type,
      timestamp: talk.lastInteraction || new Date().toISOString(),
      role: 'copied',
      // docs/TODO.md §Y1: a copy is not authorship — keep the original sender as authorId
      // until the user actually edits the content through the revise-mints-new-id path.
      fullTalk: talk.fullTalk,
      completedAnswers: talk.completedAnswers,
      outcome: talk.outcome,
      senders: talk.senders,
    });
    this.showNotification(this.t('talksCopiedToList'), 'success');
    this.displayTalksList();
    this.displayAnswersList();
  }

  /** Resolve a concrete talk UUID for an incoming cluster (Gun may reshape talkIds). */
  private pickIncomingRowTalkId(cluster: any): string {
    return pickLatestTalkIdFromIncomingCluster(cluster || {});
  }

  private quickAnswerIncomingTag(talkId: string, identityKeyFallback: string | undefined, checked: boolean): void {
    const finish = (fullTalk: any): void => {
      if (!fullTalk) {
        this.showNotification(this.t('talksCouldNotLoad'), 'error');
        return;
      }
      this.quickCompleteTagTalk(fullTalk, checked);
    };
    const tid = isValidTalkId((talkId || '').trim()) ? talkId.trim() : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', { identityKey: identityKeyFallback, callback: finish });
      return;
    }
    if (!tid) {
      this.showNotification(this.t('talksCouldNotOpen'), 'error');
      return;
    }
    this.emit('demandFullTalk', { talkId: tid, identityKeyFallback: identityKeyFallback || undefined, callback: finish });
  }

  private quickCompleteTagTalk(talk: any, checked: boolean): void {
    if (String(talk?.type || '').toLowerCase() !== 'tag') {
      this.showTalkResponseDialog(talk, { skipAutoAnswer: true });
      return;
    }
    const question = Array.isArray(talk.questions) ? talk.questions[0] : null;
    const answers = Array.isArray(question?.answers) ? question.answers : [];
    const answer = checked
      ? answers.find((item: any) => item?.isMatch)
      : answers.find((item: any) => item?.isIgnore);
    if (!question || !answer) {
      this.showNotification(this.t('responseInvalidTag'), 'error');
      return;
    }
    const completed = [{
      questionId: question.id,
      answerId: answer.id,
      answerText: answer.text || (checked ? 'Match.' : 'Ignore.'),
    }];
    this.saveAnswerPreference(
      talk,
      talk.id,
      question,
      answer.id,
      answer.text || (checked ? 'Match.' : 'Ignore.'),
      completed.map((item) => ({ questionId: item.questionId, answerText: item.answerText })),
      'auto',
    );
    if (checked) this.showNotification(this.t('responseMatch'), 'success');
    else this.showNotification(this.t('responseTagIgnored'), 'info');
    this.completeTalk(talk, completed, checked ? 'match' : 'mismatch');
  }

  /**
   * Row gesture (drag up): reaches the exact same end state as picking the response
   * dialog's dedicated "Ignore" radio (talk-response-dialog.ts's `isDedicatedIgnore`
   * branch) — withheld from the sender, local bookkeeping still runs — without opening
   * the dialog first. Any question works as the nominal `questionId`; the talk ends
   * immediately either way, so which one is recorded is not semantically meaningful.
   */
  private quickIgnoreIncomingTalk(talkId: string, identityKeyFallback?: string): void {
    const finish = (fullTalk: any): void => {
      if (!fullTalk) {
        this.showNotification(this.t('talksCouldNotLoad'), 'error');
        return;
      }
      const question = Array.isArray(fullTalk.questions) ? fullTalk.questions[0] : null;
      const answers = question ? [{ questionId: question.id, answerId: 'ignore', answerText: 'ignore', mode: 'manual' }] : [];
      if (question) {
        this.saveAnswerPreference(
          fullTalk, fullTalk.id, question, 'ignore', 'ignore',
          answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
          'suppressed',
        );
      }
      this.showNotification(this.t('responseTalkIgnored'), 'info');
      this.completeTalk(fullTalk, answers, 'mismatch', { withholdFromSender: true });
    };
    const tid = isValidTalkId((talkId || '').trim()) ? talkId.trim() : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', { identityKey: identityKeyFallback, callback: finish });
      return;
    }
    if (!tid) {
      this.showNotification(this.t('talksCouldNotOpen'), 'error');
      return;
    }
    this.emit('demandFullTalk', { talkId: tid, identityKeyFallback: identityKeyFallback || undefined, callback: finish });
  }

  /**
   * Row gesture (drag down): copies an incoming talk into the user's own outgoing list
   * *without* answering it — distinct from `copyAnsweredTalkToTalks`, which only works on
   * an already-answered `myTalks` entry. A live incoming cluster has no `myTalks[talkId]`
   * row yet and no `.latestTalk` full-Talk object (only `.latestTalkId`/`.questionsJson`
   * on the wire type), so the full talk has to be resolved the same asynchronous way
   * `quickAnswerIncomingTag` does it, then saved directly with role 'copied' — bypassing
   * `completeTalk` entirely so the sender is never notified and the incoming cluster
   * stays in the inbox exactly as it was.
   */
  private quickCopyIncomingTalk(talkId: string, identityKeyFallback: string | undefined, cluster?: any): void {
    const existing = talkId ? this.getMyTalks()[talkId] : undefined;
    if (existing?.role === 'copied') {
      this.showNotification(this.t('talksAlreadyCopied'), 'info');
      return;
    }
    const finish = (fullTalk: any): void => {
      if (!fullTalk) {
        this.showNotification(this.t('talksCouldNotLoad'), 'error');
        return;
      }
      const senders = cluster?.senders && typeof cluster.senders === 'object'
        ? Array.from(new Set(Object.values(cluster.senders).map((s: any) => String(s?.senderId || '')).filter(Boolean)))
        : undefined;
      this.saveMyTalk({
        talkId: fullTalk.id || talkId,
        title: fullTalk.title,
        type: fullTalk.type,
        timestamp: new Date().toISOString(),
        role: 'copied',
        fullTalk,
        ...(senders && senders.length > 0 ? { senders } : {}),
      });
      this.showNotification(this.t('talksCopiedToList'), 'success');
      this.displayTalksList();
    };
    const tid = isValidTalkId((talkId || '').trim()) ? talkId.trim() : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', { identityKey: identityKeyFallback, callback: finish });
      return;
    }
    if (!tid) {
      this.showNotification(this.t('talksCouldNotOpen'), 'error');
      return;
    }
    this.emit('demandFullTalk', { talkId: tid, identityKeyFallback: identityKeyFallback || undefined, callback: finish });
  }

  /**
   * Talks-tab row gestures, bound once on `document.body` (survives row re-renders, same
   * idiom as the other talks-list delegations). Card rows only (`.talk-list-item` that
   * isn't `.talk-tag-chip` — tag pills keep their existing single-tap checkbox):
   *   - drag up (incoming): quick-ignore the whole talk, no dialog.
   *   - drag down (incoming): copy into my own outgoing list, unanswered.
   *   - drag left (outgoing): delete — the swipe replacement for the old 🗑️ button.
   *   - press-and-hold without dragging: open the same details popup the old ℹ️ button
   *     opened (full sender identity, co-exchanged people, expiry/location) — nothing
   *     dropped, just a different trigger, since a plain tap now opens the talk itself.
   * A drag past the move threshold suppresses the click that would otherwise follow
   * (`talksGestureSuppressClickUntil`), so letting go after a cancelled/undershot drag
   * never accidentally opens the talk either.
   */
  private bindTalksRowGestures(): void {
    if (this.talksRowGestureBound) return;
    this.talksRowGestureBound = true;

    const MOVE_THRESHOLD = 12;
    const COMMIT_THRESHOLD = 64;
    const LONG_PRESS_MS = 500;
    const excluded = '.talk-item-actions, .talk-item-inline-actions, .talk-tag-checkbox-wrap, .talk-icon-badge, .view-talk-btn, .talk-matched-people, .talk-sender-people, .talk-item-details';

    const clearHints = (row: HTMLElement): void => {
      row.classList.remove('talk-gesture-live');
      row.style.transform = '';
      row.classList.remove('talk-gesture-hint-ignore', 'talk-gesture-hint-copy', 'talk-gesture-hint-delete');
    };

    document.body.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest('#talks-list')) return;
      if (target.closest(excluded)) return;
      const row = target.closest('.talk-list-item') as HTMLElement | null;
      if (!row || row.classList.contains('talk-tag-chip')) return;
      const state = {
        row,
        talkId: row.dataset.talkId || '',
        identityKey: row.dataset.identityKey || '',
        role: row.dataset.role || '',
        cluster: undefined,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        committedAt: 0,
      };
      this.talksRowGestureState = state;
      const longPressTimer = window.setTimeout(() => {
        if (this.talksRowGestureState !== state || state.dragging) return;
        this.talksRowGestureState = null;
        // Short window, just long enough to swallow the synthetic click the pointerup
        // that follows the long-press would otherwise fire — NOT long enough to also
        // swallow a real, separate click on something inside the popup that just opened
        // (e.g. a test or a fast double-tap landing on the sender-name a moment later).
        this.talksGestureSuppressClickUntil = Date.now() + 60;
        const details = row.querySelector('.talk-item-details') as HTMLElement | null;
        if (details) this.showDetailsPopupFor(details, row);
      }, LONG_PRESS_MS);
      const clearTimer = () => window.clearTimeout(longPressTimer);
      row.addEventListener('pointerup', clearTimer, { once: true });
      row.addEventListener('pointercancel', clearTimer, { once: true });
    }, { passive: true });

    document.body.addEventListener('pointermove', (e: PointerEvent) => {
      const state = this.talksRowGestureState;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (!state.dragging && Math.max(Math.abs(dx), Math.abs(dy)) < MOVE_THRESHOLD) return;
      if (!state.dragging) state.row.classList.add('talk-gesture-live');
      state.dragging = true;
      if (Math.abs(dy) >= Math.abs(dx)) {
        if (state.role === 'incoming') {
          const clamped = Math.max(-100, Math.min(100, dy));
          state.row.style.transform = `translateY(${clamped}px)`;
          state.row.classList.toggle('talk-gesture-hint-ignore', dy < -MOVE_THRESHOLD);
          state.row.classList.toggle('talk-gesture-hint-copy', dy > MOVE_THRESHOLD);
        }
      } else if (state.role !== 'incoming') {
        const clamped = Math.max(-100, Math.min(0, dx));
        state.row.style.transform = `translateX(${clamped}px)`;
        state.row.classList.toggle('talk-gesture-hint-delete', dx < -MOVE_THRESHOLD);
      }
    }, { passive: true });

    document.body.addEventListener('pointerup', (e: PointerEvent) => {
      const state = this.talksRowGestureState;
      this.talksRowGestureState = null;
      if (!state) return;
      if (!state.dragging) return; // plain tap or a long-press already handled by its own timer
      clearHints(state.row);
      // Same reasoning as the long-press timer: just long enough to swallow the click
      // that naturally follows this same release, not a blanket window that could also
      // eat an unrelated later click.
      this.talksGestureSuppressClickUntil = Date.now() + 60;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDy >= absDx && absDy >= COMMIT_THRESHOLD && state.role === 'incoming') {
        if (dy < 0) this.quickIgnoreIncomingTalk(state.talkId, state.identityKey || undefined);
        else this.quickCopyIncomingTalk(state.talkId, state.identityKey || undefined);
      } else if (absDx > absDy && absDx >= COMMIT_THRESHOLD && state.role !== 'incoming' && dx < 0 && state.talkId) {
        this.deleteMyTalk(state.talkId);
      }
    });

    document.body.addEventListener('pointercancel', () => {
      const state = this.talksRowGestureState;
      this.talksRowGestureState = null;
      if (state) clearHints(state.row);
    });
  }

  /**
   * Me-tab Q&A traceback (TODO §P) always means "show my answer," never "edit the talk" — even
   * for a self-answered own-created talk, which otherwise keeps role:'created' and would route
   * to the editor. Route through showTalkDetail's preferAnswerView option instead of duplicating
   * its role/fullTalk lookup here.
   */
  private showTalkDetailAsAnswer(talkId: string, questionId?: string): void {
    this.showTalkDetail(talkId, undefined, { preferAnswerView: true, ...(questionId ? { questionId } : {}) });
  }

  private showTalkDetail(talkId: string, identityKeyFallback?: string, options?: { preferAnswerView?: boolean; questionId?: string }): void {
    const raw = (talkId || '').trim();
    const tid = isValidTalkId(raw) ? raw : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', {
        identityKey: identityKeyFallback,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true, ...(options?.questionId ? { targetQuestionId: options.questionId } : {}) });
          else this.showNotification(this.t('talksCouldNotLoad'), 'error');
        },
      });
      return;
    }
    if (!tid) {
      this.showNotification(this.t('talksCouldNotOpen'), 'error');
      return;
    }

    const myTalks = getMyTalks();
    const talk = myTalks[tid];

    if (talk) {
      const preferAnswerView = options?.preferAnswerView && !!talk.fullTalk;
      if (talk.role === 'created' && !preferAnswerView) {
        // Open editor for editing
        this.emit('loadTalkForEdit', { talkId: tid });
      } else if ((talk.role === 'answered' || talk.role === 'copied' || preferAnswerView) && talk.fullTalk) {
        // Open response view without auto-answering (avoid instant "Match!" toast when just viewing)
        this.showTalkResponseDialog(talk.fullTalk, { skipAutoAnswer: true, ...(options?.questionId ? { targetQuestionId: options.questionId } : {}) });
      } else {
        this.showNotification(this.tf('talksDetailNotice', { title: talk.title }), 'info');
      }
    } else {
      // Incoming: load by id; if Gun gave a bad id, app retries via identityKey from server API.
      this.emit('demandFullTalk', {
        talkId: tid,
        identityKeyFallback: identityKeyFallback || undefined,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true, ...(options?.questionId ? { targetQuestionId: options.questionId } : {}) });
          // TODO §P: a real retry, not a one-shot toast whose copy claims retry it doesn't
          // perform — clicking re-runs this same lookup (mesh cache/identity-key resolution
          // may have caught up since the first attempt).
          else
            this.showNotification(
              this.t('talksCouldNotLoadRetry'),
              'error',
              { retry: () => this.showTalkDetail(talkId, identityKeyFallback, options) },
            );
        },
      });
    }
  }

  displayConversationsList(): void {
    renderConversationsList({
      getMyConversations: this.getMyConversations.bind(this),
      escapeHtml: escapeHtml,
      formatTimeAgo: this.formatTalkRelativeTime.bind(this),
      showConversationDetail: this.showConversationDetail.bind(this),
      text: this.t.bind(this),
      // K2: the greeting's authenticity check lives in the full-thread render
      // (filterVerifiedSupportMessages); the list preview just shows the already-verified,
      // already-rendered `lastMessage` text as-is — no re-localization needed.
      formatMessage: (message: string) => message,
    });
  }

  /** Step 10: exposed publicly so app.ts can enumerate conversations for retraction teardown. */
  public getMyConversations(): Record<string, any> {
    const conversationsJson = localStorage.getItem('myConversations');
    return conversationsJson ? JSON.parse(conversationsJson) : {};
  }

  public formatStageNameUpdated(): string {
    return this.t('stageNameUpdated');
  }

  public formatProfileUpdated(): string {
    return this.t('profileUpdated');
  }

  public formatBroadcastNoChatroom(): string {
    return this.t('broadcastNoChatroom');
  }

  public formatBroadcastInProgress(): string {
    return this.t('broadcastInProgress');
  }

  public formatBroadcastCancelled(): string {
    return this.t('broadcastCancelled');
  }

  public formatBroadcastSent(talkCount: number, userCount: number): string {
    const key = talkCount === 1
      ? (userCount === 1 ? 'broadcastSentOneOne' : 'broadcastSentOneMany')
      : (userCount === 1 ? 'broadcastSentManyOne' : 'broadcastSentManyMany');
    return this.tf(key, { talks: talkCount, users: userCount });
  }

  public formatBroadcastFailed(reason: string): string {
    return this.tf('broadcastFailed', { reason });
  }

  /** docs/TODO.md §U. */
  public formatBroadcastGroupSent(): string {
    return this.t('broadcastGroupSent');
  }

  public formatTravelEnabled(): string {
    return this.t('travelEnabled');
  }

  public formatTravelReturnedHomeRoom(): string {
    return this.t('travelReturnedHomeRoom');
  }

  public formatTravelReturnedHome(): string {
    return this.t('travelReturnedHome');
  }

  public formatTravelHomeSet(name: string): string {
    return this.tf('travelHomeSet', { name });
  }

  public formatTravelLocationHeld(): string {
    return this.t('travelLocationHeld');
  }

  public formatTravelMovedLocation(): string {
    return this.t('travelMovedLocation');
  }

  public formatLocationUpdateFailed(reason: string): string {
    return this.tf('locationUpdateFailed', { reason });
  }

  public formatChatroomCreateFailed(reason?: string): string {
    return reason ? this.tf('chatroomCreateFailedWithReason', { reason }) : this.t('chatroomCreateFailed');
  }

  public formatChatroomCreated(name: string): string {
    return this.tf('chatroomCreated', { name });
  }

  public formatChatroomRenameFailed(reason?: string): string {
    return reason ? this.tf('chatroomRenameFailedWithReason', { reason }) : this.t('chatroomRenameFailed');
  }

  public formatChatroomRenamed(): string {
    return this.t('chatroomRenamed');
  }

  public formatChatroomDeleteConfirm(): string {
    return this.t('chatroomDeleteConfirm');
  }

  public formatChatroomDeleteFailed(reason?: string): string {
    return reason ? this.tf('chatroomDeleteFailedWithReason', { reason }) : this.t('chatroomDeleteFailed');
  }

  public formatChatroomDeleted(): string {
    return this.t('chatroomDeleted');
  }

  public formatTalkCreateSyncSlow(): string {
    return this.t('talksCreateSyncSlow');
  }

  public formatTalkCreated(mode: 'sent' | 'saved-only' | 'needs-room'): string {
    if (mode === 'saved-only') return this.t('talksCreatedSavedOnly');
    if (mode === 'needs-room') return this.t('talksCreatedNeedsRoom');
    return this.t('talksCreatedSent');
  }

  public formatTalkCreateFailed(reason: string): string {
    return this.tf('talksCreateFailed', { reason });
  }

  /** docs/TODO.md §V — Auto Linear Capture finalize notices. */
  public formatCaptureTalkCreated(): string {
    return this.t('captureTalkCreatedNotice');
  }

  public formatCaptureTalkAppended(): string {
    return this.t('captureTalkAppendedNotice');
  }

  public formatTalkUpdated(): string {
    return this.t('talksUpdated');
  }

  public formatTalkUpdateFailed(reason: string): string {
    return this.tf('talksUpdateFailed', { reason });
  }

  public formatTalkNotFound(): string {
    return this.t('talksNotFound');
  }

  public formatTalkCouldNotLoad(): string {
    return this.t('talksCouldNotLoad');
  }

  public formatTalkLoadFailed(reason: string): string {
    return this.tf('talksLoadFailed', { reason });
  }

  public formatTalkMatched(name: string, title: string): string {
    return this.tf('talksMatchNotice', { name, title });
  }

  public formatAgeVoteSubmitted(): string {
    return this.t('contactAgeVoteSubmitted');
  }

  public formatUserBlockChanged(blocked: boolean): string {
    return this.t(blocked ? 'contactBlockedNotice' : 'contactUnblockedNotice');
  }

  public formatMatchToStartConversation(): string {
    return this.t('contactMatchToChat');
  }

  public formatAnswerProcessFailed(reason: string): string {
    return this.tf('conversationAnswerFailed', { reason });
  }

  public formatNotInChatroom(): string {
    return this.t('conversationNotInChatroom');
  }

  public formatMessageSent(): string {
    return this.t('conversationMessageSent');
  }

  public formatMessageSendFailed(reason: string): string {
    return this.tf('conversationSendFailed', { reason });
  }

  public formatMediaShareUploading(fileName: string): string {
    return this.tf('mediaShareUploading', { name: fileName });
  }

  public formatConversationLoadFailed(reason: string): string {
    return this.tf('conversationLoadFailed', { reason });
  }

  private formatTransportMode(mode: string): string {
    if (mode === 'direct-p2p') return this.t('transportDirectP2P');
    if (mode === 'server-relay') return this.t('transportServerRelay');
    return this.t('transportStarGun');
  }

  private formatTransportFallback(mode: string, fallbackReason: unknown): string {
    const reason = String(fallbackReason || '').trim();
    if (reason) return this.tf('transportFallbackReason', { reason });
    return this.t(mode === 'star-gun' ? 'transportNoFallbackActive' : 'transportNoFallbackReported');
  }

  private formatLastHealthyContact(lastMessageTime: unknown): string {
    const timestamp = String(lastMessageTime || '').trim();
    if (!timestamp) return this.t('transportNoHealthyContact');
    return this.tf('transportLastHealthyContact', {
      time: this.formatTalkRelativeTime(new Date(timestamp)),
    });
  }

  showConversationDetail(conversationId: string, threadTalkId?: string): void {
    const conversations = this.getMyConversations();
    const conversation = conversations[conversationId];

    if (!conversation) {
      console.warn('showConversationDetail: conversation not found', conversationId);
      return;
    }

    const overlay = document.getElementById('conversation-detail-overlay');
    if (overlay) overlay.style.display = 'flex';
    // Always land on the message thread, not a leftover media gallery from a prior conversation.
    this.closeMediaGallery();

    this.currentConversationId = conversationId;
    // Per-talk Thread scope (redesign §5): messages and the composer are bound to one
    // matched talk; without a talkId this is the pair's talk-independent DM thread.
    this.currentThreadTalkId = threadTalkId && threadTalkId !== 'direct' ? threadTalkId : undefined;

    // Update header with user name. The name embedded in the conversation record was
    // captured at match time and goes stale when the peer renames. Resolve the live name
    // (roster-first, synchronous) and then self-heal asynchronously from the public-user
    // read so the header matches the chatroom's current stage name after a rename.
    const userName = document.getElementById('conversation-user-name');
    if (userName) {
      const liveName = conversation.otherUserId
        ? this.getPeerName(conversation.otherUserId, conversation.otherUserName)
        : conversation.otherUserName;
      userName.textContent = liveName || this.t('conversationUnknown');
      if (conversation.otherUserId) {
        void this.resolvePeerStageNameLive(conversation.otherUserId).then((resolved) => {
          // Only apply if this conversation is still the one on screen.
          if (resolved && this.currentConversationId === conversationId) {
            userName.textContent = resolved;
          }
        });
      }
    }
    const status = document.getElementById('conversation-status');
    if (status) status.textContent = this.t('online');
    // Per-talk Thread pages (redesign §5) share this component; show the talk scope line
    // when this view is bound to a matched talk.
    const threadScope = document.getElementById('conversation-thread-scope');
    if (threadScope) {
      const talkId = this.currentThreadTalkId || '';
      if (talkId && conversation.supportChannel !== true) {
        const talk = this.getMyTalks()[talkId] as any;
        const talkTitle = talk?.title || talk?.fullTalk?.title || `${this.t('peerTalkFallback')} ${talkId.slice(0, 8)}`;
        threadScope.textContent = `🧵 ${talkTitle}`;
        threadScope.style.display = 'block';
        threadScope.dataset.talkId = talkId;
      } else {
        threadScope.textContent = '';
        threadScope.style.display = 'none';
        delete threadScope.dataset.talkId;
      }
    }

    // Spec §30.2 deal confirmation: only shown when the thread's own talk declares a Pair-tag
    // question (`isDealEligibleTalk`, app.ts) — a match there isn't exclusive on its own, so both
    // sides must explicitly confirm before the talk disables. Plain talks show no deal bar.
    const dealBar = document.getElementById('conversation-deal-bar');
    const dealStatusEl = document.getElementById('conversation-deal-status');
    const dealBtn = document.getElementById('conversation-confirm-deal-btn') as HTMLButtonElement | null;
    const isDealEligible = conversation.dealEligible === true;
    if (dealBar && dealStatusEl && dealBtn) {
      if (!isDealEligible || conversation.supportChannel === true) {
        dealBar.style.display = 'none';
      } else {
        let confirmedBy: string[] = [];
        try { confirmedBy = JSON.parse(conversation.dealConfirmedByJson || '[]'); } catch { /* ignore malformed */ }
        const myId = this.currentUserId || '';
        const iConfirmed = myId ? confirmedBy.includes(myId) : false;
        const otherConfirmed = confirmedBy.some((id) => id && id !== myId);
        dealBar.style.display = 'flex';
        if (iConfirmed && otherConfirmed) {
          dealStatusEl.textContent = '✅ Deal confirmed';
          dealBtn.style.display = 'none';
        } else if (iConfirmed) {
          dealStatusEl.textContent = 'Waiting for the other side to confirm...';
          dealBtn.style.display = 'none';
        } else {
          dealStatusEl.textContent = '';
          dealBtn.style.display = 'inline-block';
          dealBtn.textContent = 'Confirm Deal';
          dealBtn.replaceWith(dealBtn.cloneNode(true));
          const freshDealBtn = document.getElementById('conversation-confirm-deal-btn');
          freshDealBtn?.addEventListener('click', () => {
            this.emit('confirmDeal', { conversationId });
          });
        }
      }
    }

    const transportStatus = document.getElementById('conversation-transport-status');
    if (transportStatus) {
      const mode = String(conversation.transportMode || 'star-gun');
      transportStatus.dataset.transportMode = mode;
      transportStatus.textContent = `${this.t('conversationTransport')}: ${this.formatTransportMode(mode)}`;
      const fallbackStatus = document.getElementById('conversation-fallback-status');
      if (fallbackStatus) {
        fallbackStatus.textContent = this.formatTransportFallback(mode, conversation.transportFallbackReason);
      }
      const healthStatus = document.getElementById('conversation-health-status');
      if (healthStatus) {
        healthStatus.textContent = this.formatLastHealthyContact(conversation.lastMessageTime);
      }
    }
    const messagesContainer = document.getElementById('conversation-messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${escapeHtml(this.t('conversationStart'))}</p>`;
    }

    // Record the read cursor for the OPENED scope only (per-thread read state,
    // redesign §5); other threads of the pair keep their unread counts.
    const openKey = this.currentThreadTalkId || 'direct';
    const summaries = (conversation.threadSummaries && typeof conversation.threadSummaries === 'object'
      ? conversation.threadSummaries
      : {}) as Record<string, { lastMessage?: string; lastMessageTime?: string; unreadCount?: number }>;
    if (summaries[openKey]) {
      summaries[openKey].unreadCount = 0;
      const cursorKey = 'iinpublic:conversation-read-cursors';
      let cursors: Record<string, { timestamp: string; id?: string }> = {};
      try { cursors = JSON.parse(localStorage.getItem(cursorKey) || '{}'); } catch { /* ignore malformed local data */ }
      cursors[openKey === 'direct' ? conversationId : `${conversationId}#${openKey}`] = {
        timestamp: summaries[openKey].lastMessageTime || new Date().toISOString(),
      };
      localStorage.setItem(cursorKey, JSON.stringify(cursors));
    }
    const remainingUnread = Object.values(summaries).reduce(
      (total, summary) => total + (Number(summary?.unreadCount) || 0),
      0,
    );
    conversation.unreadCount = remainingUnread;
    conversation.unread = remainingUnread > 0;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();

    // Load messages
    this.emit('loadConversation', { conversationId });

    // Setup back button
    const backBtn = document.getElementById('back-from-conversation');
    if (backBtn) {
      backBtn.textContent = `‹ ${this.t('back')}`;
      backBtn.replaceWith(backBtn.cloneNode(true)); // Remove old listeners
      const newBackBtn = document.getElementById('back-from-conversation');
      newBackBtn?.addEventListener('click', () => {
        if (overlay) overlay.style.display = 'none';
        this.currentConversationId = undefined;
        this.currentThreadTalkId = undefined;
        // If the shared ⟨User⟩ layout is open underneath (rule N2a), refresh its
        // thread rows so snippets/unread badges reflect this visit.
        this.refreshOpenPeerThreadList();
      });
    }

    // Setup send message button
    const sendBtn = document.getElementById('send-conversation-message');
    const messageInput = document.getElementById(
      'conversation-message-input',
    ) as HTMLTextAreaElement;

    if (sendBtn && messageInput) {
      sendBtn.textContent = this.t('conversationSend');
      messageInput.placeholder = this.t('conversationMessagePlaceholder');
      sendBtn.replaceWith(sendBtn.cloneNode(true)); // Remove old listeners
      const newSendBtn = document.getElementById('send-conversation-message');

      const sendMessage = async () => {
        const message = messageInput.value.trim();
        if (!message) return;
        // Send-path content filter (redesign §9): a blocked message is not sent
        // and the composer text is preserved for editing.
        if (!this.allowOutgoingMessage(message)) return;

        // docs/TODO.md §V — Auto Linear Capture: recognize the shorthand *before* the
        // ordinary send, not after (unlike the IPFS-share precedent, which only ever parses
        // already-sent text at render time). Mandatory confirm, never silent.
        const capturedLine = FlowCapture.parseChatLine(message);
        if (capturedLine) {
          const confirmed = await this.confirmCapturedQuestionDialog(capturedLine);
          if (confirmed) {
            const session = this.captureSessionsByConversationId.get(conversationId)
              ?? { scopeTalkId: this.currentThreadTalkId, lines: [] };
            session.lines.push(message);
            this.captureSessionsByConversationId.set(conversationId, session);
            this.emit('sendConversationMessage', {
              conversationId,
              message: encodeCapturedQuestionMessage(capturedLine),
              ...(this.currentThreadTalkId ? { talkId: this.currentThreadTalkId } : {}),
            });
            messageInput.value = '';
            return;
          }
          // Declined — fall through and send the original text as an ordinary message.
        } else {
          const activeSession = this.captureSessionsByConversationId.get(conversationId);
          if (activeSession) {
            // FR-TK-7: a non-captured message closes the capture — finalize what's been
            // gathered so far, then this message itself still sends normally, below.
            this.captureSessionsByConversationId.delete(conversationId);
            this.emit('finalizeCaptureSession', { conversationId, ...activeSession });
          }
        }

        this.emit('sendConversationMessage', {
          conversationId,
          message,
          ...(this.currentThreadTalkId ? { talkId: this.currentThreadTalkId } : {}),
        });
        messageInput.value = '';
      };

      newSendBtn?.addEventListener('click', sendMessage);
      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    // Attach-media button (share a link to any file via IPFS — not the bytes inline).
    // Clone to drop stale listeners; read this.currentConversationId at pick time so a
    // media share always routes to the conversation currently on screen.
    const attachBtn = document.getElementById('conversation-attach-btn');
    const attachInput = document.getElementById('conversation-attach-input') as HTMLInputElement | null;
    if (attachBtn && attachInput) {
      attachBtn.replaceWith(attachBtn.cloneNode(true));
      const newAttachBtn = document.getElementById('conversation-attach-btn');
      const freshInput = attachInput.cloneNode(true) as HTMLInputElement;
      attachInput.replaceWith(freshInput);
      newAttachBtn?.addEventListener('click', () => freshInput.click());
      freshInput.addEventListener('change', () => {
        const file = freshInput.files?.[0];
        if (!file) return;
        const targetConversationId = this.currentConversationId;
        if (targetConversationId) {
          this.emit('shareConversationMedia', { conversationId: targetConversationId, file });
        }
        freshInput.value = '';
      });
    }
  }

  async showUserCreationDialog(): Promise<any> {
    // No modal needed - user creation is automatic
    // Welcome banner will be shown on chatrooms tab after joining
    return Promise.resolve({
      languages: ['en'],
      interests: [],
    });
  }

  async showEditStageNameDialog(user: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">${this.t('editStageName')}</h2>
            <p>${escapeHtml(this.tf('stageDialogCurrent', { name: String(user.stageName || '') }))}</p>
          </div>
          <form id="edit-stagename-form">
            <div class="form-group">
              <label class="form-label">${this.t('stageDialogNewName')}</label>
              <input type="text" class="form-input" id="new-stage-name" name="new-stage-name" 
                     data-testid="stage-name-input"
                     required minlength="3" maxlength="50"
                     placeholder="${escapeHtml(this.t('stageDialogPlaceholder'))}"
                     value="${escapeHtml(String(user.stageName || ''))}">
              <small style="color: #666; font-size: 0.85em;">${this.t('stageDialogLength')}</small>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-edit-btn" style="background: var(--text-tertiary);">${this.t('stageDialogCancel')}</button>
              <button type="submit" class="btn" data-testid="save-stage-name-button">${this.t('stageDialogSave')}</button>
            </div>
          </form>
        </div>
      `;

      document.body.appendChild(modal);

      const form = document.getElementById('edit-stagename-form') as HTMLFormElement;
      const cancelBtn = document.getElementById('cancel-edit-btn') as HTMLButtonElement;

      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const newStageName = formData.get('new-stage-name') as string | null;

        if (newStageName && newStageName.trim() && newStageName.trim().length >= 3) {
          try {
            // Update the user's stage name
            await this.onStageNameChange?.(user.id, newStageName.trim());
            document.body.removeChild(modal);
            resolve();
          } catch (error) {
            alert(this.t('stageDialogUpdateFailed'));
            reject(error);
          }
        } else {
          alert(this.t('stageDialogTooShort'));
        }
      });
    });
  }

  async showEditProfileDialog(user: User): Promise<void> {
    const currentProfile = Array.isArray(user.profile) ? user.profile : [];
    const supportedLanguageCodes = new Set(LANGUAGE_OPTIONS.map((language) => language.code));
    const currentLanguages = (Array.isArray(user.languages) ? user.languages : [])
      .map((language) => String(language).toLowerCase())
      .filter((language) => supportedLanguageCodes.has(language));
    if (currentLanguages.length === 0) currentLanguages.push('en');
    const languageOptionsHtml = LANGUAGE_OPTIONS.map(
      (language) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);">
          <input type="checkbox" class="profile-language-option" value="${language.code}" ${currentLanguages.includes(language.code) ? 'checked' : ''}>
          <span>${escapeHtml(languageOptionLabel(this.getUiLanguage(), language.code, language.label))}</span>
        </label>
      `,
    ).join('');
    const currentHeadshot = String(user.headshot || '').trim();
    const currentInterests = Array.isArray(user.interests) ? user.interests : [];
    const interestsFieldValue = currentInterests.map((t) => String(t.name || '').trim()).filter(Boolean).join(', ');
    const dominantInterestCategory = (): TagCategory => {
      const cats = currentInterests.map((t) => t.category).filter(Boolean) as TagCategory[];
      if (cats.length === 0) return 'other';
      const counts = new Map<TagCategory, number>();
      for (const c of cats) counts.set(c, (counts.get(c) || 0) + 1);
      let best: TagCategory = 'other';
      let n = 0;
      for (const [c, k] of counts) {
        if (k > n) {
          n = k;
          best = c;
        }
      }
      return best;
    };
    const defaultInterestCategory = dominantInterestCategory();
    const visibilityOptionsHtml = (current: ProfileAttributeVisibility) =>
      (['public', 'contacts_only', 'private'] as const)
        .map(
          (v) =>
            `<option value="${v}"${v === current ? ' selected' : ''}>${escapeHtml(this.formatProfileVisibility(v))}</option>`,
        )
        .join('');
    const interestCategoryOptionsHtml = INTEREST_CATEGORY_SELECT_ORDER.map(
      (cat) =>
        `<option value="${cat}"${cat === defaultInterestCategory ? ' selected' : ''}>${escapeHtml(
          this.formatInterestCategory(cat),
        )}</option>`,
    ).join('');
    return new Promise((resolve, reject) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      const profileRowsHtml = currentProfile.length > 0
        ? currentProfile
            .map(
              (qa) => `
                <div class="profile-qa-row" data-qa-id="${escapeHtml(qa.id)}" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;">
                  <input type="text" class="form-input profile-question-input" value="${escapeHtml(qa.question)}" placeholder="${escapeHtml(this.t('profileDialogQuestion'))}">
                  <input type="text" class="form-input profile-answer-input" value="${escapeHtml(qa.answer)}" placeholder="${escapeHtml(this.t('profileDialogAnswer'))}">
                  <select class="form-input profile-visibility-select" title="${escapeHtml(this.t('profileDialogVisibilityTitle'))}">${visibilityOptionsHtml(normalizeProfileAttributeVisibility(qa.visibility))}</select>
                  <button type="button" class="btn remove-profile-qa-btn" style="background:var(--danger);">${this.t('profileDialogRemove')}</button>
                </div>
              `,
            )
            .join('')
        : `
          <div class="profile-qa-row" data-qa-id="" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;">
            <input type="text" class="form-input profile-question-input" placeholder="${escapeHtml(this.t('profileDialogQuestion'))}">
            <input type="text" class="form-input profile-answer-input" placeholder="${escapeHtml(this.t('profileDialogAnswer'))}">
            <select class="form-input profile-visibility-select" title="${escapeHtml(this.t('profileDialogVisibilityTitle'))}">${visibilityOptionsHtml('public')}</select>
            <button type="button" class="btn remove-profile-qa-btn" style="background:var(--danger);">${this.t('profileDialogRemove')}</button>
          </div>
        `;
      const headshotChoices = ['🙂', '😎', '🤠', '🎾', '☕', '🌟', '🐱', '🦊'];
      modal.innerHTML = `
        <div class="modal-content size-l modal-fullscreen" style="max-width:760px;">
          <div class="modal-header">
            <h2 class="modal-title">${this.t('editProfile')}</h2>
            <p>${escapeHtml(this.t('profileDialogDescription'))}</p>
          </div>
          <form id="edit-profile-form">
            <div class="form-group">
              <label class="form-label">${this.t('profileDialogHeadshot')}</label>
              <div style="display:flex; flex-wrap:wrap; gap:8px;" id="headshot-choice-group">
                ${headshotChoices
                  .map(
                    (choice) => `
                      <label style="display:flex; align-items:center; justify-content:center; width:52px; height:52px; border:1px solid var(--border-strong); border-radius:14px; cursor:pointer; font-size:1.5em; background:${choice === currentHeadshot ? 'var(--accent-soft)' : 'white'};">
                        <input type="radio" name="profile-headshot" value="${choice}" ${choice === currentHeadshot ? 'checked' : ''} style="display:none;">
                        <span>${choice}</span>
                      </label>
                    `,
                  )
                  .join('')}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">${this.t('languagesLabel')}</label>
              <div id="profile-languages-select" data-testid="profile-languages-select" style="display:flex;flex-wrap:wrap;gap:8px;">
                ${languageOptionsHtml}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">${this.t('interestsLabel')}</label>
              <input type="text" class="form-input" id="profile-interests-input" value="${escapeHtml(interestsFieldValue)}" placeholder="${escapeHtml(this.t('profileDialogInterestPlaceholder'))}">
              <label class="form-label" style="margin-top:10px;">${this.t('profileDialogDefaultCategory')}</label>
              <select class="form-input" id="profile-interest-category-default">${interestCategoryOptionsHtml}</select>
              <small style="color:#666;font-size:0.85em;">${this.t('profileDialogCategoryHelp')}</small>
            </div>
            <div class="form-group">
              <label class="form-label">${this.t('profileDialogAttributes')}</label>
              <div id="profile-qa-list">${profileRowsHtml}</div>
              <button type="button" class="btn" id="add-profile-qa-btn">${this.t('profileDialogAddAttribute')}</button>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-profile-btn" style="background: var(--text-tertiary);">${this.t('stageDialogCancel')}</button>
              <button type="submit" class="btn" id="save-profile-btn">${this.t('profileDialogSave')}</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      const close = () => {
        if (document.body.contains(modal)) document.body.removeChild(modal);
      };

      const bindRemoveButtons = () => {
        modal.querySelectorAll('.remove-profile-qa-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const row = (btn as HTMLElement).closest('.profile-qa-row');
            row?.remove();
          });
        });
      };
      bindRemoveButtons();

      const addBtn = document.getElementById('add-profile-qa-btn') as HTMLButtonElement | null;
      addBtn?.addEventListener('click', () => {
        const list = document.getElementById('profile-qa-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'profile-qa-row';
        row.setAttribute('data-qa-id', '');
        row.style.cssText =
          'display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;';
        row.innerHTML = `
          <input type="text" class="form-input profile-question-input" placeholder="${escapeHtml(this.t('profileDialogQuestion'))}">
          <input type="text" class="form-input profile-answer-input" placeholder="${escapeHtml(this.t('profileDialogAnswer'))}">
          <select class="form-input profile-visibility-select" title="${escapeHtml(this.t('profileDialogVisibilityTitle'))}">${visibilityOptionsHtml('public')}</select>
          <button type="button" class="btn remove-profile-qa-btn" style="background:var(--danger);">${this.t('profileDialogRemove')}</button>
        `;
        list.appendChild(row);
        bindRemoveButtons();
      });

      const cancelBtn = document.getElementById('cancel-profile-btn') as HTMLButtonElement | null;
      cancelBtn?.addEventListener('click', () => {
        close();
        resolve();
      });

      const form = document.getElementById('edit-profile-form') as HTMLFormElement | null;
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const selectedHeadshot = (modal.querySelector('input[name="profile-headshot"]:checked') as HTMLInputElement | null)?.value?.trim() || '';
        const languages = Array.from(modal.querySelectorAll<HTMLInputElement>('.profile-language-option:checked'))
          .map((option) => option.value)
          .filter((language) => supportedLanguageCodes.has(language));
        const interestsRaw = (document.getElementById('profile-interests-input') as HTMLInputElement | null)?.value || '';
        const defaultCatRaw = (document.getElementById('profile-interest-category-default') as HTMLSelectElement | null)?.value;
        const defaultCat: TagCategory =
          defaultCatRaw && defaultCatRaw in INTEREST_CATEGORY_LABELS ? (defaultCatRaw as TagCategory) : 'other';
        const interests = interestsFromCommaInput(interestsRaw, defaultCat);
        const byId = new Map(currentProfile.map((qa) => [qa.id, qa]));
        const profile: QuestionAnswer[] = Array.from(modal.querySelectorAll('.profile-qa-row'))
          .map((row, index) => {
            const question = ((row.querySelector('.profile-question-input') as HTMLInputElement | null)?.value || '').trim();
            const answer = ((row.querySelector('.profile-answer-input') as HTMLInputElement | null)?.value || '').trim();
            if (!question || !answer) return null;
            const rowEl = row as HTMLElement;
            const attrId = rowEl.dataset.qaId?.trim();
            const prev = attrId ? byId.get(attrId) : undefined;
            const visRaw = (row.querySelector('.profile-visibility-select') as HTMLSelectElement | null)?.value;
            const visibility = normalizeProfileAttributeVisibility(visRaw);
            return {
              id: attrId || `profile_${Date.now()}_${index}`,
              question,
              answer,
              isAuto: false,
              answeredAt: prev?.answeredAt || new Date(),
              ...(visibility === 'public' ? {} : { visibility }),
            } as QuestionAnswer;
          })
          .filter((item): item is QuestionAnswer => !!item);

        if (languages.length === 0) {
          alert(this.t('profileDialogLanguageRequired'));
          return;
        }

        try {
          await this.onProfileChange?.(user.id, {
            ...(selectedHeadshot ? { headshot: selectedHeadshot } : {}),
            languages,
            profile,
            interests,
          });
          close();
          resolve();
        } catch (error) {
          alert(this.t('profileDialogUpdateFailed'));
          reject(error);
        }
      });
    });
  }

  /**
   * Survey creators: show aggregated response counts from local exchange history (STAT-01).
   * Since P0 Step 7 removed server-side stats, all aggregation is client-local.
   */
  private showSurveyStatsDialog(talkId: string): void {
    const entry = this.getMyTalks()[talkId];
    const title = String(entry?.title || this.t('surveyDefaultTitle')).trim() || this.t('surveyDefaultTitle');
    const questionLabel = (questionId: string): string => {
      const qs = entry?.fullTalk?.questions;
      if (!Array.isArray(qs)) return questionId;
      const q = qs.find((x: { id?: string }) => x?.id === questionId);
      const text = (q?.text && String(q.text).trim()) || '';
      return text || questionId;
    };

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content size-l modal-fullscreen" style="max-width:860px;">
        <div class="modal-header">
          <h2 class="modal-title">${this.t('surveyAnalyticsTitle')}</h2>
          <p style="margin:0;color:var(--text-tertiary);font-size:0.92em;">${escapeHtml(title)}</p>
        </div>
        <div id="survey-stats-body" style="padding:8px 0 16px;min-height:120px;">
          <p style="text-align:center;color:var(--text-tertiary);">${this.t('surveyLoading')}</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="survey-stats-followup-btn" style="background:var(--accent);">${this.t('surveyCreateFollowUp')}</button>
          <button type="button" class="btn" id="survey-stats-close-btn" style="background:var(--text-tertiary);">${this.t('surveyClose')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = (): void => {
      if (document.body.contains(modal)) document.body.removeChild(modal);
    };
    modal.querySelector('#survey-stats-close-btn')?.addEventListener('click', close);
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close();
    });

    const body = modal.querySelector('#survey-stats-body') as HTMLElement | null;
    const followUpBtn = modal.querySelector('#survey-stats-followup-btn') as HTMLButtonElement | null;

    // Build stats from local exchange history — no server call required.
    const exchanges = readLocalTalkExchanges();
    const allResponses = buildTalkResponsesFromExchanges(talkId, exchanges);
    const talkType = (entry?.fullTalk?.type || allResponses[0]?.talkType || 'survey') as TalkType;
    const summary = summarize(talkId, talkType, allResponses);
    const byDay = aggregateByTime(talkId, allResponses, 'day');
    const byRegion = aggregateByRegion(talkId, allResponses);

    if (followUpBtn) {
      followUpBtn.disabled = false;
      followUpBtn.addEventListener('click', () => {
        const closeModal = (): void => {
          if (document.body.contains(modal)) document.body.removeChild(modal);
        };
        closeModal();
        this.createSurveyFollowUpFromStats(entry, summary, questionLabel);
      });
    }
    this.renderSurveyStatsDashboard(body, summary, byDay, byRegion, questionLabel, title, allResponses);
  }

  private renderSurveyStatsDashboard(
    body: HTMLElement | null,
    summary: StatsSummary,
    byDay: StatsByTime,
    byRegion: StatsByRegion,
    questionLabel: (questionId: string) => string,
    title: string,
    allResponses: import('../../shared/talk-stats').TalkResponse[] = [],
  ): void {
    if (!body) return;
    const anonymityMasking = summary.total < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
    const render = (maskSmallCounts: boolean, filterDays?: number): void => {
      // Apply optional time-range filter to responses for re-aggregation.
      const responses = filterDays
        ? allResponses.filter((r) => r.createdAt >= Date.now() - filterDays * 86_400_000)
        : allResponses;
      const filteredSummary = responses.length !== allResponses.length
        ? summarize(summary.talkId, summary.talkType, responses)
        : summary;
      const filteredByDay = responses.length !== allResponses.length
        ? aggregateByTime(summary.talkId, responses, 'day')
        : byDay;
      const filteredByRegion = responses.length !== allResponses.length
        ? aggregateByRegion(summary.talkId, responses)
        : byRegion;
      const matchRate = filteredSummary.total > 0
        ? +((filteredSummary.matches * 100) / filteredSummary.total).toFixed(1)
        : 0;
      const cards = `
        <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px;">
          ${this.surveyMetricCard(this.t('surveyResponses'), String(filteredSummary.total))}
          ${this.surveyMetricCard(this.t('surveyQuestions'), String(filteredSummary.byQuestion?.length || 0))}
          ${this.surveyMetricCard(this.t('surveyRegions'), String(filteredByRegion.series?.length || 0))}
          ${this.surveyMetricCard(this.t('surveyLatestDayBucket'), escapeHtml(filteredByDay.series?.[filteredByDay.series.length - 1]?.bucket || '—'))}
          ${this.surveyMetricCard('Match rate', `${matchRate}%`)}
        </div>`;
      const filterOptions = [
        { value: '', label: this.t('surveyFilterAll') },
        { value: '7', label: this.t('surveyFilterDays7') },
        { value: '30', label: this.t('surveyFilterDays30') },
        { value: '90', label: this.t('surveyFilterDays90') },
      ];
      const privacyLine = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9em;color:var(--text-primary);">
            <input type="checkbox" id="survey-anon-toggle" ${maskSmallCounts ? 'checked' : ''}>
            <span>${this.tf('surveyAnonymizeCohorts', { count: UIManager.SURVEY_ANONYMITY_MIN_COUNT })}</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;color:var(--text-primary);">
            <span>${this.t('surveyFilterLabel')}:</span>
            <select id="survey-time-filter" style="padding:4px 6px;border:1px solid var(--border-strong);border-radius:6px;font-size:0.9em;">
              ${filterOptions.map((o) => `<option value="${o.value}" ${filterDays?.toString() === o.value || (!filterDays && o.value === '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn" id="survey-export-summary-btn" style="padding:6px 10px;background:var(--accent);">${this.t('surveyExportSummary')}</button>
          <button type="button" class="btn" id="survey-export-day-btn" style="padding:6px 10px;background:var(--accent);">${this.t('surveyExportDay')}</button>
          <button type="button" class="btn" id="survey-export-region-btn" style="padding:6px 10px;background:var(--accent);">${this.t('surveyExportRegion')}</button>
        </div>
      </div>`;

      const byQuestionParts: string[] = [];
      const completionFunnel = (filteredSummary.talkType === 'flow' || filteredSummary.talkType === 'route')
        ? `<div class="survey-completion-funnel"><div class="survey-chart-title">Question completion</div>${(filteredSummary.byQuestion || []).map((q, index) => {
            const width = Math.max(12, Math.round(q.completionRate));
            return `<div class="survey-funnel-step"><span>Q${index + 1}</span><i style="width:${width}%"></i><b>${q.completionRate}%</b></div>`;
          }).join('')}</div>`
        : '';
      if (!filteredSummary.byQuestion || filteredSummary.byQuestion.length === 0) {
        byQuestionParts.push(`<p style="color:var(--text-tertiary);font-size:0.92em;">${this.t('surveyNoQuestionBreakdown')}</p>`);
      } else {
        for (const q of filteredSummary.byQuestion) {
          const hideQuestion = maskSmallCounts && q.total < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
          const qTitle = escapeHtml(questionLabel(q.questionId));
          const skipLine = !hideQuestion && filteredSummary.total > 0
            ? `<div style="font-size:0.78em;color:var(--text-muted);margin-top:2px;">${this.t('surveyCompletionRateLabel')}: ${q.completionRate}% · ${this.t('surveySkipRate')}: ${q.skipCount > 0 ? q.skipCount : 0} skipped</div>`
            : '';
          const rows = hideQuestion
            ? `<div style="margin-top:8px;padding:10px;border-radius:8px;border:1px dashed var(--border-strong);background:var(--bg-subtle);color:var(--text-tertiary);">${this.tf('surveyHiddenUntil', { count: UIManager.SURVEY_ANONYMITY_MIN_COUNT })}</div>`
            : q.answers
                .map(
                  (a) => `
              <div class="survey-answer-bar">
                <span>${escapeHtml(a.answerText || a.answerId)}</span>
                <i><b style="width:${Math.max(2, a.percentage)}%"></b></i>
                <strong>${a.count} <em>(${a.percentage}%)</em></strong>
              </div>`,
                )
                .join('');
          byQuestionParts.push(`
            <div style="margin-top:16px;">
              <div style="font-weight:700;font-size:0.95em;color:var(--text-primary);margin-bottom:2px;">${qTitle}</div>
              <div style="font-size:0.8em;color:var(--text-tertiary);">${this.tf(q.total === 1 ? 'surveyAnswersRecordedOne' : 'surveyAnswersRecorded', { count: q.total })}</div>
              ${skipLine}
              ${rows}
            </div>`);
        }
      }

      // Cross-question correlation — show if ≥2 questions each have enough responses.
      const eligibleQs = (filteredSummary.byQuestion || []).filter(
        (q) => q.total >= UIManager.SURVEY_ANONYMITY_MIN_COUNT,
      );
      let crossQSection = '';
      if (eligibleQs.length >= 2) {
        const qA = eligibleQs[0]!;
        const qB = eligibleQs[1]!;
        const cross = aggregateCrossQuestion(
          filteredSummary.talkId,
          responses,
          qA.questionId,
          qB.questionId,
          maskSmallCounts ? UIManager.SURVEY_ANONYMITY_MIN_COUNT : 1,
        );
        const crossRows = cross.cells
          .map((cell) => `<tr>
            <td style="padding:6px 8px;border-top:1px solid var(--border);">${cell.masked ? '—' : escapeHtml(cell.answerAText)}</td>
            <td style="padding:6px 8px;border-top:1px solid var(--border);">${cell.masked ? '—' : escapeHtml(cell.answerBText)}</td>
            <td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;background:rgba(15,118,110,${cell.masked ? 0 : Math.min(0.5, cell.percentage / 160)});">${cell.masked ? '—' : cell.count}</td>
            <td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;background:rgba(15,118,110,${cell.masked ? 0 : Math.min(0.5, cell.percentage / 160)});">${cell.masked ? '—' : `${cell.percentage}%`}</td>
          </tr>`)
          .join('');
        crossQSection = `
          <div style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${this.t('surveyCrossQuestion')}</div>
            <div style="font-size:0.82em;color:var(--text-tertiary);margin-bottom:8px;">${escapeHtml(questionLabel(qA.questionId))} × ${escapeHtml(questionLabel(qB.questionId))}</div>
            <table class="survey-heatmap" style="width:100%;border-collapse:collapse;font-size:0.88em;">
              <thead><tr>
                <th style="text-align:left;padding:6px 8px;">${escapeHtml(questionLabel(qA.questionId).slice(0, 20))}</th>
                <th style="text-align:left;padding:6px 8px;">${escapeHtml(questionLabel(qB.questionId).slice(0, 20))}</th>
                <th style="text-align:right;padding:6px 8px;">${this.t('surveyCount')}</th>
                <th style="text-align:right;padding:6px 8px;">%</th>
              </tr></thead>
              <tbody>${crossRows || `<tr><td colspan="4" style="padding:8px;color:var(--text-tertiary);">${this.t('surveyNoResponses')}</td></tr>`}</tbody>
            </table>
          </div>`;
      } else if ((filteredSummary.byQuestion || []).length >= 2) {
        crossQSection = `
          <div style="margin-top:12px;padding:10px;border:1px dashed var(--border-strong);border-radius:8px;background:var(--bg-subtle);font-size:0.88em;color:var(--text-tertiary);">
            ${this.tf('surveyCrossQuestionEmpty', { count: UIManager.SURVEY_ANONYMITY_MIN_COUNT })}
          </div>`;
      }

      const dayRows = (filteredByDay.series || [])
        .map((item) => `<tr><td style="padding:6px 8px;border-top:1px solid var(--border);">${escapeHtml(item.bucket)}</td><td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;">${item.count}</td></tr>`)
        .join('');
      const regionRows = (filteredByRegion.series || [])
        .map((item) => {
          const hidden = maskSmallCounts && item.count < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
          return `<tr><td style="padding:6px 8px;border-top:1px solid var(--border);">${hidden ? this.t('surveyHiddenRegion') : escapeHtml(item.region || this.t('surveyUnknownRegion'))}</td><td style="padding:6px 8px;border-top:1px solid var(--border);text-align:right;">${hidden ? '—' : item.count}</td></tr>`;
        })
        .join('');
      const followUpCandidates = (filteredSummary.byQuestion || []).filter(
        (q) => q.total > 0 && q.total < Math.max(UIManager.SURVEY_ANONYMITY_MIN_COUNT, Math.ceil(filteredSummary.total * 0.6)),
      );
      const followUpHint =
        followUpCandidates.length === 0
          ? `<p style="margin:8px 0 0;color:var(--text-tertiary);font-size:0.9em;">${this.t('surveyNoFollowUpGaps')}</p>`
          : `<p style="margin:8px 0 0;color:var(--text-primary);font-size:0.9em;">${escapeHtml(this.tf('surveyFollowUpCandidates', {
              questions: followUpCandidates.map((q) => questionLabel(q.questionId)).join(', '),
            }))}</p>`;

      body.innerHTML = `
        ${cards}
        ${privacyLine}
        <div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);">${this.t('surveyQuestionDistribution')}</div>
          ${completionFunnel}
          ${byQuestionParts.join('')}
        </div>
        ${crossQSection}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-weight:700;color:var(--text-primary);">${this.t('surveyResponsesByDay')}</div>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">${this.t('surveyBucket')}</th><th style="text-align:right;padding:6px 8px;">${this.t('surveyCount')}</th></tr></thead>
              <tbody>${dayRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">${this.t('surveyNoResponses')}</td></tr>`}</tbody>
            </table>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-weight:700;color:var(--text-primary);">${this.t('surveyResponsesByRegion')}</div>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">${this.t('surveyRegions')}</th><th style="text-align:right;padding:6px 8px;">${this.t('surveyCount')}</th></tr></thead>
              <tbody>${regionRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">${this.t('surveyNoRegionData')}</td></tr>`}</tbody>
            </table>
          </div>
        </div>
        <div style="margin-top:12px;padding:12px;border:1px dashed var(--border-strong);border-radius:8px;background:var(--bg-subtle);">
          <div style="font-weight:700;color:var(--text-primary);">${this.t('surveyFollowUpHandling')}</div>
          <p style="margin:8px 0 0;color:var(--text-tertiary);font-size:0.9em;">${escapeHtml(this.tf('surveyFollowUpHelp', { title }))}</p>
          ${followUpHint}
        </div>
        <p style="margin:10px 0 0;font-size:0.8em;color:var(--text-muted);">${this.t('surveyLocalData')}</p>`;

      body.querySelector('#survey-anon-toggle')?.addEventListener('change', (event) => {
        const checked = !!(event.target as HTMLInputElement | null)?.checked;
        render(checked, filterDays);
      });
      body.querySelector('#survey-time-filter')?.addEventListener('change', (event) => {
        const val = (event.target as HTMLSelectElement | null)?.value || '';
        const days = val ? parseInt(val, 10) : undefined;
        render(maskSmallCounts, days);
      });
      body.querySelector('#survey-export-summary-btn')?.addEventListener('click', () => {
        this.downloadCsv(`survey-summary-${filteredSummary.talkId}.csv`, this.toSurveySummaryCsv(filteredSummary, questionLabel));
      });
      body.querySelector('#survey-export-day-btn')?.addEventListener('click', () => {
        this.downloadCsv(`survey-by-day-${filteredSummary.talkId}.csv`, this.toByDayCsv(filteredByDay));
      });
      body.querySelector('#survey-export-region-btn')?.addEventListener('click', () => {
        this.downloadCsv(`survey-by-region-${filteredSummary.talkId}.csv`, this.toByRegionCsv(filteredByRegion, maskSmallCounts));
      });
    };

    render(anonymityMasking);
  }

  private surveyMetricCard(label: string, value: string): string {
    return `<div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
      <div style="font-size:0.78em;color:var(--text-tertiary);">${escapeHtml(label)}</div>
      <div style="font-size:1.2em;font-weight:700;color:var(--text-primary);">${escapeHtml(value)}</div>
    </div>`;
  }

  private toSurveySummaryCsv(summary: StatsSummary, questionLabel: (questionId: string) => string): string {
    const lines = ['question_id,question,answer_id,answer,count,percentage'];
    for (const q of summary.byQuestion || []) {
      for (const a of q.answers || []) {
        lines.push(
          [
            q.questionId,
            questionLabel(q.questionId),
            a.answerId,
            a.answerText || a.answerId,
            String(a.count),
            String(a.percentage),
          ]
            .map((part) => this.escapeCsvCell(part))
            .join(','),
        );
      }
    }
    return lines.join('\n');
  }

  private toByDayCsv(byDay: StatsByTime): string {
    const lines = ['bucket,count'];
    for (const item of byDay.series || []) {
      lines.push([item.bucket, String(item.count)].map((part) => this.escapeCsvCell(part)).join(','));
    }
    return lines.join('\n');
  }

  private toByRegionCsv(byRegion: StatsByRegion, maskSmallCounts: boolean): string {
    const lines = ['region,count'];
    for (const item of byRegion.series || []) {
      const hide = maskSmallCounts && item.count < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
      lines.push(
        [hide ? 'hidden_region' : item.region || 'unknown', hide ? '' : String(item.count)]
          .map((part) => this.escapeCsvCell(part))
          .join(','),
      );
    }
    return lines.join('\n');
  }

  private escapeCsvCell(value: string): string {
    const str = String(value ?? '');
    const escaped = str.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  private downloadCsv(filename: string, csvBody: string): void {
    const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    this.showNotification(this.tf('surveyExported', { filename }), 'success');
  }

  private createSurveyFollowUpFromStats(
    entry: any,
    summary: StatsSummary,
    questionLabel: (questionId: string) => string,
  ): void {
    const sourceQuestions = Array.isArray(entry?.fullTalk?.questions) ? entry.fullTalk.questions : [];
    const copiedQuestions = sourceQuestions
      .slice(0, 4)
      .map((q: any, qIdx: number) => ({
        id: `q_${qIdx}`,
        text: String(q?.text || questionLabel(String(q?.id || `q_${qIdx}`)) || '').trim(),
        answers: Array.isArray(q?.answers)
          ? q.answers.slice(0, 6).map((a: any, aIdx: number) => ({
              id: `a_${qIdx}_${aIdx}`,
              text: String(a?.text || '').trim() || `Option ${aIdx + 1}`,
              isTerminal: true,
              counter: 0,
            }))
          : [],
      }))
      .filter((q: any) => q.text && Array.isArray(q.answers) && q.answers.length > 0);
    if (copiedQuestions.length === 0) {
      copiedQuestions.push({
        id: 'q_0',
        text: this.t('surveyFollowUpQuestion'),
        answers: [
          { id: 'a_0_0', text: this.t('surveyFollowUpDetails'), isTerminal: true, counter: 0 },
          { id: 'a_0_1', text: this.t('surveyNoFollowUpNeeded'), isTerminal: true, counter: 0 },
        ],
      });
    }
    this.showTalkEditorDialog({
      title: this.tf('surveyFollowUpTitle', { title: String(entry?.title || summary.talkId).trim() }),
      type: 'survey',
      questions: copiedQuestions,
    });
  }

  displayNewMessage(message: any): void {
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
      const messageElement = document.createElement('div');
      messageElement.className = `message ${message.senderId === 'current_user' ? 'sent' : 'received'}`;
      messageElement.innerHTML = `
        <div class="message-bubble">
          ${message.text || message.message}
          <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
      `;
      messagesContainer.appendChild(messageElement);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  updateConversation(_conversationId: string, result: any): void {
    console.log('Conversation updated:', result);
  }

  updateChatroomInfo(info: { id: string; name: string } | any): void {
    // Update current chatroom tracking
    if (info.id) {
      this.currentChatroom = info.id;
    }
    this.syncStatusBroadcastButtonVisibility();

    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo && info.id && info.name) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">${info.name}</div>
        <div class="chatroom-status">Connected</div>
      `;
    } else {
      console.log('Chatroom updated:', info);
    }
  }

  updateUserInfo(user: User): void {
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">${user.stageName.charAt(0).toUpperCase()}</div>
        <div>
          <div><strong>${user.stageName}</strong></div>
          <div style="font-size: 0.8em; color: #666;">Online</div>
        </div>
      `;
    }
  }

  /**
   * docs/TODO.md §V — Auto Linear Capture's mandatory confirmation step. Bernard, 2026-08-01:
   * "yes, make it mandatory" — a successful shorthand parse never silently diverts a send;
   * the sender always confirms first. Declining sends the typed text as an ordinary message
   * instead (the caller falls through to the normal send path on `false`).
   */
  confirmCapturedQuestionDialog(parsed: { question: string; answers: string[] }): Promise<boolean> {
    document.getElementById('capture-question-confirm-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'capture-question-confirm-modal';
    modal.dataset.testid = 'capture-question-confirm-modal';
    modal.className = 'modal-overlay';
    // This dialog is opened from *inside* an already-open conversation detail overlay
    // (z-index 1001), which sits above .modal-overlay's own default (1000) — found via
    // real E2E run (docs/TODO.md §V), matching the z-index tier the media lightbox
    // already uses for the same "float above an open conversation" requirement.
    modal.style.zIndex = '2000';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h2 class="modal-title">${this.t('captureConfirmTitle')}</h2>
          <p>${this.t('captureConfirmHelp')}</p>
        </div>
        <div style="padding:10px 0;">
          <div style="font-weight:600;">${escapeHtml(parsed.question)}</div>
          <ul style="margin:8px 0 0;padding-left:20px;font-size:0.9em;color:var(--text-secondary);">
            ${parsed.answers.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
          </ul>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" data-testid="capture-question-confirm-decline">${this.t('captureConfirmDecline')}</button>
          <button type="button" class="btn primary-btn" data-testid="capture-question-confirm-accept">${this.t('captureConfirmAccept')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return new Promise<boolean>((resolve) => {
      const finish = (confirmed: boolean): void => {
        modal.remove();
        resolve(confirmed);
      };
      modal.querySelector('[data-testid="capture-question-confirm-accept"]')?.addEventListener('click', () => finish(true));
      modal.querySelector('[data-testid="capture-question-confirm-decline"]')?.addEventListener('click', () => finish(false));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) finish(false);
      });
    });
  }

  /**
   * Durable bulk-send outcome for QA/E2E. Success toasts auto-hide after ~3s while delivery
   * can run much longer, so tests should assert on these attributes instead of toast text.
   */
  setBroadcastBulkAck(talksSent: number, receiversResolved: number): void {
    const el = document.getElementById('broadcast-bulk-ack');
    if (!el) return;
    el.dataset.broadcastTalksSent = String(talksSent);
    el.dataset.broadcastReceivers = String(receiversResolved);
    const prev = Number(el.dataset.broadcastBulkGen ?? '0');
    el.dataset.broadcastBulkGen = String(Number.isFinite(prev) ? prev + 1 : 1);
  }

  /** docs/TODO.md §U — display text for a contact-group option; built-ins reuse the existing relation-filter translation keys, custom groups show the raw typed text as-is. */
  private formatContactGroupLabel(group: ContactGroupOption): string {
    const builtInKeys: Record<string, UiTranslationKey> = {
      all: 'allRelations',
      friend: 'friends',
      relative: 'relatives',
      coworker: 'coworkers',
      acquaintance: 'acquaintances',
      partner: 'partners',
      custom: 'custom',
    };
    const key = builtInKeys[group.id];
    return key ? this.t(key) : group.displayLabel;
  }

  /**
   * docs/TODO.md §U — broadcast a talk to a whole contact group, online or not. Delivery
   * itself reuses the exact same mesh-plus-mailbox path every other broadcast already uses
   * (`app.ts`'s `broadcastToContactGroup` handler calls `deliverTalkToReceiversOverMesh`) —
   * this dialog's only job is resolving *who* to send to.
   */
  showBroadcastToGroupDialog(): void {
    const knownPeople = this.getKnownPeople();
    const groups = listContactGroups(knownPeople);
    const talkIds = this.getBroadcastableTalkIds();
    if (talkIds.length === 0) {
      this.showNotification(this.t('chatroomNoTalksToBroadcast'), 'info');
      return;
    }
    const myTalks = getMyTalks();

    document.getElementById('broadcast-group-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'broadcast-group-modal';
    modal.dataset.testid = 'broadcast-group-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2000';

    const groupOptions = groups
      .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(this.formatContactGroupLabel(g))} (${g.memberCount})</option>`)
      .join('');
    const talkOptions = talkIds
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(myTalks[id]?.title || id)}</option>`)
      .join('');

    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h2 class="modal-title">${this.t('broadcastGroupTitle')}</h2>
        </div>
        <label style="display:block;margin-top:10px;font-size:0.9em;">
          <span>${this.t('broadcastGroupPickGroup')}</span>
          <select id="broadcast-group-select" class="form-input" data-testid="broadcast-group-select">${groupOptions}</select>
        </label>
        <label style="display:block;margin-top:10px;font-size:0.9em;">
          <span>${this.t('broadcastGroupPickTalk')}</span>
          <select id="broadcast-group-talk-select" class="form-input" data-testid="broadcast-group-talk-select">${talkOptions}</select>
        </label>
        <div id="broadcast-group-preview" style="margin-top:10px;font-size:0.88em;color:var(--text-secondary);" data-testid="broadcast-group-preview"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-testid="broadcast-group-cancel">${this.t('captureConfirmDecline')}</button>
          <button type="button" class="btn primary-btn" data-testid="broadcast-group-confirm">${this.t('conversationSend')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const groupSelect = modal.querySelector('#broadcast-group-select') as HTMLSelectElement;
    const talkSelect = modal.querySelector('#broadcast-group-talk-select') as HTMLSelectElement;
    const preview = modal.querySelector('#broadcast-group-preview') as HTMLElement;
    const updatePreview = () => {
      const userIds = resolveContactGroupUserIds(knownPeople, groupSelect.value, this.currentUser?.blockedUserIds || []);
      preview.textContent = this.tf('broadcastGroupPreview', { count: userIds.length });
    };
    groupSelect.addEventListener('change', updatePreview);
    updatePreview();

    const close = () => modal.remove();
    modal.querySelector('[data-testid="broadcast-group-cancel"]')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
    modal.querySelector('[data-testid="broadcast-group-confirm"]')?.addEventListener('click', () => {
      const userIds = resolveContactGroupUserIds(knownPeople, groupSelect.value, this.currentUser?.blockedUserIds || []);
      if (userIds.length === 0) {
        this.showNotification(this.t('broadcastGroupEmpty'), 'info');
        return;
      }
      const members = userIds.map((userId) => ({ userId, stageName: this.getPeerName(userId) }));
      this.emit('broadcastToContactGroup', { talkId: talkSelect.value, members });
      close();
    });
  }

  confirmBroadcastAudience(previews: BroadcastAudiencePreview[]): Promise<boolean> {
    document.getElementById('broadcast-preamble-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'broadcast-preamble-modal';
    modal.dataset.testid = 'broadcast-preamble-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(15,23,42,0.48);display:flex;align-items:center;justify-content:center;padding:20px;';
    const knownPreviews = previews.filter((preview) => !preview.previewUnavailable);
    const deliveryCount = knownPreviews.reduce((count, preview) => count + preview.eligibleReceivers, 0);
    const candidateCount = knownPreviews.reduce((count, preview) => count + preview.totalCandidates, 0);
    const supportExcludedCount = knownPreviews.reduce((count, preview) => count + (preview.supportExcludedCount || 0), 0);
    const excludedCount = Math.max(0, candidateCount - deliveryCount) + supportExcludedCount;
    const hasUnavailable = knownPreviews.length !== previews.length;
    const rows = previews.map((preview) => {
      if (preview.senderOmittedBy?.length) {
        const reasonText = preview.senderOmittedBy
          .map((reason) => this.deliveryReasonLabel(reason))
          .join(' · ');
        return `
          <div class="broadcast-preview-row broadcast-preview-row-omitted" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid var(--danger-border);border-radius:10px;background:var(--danger-soft);">
            <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
            <div style="font-size:0.88em;color:var(--danger-hover);margin-top:4px;">0 ${this.t('broadcastPreviewEligible')} · ${this.t('broadcastPreviewSenderOmitted')}</div>
            <div class="broadcast-preview-reasons" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(reasonText)}</div>
          </div>
        `;
      }
      if (preview.previewUnavailable) {
        return `
          <div class="broadcast-preview-row" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid var(--border);border-radius:10px;">
            <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
            <div class="broadcast-preview-reasons" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${this.t('broadcastPreviewUnavailable')}</div>
          </div>
        `;
      }
      const reasonText = this.formatReasonCounts(preview.rejectedByCounts);
      const recipientText = (preview.eligibleReceiverNames || []).join(', ') || this.t('broadcastPreviewNone');
      const rejectedDetailText = (preview.rejectedReceiverDetails || [])
        .map(({ name, rejectedBy }) => {
          const reasonCounts = Object.fromEntries(rejectedBy.map((reason) => [reason, 1]));
          return `${name}: ${this.formatReasonCounts(reasonCounts)}`;
        })
        .join('; ');
      const perTalkExcluded = Math.max(0, preview.totalCandidates - preview.eligibleReceivers)
        + (preview.supportExcludedCount || 0);
      return `
        <div class="broadcast-preview-row" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid var(--border);border-radius:10px;">
          <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
          <div style="font-size:0.88em;color:var(--text-secondary);margin-top:4px;">${preview.eligibleReceivers} ${this.t('broadcastPreviewEligible')} · ${perTalkExcluded} ${this.t('broadcastPreviewExcluded')}</div>
          <div class="broadcast-preview-recipients" style="font-size:0.82em;color:var(--text-secondary);margin-top:4px;">${escapeHtml(this.tf('broadcastPreviewRecipients', { names: recipientText }))}</div>
          ${reasonText ? `<div class="broadcast-preview-reasons" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(reasonText)}</div>` : ''}
          ${rejectedDetailText ? `<div class="broadcast-preview-skipped" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(this.tf('broadcastPreviewSkipped', { details: rejectedDetailText }))}</div>` : ''}
          ${preview.supportExcludedCount ? `<div class="broadcast-preview-support" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(this.tf('broadcastPreviewSupportExcluded', { count: preview.supportExcludedCount }))}</div>` : ''}
        </div>
      `;
    }).join('');
    modal.innerHTML = `
      <div style="width:min(620px,96vw);max-height:90vh;overflow:auto;background:var(--surface);border-radius:16px;box-shadow:0 18px 55px rgba(15,23,42,0.2);">
        <div style="padding:18px;border-bottom:1px solid var(--border);">
          <div style="font-size:1.05em;font-weight:700;">${this.t('broadcastPreviewTitle')}</div>
          <div style="font-size:0.88em;color:var(--text-tertiary);margin-top:5px;">${this.t('broadcastPreviewHelp')}</div>
          <span class="broadcast-chip" style="display:inline-flex;margin-top:10px;padding:4px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent-hover);font-size:0.82em;">${this.tf(previews.length === 1 ? 'talksCountOne' : 'talksCount', { count: previews.length })} · ${deliveryCount} ${this.t('broadcastPreviewEligible')} · ${excludedCount} ${this.t('broadcastPreviewExcluded')}${hasUnavailable ? ` · ${this.t('broadcastPreviewFinalCheck')}` : ''}</span>
        </div>
        <div style="display:grid;gap:8px;padding:14px;">${rows}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--border);">
          <button class="btn" type="button" data-testid="broadcast-preamble-cancel">${this.t('broadcastPreviewCancel')}</button>
          <button class="btn primary-btn" type="button" data-testid="broadcast-preamble-send">${this.t('broadcastPreviewSend')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return new Promise<boolean>((resolve) => {
      const finish = (confirmed: boolean) => {
        modal.remove();
        resolve(confirmed);
      };
      modal.querySelector('[data-testid="broadcast-preamble-send"]')?.addEventListener('click', () => finish(true));
      modal.querySelector('[data-testid="broadcast-preamble-cancel"]')?.addEventListener('click', () => finish(false));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) finish(false);
      });
    });
  }

  updateStatusBar(
    _stageName: string,
    chatroomName: string,
    memberCount: number,
    totalMatches?: number,
  ): void {
    const statusBarText = document.getElementById('status-bar-text');

    if (statusBarText) {
      const userText = this.tf(memberCount === 1 ? 'statusBarUser' : 'statusBarUsers', { count: memberCount });
      const base = `${chatroomName} · ${userText}`;
      statusBarText.dataset.statusBarBase = base;
      const localTotalMatches = this.getTotalMatches();
      const effectiveTotalMatches = localTotalMatches > 0 ? localTotalMatches : (totalMatches ?? 0);
      let text = base;
      if (effectiveTotalMatches > 0) {
        const matchText = this.tf(
          effectiveTotalMatches === 1 ? 'statusBarMatch' : 'statusBarMatches',
          { count: effectiveTotalMatches },
        );
        text += ` · ${matchText}`;
      }
      statusBarText.textContent = text;
    }
  }

  private syncStatusBarMatchCount(): void {
    const statusBarText = document.getElementById('status-bar-text');
    if (!statusBarText) return;
    // Use data attribute set by updateStatusBar; fall back to stripping legacy English suffix.
    const base =
      statusBarText.dataset.statusBarBase ||
      statusBarText.textContent?.replace(/\s*·\s*\d+\s+match(?:es)?\s*$/i, '').trim() ||
      '';
    const totalMatches = this.getTotalMatches();
    if (totalMatches > 0) {
      const matchText = this.tf(
        totalMatches === 1 ? 'statusBarMatch' : 'statusBarMatches',
        { count: totalMatches },
      );
      statusBarText.textContent = `${base} · ${matchText}`;
    } else {
      statusBarText.textContent = base;
    }
  }

  getTotalMatches(): number {
    const statsMatches = Object.values(this.talkStatsMap).reduce((sum, s) => sum + s.matches, 0);
    const conversationMatches = Object.values(this.getMyConversations()).filter((conversation: any) => {
      return (
        !!conversation &&
        typeof conversation === 'object' &&
        conversation.supportChannel !== true &&
        !!conversation.talkId
      );
    }).length;
    // Use the higher of the two: per-talk stats update immediately on responses, while
    // Gun-backed conversations can lag (bulk matches would otherwise show "1 match" forever).
    return Math.max(statsMatches, conversationMatches);
  }

  displayIncomingTalk(talk: {
    id: string;
    title: string;
    authorName: string;
    type: string;
    questionCount: number;
    timestamp: string;
    isOwnTalk: boolean;
    fullTalk: any;
  }): void {
    // Do not auto-save to myTalks. Rely on the backend incomingTalkClusters instead.

    // Show a notification for received talks and flash the author's icon in member list
    if (!talk.isOwnTalk) {
      this.showNotification(this.tf('newTalkNotification', { name: talk.authorName, title: talk.title }), 'info');
      const authorId = talk.fullTalk?.authorId;
      if (authorId) this.flashMemberForNewTalk(authorId);
    }

    // Refresh the talks list if the Talks tab is currently active
    const talksTab = document.getElementById('tab-talks');
    if (talksTab?.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  showTalkResponseDialog(talk: any, options?: { skipAutoAnswer?: boolean; isTalkSuperseded?: boolean; senderName?: string; targetQuestionId?: string }): void {
    const talkId = String(talk?.id || '');
    openTalkResponseDialog({
      talk,
      ...(options?.skipAutoAnswer !== undefined ? { skipAutoAnswer: options.skipAutoAnswer } : {}),
      ...(options?.isTalkSuperseded ? { isTalkSuperseded: true } : {}),
      ...(options?.senderName ? { senderName: options.senderName } : {}),
      ...(options?.targetQuestionId ? { targetQuestionId: options.targetQuestionId } : {}),
      escapeHtml: escapeHtml,
      showNotification: this.showNotification.bind(this),
      completeTalk: this.completeTalk.bind(this),
      resolveAnswerPreferenceForTalkQuestion: this.resolveAnswerPreferenceForTalkQuestion.bind(this),
      saveAnswerPreference: this.saveAnswerPreference.bind(this),
      text: this.t.bind(this),
      // TODO §Q: Talk → Me-tab Q&A reverse edge — same talkId join P's Q&A → Talk direction
      // already established. Only offered when I've actually answered this talk (viewing my own
      // answer), not while answering it live for the first time.
      ...(talkId && this.hasMeTabAnswerForTalk(talkId)
        ? { viewInMyAnswers: () => this.navigateToMyAnswerForTalk(talkId) }
        : {}),
    });
  }

  /** TODO §Q: does this talk have a Me-tab Q&A entry — i.e. did I actually answer it? */
  private hasMeTabAnswerForTalk(talkId: string): boolean {
    const flatHistory = getFlatAnswerHistory();
    if (Object.values(flatHistory).some((record) => record.talkId === talkId)) return true;
    const talk = this.getMyTalks()[talkId];
    return talk?.role === 'answered' || talk?.role === 'copied';
  }

  /**
   * TODO §Q: Talk → Me-tab Q&A reverse edge. Switches to the Me tab and scrolls/highlights the
   * answer entry (or entries, for a multi-question flow/route talk) that came from this talk —
   * the reverse of P's Q&A → Talk `showTalkDetailAsAnswer` direction, same talkId join.
   */
  private navigateToMyAnswerForTalk(talkId: string): void {
    document.getElementById('talk-response-modal')?.remove();
    (document.querySelector('.nav-btn[data-view="me"]') as HTMLElement | null)?.click();
    window.setTimeout(() => {
      // Merged rows can represent more than one contributing talk (data-talk-ids is a
      // space-separated set), so this matches any row that lists talkId among its variants,
      // not just a row whose sole identity equals talkId.
      const rows = document.querySelectorAll<HTMLElement>(`.answer-talk-item[data-talk-ids~="${talkId}"]`);
      const first = rows[0];
      if (!first) return;
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      rows.forEach((row) => {
        row.classList.add('answer-item-highlighted');
        window.setTimeout(() => row.classList.remove('answer-item-highlighted'), 2000);
      });
    }, 0);
  }

  private static getTalkContentKey(talk: any): string {
    const q = (talk.questions || []).map((qu: any) => ({
      text: qu.text,
      answers: (qu.answers || []).map((a: any) => a.text),
    }));
    const title = talk.type === 'tag' ? talk.title : '';
    const loc = talk.locationRadiusMiles != null ? String(talk.locationRadiusMiles) : '';
    return JSON.stringify({ q, loc, title, type: talk.type });
  }

  private completeTalk(
    talk: any,
    answers: any[],
    outcome?: 'match' | 'mismatch',
    meta?: { withholdFromSender?: boolean },
  ): void {
    console.log('✅ Talk completed:', talk.id, answers, outcome);

    const contentKey = UIManager.getTalkContentKey(talk);
    const answeredByContent = getAnsweredTalkByContent();
    const existingTalkId = answeredByContent[contentKey];
    const myTalks = this.getMyTalks();
    const authorId = talk.authorId || (talk as any).authorId;

    let talkIdToUse: string;
    let senders: string[];

    if (existingTalkId && myTalks[existingTalkId]) {
      talkIdToUse = existingTalkId;
      const existing = myTalks[existingTalkId];
      const prevSenders = existing.senders || (existing.fullTalk?.authorId ? [existing.fullTalk.authorId] : []);
      senders = [...new Set([...prevSenders, authorId].filter(Boolean))];
    } else {
      talkIdToUse = talk.id;
      senders = authorId ? [authorId] : [];
      answeredByContent[contentKey] = talk.id;
      try {
        answeredByContent[computeTalkIdFromTalkData(talk)] = talk.id;
      } catch {
        /* keep legacy content key only */
      }
      setAnsweredTalkByContent(answeredByContent);
    }

    const existingEntry = myTalks[talkIdToUse];
    const wasIgnored = answers.some((answer) => {
      const answerId = String(answer?.answerId || '').toLowerCase();
      const answerText = String(answer?.answerText || '').toLowerCase();
      return answerId === 'ignore' || answerId.includes('ignore') || answerText === 'ignore';
    });
    const role = existingEntry?.role === 'copied' ? 'copied'
               : existingEntry?.role === 'created' ? 'created'
               : getCopyTalkAutoSave() && !wasIgnored ? 'copied'
               : 'answered';
    const completedAnswers = answers.map((answer) => ({
      questionId: answer.questionId,
      answerId: answer.answerId,
      ...(answer.answerText ? { answerText: answer.answerText } : {}),
      ...(answer.mode ? { mode: answer.mode } : {}),
    }));

    this.saveMyTalk({
      talkId: talkIdToUse,
      title: talk.title,
      type: talk.type,
      timestamp: talk.createdAt || new Date().toISOString(),
      role,
      // docs/TODO.md §Y1: auto-copy on completion is still just a copy — original authorship
      // is preserved either way until a real edit happens.
      fullTalk: existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk,
      completedAnswers,
      outcome: outcome ?? existingEntry?.outcome ?? 'mismatch',
      senders,
    });
    this.saveFlatAnswerHistoryRecord(talkIdToUse, talk, completedAnswers, outcome ?? existingEntry?.outcome ?? 'mismatch', senders);

    this.emit('talkCompleted', {
      talkId: talk.id,
      answers,
      talkData: talk,
      ...(meta?.withholdFromSender ? { withholdFromSender: true } : {}),
    });

    this.showNotification(
      talk.type === 'flow'
        ? this.t('responseSubmittedFlow')
        : talk.type === 'tag'
          ? this.t('responseSubmittedTag')
          : this.t('responseSubmittedSurvey'),
      'success',
    );
  }

  private saveFlatAnswerHistoryRecord(
    talkId: string,
    talk: any,
    completedAnswers: Array<{ questionId: string; answerId: string; answerText?: string; mode?: string }>,
    outcome: 'match' | 'mismatch',
    senders: string[],
  ): void {
    const questions = Array.isArray(talk?.questions) ? talk.questions : [];
    const talkType = String(talk?.type || '').toLowerCase();
    const items: FlatAnswerHistoryItem[] = completedAnswers.map((entry, index) => {
      const question = questions.find((item: any) => String(item?.id || '') === entry.questionId) || {};
      const answer = Array.isArray(question?.answers)
        ? question.answers.find((item: any) => String(item?.id || '') === entry.answerId)
        : null;
      // docs/TODO.md §LL.2 follow-up: an embedded tag/Pair-tag question (tagKind/
      // reciprocalTagContext, not just a literal type:'tag' talk) dissolves into the Me tab as a
      // tag too. `booleanTag` distinguishes the two sub-kinds within `kind:'tag'` — a self-match
      // tag has no meaningful answer text of its own (Checked/Unchecked), while a Pair tag's
      // accepted-answer text ("sell") is the whole point and must be shown, not hidden behind a
      // boolean. See `findTagPairAncestor`'s doc comment (talk-engine.ts) for what
      // reciprocalTagContext actually encodes.
      const isTag = talkType === 'tag' || question?.tagKind === 'simple' || !!question?.reciprocalTagContext;
      const booleanTag = isTag && !question?.reciprocalTagContext;
      const prompt = String(question?.text || talk?.title || `Question ${index + 1}`).trim();
      const rawChoice = String(entry.answerText || '').trim();
      const choice = isTag
        ? booleanTag
          ? answer?.isMatch
            ? 'Checked'
            : 'Unchecked'
          : String(answer?.text || '').trim() || 'Ignored'
        : rawChoice && rawChoice.toLowerCase() !== 'ignore'
          ? rawChoice
          : String(answer?.text || '').trim() || 'Ignored';
      const contextPath = Array.isArray(question?.contextPath)
        ? question.contextPath.map((step: any, stepIndex: number) => {
            const questionId = String(step?.questionId || '').trim();
            const parentQuestion = questions.find((item: any) => String(item?.id || '') === questionId);
            const answerId = String(step?.answerId || '').trim();
            const parentAnswer = Array.isArray(parentQuestion?.answers)
              ? parentQuestion.answers.find((item: any) => String(item?.id || '') === answerId)
              : null;
            const questionText = String(parentQuestion?.text || questionId || `Q${stepIndex + 1}`).trim();
            const answerText = String(parentAnswer?.text || answerId || '?').trim();
            return `${questionText}→${answerText}`;
          })
        : [];
      const flowContextLabel = completedAnswers
        .slice(0, index)
        .map((previousEntry, stepIndex) => {
          const previousQuestion = questions.find((item: any) => String(item?.id || '') === previousEntry.questionId);
          const previousAnswer = Array.isArray(previousQuestion?.answers)
            ? previousQuestion.answers.find((item: any) => String(item?.id || '') === previousEntry.answerId)
            : null;
          const previousPrompt = String(previousQuestion?.text || `Q${stepIndex + 1}`).trim();
          const previousRawChoice = String(previousEntry.answerText || '').trim();
          const previousChoice = previousRawChoice && previousRawChoice.toLowerCase() !== 'ignore'
            ? previousRawChoice
            : String(previousAnswer?.text || '').trim() || 'Ignored';
          return `${previousPrompt}→${previousChoice}`;
        })
        .filter(Boolean)
        .join(' · ');
      const contextLabel = talkType === 'tag' || talkType === 'survey'
        ? ''
        : talkType === 'flow'
          ? flowContextLabel
          : contextPath.join(' · ');
      const contextHash = talkType === 'tag' || talkType === 'survey'
        ? ''
        : String(question?.contextHashId || '').trim();
      const questionContentId = String(question?.cidId || '').trim();
      return {
        questionId: entry.questionId,
        answerId: entry.answerId,
        prompt,
        choice,
        kind: isTag ? 'tag' : 'question',
        ...(isTag ? { booleanTag } : {}),
        contextPath,
        contextLabel,
        ...(entry.mode ? { mode: entry.mode } : {}),
        ...(contextHash ? { contextHash } : {}),
        ...(questionContentId ? { questionContentId } : {}),
      };
    });
    upsertFlatAnswerHistory({
      id: `${UIManager.getTalkContentKey(talk)}:${talkId}`,
      talkId,
      title: String(talk?.title || 'Answered Talk'),
      type: String(talk?.type || 'flow'),
      language: String(talk?.language || 'en').toLowerCase(),
      outcome,
      answeredAt: new Date().toISOString(),
      senderIds: [...new Set(senders.filter(Boolean))],
      ...(talk?.locationRadiusMiles != null ? { locationRadiusMiles: talk.locationRadiusMiles } : {}),
      items,
    });
  }

  /**
   * docs/TODO.md §LL follow-up: finds the nearest ancestor of `currentQuestion` (within the same
   * branch) that's marked `reciprocalTagContext` and ends up with exactly one answer — the sole
   * remaining source of tag/preference context for matching (the old talk-level `selfTag`/
   * `preferenceSet` root fields have been removed entirely), usable anywhere in a flow/route
   * instead of only at the root. Branch-aware for route talks (walks `currentQuestion.contextPath`,
   * root-first, so two sibling branches with unrelated reciprocal markers never bleed into each
   * other); a plain linear array-position scan for flow talks (no `contextPath` — not route type —
   * array order IS branch order there). Nearest wins when more than one qualifying ancestor exists
   * on the path.
   */
  /**
   * Every question must carry an "Ignore" answer (`TalkValidator.validateQuestion`,
   * talk-engine.ts) — so "exactly one answer" for a `reciprocalTagContext` question actually
   * means exactly one NON-ignore answer (the real way forward) plus whatever Ignore option the
   * question already has, not literally `answers.length === 1`. Returns that one real answer,
   * or undefined if there isn't exactly one.
   */
  private singleNonIgnoreAnswer(question: { answers?: any[] } | undefined): any | undefined {
    return singleNonIgnoreAnswer(question);
  }

  private findReciprocalTagAncestor(
    talk: any,
    currentQuestion: { id: string; contextPath?: Array<{ questionId: string; answerId: string }> },
  ): { questionText: string; answerText: string } | undefined {
    return findTagPairAncestor(talk, currentQuestion);
  }

  /**
   * docs/TODO.md §KK: the single derived "my own effective tag" for this exchange, plus every
   * counterpart tag context that could apply, for `buildAnswerPreferenceLookupKey`'s `tagContext`.
   *
   * Sourced entirely from the nearest Pair-tag ancestor (`findReciprocalTagAncestor` —
   * `Question.reciprocalTagContext`, docs/TODO.md §LL follow-up), the per-question generalization
   * that replaced the old talk-level `selfTag`/`preferenceSet` root fields: `isMine` (I
   * authored/self-answered this talk) uses the ancestor's own (question, answer) unreversed, same
   * as authoring; answering someone else's talk swaps them, my own tag becomes the answer text and
   * the counterpart becomes the question text. No ancestor found means no tag context applies at
   * all — `undefined` on both, same as a talk that never declares one.
   */
  private myEffectiveTagContext(
    talk: any,
    currentQuestion?: { id: string; contextPath?: Array<{ questionId: string; answerId: string }> },
  ): { mySelfTag: string | undefined; counterpartCandidates: Array<string | undefined> } {
    const isMine = !!(talk?.authorId && this.currentUser?.id && talk.authorId === this.currentUser.id);
    const ancestor = currentQuestion ? this.findReciprocalTagAncestor(talk, currentQuestion) : undefined;
    if (ancestor) {
      return isMine
        ? { mySelfTag: ancestor.questionText, counterpartCandidates: [ancestor.answerText] }
        : { mySelfTag: ancestor.answerText, counterpartCandidates: [ancestor.questionText] };
    }
    return { mySelfTag: undefined, counterpartCandidates: [undefined] };
  }

  /**
   * Prefer context-aware flat key (cross-talk + multi-question path, tag-scoped — §KK), then
   * exact-chatbot-memory, then legacy `${talkId}_${questionId}`.
   */
  private resolveAnswerPreferenceForTalkQuestion(
    talk: any,
    questionIndex: number,
    previousQAPairs: QAPair[],
    currentQuestion: {
      id: string;
      text?: string;
      answers?: any[];
      answerSelectionMode?: string;
      builtIn?: any;
      contextPath?: Array<{ questionId: string; answerId: string }>;
      reciprocalTagContext?: boolean;
    },
    talkInstanceId: string,
  ): {
    answerId: string;
    answerText: string;
    mode: string;
    questionText?: string;
    allAnswers?: any[];
    autoAnswerAction?: string;
    autoAnswerReason?: string;
    /** Spec §3.4 FR-QA-15/16, §30.8: present only when `currentQuestion.answerSelectionMode ===
     *  'multiple'` and the chatbot resolved a non-empty checked set. `answerId` above is always
     *  `answerIds[0]`, kept for callers that only look at the single-value shape. */
    answerIds?: string[];
  } | null {
    // §BB / spec §30.2: a builtIn (typed comparison) question is dispatched entirely separately
    // from the exact-text paths below — its 2 answers are app-generated placeholder text
    // ("Compatible"/"Not compatible", see TalkAutofix.fix), never something to memorize or
    // reuse via string equality. Must run BEFORE the multi-select/single-select branches so a
    // builtIn question never falls through to exact-text lookup by mistake.
    if (currentQuestion.builtIn) {
      // Same Pair-tag-ancestor derivation every other tag-context consumer uses (§LL follow-up)
      // — mySelfTag is MY OWN declared side, counterpartCandidates[0] is the incoming talk's own
      // declared side (needed for the quantity want/have direction).
      const { mySelfTag, counterpartCandidates } = this.myEffectiveTagContext(talk, currentQuestion);
      const resolution = resolveBuiltInQuestion(
        { myTag: mySelfTag, theirTag: counterpartCandidates[0], title: talk?.title },
        { builtIn: currentQuestion.builtIn, text: currentQuestion.text || '' },
        getTypedPreferenceState(),
        LOCAL_EXACT_CHATBOT_USER_ID,
      );
      if (resolution.action === 'ASK_USER') return null;
      const chosen = pickBuiltInAnswer(currentQuestion.answers, currentQuestion.id, resolution);
      if (!chosen?.id) return null;
      return {
        answerId: chosen.id,
        answerText: String(chosen.text || ''),
        mode: 'auto',
        questionText: currentQuestion.text || '',
        allAnswers: currentQuestion.answers || [],
        autoAnswerAction: 'ANSWER',
        autoAnswerReason: resolution.compatible ? 'BUILT_IN_COMPATIBLE' : 'BUILT_IN_INCOMPATIBLE',
      };
    }

    // docs/TODO.md §LL follow-up: a reciprocalTagContext question with exactly one real answer
    // has no actual decision to make — checking the box at authoring time already declared the
    // whole (question, answer) pair, mirroring how a tag-type talk's single match-answer is
    // always trivially "selectable" (§LL). Auto-proceed unconditionally rather than requiring a
    // flattened-store/exact-text memory hit — that hit would be structurally impossible for the
    // FIRST such question on a branch, whose own text differs from anything the responder has
    // ever answered before (that's the whole point of a "buy" root auto-resolving against a
    // "sell" root: the two sides never share literal text for THIS question, only downstream).
    const reciprocalOnlyAnswer = currentQuestion.reciprocalTagContext
      ? this.singleNonIgnoreAnswer(currentQuestion)
      : undefined;
    if (reciprocalOnlyAnswer) {
      const only = reciprocalOnlyAnswer;
      return {
        answerId: only.id,
        answerText: String(only.text || ''),
        mode: 'auto',
        questionText: currentQuestion.text || '',
        allAnswers: currentQuestion.answers || [],
        autoAnswerAction: 'ANSWER',
        autoAnswerReason: 'RECIPROCAL_TAG_CONTEXT',
      };
    }

    const currentOptions = (currentQuestion.answers || []).map((answer: any) => String(answer?.text || ''));
    const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
    const isMultiSelect = currentQuestion.answerSelectionMode === 'multiple';
    // docs/TODO.md §LL follow-up: findAutoAnswer/findAutoAnswerMultiple run their own
    // independent PREFERENCE_CONFLICT veto (exact-chatbot-memory.ts), separate from
    // checkIfMatch's (talk-engine.ts). Only a Pair-tag ancestor on THIS branch ever supplies a
    // preference set now (the old talk-root `preferenceSet` fallback is gone) — so the chatbot
    // can't auto-answer past a mid-tree pair-tag conflict that manual answering would veto.
    const tagPairAncestor = findTagPairAncestor(talk, currentQuestion);
    const effectivePreferenceSet: string[] | undefined = tagPairAncestor
      ? [tagPairAncestor.answerText]
      : undefined;

    // §KK: context-aware flattened lookup, tried BEFORE exact-chatbot-memory (was the reverse —
    // exact-chatbot-memory is keyed by question text alone, no context, so it used to win on any
    // hit even when the correct, context-matched flattened entry was sitting right there unused).
    // Single-select only: the flattened store has no concept of a checked set (see the
    // multi-select branch below, unchanged). Translates the stored answer back to THIS talk's
    // OWN answer id by TEXT, not by the stored `answerId` — the flattened entry may have been
    // saved under a different, independently-authored talk whose answer ids don't line up.
    if (!isMultiSelect && currentQuestion.text && currentOptions.length > 0) {
      const { mySelfTag, counterpartCandidates } = this.myEffectiveTagContext(talk, currentQuestion);
      const talkContentHash = computeTalkIdFromTalkData(talk);
      const flatMap = getFlattenedAnswerPreferences();
      // Spec §30.2/§KK zero-click follow-up: a matchThreshold route's direct-child specs are
      // independent and order-independent by construction (talk-engine.ts) — the accumulated
      // sibling-answer history that `previousQAPairs` would otherwise carry is irrelevant (and
      // actively harmful: it would make the Model spec's lookup key depend on whichever specs
      // happened to be answered before it, so two independently-authored talks walking specs in
      // a different order would never share a bucket). Always resolve these questions with an
      // empty context path, same key shape as a talk's very first question.
      const effectivePreviousQAPairs = getRouteRootChildQuestionIds(talk)?.includes(currentQuestion.id)
        ? []
        : previousQAPairs;
      for (const counterpartTag of counterpartCandidates) {
        const tagContext: TagContext = { mySelfTag, counterpartTag };
        const flatKey = buildAnswerPreferenceLookupKey(
          talk,
          talkContentHash,
          questionIndex,
          effectivePreviousQAPairs,
          currentQuestion.text,
          tagContext,
        );
        const flat = flatMap[flatKey];
        if (!flat) continue;
        const matchingAnswer = (currentQuestion.answers || []).find(
          (answer: any) => String(answer?.text || '').trim() === String(flat.answerText || '').trim(),
        );
        if (matchingAnswer?.id) {
          return {
            answerId: matchingAnswer.id,
            answerText: String(matchingAnswer.text || flat.answerText),
            mode: flat.mode === 'temporary' ? 'auto' : flat.mode,
            questionText: currentQuestion.text || '',
            allAnswers: currentQuestion.answers || [],
            autoAnswerAction: 'ANSWER',
            autoAnswerReason: 'FLATTENED_CONTEXT_MATCH',
          };
        }
      }
    }

    const exactMemory = getExactChatbotMemory();
    if (currentQuestion.text && currentOptions.length > 0 && isMultiSelect) {
      const exact = findAutoAnswerMultiple(
        exactMemory,
        LOCAL_EXACT_CHATBOT_USER_ID,
        currentQuestion.text,
        currentOptions,
        undefined,
        languageContext,
        effectivePreferenceSet,
      );
      setExactChatbotMemory(exactMemory);
      if (exact.action === 'ASK_USER' && exact.reason === 'PREFERENCE_CONFLICT') {
        return null;
      }
      if (exact.action === 'SKIP') {
        return {
          answerId: 'ignore',
          answerText: 'ignore',
          mode: 'auto',
          questionText: currentQuestion.text || '',
          allAnswers: currentQuestion.answers || [],
          autoAnswerAction: exact.action,
          autoAnswerReason: exact.reason,
        };
      }
      if (exact.action === 'ANSWER' && exact.answerIds && exact.answerIds.length > 0) {
        // exact.answerIds are content-hash ids (makeAnswerId, exact-chatbot-memory.ts) — this
        // TALK's own Answer.id fields are positional ("a_0_0", ...), a different scheme
        // entirely (same translation the single-select ANSWER branch above already does via
        // text comparison). Map each remembered text back to this talk's own answer id.
        const exactTexts = exact.answerTexts || [];
        const matchedAnswerIds: string[] = [];
        const matchedTexts: string[] = [];
        for (const answerText of exactTexts) {
          const matchingAnswer = (currentQuestion.answers || []).find((answer: any) => {
            return String(answer?.text || '').trim() === answerText;
          });
          if (matchingAnswer?.id) {
            matchedAnswerIds.push(matchingAnswer.id);
            matchedTexts.push(String(matchingAnswer.text || answerText));
          }
        }
        if (matchedAnswerIds.length > 0) {
          return {
            answerId: matchedAnswerIds[0],
            answerIds: matchedAnswerIds,
            answerText: matchedTexts.join(', '),
            mode: 'auto',
            questionText: currentQuestion.text || '',
            allAnswers: currentQuestion.answers || [],
            autoAnswerAction: exact.action,
            autoAnswerReason: exact.reason,
          };
        }
      }
      // No resolvable multi-select preference — the flattened/legacy stores below were built
      // for single-value answers and have no concept of a checked set, so a multi-select
      // question that doesn't resolve here falls straight to manual human answering (§30.4's
      // fail-safe: no stored preference → ask, never guess or partially resolve).
      return null;
    }
    if (currentQuestion.text && currentOptions.length > 0) {
      const exact = findAutoAnswer(
        exactMemory,
        LOCAL_EXACT_CHATBOT_USER_ID,
        currentQuestion.text,
        currentOptions,
        undefined,
        languageContext,
        effectivePreferenceSet,
      );
      setExactChatbotMemory(exactMemory);
      // A preference-set conflict is an absolute veto — do not fall through to the weaker
      // flattened/legacy preference lookups below, which aren't preference-aware and could
      // otherwise resolve an answer via stale per-talk-instance history.
      if (exact.action === 'ASK_USER' && exact.reason === 'PREFERENCE_CONFLICT') {
        return null;
      }
      if (exact.action === 'SKIP') {
        return {
          answerId: 'ignore',
          answerText: 'ignore',
          mode: 'auto',
          questionText: currentQuestion.text || '',
          allAnswers: currentQuestion.answers || [],
          autoAnswerAction: exact.action,
          autoAnswerReason: exact.reason,
        };
      }
      if (exact.action === 'ANSWER' && exact.answerText) {
        const matchingAnswer = (currentQuestion.answers || []).find((answer: any) => {
          return String(answer?.text || '').trim() === exact.answerText;
        });
        if (matchingAnswer?.id) {
          return {
            answerId: matchingAnswer.id,
            answerText: String(matchingAnswer.text || exact.answerText),
            mode: 'auto',
            questionText: currentQuestion.text || '',
            allAnswers: currentQuestion.answers || [],
            autoAnswerAction: exact.action,
            autoAnswerReason: exact.reason,
          };
        }
      }
    }

    // Last resort: resume MY OWN prior answer to this exact talk instance (same id namespace,
    // no translation needed) — the §KK flattened lookup above already covers the cross-talk case.
    const preferences = getAnswerPreferences();
    const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
    return preferences[legacyKey] || null;
  }

  private saveAnswerPreference(
    talk: any,
    talkInstanceId: string,
    currentQuestion: { id: string; text?: string; answers?: any[]; contextPath?: Array<{ questionId: string; answerId: string }> },
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode: 'auto' | 'manual' | 'permanent' | 'suppressed' = 'auto',
  ): void {
    const exactMemory = getExactChatbotMemory();
    const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
    // The selfTag to persist alongside this answer is always MY OWN effective tag for this
    // deal, derived from the nearest Pair-tag ancestor (`myEffectiveTagContext`, §LL follow-up)
    // — this lets findAutoAnswer/getSelfTagForQuestionText later veto a preference mismatch
    // without every call site here having to know or pass that distinction explicitly. §KK:
    // also drives the flattened-store write below.
    const { mySelfTag, counterpartCandidates } = this.myEffectiveTagContext(talk, currentQuestion);
    if (currentQuestion.text) {
      if (mode === 'suppressed') {
        saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, undefined, languageContext);
      } else if (mode === 'permanent') {
        savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext, mySelfTag);
      } else if (mode === 'auto') {
        saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext, mySelfTag);
      }
      setExactChatbotMemory(exactMemory);
    }

    const preferences = getAnswerPreferences();
    const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
    const talkContentHash = computeTalkIdFromTalkData(talk);
    const qIndex = Math.max(
      0,
      talk.questions?.findIndex((q: { id: string }) => q.id === currentQuestion.id) ?? 0,
    );
    // Mirrors the read-side override in `resolveAnswerPreferenceForTalkQuestion` — a
    // matchThreshold route's direct-child specs are independent, so their save key must not
    // depend on whichever sibling specs happened to be saved earlier in this loop.
    const previous = getRouteRootChildQuestionIds(talk)?.includes(currentQuestion.id)
      ? []
      : sessionAnswersToQAPairs(talk, fullSessionAnswersIncludingCurrent.slice(0, -1));

    // §KK: write the same answer under one flattened-key bucket per counterpart-tag candidate
    // `myEffectiveTagContext` returns — today that's always at most one (the nearest Pair-tag
    // ancestor's own counterpart), but the fan-out shape is kept in case a future context source
    // ever yields more than one candidate.
    const primaryFlatKey = buildAnswerPreferenceLookupKey(
      talk,
      talkContentHash,
      qIndex,
      previous,
      currentQuestion.text || '',
      { mySelfTag, counterpartTag: counterpartCandidates[0] },
    );

    const entry = {
      answerId,
      answerText,
      mode: mode === 'auto' ? 'temporary' : mode,
      language: languageContext.language,
      talkId: talkInstanceId,
      questionText: currentQuestion.text || '',
      allAnswers: currentQuestion.answers || [],
      timestamp: new Date().toISOString(),
      flatKey: primaryFlatKey,
    };

    preferences[legacyKey] = entry;
    setAnswerPreferences(preferences);

    const flatMap = getFlattenedAnswerPreferences();
    for (const counterpartTag of counterpartCandidates) {
      const flatKey = buildAnswerPreferenceLookupKey(
        talk,
        talkContentHash,
        qIndex,
        previous,
        currentQuestion.text || '',
        { mySelfTag, counterpartTag },
      );
      flatMap[flatKey] = { ...entry, flatKey };
    }
    setFlattenedAnswerPreferences(flatMap);
    console.log('💾 Saved answer (exact + flat + legacy):', primaryFlatKey, answerText, mode);
  }

  /** Snapshot for syncing encrypted/auto answers to Gun (Phase 2). */
  getAnswerPreferencesSnapshot(): Record<
    string,
    {
      answerId: string;
      answerText: string;
      mode: string;
      talkId?: string;
      questionText?: string;
      allAnswers?: any[];
      timestamp?: string;
    }
  > {
    return getAnswerPreferences();
  }

  /**
   * Build a full answer list for Gun chatbot reply when the same talk id or content hash
   * has no template but each step has a matching auto preference (any talk with same path).
   */
  tryBuildChatbotAnswersFromFlattened(
    talkData: any,
  ): Array<{ questionId: string; answerId: string; answerText: string; mode?: string; answerIds?: string[] }> | null {
    const questions = talkData?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const out: Array<{ questionId: string; answerId: string; answerText: string; mode?: string; answerIds?: string[] }> =
      [];
    const pairs: QAPair[] = [];
    const gunId = talkData.id || '';

    // Spec §30.2/§KK zero-click follow-up: a matchThreshold route has no single "self-answer"
    // for its root (the root's whole point is 3+ parallel specs at once, not one chosen path —
    // matchThreshold mode never asks the respondent to answer it either, see
    // `getRouteRootChildQuestionIds`/talk-response-dialog.ts's multi-branch walk). Resolve only
    // the root's direct-child specs, each independently (no accumulated sibling context —
    // enforced inside `resolveAnswerPreferenceForTalkQuestion`), and skip the root entirely.
    // `checkIfMatch`'s route branch (`computeRouteMatchScore`) only ever reads answers for
    // recognized child-spec ids, so an answer set with no root entry is already exactly the
    // shape it expects.
    const routeChildIds = getRouteRootChildQuestionIds(talkData);
    if (routeChildIds) {
      for (const childId of routeChildIds) {
        const q = questions.find((qq: any) => qq.id === childId);
        if (!q) return null;
        const pref = this.resolveAnswerPreferenceForTalkQuestion(talkData, questions.indexOf(q), [], q, gunId);
        if (!pref || pref.mode !== 'auto') return null;
        if (pref.answerId === 'ignore') return null;
        const ans = q.answers?.find((a: { id: string }) => a.id === pref.answerId);
        if (!ans) return null;
        out.push({
          questionId: q.id,
          answerId: pref.answerId,
          answerText: pref.answerText,
          mode: 'auto',
        });
      }
      return out;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const pref = this.resolveAnswerPreferenceForTalkQuestion(talkData, i, pairs, q, gunId);
      if (!pref || pref.mode !== 'auto') return null;
      if (pref.answerId === 'ignore') return null;
      if (pref.answerIds && pref.answerIds.length > 0) {
        // Spec §3.4 FR-QA-15/16, §30.8: every checked id must be a real option on this
        // question — same fail-safe spirit as the single-value lookup below.
        const allValid = pref.answerIds.every((id) => q.answers?.some((a: { id: string }) => a.id === id));
        if (!allValid) return null;
        out.push({
          questionId: q.id,
          answerId: pref.answerId,
          answerIds: pref.answerIds,
          answerText: pref.answerText,
          mode: 'auto',
        });
        // docs/TODO.md §LL follow-up: mirrors `sessionAnswersToQAPairs`'s own exclusion — a
        // Pair-tag question's (text, answer) differs by construction between independently-
        // authored talks, so it's kept out of the path every later question's flattened lookup
        // key is built from (see that function's doc comment for the full reasoning).
        if (!q.reciprocalTagContext) {
          pairs.push({
            questionText: (q.text || '').trim(),
            answerText: (pref.answerText || '').trim(),
          });
        }
        continue;
      }
      const ans = q.answers?.find((a: { id: string }) => a.id === pref.answerId);
      if (!ans) return null;
      out.push({
        questionId: q.id,
        answerId: pref.answerId,
        answerText: pref.answerText,
        mode: 'auto',
      });
      if (!q.reciprocalTagContext) {
        pairs.push({
          questionText: (q.text || '').trim(),
          answerText: (pref.answerText || '').trim(),
        });
      }
    }
    return out;
  }

  /**
   * Called by app when user completes a talk: save each question-answer to myQuestionAnswers (keyed by question text; last wins).
   */
  saveQuestionAnswersFromCompletion(
    talkData: { questions?: Array<{ id: string; text?: string }> },
    answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
    location?: { latitude: number; longitude: number },
  ): void {
    const locationStr = location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : undefined;
    const timestamp = new Date().toISOString();
    const questions = talkData.questions || [];
    for (const a of answers) {
      const q = questions.find((qu: any) => qu.id === a.questionId);
      const questionText = q?.text?.trim() || '';
      if (!questionText) continue;
      const key = normalizeQuestionKey(questionText);
      const isIgnored = a.answerText === 'ignore' || !a.answerText;
      const entry: MyQuestionAnswerEntry = {
        questionText,
        answerId: a.answerId,
        answerText: isIgnored ? '' : (a.answerText || ''),
        isIgnored,
        timestamp,
      };
      if (locationStr != null) entry.location = locationStr;
      setMyQuestionAnswer(key, entry);
    }
    const meView = document.getElementById('me-view');
    if (meView?.classList.contains('active')) {
      this.displayAnswersList();
    }
  }

  showPreferencesDialog(): void {
    openPreferencesDialog({
      getPreferences: () => ({
        ...getAnswerPreferences(),
        ...getFlattenedAnswerPreferences(),
      }),
      escapeHtml: escapeHtml,
      updateAnswer: (key, answerId, answerText) => {
        if (key.startsWith('flat_')) {
          const prefs = getFlattenedAnswerPreferences();
          if (!prefs[key]) return;
          prefs[key].answerId = answerId;
          prefs[key].answerText = answerText;
          prefs[key].timestamp = new Date().toISOString();
          setFlattenedAnswerPreferences(prefs);
          this.applyPreferenceModeToExactMemory(prefs[key], this.normalizePreferenceMode(prefs[key].mode));
        } else {
          const prefs = getAnswerPreferences();
          if (!prefs[key]) return;
          prefs[key].answerId = answerId;
          prefs[key].answerText = answerText;
          prefs[key].timestamp = new Date().toISOString();
          setAnswerPreferences(prefs);
          this.applyPreferenceModeToExactMemory(prefs[key], this.normalizePreferenceMode(prefs[key].mode));
        }
        this.showNotification(this.t('preferencesAnswerUpdated'), 'success');
      },
      updateMode: (key, mode) => {
        const prefs: AnswerPreferenceMap = key.startsWith('flat_')
          ? getFlattenedAnswerPreferences()
          : getAnswerPreferences();
        if (!prefs[key]) return;
        prefs[key].mode = mode;
        prefs[key].timestamp = new Date().toISOString();
        if (key.startsWith('flat_')) {
          setFlattenedAnswerPreferences(prefs);
        } else {
          setAnswerPreferences(prefs);
        }
        this.applyPreferenceModeToExactMemory(prefs[key], mode);
        const noticeKey: Record<AnswerPreferenceUiMode, UiTranslationKey> = {
          manual: 'preferencesModeChangedManual',
          temporary: 'preferencesModeChangedTemporary',
          permanent: 'preferencesModeChangedPermanent',
          suppressed: 'preferencesModeChangedSuppressed',
        };
        this.showNotification(this.t(noticeKey[mode]), 'success');
      },
      deletePreference: (key) => {
        this.deleteAnswerPreference(key);
        this.showNotification(this.t('preferencesAnswerDeleted'), 'success');
      },
      clearAll: () => {
        clearAnswerPreferences();
        this.showNotification(this.t('preferencesAnswersCleared'), 'success');
      },
      notify: this.showNotification.bind(this),
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
    });
  }

  private normalizePreferenceMode(mode: string): AnswerPreferenceUiMode {
    if (mode === 'auto' || mode === 'temporary') return 'temporary';
    if (mode === 'permanent' || mode === 'suppressed') return mode;
    return 'manual';
  }

  private applyPreferenceModeToExactMemory(pref: AnswerPreferenceEntry, mode: AnswerPreferenceUiMode): void {
    const questionText = String(pref.questionText || '').trim();
    if (!questionText) return;
    const exactMemory = getExactChatbotMemory();
    const language = String(pref.language || 'en').toLowerCase();
    if (mode === 'manual') {
      const userMemory = exactMemory.users[LOCAL_EXACT_CHATBOT_USER_ID];
      if (userMemory) {
        delete userMemory[makeQuestionId(questionText, { language })];
        if (language === 'en') delete userMemory[makeQuestionId(questionText)];
      }
    } else if (mode === 'suppressed') {
      saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, questionText, undefined, { language });
    } else if (mode === 'permanent') {
      savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, questionText, pref.answerText, undefined, { language });
    } else {
      saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, questionText, pref.answerText, undefined, { language });
    }
    setExactChatbotMemory(exactMemory);
  }

  private deleteAnswerPreference(key: string): void {
    if (key.startsWith('flat_')) {
      const flat = getFlattenedAnswerPreferences();
      const pref = flat[key];
      delete flat[key];
      setFlattenedAnswerPreferences(flat);
      if (pref) this.applyPreferenceModeToExactMemory(pref, 'manual');
      return;
    }
    const preferences = getAnswerPreferences();
    const pref = preferences[key];
    delete preferences[key];
    setAnswerPreferences(preferences);
    if (pref) this.applyPreferenceModeToExactMemory(pref, 'manual');
  }

  // ============================================
  // MY TALKS MANAGEMENT
  // ============================================

  private saveMyTalk(talkData: MyTalkEntry): void {
    const myTalks = getMyTalks();
    const existing = myTalks[talkData.talkId];
    const full = talkData.fullTalk;
    myTalks[talkData.talkId] = {
      ...existing,
      ...talkData,
      disabled: talkData.disabled ?? existing?.disabled ?? false,
      expiresAt: existing?.expiresAt ?? full?.expiresAt ?? undefined,
      locationRadiusMiles: existing?.locationRadiusMiles ?? full?.locationRadiusMiles ?? undefined,
      senders: talkData.senders ?? existing?.senders ?? undefined,
      lastInteraction: new Date().toISOString(),
    };
    setMyTalks(myTalks);

    // Refresh talks list if currently viewing Talks tab
    const talksView = document.getElementById('talks-view');
    if (talksView && talksView.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  /** OUT talks eligible for the next broadcast in the current room (respects send history). */
  getPendingBroadcastTalkIds(): string[] {
    const fromDom = Array.from(
      document.querySelectorAll('#chatroom-members-list .chatroom-member-item[data-user-id]'),
    ).map((el) => (el as HTMLElement).dataset.userId || '');
    const receiverIds = [...this.currentChatroomMembers.map((m) => m.userId), ...fromDom]
      .map((id) => String(id || '').trim())
      .filter((id) => !!id && id !== this.currentUserId);
    return this.getUnsentBroadcastTalkIds(this.currentChatroom, [...new Set(receiverIds)]);
  }

  /** Talks that can be included in broadcast: created or copied, not disabled, and not expired */
  getBroadcastableTalkIds(): string[] {
    const myTalks = getMyTalks();
    const now = Date.now();
    return Object.entries(myTalks)
      .filter(([, t]: [string, any]) => {
        if (t?.disabled) return false;
        if (t?.role !== 'created' && t?.role !== 'copied') return false;
        const expiresAt = resolveExpiresAtMs(t?.expiresAt ?? t?.fullTalk?.expiresAt);
        if (Number.isFinite(expiresAt) && now > expiresAt) return false;
        return true;
      })
      .map(([id]) => id);
  }

  /** OUT talks omitted from broadcast/peer send because they are disabled or expired. */
  getSenderOmittedBroadcastPreviews(): BroadcastAudiencePreview[] {
    const myTalks = getMyTalks();
    const now = Date.now();
    const previews: BroadcastAudiencePreview[] = [];
    for (const [talkId, talk] of Object.entries(myTalks)) {
      if (talk?.role !== 'created' && talk?.role !== 'copied') continue;
      const omittedBy: string[] = [];
      if (talk?.disabled) omittedBy.push('broadcast_disabled');
      const expiresAt = talk?.expiresAt ?? talk?.fullTalk?.expiresAt;
      const expiresAtMs = resolveExpiresAtMs(expiresAt);
      if (Number.isFinite(expiresAtMs) && now > expiresAtMs) omittedBy.push('talk_expired');
      if (omittedBy.length === 0) continue;
      previews.push({
        talkId,
        title: String(talk?.title || talk?.fullTalk?.title || talkId),
        totalCandidates: 0,
        eligibleReceivers: 0,
        rejectedByCounts: Object.fromEntries(omittedBy.map((reason) => [reason, 1])),
        senderOmittedBy: omittedBy,
      });
    }
    return previews.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Full talk from OUT/myTalks when Gun `getTalk` is slow — bulk broadcast still needs a local payload.
   */
  getBroadcastTalkPayload(talkId: string): any | null {
    const myTalks = getMyTalks();
    const row = myTalks[talkId];
    // docs/TODO.md §Y1: broadcasting a copied-but-unedited talk keeps the original sender as
    // authorId — copying isn't authorship.
    const full = row?.fullTalk;
    if (!full) return null;
    // Tag talks have no questions; non-tag talks require at least one question
    if (full.type !== 'tag' && (!Array.isArray(full.questions) || full.questions.length === 0)) return null;
    return full;
  }

  /**
   * Called by app after a talk is created: saves to myTalks and user's answer list (answerPreferences).
   */
  saveCreatedTalk(
    talk: { id: string; title: string; type: string; questions: any[]; language?: string; expiresAt?: number | null; locationRadiusMiles?: number | null },
    options: { selfAnswers: { questionId: string; answerId: string }[] },
  ): void {
    const myTalks = getMyTalks();
    const uncheckedTag = talk.type === 'tag' && options.selfAnswers.some((answer) => answer.answerId === 'ignore' || answer.answerId.includes('ignore'));
    myTalks[talk.id] = {
      ...myTalks[talk.id],
      talkId: talk.id,
      title: talk.title,
      type: talk.type,
      language: talk.language || 'en',
      timestamp: new Date().toISOString(),
      role: 'created',
      fullTalk: talk,
      disabled: uncheckedTag,
      expiresAt: talk.expiresAt ?? undefined,
      locationRadiusMiles: talk.locationRadiusMiles ?? undefined,
      lastInteraction: new Date().toISOString(),
    };
    setMyTalks(myTalks);

    // Save self-answers to answer preferences (user's answer list) for chatbot/auto-reply
    const acc: Array<{ questionId: string; answerText?: string }> = [];
    const completedAnswers: Array<{ questionId: string; answerId: string; answerText?: string; mode?: string }> = [];
    let hasMatchAnswer = false;
    for (const { questionId, answerId } of options.selfAnswers) {
      const q = talk.questions?.find((qu: any) => qu.id === questionId);
      if (!q) continue;
      const a = q.answers?.find((an: any) => an.id === answerId);
      if (!a) continue;
      acc.push({ questionId, answerText: a.text });
      completedAnswers.push({
        questionId,
        answerId,
        answerText: a.text || '',
        mode: 'manual',
      });
      if (a.isMatch === true) hasMatchAnswer = true;
      this.saveAnswerPreference(talk, talk.id, q, a.id, a.text || '', acc, 'auto');
    }
    if (completedAnswers.length > 0) {
      this.saveQuestionAnswersFromCompletion(talk, completedAnswers);
      this.saveFlatAnswerHistoryRecord(talk.id, talk, completedAnswers, hasMatchAnswer ? 'match' : 'mismatch', []);
    }

    const talksView = document.getElementById('talks-view');
    if (talksView?.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  getChatbotTemplate(talkId: string): { answers: any[]; talkData: any } | null {
    return loadChatbotTemplate(talkId);
  }

  /**
   * My own self-tag (see `ChatbotQuestionSummary.selfTag`, exact-chatbot-memory.ts) recorded
   * for this exact question text, if any — lets app.ts resolve `responderSelfTag` for
   * `checkIfMatch`'s Pair-tag-ancestor veto on the manual answering path (the chatbot's own
   * auto-reply path already vetoes internally via findAutoAnswer, see
   * resolveAnswerPreferenceForTalkQuestion above).
   */
  getMySelfTagForQuestionText(questionText: string, language?: string): string | undefined {
    if (!questionText) return undefined;
    return getSelfTagForQuestionText(getExactChatbotMemory(), LOCAL_EXACT_CHATBOT_USER_ID, questionText, {
      language: String(language || 'en').toLowerCase(),
    });
  }

  saveChatbotTemplate(talkId: string, data: { answers: any[]; talkData: any }): void {
    storeChatbotTemplate(talkId, data);
  }

  getCopyTalkAutoSave(): boolean {
    return getCopyTalkAutoSave();
  }

  setCopyTalkAutoSave(enabled: boolean): void {
    setCopyTalkAutoSave(enabled);
  }

  getChatbotEnabled(): boolean {
    return getChatbotEnabled();
  }

  setChatbotEnabled(enabled: boolean): void {
    setChatbotEnabled(enabled);
  }

  /**
   * Sets whether a talk is disabled for broadcast.
   * When disabled (checkbox checked), the talk is excluded from getBroadcastableTalkIds()
   * and will not be sent to anyone when broadcasting.
   */
  setTalkDisabled(talkId: string, disabled: boolean): void {
    const myTalks = getMyTalks();
    if (!myTalks[talkId]) return;
    myTalks[talkId].disabled = !!disabled;
    setMyTalks(myTalks);
    // Phase F: disabling broadcast = withdrawing the talk from active delivery
    if (disabled) {
      this.emit('withdrawTalk', { talkId });
      // Step 10: tag-uncheck is a hard retraction — flood the tombstone so responders
      // learn the talk is gone even if they are offline at this moment.
      this.emit('retractTalk', { talkId, retractedAt: Date.now() });
    }
    // Patch visible rows so checkboxes stay in DOM and keep responding (no full list re-render)
    const talksList = document.getElementById('talks-list');
    const rows = talksList?.querySelectorAll(`.talk-list-item[data-talk-id="${talkId}"]`);
    if (rows && rows.length > 0) {
      rows.forEach((row) => {
        const item = row as HTMLElement;
        item.classList.toggle('talk-broadcast-disabled', !!disabled);
        item.classList.toggle('talk-broadcast-enabled', !disabled);
        const checkbox = row.querySelector('.talk-broadcast-toggle-checkbox') as HTMLInputElement | null;
        if (checkbox) checkbox.checked = !disabled;
        const badge = checkbox?.closest('.talk-icon-badge') as HTMLElement | null;
        if (badge) badge.title = disabled ? this.t('talksBroadcastOff') : this.t('talksBroadcastOn');
      });
    } else {
      this.displayTalksList();
    }
  }

  /**
   * docs/TODO.md §V — after a content edit mints a new talk (`supersedesTalkId` points at
   * `predecessorTalkId`), retire the predecessor per the user's preference: deleted by
   * default, or kept-but-disabled for advanced users who opted in via Settings. Reuses the
   * existing delete/disable machinery verbatim rather than a parallel implementation —
   * `deleteMyTalk` already handles `answeredByContent` cleanup and the withdrawal-ledger
   * emit; `setTalkDisabled` already handles the hard-retraction tombstone flood.
   */
  applyTalkRevisionPolicy(predecessorTalkId: string): void {
    if (getKeepOldTalkOnEdit()) {
      this.setTalkDisabled(predecessorTalkId, true);
    } else {
      this.deleteMyTalk(predecessorTalkId);
    }
  }

  showMyTalksDialog(): void {
    openMyTalksDialog({
      getMyTalks,
      escapeHtml: escapeHtml,
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
      formatType: this.formatTalkType.bind(this),
      onDeleteTalk: (talkId) => {
        this.deleteMyTalk(talkId);
        this.showNotification(this.t('myTalksRemoved'), 'success');
      },
      onToggleBroadcast: (talkId, disabled) => {
        this.setTalkDisabled(talkId, disabled);
      },
      onOpenTalk: (talkId) => {
        this.showTalkDetail(talkId);
      },
      onClearAll: () => {
        clearMyTalks();
        this.showNotification(this.t('myTalksCleared'), 'success');
      },
    });
  }

  private deleteMyTalk(talkId: string): void {
    const myTalks = deleteMyTalkEntry(talkId);
    if (!(talkId in myTalks) && Object.keys(myTalks).length === 0) {
      // already absent; continue to clear answered-by-content links if present
    }
    const answeredByContent = getAnsweredTalkByContent();
    for (const [key, id] of Object.entries(answeredByContent)) {
      if (id === talkId) {
        delete answeredByContent[key];
        setAnsweredTalkByContent(answeredByContent);
        break;
      }
    }
    this.displayTalksList();
    this.displayAnswersList();
    this.showNotification(this.t('talksRemovedFromList'), 'success');
    // Phase F: notify ledger of withdrawal so peers stop routing this talk
    this.emit('withdrawTalk', { talkId });
    // Step 10: hard retraction — flood talk-retracted frame to all holders.
    // retractTalk carries retractedAt so the responder can order the tombstone.
    this.emit('retractTalk', { talkId, retractedAt: Date.now() });
  }

  setNotificationsSuppressedForE2e(suppressed: boolean): void {
    this.notificationsSuppressedForE2e = suppressed;
    if (suppressed) {
      document.querySelectorAll('.notification').forEach((el) => el.remove());
    }
  }

  showNotification(
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'info',
    options?: { persistent?: boolean; conversationId?: string; contentFilter?: string; peerId?: string; peerName?: string; retry?: () => void; safetyToast?: 'pre-send' | 'post-match' },
  ): void {
    if (this.notificationsSuppressedForE2e) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    // Content-filter toasts (redesign §9) carry a marker so E2E can assert the
    // send/receive block without matching on translated text.
    if (options?.contentFilter) {
      notification.dataset.contentFilterNotification = options.contentFilter;
    }
    // FR-FIN-1 safety-reminder toasts (TODO §CC): marker so E2E can assert the
    // once-per-day cooldown without matching on translated text.
    if (options?.safetyToast) {
      notification.dataset.safetyToast = options.safetyToast;
    }

    // Match! notices keep their marker attribute (E2E asserts on it) but are no longer
    // durable: every toast auto-dismisses — Match! after 8s, everything else after 3s
    // (redesign §4, rule G1). `options.persistent` stays as a caller override for the
    // marker only — e.g. the "can now chat" banner starts with the Match! prefix but is
    // an ordinary toast.
    const isMatchNotification =
      options?.persistent ??
      (message.startsWith(this.t('talksMatchNoticePrefix')) ||
        message === this.t('responseMatch') ||
        message === this.t('responseMatchAuto'));
    if (isMatchNotification) {
      notification.dataset.matchNotification = 'true';
    }
    // All toasts are click-to-dismiss; a Match! toast with a conversation navigates to it
    // on click (rule N6). A DM-arrival toast (TODO §N1) navigates through the graph-node
    // dispatcher's 'person' destination instead — the same "land on ⟨Conv⟩ with ⟨User⟩
    // underneath" convention every other click-to-a-person surface uses (N2a), so N2/N3/O
    // can all reuse this one settled destination rather than each picking their own. A
    // retry-capable toast (TODO §P) re-attempts the failed lookup on click instead of just
    // dismissing — real recovery, not a copy that promises retry it doesn't perform.
    notification.style.cursor = 'pointer';
    if (options?.retry) notification.dataset.retryable = 'true';
    notification.addEventListener('click', () => {
      if (document.body.contains(notification)) document.body.removeChild(notification);
      if (isMatchNotification && options?.conversationId) {
        this.showConversationDetail(options.conversationId);
      } else if (options?.peerId) {
        this.navigateToGraphNode({ type: 'person', id: options.peerId, name: options.peerName || '' });
      } else if (options?.retry) {
        options.retry();
      }
    });

    document.body.appendChild(notification);

    const hideAfter = isMatchNotification
      ? 8000
      : message === this.t('chatroomNoTalksToBroadcast')
        ? 10000
        : options?.retry
          ? 8000
          : 3000;
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, hideAfter);
  }

  /** Offer the most specific privacy-safe location room without moving the user implicitly. */
  showLocationRoomSuggestion(roomName: string, onJoin: () => void): void {
    document.getElementById('location-room-suggestion')?.remove();
    const host = document.getElementById('chatroom-list-container');
    if (!host) return;
    const banner = document.createElement('div');
    banner.id = 'location-room-suggestion';
    banner.className = 'location-room-suggestion';
    banner.innerHTML = `
      <span>${escapeHtml(this.tf('locationSuggestedRoom', { room: roomName }))}</span>
      <button type="button" data-action="join">${escapeHtml(this.t('locationSuggestedRoomJoin'))}</button>
      <button type="button" data-action="dismiss" aria-label="Dismiss">×</button>`;
    banner.querySelector<HTMLButtonElement>('[data-action="join"]')?.addEventListener('click', () => {
      banner.remove();
      onJoin();
    });
    banner.querySelector<HTMLButtonElement>('[data-action="dismiss"]')?.addEventListener('click', () => banner.remove());
    host.prepend(banner);
  }

  showSystemAnnouncement(announcement: { id: string; text: string }): void {
    const dismissedKey = `iinpublic_dismissed_announcement:${announcement.id}`;
    if (localStorage.getItem(dismissedKey) || document.getElementById(`system-announcement-${announcement.id}`)) return;
    const host = document.getElementById('chatroom-list-container');
    if (!host) return;
    let list = document.getElementById('system-announcements');
    if (!list) {
      list = document.createElement('div');
      list.id = 'system-announcements';
      list.className = 'system-announcements';
      host.prepend(list);
    }
    const banner = document.createElement('div');
    banner.id = `system-announcement-${announcement.id}`;
    banner.className = 'system-announcement';
    const text = document.createElement('span');
    text.textContent = announcement.text;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss announcement');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => {
      localStorage.setItem(dismissedKey, '1');
      banner.remove();
      if (!list?.children.length) list.remove();
    });
    banner.append(text, dismiss);
    list.append(banner);
  }

  /** Best-effort OS sniff for the app-download banner; unmatched UAs fall through to null (no dead link). */
  private detectDownloadPlatform(): 'mac' | 'windows' | 'linux' | 'android' | 'ios' | null {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Win(dows)?(NT)?/i.test(ua)) return 'windows';
    // iPadOS 13+ reports as Mac Safari but exposes touch points.
    if (/Mac/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
    if (/Mac/i.test(ua)) return 'mac';
    if (/Linux|X11/i.test(ua)) return 'linux';
    return null;
  }

  /**
   * §19.2: a plain browser tab pointed at the relay hub is a first-class client, not just an
   * app-download landing page — but we still want to point desktop-capable visitors at the
   * native app when one exists. Skipped entirely inside the packaged Electron shell, which
   * reports 'Electron' in its UA.
   */
  async renderAppDownloadBanner(): Promise<void> {
    const nativeHost = (window as unknown as {
      iinpublicNative?: { version?: string; platform?: string };
    }).iinpublicNative;
    const nativePlatform = new URLSearchParams(window.location.search).get('native_platform');
    // Electron identifies itself through both its preload bridge and UA. Mobile shells use a
    // query marker because their UI is served by the embedded loopback node inside a WebView.
    // Neither is a web-version visitor and neither should be invited to download itself.
    if (nativeHost?.platform || nativePlatform || /Electron/i.test(navigator.userAgent || '')) return;
    if (sessionStorage.getItem('iinpublic_dismissed_app_download_banner')) return;
    const shell = document.querySelector('.app-container');
    if (!shell || document.getElementById('app-download-banner')) return;

    const platform = this.detectDownloadPlatform();
    let downloadUrl: string | null = null;
    if (platform && this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/downloads`, { cache: 'no-store' });
        if (res.ok) {
          const manifest = (await res.json()) as Record<string, string | null>;
          downloadUrl = manifest[platform] || null;
        }
      } catch {
        // Offline/unreachable API — banner still renders with the "unavailable" state below.
      }
    }

    const platformLabel = platform === 'mac'
      ? 'Mac'
      : platform === 'windows'
        ? 'Windows'
        : platform === 'linux'
          ? 'Linux'
          : platform === 'android'
            ? 'Android'
            : platform === 'ios'
              ? 'iPhone/iPad'
              : '';
    const banner = document.createElement('div');
    banner.id = 'app-download-banner';
    banner.className = 'app-download-banner';
    banner.innerHTML = `
      <span class="app-download-banner-text">${escapeHtml(this.t('appDownloadBannerText'))}</span>
      ${downloadUrl
        ? `<a class="app-download-banner-link" href="${escapeHtml(downloadUrl)}" download>${escapeHtml(this.tf('appDownloadBannerGetApp', { platform: platformLabel }))}</a>`
        : `<span class="app-download-banner-muted">${escapeHtml(this.t('appDownloadBannerUnavailable'))}</span>`}
      <button type="button" class="app-download-banner-dismiss" aria-label="${escapeHtml(this.t('appDownloadBannerDismiss'))}">×</button>`;
    banner.querySelector('.app-download-banner-dismiss')?.addEventListener('click', () => {
      sessionStorage.setItem('iinpublic_dismissed_app_download_banner', '1');
      banner.remove();
    });
    shell.prepend(banner);
  }

  private dismissMatchNotifications(): void {
    document.querySelectorAll('.notification[data-match-notification="true"]').forEach((el) => {
      if (document.body.contains(el)) document.body.removeChild(el);
    });
  }

  showTalkCompletion(_conversationId: string, outcome: string): void {
    const localizedOutcome = outcome === 'match'
      ? this.t('peerMatch')
      : outcome === 'mismatch'
        ? this.t('peerMismatch')
        : outcome;
    this.showNotification(this.tf('talksCompletedOutcome', { outcome: localizedOutcome }), 'success');
  }

  showLinearCaptureInterface(_conversationId: string, _capture: any): void {
    this.showNotification(this.t('talksAutoCaptured'), 'info');
  }

  refreshTalksList(): void {
    // Placeholder for refreshing talks list
  }

  displayChatroomMessage(message: {
    id: string;
    text: string;
    senderName: string;
    timestamp: string;
    isOwnMessage: boolean;
  }): void {
    const messagesContainer = document.getElementById('messages-container');
    if (!messagesContainer) return;

    // Check if message already exists to avoid duplicates
    if (document.getElementById(`msg-${message.id}`)) {
      return;
    }

    // Clear welcome message if it exists
    const welcomeMsg = messagesContainer.querySelector('.text-center.p-20');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    const messageTime = new Date(message.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const messageDiv = document.createElement('div');
    messageDiv.id = `msg-${message.id}`;
    messageDiv.className = `message ${message.isOwnMessage ? 'sent' : ''}`;
    messageDiv.innerHTML = `
      <div class="message-bubble">
        ${!message.isOwnMessage ? `<div style="font-weight: bold; font-size: 0.85em; margin-bottom: 4px; color: var(--accent);">${escapeHtml(message.senderName)}</div>` : ''}
        <div>${escapeHtml(message.text)}</div>
        <div class="message-time">${messageTime}</div>
      </div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showTalkEditorDialog(existingTalk?: any): void {
    // Reset the route DAG editor's in-memory model on every open — it's a field on this
    // (singleton) instance, not scoped to one dialog session, so without this a second route
    // talk created back-to-back (or an edit opened right after an unrelated route create)
    // would silently inherit the previous session's leftover question tree instead of either
    // a fresh root (`ensureRouteEditorRendered` only reseeds when this array is empty) or the
    // one actually being edited.
    this.routeEditorQuestions = [];
    openTalkEditorDialog({
      existingTalk,
      currentUserId: this.currentUserId,
      text: this.t.bind(this),
      escapeHtml: escapeHtml,
      getAnswerPreferences,
      addQuestionToForm: (index, container) =>
        addTalkEditorQuestionToForm(index, container, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
          text: this.t.bind(this),
        }),
      addAnswerToQuestion: (container, index) =>
        addTalkEditorAnswerToQuestion(container, index, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
          text: this.t.bind(this),
        }),
      appendIgnoreRow: (container, index) => appendTalkEditorIgnoreRow(container, index, {
        refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
        processTalkForm: this.processTalkForm.bind(this),
        text: this.t.bind(this),
      }),
      applyBuiltInKindToQuestion,
      applyTagKindVisibilityToQuestion,
      updateAllAnswerDropdowns: this.updateAllAnswerDropdowns.bind(this),
      refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
      ensureRouteEditorRendered: this.ensureRouteEditorRendered.bind(this),
      setupTalkFormHandlers: (modal) =>
        setupTalkEditorFormHandlers(modal, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
          text: this.t.bind(this),
        }),
    });
  }

  private updateAllAnswerDropdowns(): void {
    updateTalkEditorAnswerDropdowns({
      refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
      processTalkForm: this.processTalkForm.bind(this),
      text: this.t.bind(this),
    });
  }

  private processTalkForm(form: HTMLFormElement): boolean {
    const title = (document.getElementById('talk-title') as HTMLInputElement).value.trim();
    const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
      | 'flow'
      | 'survey'
      | 'tag'
      | 'route';
    // No per-talk language picker: auto-detected from the title, falling back to the
    // author's Settings > Languages > Default Talk Language preference.
    const language = detectTalkLanguage(title, getDefaultTalkLanguagePreference(this.getUiLanguage()));

    const expiresSelect = document.getElementById('talk-expires') as HTMLSelectElement;
    const locationSelect = document.getElementById('talk-location-radius') as HTMLSelectElement;
    const sendToChatroomCheck = document.getElementById('talk-send-to-chatroom') as HTMLInputElement;
    // docs/TODO.md §LL follow-up: the root-level `#talk-tag`/`#talk-preference-set` fields (and
    // the talk-level `selfTag`/`preferenceSet` they wrote) were removed entirely — tag/preference
    // context is now declared exclusively per-question via a Pair-tag question's own
    // `reciprocalTagContext` flag (`Question.reciprocalTagContext`), read at match/resolution
    // time by `findTagPairAncestor`/`myEffectiveTagContext`, not authored here.
    const tags: Tag[] = [];
    const expiresVal = expiresSelect?.value || '';
    const oneDay = 24 * 60 * 60 * 1000;
    let expiresAt: number | null = null;
    if (expiresVal === '1d') expiresAt = Date.now() + oneDay;
    else if (expiresVal === '1w') expiresAt = Date.now() + 7 * oneDay;
    else if (expiresVal === '1M') expiresAt = Date.now() + 30 * oneDay;
    else if (expiresVal === '1y') expiresAt = Date.now() + 365 * oneDay;
    const locationRadiusMiles =
      locationSelect?.value === '' || locationSelect?.value == null
        ? null
        : parseInt(locationSelect.value, 10);
    const sendToChatroom = sendToChatroomCheck?.checked !== false;

    let questions: any[];
    const selfAnswers: { questionId: string; answerId: string }[] = [];
    // Spec §30.2 multi-spec route matching: presence switches checkIfMatch (talk-engine.ts)
    // from "check only the terminal answer" to a score-threshold rule over every direct child
    // of the route's root. Only meaningful for type: 'route'; left undefined for every other
    // type, and undefined for a route talk that leaves the field blank (today's terminal-only
    // behavior, unchanged).
    let matchThreshold: number | undefined;
    if (type === 'route') {
      const matchThresholdInput = document.getElementById('talk-match-threshold') as HTMLInputElement | null;
      const rawThreshold = matchThresholdInput?.value.trim() || '';
      const parsedThreshold = rawThreshold ? parseInt(rawThreshold, 10) : NaN;
      matchThreshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : undefined;
    }

      if (type === 'tag') {
      const keyword = title || (document.getElementById('talk-title') as HTMLInputElement).value.trim();
      if (!keyword) {
        this.showTalkValidationError([this.t('editorTagRequired')]);
        return false;
      }
      // docs/TODO.md §LL follow-up: a tag IS a single-question talk — the question text is the
      // keyword (unchanged). By default it's a "simple tag" (tagKind: 'simple') — the match
      // answer's text IS the keyword, self-match only ("Tennis" matches "Tennis"), enforced by
      // TalkValidator.validateTagTalk. Only when the author checks "Pair tag"
      // (`#tag-pair-checkbox`, talk-editor-dialog.ts) does the accepted answer come from
      // `#talk-answer` and get to diverge (e.g. "sell" accepting "buy") — that's
      // reciprocalTagContext:true, the same asymmetric-pair primitive usable anywhere in
      // flow/survey/route (see Question.tagKind/reciprocalTagContext, types.ts).
      const isPairTag = (document.getElementById('tag-pair-checkbox') as HTMLInputElement | null)?.checked === true;
      const answerInputValue = isPairTag
        ? (document.getElementById('talk-answer') as HTMLInputElement | null)?.value.trim() || ''
        : '';
      const answerWord = answerInputValue || keyword;
      questions = [
        {
          id: 'q_0',
          text: keyword,
          ...(isPairTag ? { reciprocalTagContext: true } : { tagKind: 'simple' as const }),
          answers: [
            { id: 'a_0_match', text: answerWord, isMatch: true, isTerminal: true },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ];
      const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
      const likesTag = tagLikeCheckbox ? tagLikeCheckbox.checked : true;
      selfAnswers.push({ questionId: 'q_0', answerId: likesTag ? 'a_0_match' : 'a_0_ignore' });
    } else if (type === 'route') {
      const routeResult = this.collectRouteEditorQuestions();
      if (routeResult.errors.length > 0) {
        this.showTalkValidationError(routeResult.errors);
        return false;
      }
      questions = routeResult.questions;
      if (questions.length === 0) {
        this.showTalkValidationError([this.t('editorRouteRequired')]);
        return false;
      }
      selfAnswers.push(...this.buildRouteSelfAnswers(matchThreshold));
    } else {
      // flow + survey share the linear editor
      questions = [];
      const questionItems = form.querySelectorAll('.question-item');
      const builtInErrors: string[] = [];

      questionItems.forEach((item, qIndex) => {
        const questionId = `q_${qIndex}`;
        const answerSelectionMode =
          (item.querySelector('.answer-selection-mode') as HTMLSelectElement | null)?.value === 'multiple'
            ? 'multiple'
            : 'single';
        // Spec §3.4 FR-QA-15/16, §30.8: a 'multiple'-mode question's self-answer is every
        // checked box (possibly several) — pushing one selfAnswers entry per checked value
        // reuses saveCreatedTalk's existing per-entry saveAnswerPreference loop unchanged,
        // which is exactly the substrate findAutoAnswerMultiple scans (one history event per
        // selected value under the same question).
        item.querySelectorAll<HTMLInputElement>(`input[name="self-answer-${questionId}"]:checked`).forEach((selfInput) => {
          if (selfInput.value !== 'ignore') {
            selfAnswers.push({ questionId, answerId: selfInput.value });
          }
        });
        const questionText = (item.querySelector('.question-text') as HTMLInputElement).value;
        const answerItems = item.querySelectorAll('.answer-item');

        const answers: any[] = [];
        answerItems.forEach((answerItem, aIndex) => {
          const answerText = (
            answerItem.querySelector('.answer-text') as HTMLInputElement
          ).value.trim();
          const nextQuestion = (answerItem.querySelector('.answer-next') as HTMLSelectElement).value;

          if (answerText) {
            const answer: any = {
              id: `a_${qIndex}_${aIndex}`,
              text: answerText,
            };

            if (type === 'survey') {
              // Surveys never branch; every answer carries a counter for stats.
              answer.counter = 0;
              answer.isTerminal = true;
              if (nextQuestion === 'ignore') {
                answer.isIgnore = true;
              }
            } else if (nextQuestion === 'ignore') {
              answer.isIgnore = true;
              answer.isTerminal = true;
            } else if (nextQuestion === 'noticed') {
              answer.isMatch = true;
              answer.isTerminal = true;
            } else if (nextQuestion) {
              // It's a question ID (e.g., "q_1")
              answer.nextQuestionId = nextQuestion;
            }

            answers.push(answer);
          }
        });

        const questionObj: any = {
          id: questionId,
          text: questionText,
          answers: answers,
        };
        if (answerSelectionMode === 'multiple') {
          questionObj.answerSelectionMode = 'multiple';
        }
        // docs/TODO.md §LL follow-up: only meaningful with exactly 1 real answer (matching
        // engine's own gate, myEffectiveTagContext/findReciprocalTagAncestor) — stored either
        // way so re-checking the box round-trips even while the answer count is temporarily
        // off (e.g. mid-edit).
        const reciprocalTagCheckbox = item.querySelector('.question-reciprocal-tag') as HTMLInputElement | null;
        if (reciprocalTagCheckbox?.checked) {
          questionObj.reciprocalTagContext = true;
        }
        // docs/TODO.md §LL follow-up: "Simple tag" (tagKind: 'simple') — the mutually exclusive
        // sibling of the Pair tag checkbox above (talk-editor-form-helpers.ts wires the
        // exclusion in the DOM). Applies to flow and survey alike, same shared branch.
        const simpleTagCheckbox = item.querySelector('.question-simple-tag') as HTMLInputElement | null;
        if (simpleTagCheckbox?.checked) {
          questionObj.tagKind = 'simple';
        }
        if (type === 'survey') {
          questionObj.isAggregatable = true;
          questionObj.contextHashId = '';
        }
        // §BB / spec §30.2: a builtIn question has no author-typed answers at all —
        // TalkAutofix.fix generates the 2 synthetic answers from questionObj.builtIn alone, so
        // force answers back to [] regardless of what the (hidden, unused) answer-item rows
        // produced above.
        const builtInRead = readBuiltInSpecFromQuestion(item, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
          text: this.t.bind(this),
        });
        if (builtInRead.error) {
          builtInErrors.push(builtInRead.error);
        } else if (builtInRead.kind) {
          questionObj.answers = [];
          questionObj.builtIn = {
            kind: builtInRead.kind,
            ...(builtInRead.quantity !== undefined ? { quantity: builtInRead.quantity } : {}),
            ...(builtInRead.priceRange ? { priceRange: builtInRead.priceRange } : {}),
            ...(builtInRead.timeFrame ? { timeFrame: builtInRead.timeFrame } : {}),
          };
        }
        questions.push(questionObj);
      });

      if (builtInErrors.length > 0) {
        this.showTalkValidationError(builtInErrors);
        return false;
      }
    }

    // ── Mandatory financial-data check (spec §7.4, FR-FIN-2) ───────────────
    // Runs before validation/autofix and cannot be disabled — covers the talk
    // title and every question/answer text field.
    const talkTextFields: string[] = [
      title,
      ...questions.flatMap((q: any) => [q.text, ...(q.answers || []).map((a: any) => a.text)]),
    ];
    if (talkTextFields.some((t) => containsFinancialData(String(t || '')))) {
      this.showTalkValidationError([this.t('editorFinancialDataBlocked')]);
      return false;
    }

    // ── Validate (with best-effort autofix) before we emit anything ────────
    // Build a minimal Talk-shaped object for the validator. Fields the
    // validator doesn't care about are filled with placeholders.
    const isAdult = !!(document.getElementById('talk-is-adult') as HTMLInputElement | null)?.checked;
    const candidate = {
      id: '',
      title,
      authorId: '',
      type,
      isAdult,
      language,
      tags,
      questions,
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
    };
    let fixed: any;
    try {
      const report = TalkAutofix.fix(candidate as any);
      fixed = report.talk;
      if (report.fixes.length > 0) {
        this.showTalkAutofixReport(report.fixes);
      }
      TalkValidator.validateTalk(fixed as any);
    } catch (err) {
      this.showTalkValidationError([(err as Error).message]);
      return false;
    }
    questions = fixed.questions;

    // §BB / spec §30.2: the value I just declared on my OWN builtIn question is also my own
    // typed preference for future auto-resolution when I respond to someone ELSE'S talk of the
    // same shape — save it into the same store `resolveBuiltInQuestion` (Phase 5) reads, scoped
    // the same way (my own tag, from this question's nearest Pair-tag ancestor if any + this
    // talk's title + this question's own text — the text component is required so a talk with
    // MORE THAN ONE builtIn question, e.g. priceRange AND timeFrame in the same talk (§HH),
    // doesn't have the second overwrite the first at an otherwise-identical scope key).
    // 'location' is excluded: it has no stored preference, see Question.builtIn's doc comment.
    for (const q of questions) {
      if (!q.builtIn || q.builtIn.kind === 'location') continue;
      const preferenceState = getTypedPreferenceState();
      const myTag = findTagPairAncestor({ type, questions }, q)?.questionText;
      const scopeKey = makeTypedPreferenceScopeKey(String(myTag || 'general'), title, q.text);
      saveTypedPreference(preferenceState, LOCAL_EXACT_CHATBOT_USER_ID, scopeKey, {
        kind: q.builtIn.kind,
        ...(q.builtIn.quantity !== undefined ? { quantity: q.builtIn.quantity } : {}),
        ...(q.builtIn.priceRange ? { priceRange: q.builtIn.priceRange } : {}),
        ...(q.builtIn.timeFrame ? { timeFrame: q.builtIn.timeFrame } : {}),
      });
      setTypedPreferenceState(preferenceState);
    }

    const editingTalkId = form.dataset.editingTalkId;
    if (editingTalkId) {
      // Update local myTalks so the list shows the new title when re-rendered after save
      patchMyTalk(editingTalkId, {
        title,
        type,
        language,
        expiresAt: expiresAt ?? undefined,
        locationRadiusMiles: locationRadiusMiles ?? undefined,
        lastInteraction: new Date().toISOString(),
      });
      this.emit('updateTalk', {
        id: editingTalkId,
        title,
        type,
        isAdult,
        questions,
        language,
        tags,
        expiresAt,
        locationRadiusMiles,
        matchThreshold,
      });
    } else {
      const attachmentInput = document.getElementById('talk-attachment-input') as HTMLInputElement | null;
      const mediaFile = attachmentInput?.files?.[0];
      // docs/TODO.md §Y1: editing a copied-but-not-yet-owned talk stashes the source talk on
      // the form (see talk-editor-dialog.ts's isOwnedEdit gate) instead of setting
      // editingTalkId — this is what finally makes the editor the credited author, via the
      // same revise-mints-new-id + originalAuthorId-transfer path §V built for DM shorthand.
      let reviseSourceTalk: any;
      const rawReviseSource = form.dataset.reviseSourceTalk;
      if (rawReviseSource) {
        try {
          reviseSourceTalk = JSON.parse(rawReviseSource);
        } catch {
          /* malformed stash — fall through as an ordinary new talk */
        }
      }
      this.emit('createTalk', {
        title,
        type,
        isAdult,
        questions,
        language,
        tags,
        sendToChatroom,
        expiresAt,
        locationRadiusMiles,
        matchThreshold,
        selfAnswers,
        ...(mediaFile ? { mediaFile } : {}),
        ...(reviseSourceTalk ? { reviseSourceTalk } : {}),
      });
    }
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Create-Talk: per-type UI helpers (flow constraint, route DAG editor,
  // validation feedback). Kept on the class so the inner closures in
  // showTalkEditorDialog can reference them via `this`.
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Flow-talk UI hints: only the first answer per question decides (match or
   * link to the next question). Additional answers are normalized to "ignore"
   * by TalkAutofix at submit time, but we keep the <select> elements fully
   * interactive here so the user — and Playwright — can toggle them freely.
   *
   * We do NOT disable the dropdowns or force their value on render. The only
   * visible hint is a tooltip on non-first answers in flow mode. The heavy
   * lifting is done by TalkAutofix + TalkValidator before save.
   */
  private refreshFlowAnswerConstraints(type: string): void {
    const questionItems = document.querySelectorAll('.question-item');
    questionItems.forEach((item) => {
      const answersContainer = item.querySelector('.answers-container');
      if (!answersContainer) return;
      const answerItems = answersContainer.querySelectorAll('.answer-item');
      answerItems.forEach((answerItem, aIdx) => {
        const select = answerItem.querySelector('.answer-next') as HTMLSelectElement | null;
        if (!select) return;
        // Always keep the select enabled so Playwright / keyboard users can
        // interact with every row. Reset any stale lock-state from previous
        // renders.
        select.disabled = false;
        const ignoreOpt = select.querySelector('option[value="ignore"]') as HTMLOptionElement | null;
        if (ignoreOpt) ignoreOpt.disabled = false;
        select.removeAttribute('title');
        if (type === 'flow' && aIdx > 0) {
          select.title = this.t('editorFlowConstraint');
        }
      });
    });
  }

  /** In-memory model for the route-type DAG editor. */
  private routeEditorQuestions: Array<{
    id: string;
    text: string;
    parentAnswer: { questionId: string; answerId: string } | null;
    answers: Array<{
      id: string;
      text: string;
      isMatch?: boolean;
      isIgnore?: boolean;
      isTerminal?: boolean;
      /**
       * See `Answer.parallelMatchThreshold` (types.ts) — only meaningful once this answer has
       * 2+ children (a fan-out). Undefined = require all of them; the editor's "+Child Q"/
       * "+Parallel Q" button stays available past the first child (unlike the old one-child
       * cap) so an author can build "iPhone" fanning out into Model/Condition/Price-range.
       */
      parallelMatchThreshold?: number;
    }>;
    /**
     * §BB / spec §30.2: a typed comparison node (e.g. a per-item quantity/price question at
     * the leaf of one item's branch, docs/TODO.md §BB Phase 6). When set, `answers` is
     * meaningless for this node — TalkAutofix.fix generates the synthetic pair — and the node
     * is always a leaf: the route editor has no affordance to add a child to a builtIn node's
     * single implicit "compatible" outcome (only to an authored answer row), so a builtIn route
     * question can be a branch's terminal item-detail step but not a shared root that itself
     * branches further. See the Phase 6 TODO.md note for the deferred root-branching case.
     */
    builtIn?: { kind: string; quantity?: number; priceRange?: { min: number; max: number }; timeFrame?: { start: number; end: number } };
    /** See `Question.reciprocalTagContext` (types.ts) — only meaningful with exactly 1 answer. */
    reciprocalTagContext?: boolean;
    /** See `Question.tagKind` (types.ts) — mutually exclusive with `reciprocalTagContext`. */
    tagKind?: 'simple';
    /**
     * Tag-style self-match convenience: while false, the question's single non-Ignore answer
     * text auto-mirrors this question's own text as it's typed (so typing "iphone" as the
     * question needs no separate step to also make "iphone" the accepted answer — the same
     * self-match default §LL gives `type:'tag'` talks, extended to route/flow questions). Flips
     * to true the moment the author edits that answer's text directly, or on rehydrating an
     * existing talk whose answer text was already explicitly authored.
     */
    matchAnswerDirty?: boolean;
  }> = [];

  /** Builds or re-hydrates the route-editor in-memory state and redraws it. */
  private ensureRouteEditorRendered(existingTalk?: any): void {
    const host = document.getElementById('route-editor');
    if (!host) return;
    if (this.routeEditorQuestions.length === 0) {
      if (existingTalk && existingTalk.type === 'route' && Array.isArray(existingTalk.questions)) {
        // Rehydrate from an existing route talk.
        this.routeEditorQuestions = existingTalk.questions.map((q: any) => ({
          id: q.id,
          text: q.text,
          parentAnswer:
            Array.isArray(q.contextPath) && q.contextPath.length > 0
              ? { ...q.contextPath[q.contextPath.length - 1] }
              : null,
          answers: (q.answers || []).map((a: any) => ({
            id: a.id,
            text: a.text,
            isMatch: !!a.isMatch,
            isIgnore: !!a.isIgnore,
            // A linking answer (nextQuestionId, or a fan-out's nextQuestionIds, set per this
            // session's Phase 6 fix / the fan-out generalization) never carries
            // isMatch/isIgnore/isTerminal — so the `!== false` default-to-terminal below,
            // correct for the old match/ignore-only shape, would otherwise misclassify it as
            // Terminal on reopen instead of Next question.
            isTerminal: !a.nextQuestionId && !(Array.isArray(a.nextQuestionIds) && a.nextQuestionIds.length > 0) && a.isTerminal !== false,
            ...(typeof a.parallelMatchThreshold === 'number' ? { parallelMatchThreshold: a.parallelMatchThreshold } : {}),
          })),
          ...(q.builtIn ? { builtIn: q.builtIn } : {}),
          ...(q.reciprocalTagContext ? { reciprocalTagContext: true } : {}),
          ...(q.tagKind === 'simple' ? { tagKind: 'simple' as const } : {}),
          // Already-authored text — don't let further question-text edits clobber it.
          matchAnswerDirty: true,
        }));
      } else {
        // Seed with a single root question. The match answer starts blank (not
        // matchAnswerDirty) so it mirrors the question text as soon as the author types it —
        // "iphone" as the question needs no separate typing-out of "iphone" as the answer too.
        this.routeEditorQuestions = [
          {
            id: 'q_0',
            text: '',
            parentAnswer: null,
            answers: [
              { id: 'a_0_match', text: '', isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: this.t('editorRouteDefaultIgnore'), isIgnore: true, isTerminal: true },
            ],
            matchAnswerDirty: false,
          },
        ];
      }
    }
    this.renderRouteEditor();
  }

  private renderRouteEditor(): void {
    const host = document.getElementById('route-editor');
    if (!host) return;
    // Build children index from parentAnswer refs.
    const childrenOf = new Map<string, string[]>(); // key = parentAnswerId "qid::aid", value = child question ids
    const roots: string[] = [];
    for (const q of this.routeEditorQuestions) {
      if (!q.parentAnswer) {
        roots.push(q.id);
      } else {
        const key = `${q.parentAnswer.questionId}::${q.parentAnswer.answerId}`;
        const arr = childrenOf.get(key) ?? [];
        arr.push(q.id);
        childrenOf.set(key, arr);
      }
    }
    const byId = new Map(this.routeEditorQuestions.map((q) => [q.id, q]));
    const renderNode = (qid: string, depth: number): string => {
      const q = byId.get(qid);
      if (!q) return '';
      const indent = `margin-left:${depth * 20}px;`;
      // §BB / spec §30.5: a builtIn node has no AUTHORED answers (TalkAutofix.fix / this
      // editor's own `collectRouteEditorQuestions` generate the synthetic "Compatible"/"Not
      // compatible" pair) but its one implicit "compatible" outcome CAN still fork further —
      // this is exactly the "shared timeFrame/location asked once at the root, then the route
      // branches" pattern spec §30.5 describes. The synthetic compatible answer's fixed id
      // (`${q.id}_compatible`, matching TalkAutofix's own naming) is the parent-answer key a
      // child links against, kept in sync with `collectRouteEditorQuestions` below.
      const builtInKind = q.builtIn?.kind || '';
      const builtInCompatibleAid = `${q.id}_compatible`;
      const builtInChildIds = q.builtIn ? (childrenOf.get(`${q.id}::${builtInCompatibleAid}`) ?? []) : [];
      const builtInAddChildLabel = builtInChildIds.length === 0
        ? this.t('editorRouteAddChild')
        : this.t('editorRouteAddParallel');
      const builtInHtml = `
        <div class="route-builtin-controls" style="margin: 6px 0 6px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:0.85em; color:var(--text-secondary);">
            ${this.t('editorBuiltInKindLabel')}
            <select class="form-input route-builtin-kind" data-qid="${q.id}" style="flex:0 0 auto; width:auto; font-size:0.9em;">
              <option value="" ${builtInKind === '' ? 'selected' : ''}>${this.t('editorBuiltInKindNone')}</option>
              <option value="quantity" ${builtInKind === 'quantity' ? 'selected' : ''}>${this.t('editorBuiltInKindQuantity')}</option>
              <option value="priceRange" ${builtInKind === 'priceRange' ? 'selected' : ''}>${this.t('editorBuiltInKindPriceRange')}</option>
              <option value="timeFrame" ${builtInKind === 'timeFrame' ? 'selected' : ''}>${this.t('editorBuiltInKindTimeFrame')}</option>
              <option value="location" ${builtInKind === 'location' ? 'selected' : ''}>${this.t('editorBuiltInKindLocation')}</option>
            </select>
          </label>
          ${builtInKind === 'quantity' ? `
            <label style="font-size:0.85em;">${this.t('editorBuiltInQuantityLabel')}
              <input type="number" class="form-input route-builtin-quantity-input" data-qid="${q.id}" value="${q.builtIn?.quantity ?? ''}" style="width:120px; display:inline-block;">
            </label>` : ''}
          ${builtInKind === 'priceRange' ? `
            <label style="font-size:0.85em;">${this.t('editorBuiltInPriceMinLabel')}
              <input type="number" class="form-input route-builtin-pricerange-min" data-qid="${q.id}" value="${q.builtIn?.priceRange?.min ?? ''}" style="width:100px; display:inline-block;">
            </label>
            <label style="font-size:0.85em;">${this.t('editorBuiltInPriceMaxLabel')}
              <input type="number" class="form-input route-builtin-pricerange-max" data-qid="${q.id}" value="${q.builtIn?.priceRange?.max ?? ''}" style="width:100px; display:inline-block;">
            </label>` : ''}
          ${builtInKind === 'timeFrame' ? `
            <label style="font-size:0.85em;">${this.t('editorBuiltInTimeStartLabel')}
              <input type="date" class="form-input route-builtin-timeframe-start" data-qid="${q.id}" value="${q.builtIn?.timeFrame ? new Date(q.builtIn.timeFrame.start).toISOString().slice(0, 10) : ''}" style="display:inline-block;">
            </label>
            <label style="font-size:0.85em;">${this.t('editorBuiltInTimeEndLabel')}
              <input type="date" class="form-input route-builtin-timeframe-end" data-qid="${q.id}" value="${q.builtIn?.timeFrame ? new Date(q.builtIn.timeFrame.end).toISOString().slice(0, 10) : ''}" style="display:inline-block;">
            </label>` : ''}
          ${builtInKind === 'location' ? `<span style="font-size:0.8em; color:var(--text-secondary);">${this.t('editorBuiltInLocationNote')}</span>` : ''}
        </div>
      `;
      // Reuses the exact same `.route-add-child-btn`/`.route-parallel-threshold` handlers an
      // ordinary answer row already wires (they key off data-qid/data-aid alone, not on
      // whether `parentQ.answers` actually contains that id — a builtIn node's synthetic
      // answer never lives in the live editor's `q.answers`, only in what gets emitted at
      // save time, exactly like TalkAutofix already treats it for the leaf-only case).
      const builtInChildHtml = builtInKind ? `
        <div style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
          <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${builtInCompatibleAid}" style="font-size:0.8em; background:var(--accent); color:white; padding:2px 6px;">${builtInAddChildLabel}</button>
        </div>
        ${builtInChildIds.map((c) => renderNode(c, depth + 1)).join('')}
      ` : '';
      // docs/TODO.md §LL.2 follow-up: a Simple/Pair tag question is structurally fixed to exactly
      // one non-ignore answer (TalkValidator.validateTagKindFields) — the editor now reflects
      // that instead of showing free-form multi-answer chrome the data model can never actually
      // use. Non-destructive: only the RENDER is filtered, `q.answers` itself is untouched, so
      // unchecking either box later restores every previously-hidden answer exactly as it was.
      const isTagKind = !q.builtIn && (q.tagKind === 'simple' || !!q.reciprocalTagContext);
      const visibleAnswers = isTagKind ? q.answers.filter((a) => !a.isIgnore).slice(0, 1) : q.answers;
      const answersHtml = q.builtIn ? '' : visibleAnswers
        .map((a) => {
          const childIds = childrenOf.get(`${q.id}::${a.id}`) ?? [];
          const kind = a.isMatch
            ? this.t('editorRouteKindMatch')
            : a.isIgnore
              ? this.t('editorRouteKindIgnore')
              : a.isTerminal
                ? this.t('editorRouteKindTerminal')
                : this.t('editorRouteKindLink');
          // Fan-out (types.ts's Answer.nextQuestionIds): once an answer has its first child,
          // the button adds a PARALLEL sibling instead of extending a single chain — e.g. an
          // "iPhone" answer fanning out into Model/Condition/Price-range, each side answerable
          // in either order. No cap on the number of children (the old one-child limit only
          // ever reflected a UI gate, not a real data-model constraint for 2+).
          const addChildLabel = childIds.length === 0 ? this.t('editorRouteAddChild') : this.t('editorRouteAddParallel');
          const thresholdHtml = childIds.length >= 2 ? `
            <label style="display:flex; align-items:center; gap:6px; margin:4px 0 4px 18px; font-size:0.8em; color:var(--text-secondary);">
              ${this.t('editorRouteParallelThresholdLabel').replace('{count}', String(childIds.length))}
              <input type="number" class="form-input route-parallel-threshold" data-qid="${q.id}" data-aid="${a.id}"
                min="1" max="${childIds.length}" placeholder="${this.t('editorRouteParallelThresholdAll')}"
                value="${a.parallelMatchThreshold ?? ''}" style="width:70px; display:inline-block;">
            </label>` : '';
          // Simple tag (self-match): frozen — matches the answer text to the question, mirroring
          // TalkAutofix's already-enforced invariant. Pair tag keeps this editable (the whole
          // point is a divergent accepted answer).
          const frozen = isTagKind && q.tagKind === 'simple';
          return `
            <div class="route-answer" data-qid="${q.id}" data-aid="${a.id}" style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
              <span class="route-answer-kind" style="font-size:0.8em; padding:2px 6px; border-radius:10px; background:var(--accent-soft); color:var(--accent-text);">${kind}</span>
              <input type="text" class="form-input route-answer-text" value="${escapeHtml(a.text)}" placeholder="${this.t('editorRouteAnswerPlaceholder')}" data-qid="${q.id}" data-aid="${a.id}" ${frozen ? 'readonly' : ''} style="flex:1; ${frozen ? 'background:var(--bg-subtle);' : ''}">
              <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:var(--accent); color:white; padding:2px 6px;">${addChildLabel}</button>
              <button type="button" class="btn route-remove-answer-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:var(--danger); color:white; padding:2px 6px;">×</button>
            </div>
            ${thresholdHtml}
            ${childIds.map((c) => renderNode(c, depth + 1)).join('')}
          `;
        })
        .join('');
      return `
        <div class="route-node" data-qid="${q.id}" style="border:1px solid var(--border); border-radius:6px; padding:8px; margin:6px 0; ${indent} background:var(--bg-subtle);">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:var(--accent);">${this.t('editorRouteQuestionPrefix')}</strong>
            <input type="text" class="form-input route-question-text" value="${escapeHtml(q.text)}" placeholder="${this.t('editorRouteQuestionPlaceholder')}" data-qid="${q.id}" style="flex:1;">
            ${q.builtIn || isTagKind ? '' : `<button type="button" class="btn route-add-answer-btn" data-qid="${q.id}" style="font-size:0.8em; background:var(--success); color:white; padding:2px 6px;">${this.t('editorAddAnswer')}</button>`}
            ${q.parentAnswer ? `<button type="button" class="btn route-remove-question-btn" data-qid="${q.id}" style="font-size:0.8em; background:var(--danger); color:white; padding:2px 6px;">${this.t('editorRouteRemoveQuestion')}</button>` : ''}
          </div>
          ${q.builtIn ? '' : `
          <label style="display:flex; align-items:center; gap:6px; margin:6px 0 0 0; font-size:0.82em; color:var(--text-secondary);">
            <input type="checkbox" class="route-question-simple-tag" data-qid="${q.id}" ${q.tagKind === 'simple' ? 'checked' : ''}>
            ${this.t('editorSimpleTagLabel')}
          </label>
          <label style="display:flex; align-items:center; gap:6px; margin:6px 0 0 0; font-size:0.82em; color:var(--text-secondary);">
            <input type="checkbox" class="route-question-reciprocal-tag" data-qid="${q.id}" ${q.reciprocalTagContext ? 'checked' : ''}>
            ${this.t('editorReciprocalTagLabel')}
          </label>`}
          ${builtInHtml}
          ${builtInChildHtml}
          ${answersHtml}
        </div>
      `;
    };
    host.innerHTML = roots.map((r) => renderNode(r, 0)).join('');

    // Bind events (delegation-free for clarity).
    host.querySelectorAll<HTMLInputElement>('.route-question-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q) return;
        q.text = inp.value;
        // Tag-style self-match: mirror the question text onto its one real answer until the
        // author edits that answer directly (matchAnswerDirty), same convenience §LL gives
        // type:'tag' talks. Ambiguous with 2+ non-Ignore answers, so skip those.
        if (!q.matchAnswerDirty) {
          const real = q.answers.filter((a) => !a.isIgnore);
          if (real.length === 1) {
            real[0].text = inp.value;
            const answerInput = host.querySelector<HTMLInputElement>(
              `.route-answer-text[data-qid="${q.id}"][data-aid="${real[0].id}"]`,
            );
            if (answerInput) answerInput.value = inp.value;
          }
        }
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-question-reciprocal-tag').forEach((cb) => {
      cb.addEventListener('change', () => {
        const q = byId.get(cb.dataset.qid!);
        if (!q) return;
        q.reciprocalTagContext = cb.checked;
        // docs/TODO.md §LL follow-up: mutually exclusive with "Simple tag" — see the flow/survey
        // editor's identical exclusion (talk-editor-form-helpers.ts). A full re-render (not just
        // a DOM patch) picks up the answer-row freeze/hide rules that now depend on this state.
        if (cb.checked) delete q.tagKind;
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-question-simple-tag').forEach((cb) => {
      cb.addEventListener('change', () => {
        const q = byId.get(cb.dataset.qid!);
        if (!q) return;
        if (cb.checked) {
          q.tagKind = 'simple';
          q.reciprocalTagContext = false;
        } else {
          delete q.tagKind;
        }
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLSelectElement>('.route-builtin-kind').forEach((sel) => {
      sel.addEventListener('change', () => {
        const q = byId.get(sel.dataset.qid!);
        if (!q) return;
        if (!sel.value) {
          delete q.builtIn;
        } else {
          q.builtIn = { kind: sel.value };
        }
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-builtin-quantity-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q?.builtIn) return;
        q.builtIn.quantity = Number(inp.value);
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-builtin-pricerange-min').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q?.builtIn) return;
        q.builtIn.priceRange = { min: Number(inp.value), max: q.builtIn.priceRange?.max ?? NaN };
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-builtin-pricerange-max').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q?.builtIn) return;
        q.builtIn.priceRange = { min: q.builtIn.priceRange?.min ?? NaN, max: Number(inp.value) };
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-builtin-timeframe-start').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q?.builtIn) return;
        const start = inp.value ? new Date(inp.value).getTime() : NaN;
        q.builtIn.timeFrame = { start, end: q.builtIn.timeFrame?.end ?? NaN };
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-builtin-timeframe-end').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q?.builtIn) return;
        const end = inp.value ? new Date(inp.value).getTime() : NaN;
        q.builtIn.timeFrame = { start: q.builtIn.timeFrame?.start ?? NaN, end };
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-answer-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q) return;
        const a = q.answers.find((x) => x.id === inp.dataset.aid);
        if (a) a.text = inp.value;
        // Editing the answer directly opts out of the question-text auto-mirror above.
        q.matchAnswerDirty = true;
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-parallel-threshold').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q) return;
        const a = q.answers.find((x) => x.id === inp.dataset.aid);
        if (!a) return;
        const n = Number(inp.value);
        if (inp.value.trim() && Number.isInteger(n) && n > 0) {
          a.parallelMatchThreshold = n;
        } else {
          delete a.parallelMatchThreshold;
        }
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-add-answer-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = byId.get(btn.dataset.qid!);
        if (!q) return;
        const idx = q.answers.length;
        q.answers.push({
          id: `${q.id}_a${idx}`,
          text: this.t('editorRouteNewAnswer'),
          isIgnore: true,
          isTerminal: true,
        });
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-remove-answer-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = byId.get(btn.dataset.qid!);
        if (!q) return;
        q.answers = q.answers.filter((a) => a.id !== btn.dataset.aid);
        // Also cascade-remove any children of this answer.
        const killKey = `${btn.dataset.qid}::${btn.dataset.aid}`;
        this.routeEditorQuestions = this.routeEditorQuestions.filter((qq) => {
          if (!qq.parentAnswer) return true;
          const key = `${qq.parentAnswer.questionId}::${qq.parentAnswer.answerId}`;
          return key !== killKey;
        });
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-add-child-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parentQid = btn.dataset.qid!;
        const parentAid = btn.dataset.aid!;
        const newId = `q_${this.routeEditorQuestions.length}`;
        // Promote the chosen parent answer to a linking answer (not terminal/match/ignore).
        const parentQ = byId.get(parentQid);
        if (parentQ) {
          const parentAnswer = parentQ.answers.find((a) => a.id === parentAid);
          if (parentAnswer) {
            delete parentAnswer.isMatch;
            delete parentAnswer.isIgnore;
            parentAnswer.isTerminal = false;
          }
        }
        this.routeEditorQuestions.push({
          id: newId,
          text: '',
          parentAnswer: { questionId: parentQid, answerId: parentAid },
          answers: [
            { id: `${newId}_match`, text: '', isMatch: true, isTerminal: true },
            { id: `${newId}_ignore`, text: this.t('editorRouteDefaultIgnore'), isIgnore: true, isTerminal: true },
          ],
          matchAnswerDirty: false,
        });
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-remove-question-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.qid!;
        // Remove target and its descendants.
        const keep = new Set<string>();
        const mark = (id: string) => {
          keep.add(id);
          for (const qq of this.routeEditorQuestions) {
            if (qq.parentAnswer && qq.parentAnswer.questionId === id) {
              // Do not keep descendants of target.
            }
          }
        };
        // Build a child map and BFS from target to collect descendants.
        const childMap = new Map<string, string[]>();
        for (const qq of this.routeEditorQuestions) {
          if (qq.parentAnswer) {
            const arr = childMap.get(qq.parentAnswer.questionId) ?? [];
            arr.push(qq.id);
            childMap.set(qq.parentAnswer.questionId, arr);
          }
        }
        const dead = new Set<string>([target]);
        const stack = [target];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const child of childMap.get(cur) ?? []) {
            if (!dead.has(child)) {
              dead.add(child);
              stack.push(child);
            }
          }
        }
        this.routeEditorQuestions = this.routeEditorQuestions.filter((qq) => !dead.has(qq.id));
        void keep; // silence unused
        void mark;
        this.renderRouteEditor();
      });
    });
  }

  /**
   * Route talks have no dedicated self-answer picker (unlike flow/tag, `input[name="self-answer-…"]`
   * above) — the author's own answer to each of their own questions defaults to that question's
   * first authored answer, walking the DAG from the root and always taking the first answer's
   * link at each fork. A question with a single answer (the common case: "Model?" → "16 Pro")
   * makes this unambiguous — that one answer simply IS the self-answer. Stops at a builtIn node
   * (no authored answers; its own typed-preference save, `processTalkForm` below, is unconditional
   * on type and covers it separately) or a leaf with no outgoing link.
   *
   * `matchThreshold` routes (spec §30.2) are a different shape and take a different branch here:
   * the root's whole point is 3+ parallel, order-independent specs, not one chosen path, and
   * matchThreshold mode never asks the respondent to answer the root either (see
   * `getRouteRootChildQuestionIds`/talk-response-dialog.ts's multi-branch walk) — so the root
   * itself gets no self-answer. Instead, every direct child of the root is its own independent
   * spec: the author's self-answer is that spec's own first authored answer ("yes, compatible"),
   * one per branch off the root (docs/TODO.md §KK zero-click follow-up).
   */
  private buildRouteSelfAnswers(matchThreshold?: number): { questionId: string; answerId: string }[] {
    const childQuestionIdsByParentAnswerKey = new Map<string, string[]>();
    for (const q of this.routeEditorQuestions) {
      if (q.parentAnswer) {
        const key = `${q.parentAnswer.questionId}::${q.parentAnswer.answerId}`;
        const arr = childQuestionIdsByParentAnswerKey.get(key) ?? [];
        arr.push(q.id);
        childQuestionIdsByParentAnswerKey.set(key, arr);
      }
    }
    const byId = new Map(this.routeEditorQuestions.map((q) => [q.id, q]));
    const root = this.routeEditorQuestions.find((q) => !q.parentAnswer);
    const selfAnswers: { questionId: string; answerId: string }[] = [];

    if (matchThreshold != null && root) {
      for (const answer of root.answers) {
        const childIds = childQuestionIdsByParentAnswerKey.get(`${root.id}::${answer.id}`) ?? [];
        for (const childId of childIds) {
          const child = byId.get(childId);
          if (!child || child.builtIn || child.answers.length === 0) continue;
          selfAnswers.push({ questionId: child.id, answerId: child.answers[0].id });
        }
      }
      return selfAnswers;
    }

    // Fan-out (Answer.nextQuestionIds, the any-node generalization of the root-only
    // matchThreshold case above): the author's own self-answer walk must descend into EVERY
    // parallel spec, not just one chosen path, since the author would need to answer all of
    // them too (e.g. Model, Condition, AND Price-range under their own "iPhone" branch).
    const visit = (question: typeof this.routeEditorQuestions[number] | undefined): void => {
      if (!question) return;
      // §BB / spec §30.5: a builtIn node itself gets no self-answer (its typed-preference save
      // covers that separately, `processTalkForm` below) — but the walk MUST still continue
      // into whatever it forks into, since a shared timeFrame/location root is now allowed to
      // branch into real item questions the author does need self-answers for.
      if (question.builtIn) {
        const childIds = childQuestionIdsByParentAnswerKey.get(`${question.id}::${question.id}_compatible`) ?? [];
        for (const childId of childIds) visit(byId.get(childId));
        return;
      }
      if (question.answers.length === 0) return;
      const firstAnswer = question.answers[0];
      selfAnswers.push({ questionId: question.id, answerId: firstAnswer.id });
      const childIds = childQuestionIdsByParentAnswerKey.get(`${question.id}::${firstAnswer.id}`) ?? [];
      for (const childId of childIds) {
        visit(byId.get(childId));
      }
    };
    visit(root);
    return selfAnswers;
  }

  /**
   * Converts the route-editor model into the validator-ready Question[] shape.
   * Sets each question's contextPath by walking up its parent chain.
   *
   * Also derives each linking answer's `nextQuestionId`/`nextQuestionIds` from the editor
   * model's own `parentAnswer` linkage — a real pre-existing gap: the route editor only ever
   * tracked `contextPath`/`parentAnswer` bookkeeping, never wrote `nextQuestionId` itself, so a
   * route talk saved through the editor could never navigate past its first question
   * (`talk-response-dialog.ts` reads `answer.nextQuestionId` directly to advance). An answer
   * with exactly one child emits the singular `nextQuestionId` (unchanged shape); 2+ children
   * (`renderRouteEditor`'s "+Parallel Q") emit the `nextQuestionIds` array plus whatever
   * per-answer `parallelMatchThreshold` the author set — the any-node fan-out generalization
   * of the old root-only `Talk.matchThreshold` (see `evaluateRouteFanOutMatch`, talk-engine.ts).
   *
   * §BB / spec §30.2, docs/TODO.md §BB Phase 6: a builtIn node emits `answers: []` (TalkAutofix
   * generates the synthetic pair) and its typed value is validated here — the same early-return
   * `showTalkValidationError` pattern the flow editor's `readBuiltInSpecFromQuestion` uses,
   * surfaced via the returned `errors` array rather than thrown, since this runs per-node inside
   * a `.map`.
   */
  private collectRouteEditorQuestions(): { questions: any[]; errors: string[] } {
    const byId = new Map(this.routeEditorQuestions.map((q) => [q.id, q]));
    const computeContextPath = (qid: string): Array<{ questionId: string; answerId: string }> => {
      const path: Array<{ questionId: string; answerId: string }> = [];
      let cur = byId.get(qid);
      while (cur && cur.parentAnswer) {
        path.unshift({ questionId: cur.parentAnswer.questionId, answerId: cur.parentAnswer.answerId });
        cur = byId.get(cur.parentAnswer.questionId);
      }
      return path;
    };
    // Answer.nextQuestionIds (types.ts) generalizes the old one-child-per-answer model to a
    // fan-out: an array of child ids, not a single value, so a second (third, ...) sibling
    // added via renderRouteEditor's "+Parallel Q" button isn't silently dropped here.
    const childQuestionIdsByParentAnswerKey = new Map<string, string[]>();
    for (const q of this.routeEditorQuestions) {
      if (q.parentAnswer) {
        const key = `${q.parentAnswer.questionId}::${q.parentAnswer.answerId}`;
        const arr = childQuestionIdsByParentAnswerKey.get(key) ?? [];
        arr.push(q.id);
        childQuestionIdsByParentAnswerKey.set(key, arr);
      }
    }
    const errors: string[] = [];
    const questions = this.routeEditorQuestions.map((q) => {
      const contextPath = computeContextPath(q.id);
      if (q.builtIn) {
        const kind = q.builtIn.kind;
        if (kind === 'quantity' && !Number.isFinite(q.builtIn.quantity)) {
          errors.push(this.t('editorBuiltInQuantityRequired'));
        } else if (kind === 'priceRange') {
          const pr = q.builtIn.priceRange;
          if (!pr || !Number.isFinite(pr.min) || !Number.isFinite(pr.max) || pr.min > pr.max) {
            errors.push(this.t('editorBuiltInPriceRangeRequired'));
          }
        } else if (kind === 'timeFrame') {
          const tf = q.builtIn.timeFrame;
          if (!tf || !Number.isFinite(tf.start) || !Number.isFinite(tf.end) || tf.start > tf.end) {
            errors.push(this.t('editorBuiltInTimeFrameRequired'));
          }
        }
        // §BB / spec §30.5: emit the synthetic "Compatible"/"Not compatible" pair here (not
        // left to TalkAutofix) so a child attached via the editor's builtIn "+Add Child"
        // button (renderRouteEditor above) actually survives to the saved talk — the fixed
        // `${q.id}_compatible` id is the SAME key that button's parentAnswer link uses.
        // TalkAutofix's own synthesis (talk-engine.ts) still applies unconditionally for
        // route talks built outside this editor (no `nextQuestionId` possible there), so it's
        // left untouched as that fallback.
        const compatibleId = `${q.id}_compatible`;
        const childIds = childQuestionIdsByParentAnswerKey.get(`${q.id}::${compatibleId}`) ?? [];
        const compatibleAnswer: any = { id: compatibleId, text: 'Compatible' };
        if (childIds.length === 1) {
          compatibleAnswer.nextQuestionId = childIds[0];
        } else if (childIds.length > 1) {
          compatibleAnswer.nextQuestionIds = childIds;
        } else {
          compatibleAnswer.isMatch = true;
          compatibleAnswer.isTerminal = true;
        }
        return {
          id: q.id,
          text: q.text.trim(),
          contextPath,
          answers: [
            compatibleAnswer,
            { id: `${q.id}_incompatible`, text: 'Not compatible', isIgnore: true, isTerminal: true },
          ],
          builtIn: q.builtIn,
          ...(q.reciprocalTagContext ? { reciprocalTagContext: true } : {}),
          ...(q.tagKind === 'simple' ? { tagKind: 'simple' as const } : {}),
        };
      }
      return {
        id: q.id,
        text: q.text.trim(),
        contextPath,
        answers: q.answers.map((a) => {
          const obj: any = { id: a.id, text: a.text.trim() };
          const childIds = childQuestionIdsByParentAnswerKey.get(`${q.id}::${a.id}`) ?? [];
          if (childIds.length === 1) {
            obj.nextQuestionId = childIds[0];
          } else if (childIds.length > 1) {
            obj.nextQuestionIds = childIds;
            if (typeof a.parallelMatchThreshold === 'number') {
              obj.parallelMatchThreshold = a.parallelMatchThreshold;
            }
          } else {
            if (a.isMatch) obj.isMatch = true;
            if (a.isIgnore) obj.isIgnore = true;
            if (a.isTerminal) obj.isTerminal = true;
          }
          return obj;
        }),
        ...(q.reciprocalTagContext ? { reciprocalTagContext: true } : {}),
        ...(q.tagKind === 'simple' ? { tagKind: 'simple' as const } : {}),
      };
    });
    return { questions, errors };
  }

  private showTalkValidationError(errors: string[]): void {
    const group = document.getElementById('talk-validation-group');
    if (group) group.style.display = 'block';
    const errBox = document.getElementById('talk-validation-errors');
    if (errBox) {
      errBox.style.display = 'block';
      errBox.innerHTML = `<strong>${escapeHtml(this.t('editorCannotSave'))}</strong><ul style="margin:6px 0 0 16px; padding:0;">` +
        errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('') +
        '</ul>';
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private showTalkAutofixReport(fixes: string[]): void {
    const group = document.getElementById('talk-validation-group');
    if (group) group.style.display = 'block';
    const banner = document.getElementById('talk-autofix-banner');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = `<strong>${escapeHtml(this.t('editorAutoFixed'))}</strong><ul style="margin:6px 0 0 16px; padding:0;">` +
        fixes.map((f) => `<li>${escapeHtml(f)}</li>`).join('') +
        '</ul>';
    }
  }

  /**
   * Set member count for a specific chatroom (can be called for any chatroom)
   */
  setChatroomMemberCount(chatroomId: string, count: number): void {
    console.log(`📊 Setting member count for ${chatroomId}: ${count} members`);
    this.chatroomMemberCounts.set(chatroomId, count);

    // Refresh chatroom list to show updated counts (without changing view)
    // Only refresh if the DOM element exists (i.e., after initialization)
    const chatroomList = document.getElementById('chatroom-list');
    if (chatroomList) {
      this.renderChatroomList();
    }
  }

  setChatroomVisitCounts(chatroomId: string, counts: { visitCount: number; uniqueVisitorCount: number }): void {
    this.chatroomVisitCounts.set(chatroomId, counts);
    const chatroomList = document.getElementById('chatroom-list');
    if (chatroomList) this.renderChatroomList();
    const status = document.getElementById('current-chatroom-status');
    if (status && this.currentChatroom === chatroomId) {
      const members = this.chatroomMemberCounts.get(chatroomId) || 0;
      status.textContent = this.tf('chatroomMetrics', {
        members: this.tf(members === 1 ? 'chatroomMemberOne' : 'chatroomMembers', { count: members }),
        visits: this.tf(counts.visitCount === 1 ? 'chatroomVisitOne' : 'chatroomVisits', { count: counts.visitCount }),
        unique: this.tf(counts.uniqueVisitorCount === 1 ? 'chatroomUniqueOne' : 'chatroomUniqueVisitors', { count: counts.uniqueVisitorCount }),
      });
    }
  }

  updateChatroomMembers(
    members: Array<{ userId: string; stageName: string }>,
    currentUserId: string,
  ): void {
    this.currentUserId = currentUserId;
    for (const member of members) {
      if (member.userId && member.stageName) {
        this.rememberPeerName(member.userId, member.stageName);
      }
    }
    console.log(
      `📊 Updating member count for ${this.currentChatroom}: ${members.length} total members`,
    );
    renderChatroomMembers(this.chatroomsDeps(), members, currentUserId);
  }

  /**
   * docs/TODO.md K5, design note §Item 4. Fed by app.ts's live `techsupport-inbox/*`
   * subscription (TechSupport-root sessions only) — re-renders the inbox section in place if
   * the Me/Settings tab is currently showing it, matching the presence-indicator patch pattern
   * (no full-page re-render, just this one section).
   */
  updateSupportInboxEntries(entries: SupportInboxEntry[]): void {
    this.currentSupportInboxEntries = entries;
    this.renderSupportInboxSectionIfPresent();
  }

  private renderSupportInboxSectionIfPresent(): void {
    if (!document.getElementById('support-inbox-section')) return;
    renderSupportInboxSection(
      {
        escapeHtml,
        text: this.t.bind(this),
        formatDate: this.formatUiDate.bind(this),
        onAnswer: (input) => this.emit('answerSupportQuestion', input),
      },
      this.currentSupportInboxEntries,
    );
  }

  setMemberMatched(userId: string): void {
    this.matchedUserIds.add(userId);
    const list = document.getElementById('chatroom-members-list');
    const item = list?.querySelector(`.chatroom-member-item[data-user-id="${userId}"]`);
    if (item) {
      item.classList.add('member-matched');
      (item as HTMLElement).dataset.matched = 'true';
      const status = item.querySelector('.chatroom-member-status');
      if (status) status.textContent = this.t('chatroomMatched');
    }
  }

  flashMemberForNewTalk(authorId: string): void {
    const list = document.getElementById('chatroom-members-list');
    const item = list?.querySelector(`.chatroom-member-item[data-user-id="${authorId}"]`);
    if (item) {
      item.classList.remove('flash-new-talk');
      void (item as HTMLElement).offsetWidth;
      item.classList.add('flash-new-talk');
      setTimeout(() => item.classList.remove('flash-new-talk'), 1000);
    }
  }

  /**
   * Rule N2a (redesign §5/§7): clicking a user anywhere pushes two levels in one
   * action — the shared ⟨User⟩ layout, then the default DM ⟨Conv⟩ on top. Back then
   * pops normally: Conversation → User layout → opener.
   */
  public openUserConversationFirst(userId: string, stageName: string): void {
    this.openPeerDetailForUser(userId, stageName);
    void this.openDirectConversationWithPeer(userId, stageName);
  }

  /**
   * TODO §O: an exchanged-talk history row (mismatch/pending/never-messaged) has no conversation
   * record yet — talkId lets the caller open that talk as the DM's active thread context from
   * the very first message, instead of always starting talk-independent from scratch.
   */
  private async openDirectConversationWithPeer(peerId: string, peerName: string, talkId?: string): Promise<void> {
    try {
      const conversationId = await new Promise<string>((resolve, reject) => {
        this.emit('openDirectConversation', { peerId, peerName, resolve, reject });
      });
      if (conversationId) this.showConversationDetail(conversationId, talkId);
    } catch {
      // The ⟨User⟩ layout stays on screen when the DM channel cannot be opened.
    }
  }

  private openPeerDetailForUser(userId: string, stageName: string): void {
    const knownPerson = this.getKnownPerson(userId);
    const deps = {
      currentUserId: this.currentUserId,
      apiBase: this.apiBase,
      getMyConversations: this.getMyConversations.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      getCurrentInterests: () => Array.isArray(this.currentUser?.interests) ? this.currentUser!.interests : [],
      getProfileLanguages: () => this.currentUser?.languages || ['en'],
      showConversationDetail: this.showConversationDetail.bind(this),
      registerTalkForPeer: this.registerTalkForPeer.bind(this),
      isBlockedByMe: this.isBlockedByMe.bind(this),
      setBlocked: this.setBlocked.bind(this),
      isSupportContact: (candidateId: string) => candidateId === TECHSUPPORT_ROOT_USER_ID,
      isSupportNotificationsMuted: this.isSupportNotificationsMuted.bind(this),
      setSupportNotificationsMuted: this.setSupportNotificationsMuted.bind(this),
      getTransportStatus: () => {
        const conversation = Object.values(this.getMyConversations())
          .filter((candidate: any) => candidate?.otherUserId === userId)
          .sort((a: any, b: any) =>
            new Date(b.lastMessageTime || b.createdAt || 0).getTime()
            - new Date(a.lastMessageTime || a.createdAt || 0).getTime(),
          )[0] as { transportMode?: string; transportFallbackReason?: string | null; lastMessageTime?: string | null } | undefined;
        return {
          mode: String(conversation?.transportMode || 'direct-p2p'),
          fallbackReason: conversation?.transportFallbackReason ?? null,
          lastHealthyAt: conversation?.lastMessageTime ?? null,
        };
      },
      text: this.t.bind(this),
      formatRelativeTime: this.formatTalkRelativeTime.bind(this),
      formatType: this.formatTalkType.bind(this),
      formatLanguage: this.formatTalkLanguage.bind(this),
      ...(this.publicProfileFoundationReader ? { getPublicProfileFoundation: this.publicProfileFoundationReader } : {}),
      sendDirectMessage: (peerId: string, peerName: string, text: string) => {
        return new Promise<void>((resolve, reject) => {
          // Send-path content filter (redesign §9): block before emitting so no
          // message leaves the device; the composer keeps its text.
          if (!this.allowOutgoingMessage(text)) {
            reject(new Error('content_filter_blocked'));
            return;
          }
          this.emit('sendDirectMessage', { peerId, peerName, text, resolve, reject });
        });
      },
      openDirectConversation: (peerId: string, peerName: string, talkId?: string) => {
        void this.openDirectConversationWithPeer(peerId, peerName, talkId);
      },
      openTalkResponses: (talkId: string, talkTitle: string) => {
        this.showCreatorRepliesForTalk(talkId, talkTitle);
      },
      renderPeerContext: (container: HTMLElement, peerId: string, peerName: string) => {
        this.renderPeerContextSection(container, peerId, peerName);
      },
      resolvePeerStageName: this.resolvePeerStageNameLive.bind(this),
      isLinkedIdentity: this.isLinkedIdentityLive.bind(this),
      ...(knownPerson ? { knownPerson } : {}),
    };
    openPeerDetailView(userId, stageName, deps);
  }

  /**
   * Relationship/credit context + editor entry for the shared ⟨User⟩ layout —
   * the same renderer the old contact-detail page used (redesign §5 parity).
   */
  private renderPeerContextSection(container: HTMLElement, peerId: string, peerName: string): void {
    container.innerHTML = '';
    const deps = this.contactsViewDeps(() => this.displayContactsList());
    const button = document.createElement('button');
    button.id = 'contact-edit-relationship-btn';
    button.className = 'btn';
    button.type = 'button';
    button.setAttribute('data-testid', 'contact-edit-relationship-btn');
    button.textContent = this.t(
      peerId === TECHSUPPORT_ROOT_USER_ID ? 'contactSupportControls' : 'contactRelationshipCredit',
    );
    button.style.cssText = 'margin:12px 16px 0;padding:6px 12px;font-size:0.85em;';
    button.addEventListener('click', () => {
      void openRelationshipDialog(deps, peerId, peerName);
    });
    container.appendChild(button);
    renderContactContextSummaryInto(container, deps, peerId, null, this.isBlockedByMe(peerId), false);
  }

  private getKnownPeople(): KnownPerson[] {
    return Array.isArray(this.currentUser?.knownPeople) ? this.currentUser!.knownPeople! : [];
  }

  private getKnownPerson(userId: string): KnownPerson | undefined {
    return this.getKnownPeople().find((entry) => entry.userId === userId);
  }

  private isBlockedByMe(userId: string): boolean {
    return Array.isArray(this.currentUser?.blockedUserIds) && this.currentUser!.blockedUserIds!.includes(userId);
  }

  private hasSupportContact(): boolean {
    return Object.values(this.getMyConversations()).some(
      (conversation: any) => conversation?.supportChannel === true && conversation?.otherUserId === TECHSUPPORT_ROOT_USER_ID,
    );
  }

  /**
   * Liveness, never headcount (K1-2, docs/TODO.md). Whether TechSupport's device is currently
   * reachable is independent of whether it counts toward the room — that floor is unconditional
   * (see `techSupportRosterMember`/`seedTechSupportGlobalMembership`). Defaults to away until a
   * positive presence signal arrives (app.ts wires this from `P2PPresenceClient.fetchNearby`), so
   * a device that has never connected — or hasn't been built yet (K3) — reads as away, not a
   * stuck "checking" state.
   */
  private techSupportOnline = false;

  private isTechSupportOnline(): boolean {
    return this.techSupportOnline;
  }

  public setTechSupportOnlineStatus(online: boolean): void {
    if (this.techSupportOnline === online) return;
    this.techSupportOnline = online;
    const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
    // getMyConversations()/deriveLocalPeers() read live localStorage, never a stale snapshot,
    // so a full re-render here is safe.
    if (contactsTab?.classList.contains('active')) this.displayContactsList();
    // The chatroom roster is NOT re-rendered from `currentChatroomMembers` here — that array is
    // a point-in-time snapshot from the last live subscription emit, and `#chatroom-members-list`
    // exists in the static shell regardless of which tab is active, so re-rendering from it would
    // risk clobbering a since-arrived member (e.g. a peer whose row synced in after this snapshot
    // was captured) with stale data. Instead, patch only the TechSupport presence dot in place —
    // a no-op if the row isn't currently rendered.
    this.patchTechSupportPresenceIndicators();
  }

  private patchTechSupportPresenceIndicators(): void {
    const indicators = document.querySelectorAll<HTMLElement>('.techsupport-presence-indicator');
    for (const el of Array.from(indicators)) {
      el.classList.toggle('online', this.techSupportOnline);
      el.classList.toggle('away', !this.techSupportOnline);
      el.setAttribute('data-techsupport-online', String(this.techSupportOnline));
      el.setAttribute('aria-label', this.t(this.techSupportOnline ? 'contactsSupportOnline' : 'contactsSupportAway'));
    }
  }

  public isSupportNotificationsMuted(): boolean {
    if (!this.currentUserId) return false;
    return localStorage.getItem(`iinpublic_support_notifications_muted:${this.currentUserId}`) === '1';
  }

  private async setSupportNotificationsMuted(muted: boolean): Promise<void> {
    if (!this.currentUserId) return;
    localStorage.setItem(`iinpublic_support_notifications_muted:${this.currentUserId}`, muted ? '1' : '0');
    this.showNotification(this.t(muted ? 'contactSupportMutedNotice' : 'contactSupportUnmutedNotice'), 'info');
    this.displayContactsList();
  }

  private async saveKnownPerson(
    userId: string,
    details: {
      labels: KnownPerson['labels'];
      nickname?: string;
      customLabel?: string;
      rating?: number;
      notes?: string;
    },
  ): Promise<void> {
    if (!this.currentUser) return;
    const nextEntry: KnownPerson = {
      userId,
      labels: details.labels,
      ...(details.nickname ? { nickname: details.nickname } : {}),
      ...(details.customLabel ? { customLabel: details.customLabel } : {}),
      ...(typeof details.rating === 'number' ? { rating: details.rating } : {}),
      ...(details.notes ? { notes: details.notes } : {}),
      addedAt: new Date(),
    };
    const knownPeople = [
      ...(this.currentUser.knownPeople || []).filter((entry) => entry.userId !== userId),
      nextEntry,
    ];
    this.currentUser.knownPeople = knownPeople;
    this.emit('saveKnownPerson', { userId, ...details });
    this.displayContactsList();
  }

  private async submitPeerReview(userId: string, rating: number): Promise<void> {
    this.emit('submitPeerReview', { userId, rating });
  }

  private async vouchAgeVerified(userId: string): Promise<void> {
    this.emit('vouchAgeVerified', { userId });
  }

  private async setBlocked(userId: string, blocked: boolean): Promise<void> {
    if (!this.currentUser) return;
    if (this.apiBase && this.currentUserId) {
      const url = blocked
        ? `${this.apiBase}/api/users/${encodeURIComponent(this.currentUserId)}/blocks`
        : `${this.apiBase}/api/users/${encodeURIComponent(this.currentUserId)}/blocks/${encodeURIComponent(userId)}`;
      const response = await fetch(
        url,
        blocked
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetId: userId }),
            }
          : { method: 'DELETE' },
      );
      if (!response.ok) throw new Error(`Failed to ${blocked ? 'block' : 'unblock'} user: HTTP ${response.status}`);
    }
    this.currentUser.blockedUserIds = blocked
      ? Array.from(new Set([...(this.currentUser.blockedUserIds || []), userId]))
      : (this.currentUser.blockedUserIds || []).filter((candidate) => candidate !== userId);
    this.emit('setUserBlocked', { userId, blocked });
    this.displayContactsList();
  }

  private getPeerName(userId: string, fallbackName?: string): string {
    // LIVE source first: the chatroom roster tracks the peer's CURRENT stage name via Gun
    // member updates. Names embedded in conversation/exchange records were captured at
    // match/broadcast time and go permanently stale when a rename raced the exchange (the
    // e2e bootstraps rename immediately before broadcasting — real users rename too).
    // Recorded names remain as fallbacks for peers who are no longer in the room.
    const currentMember = this.currentChatroomMembers.find((member) => member.userId === userId);
    const conversationMatch = Object.values(this.getMyConversations()).find(
      (conversation: any) => conversation.otherUserId === userId && conversation.otherUserName,
    ) as { otherUserName?: string } | undefined;
    const incomingSenderName = this.incomingTalkClusters
      .flatMap((cluster: any) => Object.values(cluster?.senders || {}) as Array<{ senderId?: string; senderName?: string }>)
      .find((sender) => sender?.senderId === userId && sender?.senderName)?.senderName;
    const cachedName = this.getPeerNameCache()[userId];
    const resolved = currentMember?.stageName || conversationMatch?.otherUserName || incomingSenderName || cachedName || fallbackName || 'Unknown';
    if (resolved && resolved !== 'Unknown') this.rememberPeerName(userId, resolved);
    return resolved;
  }

  /**
   * Live stage-name lookup for render-time self-healing: recorded exchange/conversation
   * names can be stale (captured before a peer renamed). The public-user read is
   * rename-fresh (server cache overlay + Gun graph). Successful lookups flow through
   * rememberPeerName so cached names and stored conversation records converge too.
   */
  private async resolvePeerStageNameLive(userId: string): Promise<string | null> {
    try {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      const user = await app?.gunService?.getPublicUser?.(userId);
      const name = String(user?.stageName || '').trim();
      if (!name) return null;
      this.rememberPeerName(userId, name);
      return name;
    } catch {
      return null;
    }
  }

  /**
   * TODO §I — resolves the peer's SEA pubkey live (same `getPublicUser` read as
   * `resolvePeerStageNameLive`), then asks `WebIdentityLinkService` (via
   * `identityLinkChecker`, wired by `setIdentityLinkHooks`) whether the viewer holds a
   * verified, mutual link to that pubkey. `linkStateWith`/`isLinked` are self-scoped (they
   * resolve the edge between the viewer's OWN identity and `pub`), so this only ever
   * answers "is this peer one of MY OWN linked identities" — never a general "does this
   * peer have any links to anyone."
   */
  private async isLinkedIdentityLive(peerId: string): Promise<boolean> {
    if (!this.identityLinkChecker) return false;
    try {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      const user = await app?.gunService?.getPublicUser?.(peerId);
      const pub = String(user?.pub || '').trim();
      if (!pub) return false;
      return await this.identityLinkChecker(pub);
    } catch {
      return false;
    }
  }

  private getPeerNameCache(): Record<string, string> {
    try {
      const raw = localStorage.getItem('peerNameCache');
      return raw ? JSON.parse(raw) as Record<string, string> : {};
    } catch {
      return {};
    }
  }

  private rememberPeerName(userId: string, stageName: string): void {
    const trimmedId = String(userId || '').trim();
    const trimmedName = String(stageName || '').trim();
    if (!trimmedId || !trimmedName) return;
    const cache = this.getPeerNameCache();
    if (cache[trimmedId] === trimmedName) return;
    cache[trimmedId] = trimmedName;
    localStorage.setItem('peerNameCache', JSON.stringify(cache));
    // Self-heal recorded names: conversation records embed the peer name captured at match
    // time; when a fresher name resolves (rename observed via the live roster), sync it into
    // stored conversations so the conversation list, contact derivation, and anything that
    // reads `myConversations` from localStorage all converge on the current name.
    try {
      const conversations = this.getMyConversations() as Record<string, any>;
      let changed = false;
      for (const conversation of Object.values(conversations)) {
        if (
          conversation &&
          conversation.otherUserId === trimmedId &&
          conversation.supportChannel !== true &&
          conversation.otherUserName !== trimmedName
        ) {
          conversation.otherUserName = trimmedName;
          changed = true;
        }
      }
      if (changed) localStorage.setItem('myConversations', JSON.stringify(conversations));
    } catch {
      /* name sync is best-effort — never break the caller's render */
    }
  }

  private async registerTalkForPeer(talkId: string, talkData: any, peerId: string, peerName: string): Promise<void> {
    // P0 step 7: server talk delivery removed. Always route via mesh (sendDirectTalkToPeer).
    const app = (
      window as unknown as {
        __iinpublic_app?: {
          getApp: () => {
            sendDirectTalkToPeer?: (
              talkId: string,
              talkData: unknown,
              peerId: string,
              peerName: string,
            ) => Promise<void>;
          };
        };
      }
    ).__iinpublic_app?.getApp?.();
    if (app?.sendDirectTalkToPeer) {
      await app.sendDirectTalkToPeer(talkId, talkData, peerId, peerName);
      return;
    }
    // No mesh connection available — no-op (star path removed).
    console.warn('registerTalkForPeer: sendDirectTalkToPeer unavailable, skipping delivery to', peerId);
  }

  updateMatchBadge(): void {
    // Count unread conversations
    const conversations = this.getMyConversations();
    const unreadCount = Object.values(conversations).filter((conv: any) => {
      return conv?.unread && conv.supportChannel !== true;
    }).length;

    // Update badge on Me tab
    const meTab = document.querySelector('.nav-btn[data-view="me"] .nav-icon');
    if (meTab) {
      // Remove existing badge
      const existingBadge = meTab.querySelector('.notification-badge');
      if (existingBadge) existingBadge.remove();

      // Add new badge if there are unread conversations
      if (unreadCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'notification-badge';
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
        meTab.appendChild(badge);
      }
    }

    // TODO §N2: same aggregate count badges the always-visible DM inbox icon, reachable from
    // every tab (unlike the Me-tab badge above, which only shows while on the Me tab).
    const dmInboxBtn = document.getElementById('dm-inbox-btn');
    if (dmInboxBtn) {
      const existingBadge = dmInboxBtn.querySelector('.notification-badge');
      if (existingBadge) existingBadge.remove();
      if (unreadCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'notification-badge';
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
        dmInboxBtn.appendChild(badge);
      }
    }
  }

  /** True when a message belongs to the currently open thread scope (DM vs per-talk). */
  private messageInCurrentThread(msg: { talkId?: string }): boolean {
    const msgTalkId = String(msg?.talkId || '');
    if (this.currentThreadTalkId) return msgTalkId === this.currentThreadTalkId;
    // DM scope: legacy messages (no talkId) and explicit direct messages.
    return !msgTalkId || msgTalkId === 'direct';
  }

  /** Re-render the thread rows of an open ⟨User⟩ layout (unread badges, snippets). */
  private refreshOpenPeerThreadList(): void {
    const overlay = document.getElementById('peer-detail-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    refreshPeerThreadList();
  }

  /** Re-render the open conversation from the last synced messages (filter toggle, §9). */
  private rerenderOpenConversation(): void {
    if (!this.currentConversationId) return;
    this.displayConversationMessages(this.currentConversationId, this.lastConversationMessages);
  }

  /** app.ts wires this so decrypted attachment bytes become a viewable blob URL. */
  setSharedAttachmentResolver(fn: (cid: string, mimeType: string) => Promise<string | null>): void {
    this.sharedAttachmentResolver = fn;
  }

  /** app.ts calls this once a shared attachment's bytes finish downloading, so the image appears. */
  refreshOpenConversationForAttachment(): void {
    this.rerenderOpenConversation();
  }

  /** Parse an `IPFS_SHARE:` auto-share message body into its attachment fields. */
  private parseIpfsSharePayload(text: string): { cid: string; link: string; name: string; mimeType: string; sizeBytes: number } | null {
    const raw = String(text || '');
    if (!raw.startsWith('IPFS_SHARE:')) return null;
    try {
      const p = JSON.parse(raw.slice('IPFS_SHARE:'.length));
      const cid = String(p?.cid || '').trim();
      if (!cid || p?.kind !== 'ipfs-auto-share-v1') return null;
      return {
        cid,
        link: String(p?.link || `ipfs://${cid}`),
        name: String(p?.name || 'attachment'),
        mimeType: String(p?.mimeType || ''),
        sizeBytes: Number(p?.sizeBytes) || 0,
      };
    } catch {
      return null;
    }
  }

  private formatAttachmentSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * A safe download filename: keep the sender's name if it already has an extension, otherwise
   * append one derived from the mime type. Without an extension the OS saves an unopenable
   * blob-UUID file (macOS can't tell a `d393a824-…` file is a PNG).
   */
  private attachmentDownloadFilename(rawName: string, mimeType: string): string {
    const base = String(rawName || '').trim() || 'download';
    if (/\.[a-z0-9]{1,6}$/i.test(base)) return base;
    const m = String(mimeType || '').toLowerCase();
    const ext = m === 'image/jpeg' ? 'jpg'
      : m === 'image/png' ? 'png'
      : m === 'image/gif' ? 'gif'
      : m === 'image/webp' ? 'webp'
      : m === 'image/avif' ? 'avif'
      : m === 'image/svg+xml' ? 'svg'
      : m === 'application/pdf' ? 'pdf'
      : m.startsWith('video/') ? (m.split('/')[1] || 'mp4')
      : m.startsWith('audio/') ? (m.split('/')[1] || 'mp3')
      : m.startsWith('text/') ? 'txt'
      : '';
    return ext ? `${base}.${ext}` : base;
  }

  /** Emoji cue by media type — messenger-style icon for the attachment card. */
  private attachmentIconForMime(mimeType: string): string {
    const m = String(mimeType || '').toLowerCase();
    if (m.startsWith('image/')) return '🖼️';
    if (m.startsWith('video/')) return '🎬';
    if (m.startsWith('audio/')) return '🎵';
    if (m === 'application/pdf') return '📕';
    if (m.startsWith('text/') || m.includes('word') || m.includes('document') || m.includes('sheet') || m.includes('presentation')) return '📄';
    if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return '🗜️';
    return '📎';
  }

  /**
   * One-time delegated click binding (same idiom as `talksListDelegationBound` above — the
   * message list is re-rendered wholesale on every sync, so per-button listeners would need
   * rebinding on every render; a single body-level delegated listener survives re-renders for
   * free). Tapping a `.captured-question-answer-btn` sends its answer text back as an
   * ordinary reply message — see `renderCapturedQuestionMessage`'s doc comment for why this
   * is a quick-reply convenience, not a formal talk-answer submission.
   */
  private bindCapturedQuestionChipDelegation(): void {
    if (this.captureChipDelegationBound) return;
    this.captureChipDelegationBound = true;
    document.body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.captured-question-answer-btn') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const messageId = btn.dataset.messageId || '';
      const answerText = btn.dataset.answerText || '';
      if (!messageId || !answerText || !this.currentConversationId) return;

      this.answeredCaptureChipMessageIds.add(messageId);
      const card = document.querySelector(`.captured-question-card[data-message-id="${CSS.escape(messageId)}"]`);
      if (card) {
        card.classList.add('captured-question-answered');
        card.querySelectorAll('.captured-question-answer-btn').forEach((b) => {
          (b as HTMLButtonElement).disabled = true;
        });
      }

      this.emit('sendConversationMessage', {
        conversationId: this.currentConversationId,
        message: answerText,
        ...(this.currentThreadTalkId ? { talkId: this.currentThreadTalkId } : {}),
      });
    });
  }

  /**
   * docs/TODO.md §V — Auto Linear Capture, UI-1d: "lines matching `Question? Answer1; …;
   * AnswerN.` SHALL render answers as tappable chips" instead of a plain text bubble — same
   * detect-a-marked-payload-and-render-specially shape as `renderIpfsAttachmentMessage`
   * above. Tapping a chip is a quick-reply convenience (sends the chosen answer text back as
   * an ordinary message), not a formal talk-answer submission — the real Talk this session is
   * building doesn't exist yet mid-capture (it's only created once the sender's session
   * finalizes), so there's nothing to run `completeTalk`/`checkIfMatch` against until then.
   * Once `messageId` has been tapped once, `answeredCaptureChipMessageIds` disables it on
   * re-render so a page refresh mid-conversation doesn't invite a duplicate reply.
   */
  private renderCapturedQuestionMessage(
    payload: { question: string; answers: string[] },
    isOwn: boolean,
    timestamp: unknown,
    messageId: string,
  ): string {
    const alreadyAnswered = this.answeredCaptureChipMessageIds.has(messageId);
    const question = escapeHtml(payload.question);
    const buttons = payload.answers
      .map((answer, index) => `
        <button
          type="button"
          class="captured-question-answer-btn"
          data-testid="captured-question-answer-btn"
          data-message-id="${escapeHtml(messageId)}"
          data-answer-index="${index}"
          data-answer-text="${escapeHtml(answer)}"
          ${alreadyAnswered ? 'disabled' : ''}
        >${escapeHtml(answer)}</button>
      `)
      .join('');
    return `
      <div class="message ${isOwn ? 'message-own' : 'message-other'}">
        <div class="message-content">
          <div class="captured-question-card${alreadyAnswered ? ' captured-question-answered' : ''}" data-testid="captured-question-card" data-message-id="${escapeHtml(messageId)}">
            <div class="captured-question-text">${question}</div>
            <div class="captured-question-answers">${buttons}</div>
          </div>
          <div class="message-time">${this.formatTalkRelativeTime(new Date(timestamp as any))}</div>
        </div>
      </div>
    `;
  }

  /**
   * Inline attachment chip: a small preview thumbnail (images) or file icon, name + size, and
   * a small Download link. Tapping an image thumbnail opens the full-size in-app viewer; the
   * Shared-media gallery (🖼 in the header) collects everything.
   */
  private renderIpfsAttachmentMessage(
    share: { cid: string; link: string; name: string; mimeType: string; sizeBytes: number },
    isOwn: boolean,
    timestamp: unknown,
  ): string {
    const isImage = share.mimeType.startsWith('image/');
    const icon = this.attachmentIconForMime(share.mimeType);
    const safeName = this.attachmentDownloadFilename(share.name, share.mimeType);
    const name = escapeHtml(safeName);
    const size = escapeHtml(this.formatAttachmentSize(share.sizeBytes));
    const cid = escapeHtml(share.cid);
    const mime = escapeHtml(share.mimeType);
    const downloadLabel = escapeHtml(this.t('attachmentDownload'));
    const lead = isImage
      ? `<img class="ipfs-attachment-img ipfs-attachment-thumb" alt="${name}" hidden />`
      : `<span class="ipfs-attachment-icon">${icon}</span>`;
    return `
      <div class="message ${isOwn ? 'message-own' : 'message-other'}">
        <div class="message-content">
          <div class="ipfs-attachment ipfs-attachment-chip${isImage ? ' ipfs-attachment-chip-image' : ''}" data-testid="ipfs-attachment" data-ipfs-cid="${cid}" data-ipfs-mime="${mime}" data-ipfs-name="${name}" title="${name}">
            ${lead}
            <span class="ipfs-attachment-meta">
              <span class="ipfs-attachment-name">${name}</span>
              ${size ? `<span class="ipfs-attachment-size">${size}</span>` : ''}
              <span class="ipfs-attachment-loading" aria-hidden="true">⏳</span>
              <a class="ipfs-attachment-download" download="${name}" title="${downloadLabel}" aria-label="${downloadLabel}" hidden>⬇</a>
            </span>
          </div>
          <div class="message-time">${this.formatTalkRelativeTime(new Date(timestamp as any))}</div>
        </div>
      </div>
    `;
  }

  /** URL/name of the photo currently open in the lightbox (for its Download button). */
  private lightboxTarget: { url: string; name: string; mime: string } | null = null;

  private setupLightbox(): void {
    const close = () => this.closeLightbox();
    document.getElementById('media-lightbox-close')?.addEventListener('click', close);
    document.getElementById('media-lightbox-backdrop')?.addEventListener('click', close);
    document.getElementById('media-lightbox-download')?.addEventListener('click', () => {
      if (this.lightboxTarget) void this.saveObjectUrlAs(this.lightboxTarget.url, this.lightboxTarget.name, this.lightboxTarget.mime);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('media-lightbox')?.style.display === 'flex') close();
    });
  }

  /** Open a shared photo full-size inside the app. */
  private openLightbox(url: string, name: string, mime: string): void {
    const box = document.getElementById('media-lightbox');
    const img = document.getElementById('media-lightbox-img') as HTMLImageElement | null;
    const label = document.getElementById('media-lightbox-name');
    if (!box || !img) return;
    this.lightboxTarget = { url, name, mime };
    img.src = url;
    if (label) label.textContent = name;
    box.style.display = 'flex';
  }

  private closeLightbox(): void {
    const box = document.getElementById('media-lightbox');
    if (box) box.style.display = 'none';
    this.lightboxTarget = null;
  }

  /**
   * Save a blob URL under a real filename. Prefer the File System Access API (a native "save
   * as" dialog — guarantees the name/extension and lets the user pick a location, so files are
   * never dropped as an unopenable blob-UUID). Fall back to an <a download> anchor.
   */
  private async saveObjectUrlAs(objectUrl: string, name: string, mimeType: string): Promise<void> {
    const anySelf = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<unknown> };
    if (typeof anySelf.showSaveFilePicker === 'function') {
      try {
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 ? name.slice(dot) : '';
        const handle = await anySelf.showSaveFilePicker({
          suggestedName: name,
          ...(ext ? { types: [{ description: 'File', accept: { [mimeType || 'application/octet-stream']: [ext] } }] } : {}),
        }) as { createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> };
        const blob = await (await fetch(objectUrl)).blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        // User cancelled the picker, or it's unavailable — fall through to the anchor.
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /**
   * After rendering, turn the bytes this device holds into a usable blob URL for each
   * attachment: gallery image tiles get a preview, and every card/tile/chip becomes
   * click-to-save under the real filename once the bytes arrive.
   */
  private hydrateAttachmentImages(container: HTMLElement): void {
    if (!this.sharedAttachmentResolver) return;
    const cards = container.querySelectorAll('.ipfs-attachment[data-ipfs-cid]');
    cards.forEach((cardEl) => {
      const card = cardEl as HTMLElement;
      if (card.dataset.localReady === '1') return; // already using local bytes
      const cid = card.getAttribute('data-ipfs-cid') || '';
      const mime = card.getAttribute('data-ipfs-mime') || '';
      const name = card.getAttribute('data-ipfs-name') || 'download';
      const img = card.querySelector('img.ipfs-attachment-img') as HTMLImageElement | null;
      const dl = card.querySelector('a.ipfs-attachment-download') as HTMLAnchorElement | null;
      let objectUrl = '';
      const isImage = mime.startsWith('image/');
      const save = (e: Event) => { e.preventDefault(); e.stopPropagation(); void this.saveObjectUrlAs(objectUrl, name, mime); };
      const view = (e: Event) => { e.stopPropagation(); this.openLightbox(objectUrl, name, mime); };
      void this.sharedAttachmentResolver!(cid, mime).then((url) => {
        if (!url) return; // bytes not here yet — a later fetch/re-render resolves it
        objectUrl = url;
        card.dataset.localReady = '1';
        card.style.cursor = 'pointer';
        // Images open the in-app viewer on tap; files download on tap.
        card.onclick = isImage ? view : save;
        const loading = card.querySelector('.ipfs-attachment-loading') as HTMLElement | null;
        if (loading) loading.hidden = true;
        if (img) {
          img.src = url;
          img.hidden = false;
        }
        // The small Download link always saves the file.
        if (dl) {
          dl.hidden = false;
          dl.onclick = save;
        }
      }).catch(() => { /* leave the loading state; a later fetch/re-render can resolve it */ });
    });
  }

  /** Active shared-media gallery tab. */
  private mediaGalleryTab: 'media' | 'files' | 'links' = 'media';

  /** One-time wiring for the shared-media gallery buttons + tabs (called from setupBaseUI). */
  private setupMediaGallery(): void {
    document.getElementById('conversation-media-btn')?.addEventListener('click', () => this.openMediaGallery());
    document.getElementById('back-from-media')?.addEventListener('click', () => this.closeMediaGallery());
    const tabLabels: Record<string, UiTranslationKey> = {
      media: 'mediaTabMedia', files: 'mediaTabFiles', links: 'mediaTabLinks',
    };
    document.querySelectorAll('.conversation-media-tab').forEach((el) => {
      const tab = (el as HTMLElement).getAttribute('data-media-tab') || '';
      if (tabLabels[tab]) (el as HTMLElement).textContent = this.t(tabLabels[tab]);
      el.addEventListener('click', () => {
        if (tab === 'media' || tab === 'files' || tab === 'links') this.setMediaGalleryTab(tab);
      });
    });
  }

  /** All IPFS_SHARE attachments in the open conversation, split by kind, newest first. */
  private collectSharedAttachments(): {
    media: Array<{ cid: string; link: string; name: string; mimeType: string; sizeBytes: number }>;
    files: Array<{ cid: string; link: string; name: string; mimeType: string; sizeBytes: number }>;
  } {
    const media: Array<{ cid: string; link: string; name: string; mimeType: string; sizeBytes: number }> = [];
    const files: Array<{ cid: string; link: string; name: string; mimeType: string; sizeBytes: number }> = [];
    const seen = new Set<string>();
    for (const msg of this.lastConversationMessages || []) {
      const share = this.parseIpfsSharePayload(String(msg?.text || ''));
      if (!share || seen.has(share.cid)) continue;
      seen.add(share.cid);
      const isMedia = share.mimeType.startsWith('image/') || share.mimeType.startsWith('video/');
      (isMedia ? media : files).push(share);
    }
    return { media: media.reverse(), files: files.reverse() };
  }

  /** http(s):// URLs found in plain text messages of the open conversation, newest first. */
  private collectSharedLinks(): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();
    const re = /https?:\/\/[^\s<>"')]+/gi;
    for (const msg of this.lastConversationMessages || []) {
      const text = String(msg?.text || '');
      if (text.startsWith('IPFS_SHARE:')) continue;
      for (const m of text.match(re) || []) {
        const url = m.replace(/[.,)]+$/, '');
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
    }
    return urls.reverse();
  }

  private renderMediaTile(share: { cid: string; link: string; name: string; mimeType: string; sizeBytes: number }): string {
    const isImage = share.mimeType.startsWith('image/');
    const safeName = this.attachmentDownloadFilename(share.name, share.mimeType);
    const name = escapeHtml(safeName);
    const cid = escapeHtml(share.cid);
    const mime = escapeHtml(share.mimeType);
    const size = escapeHtml(this.formatAttachmentSize(share.sizeBytes));
    const icon = this.attachmentIconForMime(share.mimeType);
    const thumb = isImage
      ? `<img class="ipfs-attachment-img media-tile-img" alt="${name}" hidden />`
      : `<div class="media-tile-fileicon">${icon}</div>`;
    return `
      <div class="conversation-media-tile ipfs-attachment" data-testid="media-tile" data-ipfs-cid="${cid}" data-ipfs-mime="${mime}" data-ipfs-name="${name}" title="${name}">
        ${thumb}
        <a class="ipfs-attachment-download media-tile-download" download="${name}" hidden>⬇</a>
        <div class="media-tile-name">${name}</div>
        ${size ? `<div class="media-tile-size">${size}</div>` : ''}
      </div>
    `;
  }

  private renderMediaLinkRow(url: string): string {
    const safe = escapeHtml(url);
    return `<a class="conversation-media-link" href="${safe}" target="_blank" rel="noopener noreferrer" data-testid="media-link">${safe}</a>`;
  }

  /** Render the active tab's content into the grid (media/files grid, or a links list). */
  private renderMediaGalleryTab(): void {
    const grid = document.getElementById('conversation-media-grid');
    if (!grid) return;
    const { media, files } = this.collectSharedAttachments();
    let count = 0;
    if (this.mediaGalleryTab === 'links') {
      const links = this.collectSharedLinks();
      count = links.length;
      grid.classList.add('is-list');
      grid.innerHTML = links.length === 0
        ? `<p class="conversation-media-empty">${escapeHtml(this.t('mediaLinksEmpty'))}</p>`
        : links.map((u) => this.renderMediaLinkRow(u)).join('');
    } else {
      const items = this.mediaGalleryTab === 'files' ? files : media;
      count = items.length;
      grid.classList.remove('is-list');
      grid.innerHTML = items.length === 0
        ? `<p class="conversation-media-empty">${escapeHtml(this.t('mediaGalleryEmpty'))}</p>`
        : items.map((m) => this.renderMediaTile(m)).join('');
      this.hydrateAttachmentImages(grid);
    }
    const title = document.getElementById('conversation-media-title');
    if (title) title.textContent = this.tf('mediaGalleryTitle', { count });
  }

  private setMediaGalleryTab(tab: 'media' | 'files' | 'links'): void {
    this.mediaGalleryTab = tab;
    document.querySelectorAll('.conversation-media-tab').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).getAttribute('data-media-tab') === tab);
    });
    this.renderMediaGalleryTab();
  }

  private openMediaGallery(): void {
    const gallery = document.getElementById('conversation-media-gallery');
    const messages = document.getElementById('conversation-messages');
    const composer = document.querySelector('.conversation-input-container') as HTMLElement | null;
    if (!gallery) return;
    this.setMediaGalleryTab(this.mediaGalleryTab);
    if (messages) messages.style.display = 'none';
    if (composer) composer.style.display = 'none';
    gallery.style.display = 'flex';
  }

  private closeMediaGallery(): void {
    const gallery = document.getElementById('conversation-media-gallery');
    const messages = document.getElementById('conversation-messages');
    const composer = document.querySelector('.conversation-input-container') as HTMLElement | null;
    if (gallery) gallery.style.display = 'none';
    if (messages) messages.style.display = '';
    if (composer) composer.style.display = '';
  }

  /**
   * K2 (docs/TODO.md): authenticity check for a *stored* TechSupport greeting record —
   * defends against tampering after the write-time verification in
   * `ensureSupportBootstrapForCurrentUser` (a corrupted downstream write, e.g. from a
   * compromised peer or a bug, must never render as if it were genuine). Re-derives the
   * template from the client's own compiled copy (never trusts a stored template string),
   * and additionally confirms the stored `text` is exactly what that verified template
   * renders to for the *current* user — closing the gap where `greetingSignature`/
   * `greetingLocale` are left untouched but `text` itself was altered after signing.
   *
   * K5 (docs/TODO.md): same discipline extended to the two other TechSupport-authored,
   * locally-rendered message types — a FAQ auto-answer (`faqSignature`) and the new-question
   * ack (`ackSignature`). All three fail closed (K2-3): a verify failure drops the message
   * silently, no error toast, no impersonated message rendered. Everything else passes
   * through unchanged.
   */
  private async filterVerifiedSupportMessages(messages: any[]): Promise<any[]> {
    const stageName = this.currentUser?.stageName || '';
    const kept: any[] = [];
    for (const msg of messages) {
      const isGreeting =
        typeof msg?.id === 'string' &&
        msg.id.startsWith('support_welcome_') &&
        msg.senderId === TECHSUPPORT_ROOT_USER_ID &&
        !!msg.greetingSignature;
      const isFaqAnswer = msg.senderId === TECHSUPPORT_ROOT_USER_ID && !!msg.faqSignature;
      const isAck = msg.senderId === TECHSUPPORT_ROOT_USER_ID && !!msg.ackSignature;

      if (isFaqAnswer) {
        const cached = readCachedFaqBundle();
        const verifiedBundle = cached ? await verifyFaqBundle(cached) : null;
        if (!verifiedBundle) continue;
        // The message must be attributed to the exact cached bundle version, not merely
        // any validly-signed bundle — otherwise a stale message could survive a bundle
        // rotation with a mismatched answer for the same questionKey.
        if (verifiedBundle.authorPub !== msg.faqAuthorPub || verifiedBundle.signature !== msg.faqSignature) continue;
        const entry = verifiedBundle.entries.find((e) => e.questionKey === msg.faqQuestionKey);
        if (!entry || entry.answer !== String(msg.text || '')) continue;
        kept.push(msg);
        continue;
      }

      if (isAck) {
        const locale = msg.ackLocale as SupportAckLocale;
        const verified = await verifySupportAck({
          locale,
          template: TECHSUPPORT_SUPPORT_ACK_TEMPLATES[locale],
          authorPub: msg.ackAuthorPub,
          signature: msg.ackSignature,
        });
        if (!verified) continue;
        const expectedText = verified.template.replace('{name}', stageName);
        if (String(msg.text || '') !== expectedText) continue;
        kept.push(msg);
        continue;
      }

      if (!isGreeting) {
        kept.push(msg);
        continue;
      }
      const locale = msg.greetingLocale as GreetingLocale;
      const verified = await verifyTechSupportGreeting({
        locale,
        template: TECHSUPPORT_GREETING_TEMPLATES[locale],
        authorPub: msg.greetingAuthorPub,
        signature: msg.greetingSignature,
      });
      if (!verified) continue;
      const expectedText = verified.template.replace('{name}', stageName);
      if (String(msg.text || '') !== expectedText) continue;
      kept.push(msg);
    }
    return kept;
  }

  async displayConversationMessages(conversationId: string, messages: any[]): Promise<void> {
    if (this.currentConversationId !== conversationId) return;

    const messagesContainer = document.getElementById('conversation-messages');
    if (!messagesContainer) return;

    this.bindCapturedQuestionChipDelegation();

    const isSupportChannel = this.getMyConversations()[conversationId]?.supportChannel === true;
    if (isSupportChannel) {
      messages = await this.filterVerifiedSupportMessages(messages);
      if (this.currentConversationId !== conversationId) return; // stale by the time verify resolved
    }

    // Thread isolation (redesign §5): only the open scope's messages render here.
    messages = messages.filter((msg) => this.messageInCurrentThread(msg));
    // Cache for filter-toggle re-render (§9): toggling a filter off must reveal
    // previously hidden messages without waiting for a new sync event.
    this.lastConversationMessages = messages;

    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #999;">
          <p>${escapeHtml(this.t('conversationMatchedStart'))}</p>
        </div>
      `;
      return;
    }

    const toastQueue: MessageFilterResult[] = [];
    messagesContainer.innerHTML = messages
      .map((msg) => {
        // `Message` objects from GunMessageStore never carry `isOwnMessage` (that field
        // is only set by the unrelated chatroom-message path in app.ts); derive ownership
        // from senderId here so a user's own DMs render with the "message-own" style
        // instead of always falling through to "message-other".
        const isOwn = !!this.currentUserId && String(msg.senderId || '') === this.currentUserId;
        const text = String(msg.text || '');
        // Matched-talk IPFS auto-share (L5): render the shared photo/file as an attachment
        // card (with an image preview once the decrypted bytes arrive) instead of raw JSON.
        const share = this.parseIpfsSharePayload(text);
        if (share) {
          return this.renderIpfsAttachmentMessage(share, isOwn, msg.timestamp);
        }
        // docs/TODO.md §V, UI-1d: a confirmed captured question renders as tappable chips,
        // not a plain bubble — same detect-a-marked-payload shape as the IPFS share above.
        const capturedQuestion = decodeCapturedQuestionMessage(text);
        if (capturedQuestion) {
          const messageId = String(msg.id || `${msg.senderId || ''}:${msg.timestamp || ''}`);
          return this.renderCapturedQuestionMessage(capturedQuestion, isOwn, msg.timestamp, messageId);
        }
        // Receive-path content filter (redesign §9): a receiver's own filters hide
        // incoming messages at render (they stay in the Gun graph). Never hide your
        // own outgoing messages.
        if (!isOwn) {
          const verdict = this.shouldHideIncomingMessage(text, String(msg.senderId || ''));
          if (!verdict.passed) {
            const msgKey = String(msg.id || `${msg.senderId || ''}:${msg.timestamp || ''}`);
            if (!this.hiddenMessageToastIds.has(msgKey)) {
              this.hiddenMessageToastIds.add(msgKey);
              toastQueue.push(verdict);
            }
            return `
              <div class="message message-other message-hidden" data-testid="hidden-message-placeholder">
                <div class="message-content">
                  <div class="message-text" style="font-style:italic;color:var(--text-muted);">${escapeHtml(`1 ${this.t('messageHiddenPlaceholder')}`)}</div>
                </div>
              </div>
            `;
          }
        }
        return `
          <div class="message ${isOwn ? 'message-own' : 'message-other'}">
            <div class="message-content">
              <div class="message-text">${escapeHtml(text)}</div>
              <div class="message-time">${this.formatTalkRelativeTime(new Date(msg.timestamp))}</div>
            </div>
          </div>
        `;
      })
      .join('');
    // Fire one toast per newly-hidden message (rule §9.1).
    for (const verdict of toastQueue) this.showContentFilterToast(verdict, 'receive');

    // Swap decrypted bytes into image attachment previews (async, best-effort).
    this.hydrateAttachmentImages(messagesContainer);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  updateConversationTransportMode(
    conversationId: string,
    transportMode: string,
    transportFallbackReason?: string | null,
  ): void {
    const conversations = this.getMyConversations();
    const conversation = conversations[conversationId];
    if (!conversation) return;
    conversation.transportMode = transportMode;
    if (transportFallbackReason !== undefined) {
      conversation.transportFallbackReason = transportFallbackReason;
    }
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    if (this.currentConversationId === conversationId) {
      const transportStatus = document.getElementById('conversation-transport-status');
      if (transportStatus) {
        transportStatus.dataset.transportMode = transportMode;
        transportStatus.textContent = `${this.t('conversationTransport')}: ${this.formatTransportMode(transportMode)}`;
      }
      const fallbackStatus = document.getElementById('conversation-fallback-status');
      if (fallbackStatus) {
        fallbackStatus.textContent = this.formatTransportFallback(
          transportMode,
          conversation.transportFallbackReason,
        );
      }
    }
  }

  addNewConversation(conversationData: {
    conversationId: string;
    otherUserId: string;
    otherUserName: string;
    talkId?: string;
    relatedTalkIds?: string[];
    relatedTalkIdsJson?: string;
    respondedByBot?: boolean;
    supportChannel?: boolean;
    transportMode?: string;
    transportFallbackReason?: string | null;
    /** Step 9: ISO timestamp of when the responder changed their mind to produce this match. */
    changeOfMindAt?: string;
    /** Spec §30.2: whether this conversation's talk declares a selfTag/preferenceSet pair —
     *  gates the "Confirm Deal" UI in showConversationDetail. */
    dealEligible?: boolean;
    /** Route `matchThreshold` scoring result (spec §30.2) — sorted/displayed by
     *  `renderCreatorReplies`'s "Matched items" list. */
    matchScore?: number;
    matchTotal?: number;
  }): void {
    const conversations = this.getMyConversations();
    const existing = conversations[conversationData.conversationId];
    const isNew = !existing;

    // Keep bot provenance sticky once true; some sync paths can emit records without this field.
    const respondedByBot = !!existing?.respondedByBot || conversationData.respondedByBot === true;
    // Sticky like respondedByBot — the ingest/sync path may re-emit without this field.
    const dealEligible = !!existing?.dealEligible || conversationData.dealEligible === true;
    const matchScore = conversationData.matchScore ?? existing?.matchScore;
    const matchTotal = conversationData.matchTotal ?? existing?.matchTotal;
    const incomingName = conversationData.otherUserName?.trim() || '';
    const existingName = existing?.otherUserName?.trim() || '';
    const preferredOtherUserName =
      incomingName && incomingName !== 'Unknown' && incomingName !== 'Someone'
        ? incomingName
        : existingName && existingName !== 'Unknown' && existingName !== 'Someone'
          ? existingName
          : incomingName || existingName || 'Unknown';
    const resolvedOtherUserName = this.getPeerName(
      conversationData.otherUserId,
      preferredOtherUserName,
    );

    const isSupportChannel = !!existing?.supportChannel || conversationData.supportChannel === true;
    const relatedTalkIds = new Set<string>();
    const addRelatedTalkId = (talkId: unknown) => {
      const value = String(talkId ?? '').trim();
      if (!value || value === 'direct') return;
      relatedTalkIds.add(value);
    };
    if (Array.isArray(existing?.relatedTalkIds)) {
      for (const talkId of existing.relatedTalkIds) addRelatedTalkId(talkId);
    }
    if (typeof existing?.relatedTalkIdsJson === 'string') {
      try {
        const parsed = JSON.parse(existing.relatedTalkIdsJson);
        if (Array.isArray(parsed)) {
          for (const talkId of parsed) addRelatedTalkId(talkId);
        }
      } catch {
        /* keep existing valid metadata only */
      }
    }
    if (Array.isArray(conversationData.relatedTalkIds)) {
      for (const talkId of conversationData.relatedTalkIds) addRelatedTalkId(talkId);
    }
    if (typeof conversationData.relatedTalkIdsJson === 'string') {
      try {
        const parsed = JSON.parse(conversationData.relatedTalkIdsJson);
        if (Array.isArray(parsed)) {
          for (const talkId of parsed) addRelatedTalkId(talkId);
        }
      } catch {
        /* ignore malformed incoming metadata */
      }
    }
    addRelatedTalkId(existing?.talkId);
    addRelatedTalkId(conversationData.talkId);
    const relatedTalkIdList = Array.from(relatedTalkIds);
    const displayTalkId =
      conversationData.talkId && conversationData.talkId !== 'direct'
        ? conversationData.talkId
        : existing?.talkId || conversationData.talkId;

    conversations[conversationData.conversationId] = {
      conversationId: conversationData.conversationId,
      otherUserId: conversationData.otherUserId,
      otherUserName: resolvedOtherUserName,
      ...(isSupportChannel ? {} : { talkId: displayTalkId }),
      ...(isSupportChannel || relatedTalkIdList.length === 0
        ? {}
        : {
            relatedTalkIds: relatedTalkIdList,
            relatedTalkIdsJson: JSON.stringify(relatedTalkIdList),
          }),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastMessage: existing?.lastMessage ?? null,
      lastMessageTime: existing?.lastMessageTime ?? null,
      unread: isSupportChannel ? false : (isNew ? true : (existing?.unread ?? false)),
      respondedByBot,
      dealEligible,
      ...(matchScore !== undefined ? { matchScore } : {}),
      ...(matchTotal !== undefined ? { matchTotal } : {}),
      supportChannel: isSupportChannel,
      transportMode: conversationData.transportMode ?? existing?.transportMode ?? 'star-gun',
      transportFallbackReason: existing?.transportFallbackReason ?? conversationData.transportFallbackReason ?? null,
      ...(existing?.status ? { status: existing.status } : {}),
      ...(existing?.changedAt ? { changedAt: existing.changedAt } : {}),
      // Step 9: record change-of-mind timestamp for durable UI assertion
      ...(conversationData.changeOfMindAt || existing?.changeOfMindAt
        ? { changeOfMindAt: conversationData.changeOfMindAt ?? existing?.changeOfMindAt }
        : {}),
    };

    localStorage.setItem('myConversations', JSON.stringify(conversations));

    // Update badge
    this.updateMatchBadge();
    this.syncStatusBarMatchCount();
    this.emit('conversationAdded', {
      conversationId: conversationData.conversationId,
      isNew,
      totalMatches: this.getTotalMatches(),
    });

    // Only show toast for genuinely new matches (not when re-syncing or opening edit)
    if (isNew) {
      const name = conversationData.otherUserName?.trim() || this.t('conversationUnknown');
      if (conversationData.supportChannel && !this.isSupportNotificationsMuted()) {
        this.showNotification(this.tf('supportChannelReady', { name }), 'info');
      } else {
        if (!conversationData.supportChannel) {
          // Auto-dismiss: this "can now chat" banner starts with "Match!" but is a transient
          // toast, not a durable talk-match notice that should linger until clicked.
          this.showNotification(this.tf('matchChatReady', { name }), 'success', { persistent: false });
        }
      }
    }

    const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
    if (contactsTab?.classList.contains('active')) {
      this.displayContactsList();
    }

    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) {
      this.displayConversationsList();
    }
  }

  /**
   * Step 10: Mark a conversation as withdrawn (hard retraction by author).
   * Finds the conversation by otherUserId+talkId (or talkId alone as fallback),
   * sets status:'withdrawn' and records retractedAt so the conversation-list
   * renders a durable "match gone" label assertable by E2E tests.
   *
   * If authorId is provided, the search is narrowed to conversations where
   * the other participant is the retracting author (responder-side call).
   */
  markConversationWithdrawn(
    otherUserId: string,
    talkId: string,
    retractedAt: number,
  ): void {
    const conversations = this.getMyConversations();
    const retractedAtStr = new Date(retractedAt).toISOString();
    // Find by otherUserId+talkId; fall back to talkId alone for author side.
    let convId = Object.keys(conversations).find((id) => {
      const c = conversations[id];
      return c?.otherUserId === otherUserId && c?.talkId === talkId;
    });
    if (!convId) {
      // Fallback: author-side teardown or retraction received before conversation was indexed
      convId = Object.keys(conversations).find((id) => {
        const c = conversations[id];
        return c?.talkId === talkId;
      });
    }
    if (!convId) return;
    conversations[convId].status = 'withdrawn';
    conversations[convId].retractedAt = retractedAtStr;
    conversations[convId].lastMessage = `Author removed this talk — the match is gone · ${new Date(retractedAt).toLocaleString()}`;
    conversations[convId].lastMessageTime = retractedAtStr;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();
    this.syncStatusBarMatchCount();
    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) {
      this.displayConversationsList();
    }
  }

  /**
   * Step 9: Mark a conversation as ended (match→ignore change-of-mind).
   * Finds the conversation by otherUserId+talkId, sets status:'ignored' and
   * records the changedAt timestamp so the conversation-list renders a durable
   * "answer changed" label assertable by E2E tests.
   */
  markConversationEnded(otherUserId: string, talkId: string, changedAt: string): void {
    const conversations = this.getMyConversations();
    // Find the conversation by otherUserId + talkId
    let convId = Object.keys(conversations).find((id) => {
      const c = conversations[id];
      return c?.otherUserId === otherUserId && c?.talkId === talkId;
    });
    if (!convId) {
      convId = Object.keys(conversations).find((id) => conversations[id]?.otherUserId === otherUserId);
    }
    if (!convId) return;
    conversations[convId].status = 'ignored';
    conversations[convId].changedAt = changedAt;
    conversations[convId].lastMessage = `Answer changed · ${new Date(changedAt).toLocaleString()}`;
    conversations[convId].lastMessageTime = changedAt;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();
    this.syncStatusBarMatchCount();
    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) {
      this.displayConversationsList();
    }
  }

  /** Optimistic local update after a `confirmDeal` write — refreshes the deal bar without
   *  waiting on a Gun round-trip. Re-renders the open thread if it's the one that changed. */
  applyDealConfirmedBy(conversationId: string, dealConfirmedBy: string[]): void {
    const conversations = this.getMyConversations();
    const c = conversations[conversationId];
    if (!c) return;
    c.dealConfirmedByJson = JSON.stringify(dealConfirmedBy);
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    if (this.currentConversationId === conversationId) {
      this.showConversationDetail(conversationId, this.currentThreadTalkId);
    }
  }

  /**
   * Deal confirmation (spec §30.2): once a Deal locks on one conversation for a given
   * talkId, any OTHER locally-open conversation for that same talkId (other compatible
   * candidates I'd also matched with) is marked ended on THIS device. Cross-device
   * notification to those other candidates' own devices isn't wired yet — a real gap, not
   * silently swept — see docs/TODO.md.
   */
  markOtherDealConversationsEnded(talkId: string, keepOtherUserId: string, changedAt: string): void {
    const conversations = this.getMyConversations();
    let changed = false;
    for (const [, c] of Object.entries(conversations)) {
      if (c?.talkId !== talkId || c?.otherUserId === keepOtherUserId) continue;
      if (c.status === 'ignored' || c.status === 'withdrawn') continue;
      c.status = 'ignored';
      c.changedAt = changedAt;
      c.lastMessage = `No longer available — the deal was confirmed with someone else · ${new Date(changedAt).toLocaleString()}`;
      c.lastMessageTime = changedAt;
      changed = true;
    }
    if (!changed) return;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();
    this.syncStatusBarMatchCount();
    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) {
      this.displayConversationsList();
    }
  }

  updateConversationMessage(conversationId: string, message: string, timestamp: string): void {
    const conversations = this.getMyConversations();

    if (conversations[conversationId]) {
      conversations[conversationId].lastMessage = message;
      conversations[conversationId].lastMessageTime = timestamp;

      // If the current conversation is not open, mark as unread
      if (this.currentConversationId !== conversationId && conversations[conversationId].supportChannel !== true) {
        conversations[conversationId].unread = true;
      }

      localStorage.setItem('myConversations', JSON.stringify(conversations));
      this.updateMatchBadge();
      this.syncStatusBarMatchCount();

      const meTab = document.querySelector('.nav-btn[data-view="me"]');
      if (meTab?.classList.contains('active')) {
        this.displayConversationsList();
      }

      const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
      if (contactsTab?.classList.contains('active')) {
        this.displayContactsList();
      }
    }
  }

  public syncConversationMessageSummary(conversationId: string, messages: any[], currentUserId: string): void {
    const conversations = this.getMyConversations();
    const conversation = conversations[conversationId];
    if (!conversation || messages.length === 0) return;
    const ordered = [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const latest = ordered[ordered.length - 1];
    conversation.lastMessage = String(latest.text || '');
    conversation.lastMessageTime = new Date(latest.timestamp || Date.now()).toISOString();

    const cursorKey = 'iinpublic:conversation-read-cursors';
    let cursors: Record<string, { timestamp: string; id?: string }> = {};
    try { cursors = JSON.parse(localStorage.getItem(cursorKey) || '{}'); } catch { /* ignore malformed local data */ }

    // Per-thread read state (redesign §5): messages group into the pair DM thread
    // ('direct' / legacy no-talkId) and one thread per matched talk. Cursors are per
    // thread — the DM cursor keeps the legacy `${conversationId}` key, per-talk
    // cursors use `${conversationId}#${talkId}` — so DM and threads never leak reads
    // into each other.
    const threadKeyOf = (message: any): string => {
      const talkId = String(message?.talkId || '');
      return talkId && talkId !== 'direct' ? talkId : 'direct';
    };
    const cursorIdFor = (threadKey: string): string =>
      threadKey === 'direct' ? conversationId : `${conversationId}#${threadKey}`;
    const openThreadKey = this.currentConversationId === conversationId
      ? (this.currentThreadTalkId || 'direct')
      : null;

    const byThread = new Map<string, any[]>();
    for (const message of ordered) {
      const key = threadKeyOf(message);
      const bucket = byThread.get(key) || [];
      bucket.push(message);
      byThread.set(key, bucket);
    }

    const threadSummaries: Record<string, { lastMessage: string; lastMessageTime: string; unreadCount: number }> = {};
    let totalUnread = 0;
    for (const [threadKey, bucket] of byThread) {
      const last = bucket[bucket.length - 1];
      const lastTime = new Date(last.timestamp || Date.now()).toISOString();
      let unreadCount = 0;
      if (openThreadKey === threadKey) {
        cursors[cursorIdFor(threadKey)] = { timestamp: lastTime, id: String(last.id || '') };
      } else {
        const readAt = new Date(cursors[cursorIdFor(threadKey)]?.timestamp || 0).getTime();
        unreadCount = bucket.filter((message) =>
          String(message.senderId || '') !== currentUserId && new Date(message.timestamp || 0).getTime() > readAt,
        ).length;
      }
      totalUnread += unreadCount;
      threadSummaries[threadKey] = {
        lastMessage: String(last.text || ''),
        lastMessageTime: lastTime,
        unreadCount,
      };
    }
    conversation.threadSummaries = threadSummaries;
    conversation.unreadCount = totalUnread;
    conversation.unread = totalUnread > 0;

    localStorage.setItem(cursorKey, JSON.stringify(cursors));
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();
    this.refreshOpenPeerThreadList();

    // Surface a toast when a fresh message arrives from the peer for a conversation the user
    // isn't currently viewing. Without this the only signal is the nav badge, which is easy to
    // miss — the reported bug was that an incoming message produced no visible change until the
    // user manually reopened the chat. Seed the last-notified id on first sight so history/boot
    // loads don't fire a burst of toasts; only genuine deltas notify.
    const latestId = String(latest.id || '');
    const isIncoming = String(latest.senderId || '') !== currentUserId;
    const alreadySeen = this.lastNotifiedMessageIdByConversation.has(conversationId);
    const isDelta = this.lastNotifiedMessageIdByConversation.get(conversationId) !== latestId;
    this.lastNotifiedMessageIdByConversation.set(conversationId, latestId);
    if (
      alreadySeen &&
      isDelta &&
      isIncoming &&
      this.currentConversationId !== conversationId &&
      !conversation.supportChannel
    ) {
      const name = this.getPeerName(conversation.otherUserId, conversation.otherUserName);
      this.showNotification(this.tf('conversationNewMessage', { name }), 'info', {
        peerId: conversation.otherUserId,
        peerName: name,
      });
    }

    // Re-render the conversation list whenever it exists in the DOM (not only when the Me tab is
    // the active nav item) so an arriving message updates the preview/unread row immediately.
    if (document.getElementById('conversations-list')) this.displayConversationsList();
    // Contacts sort by recency reads the same lastMessageTime this method just updated —
    // without a re-render here the visible order freezes at whatever it was when the tab
    // opened (messages arriving while the user watches never reorder the rows).
    const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
    if (contactsTab?.classList.contains('active')) this.displayContactsList();
  }

  public setConversationOnlineStatus(otherUserIds: Set<string>): void {
    const conversations = this.getMyConversations();
    let changed = false;
    for (const conversation of Object.values(conversations)) {
      const online = otherUserIds.has(String((conversation as any).otherUserId || ''));
      if ((conversation as any).online !== online) {
        (conversation as any).online = online;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('myConversations', JSON.stringify(conversations));
      const meTab = document.querySelector('.nav-btn[data-view="me"]');
      if (meTab?.classList.contains('active')) this.displayConversationsList();
    }

    // Same real-presence signal, generalized beyond conversations/TechSupport to every
    // ordinary contact row (contacts-view.ts) and chatroom member row (chatrooms-view.ts) —
    // both lists now show the same online/away dot.
    this.onlineUserIds = otherUserIds;
    const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
    // getMyConversations()/deriveLocalPeers() read live localStorage, never a stale snapshot,
    // so a full re-render here is safe (same reasoning as setTechSupportOnlineStatus above).
    if (contactsTab?.classList.contains('active')) this.displayContactsList();
    // The chatroom roster is NOT re-rendered from `currentChatroomMembers` here — see
    // patchTechSupportPresenceIndicators's own comment for why. Patch presence dots in place.
    this.patchPresenceIndicators();
  }

  private onlineUserIds = new Set<string>();

  private isUserOnline(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }

  private patchPresenceIndicators(): void {
    const indicators = document.querySelectorAll<HTMLElement>('.presence-indicator[data-user-id]');
    for (const el of Array.from(indicators)) {
      const online = this.onlineUserIds.has(el.dataset.userId || '');
      el.classList.toggle('online', online);
      el.classList.toggle('away', !online);
      el.setAttribute('aria-label', this.t(online ? 'presenceOnline' : 'presenceAway'));
    }
  }
}
