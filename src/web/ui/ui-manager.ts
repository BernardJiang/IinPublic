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
} from '../../shared/flattened-answer-keys';
import { normalizeQuestionKey, interestsFromCommaInput } from '../../shared/user-utils';
import { normalizeProfileAttributeVisibility } from '../../shared/profile-privacy';
import { INTEREST_CATEGORY_LABELS, INTEREST_CATEGORY_SELECT_ORDER } from '../../shared/interest-catalog';
import { TalkValidator, TalkAutofix } from '../../shared/talk-engine';
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
import {
  clearAnswerPreferences,
  getAnswerPreferences,
  getAnsweredTalkByContent,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  setAnswerPreferences,
  setAnsweredTalkByContent,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setMyQuestionAnswer,
  type AnswerPreferenceEntry,
  type AnswerPreferenceMap,
  type MyQuestionAnswerEntry,
} from './answer-preferences-storage';
import {
  findAutoAnswer,
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
  getChatbotEnabled,
  getChatbotTemplate as loadChatbotTemplate,
  getCopyTalkAutoSave,
  getDefaultTalkLanguagePreference,
  getUiLanguagePreference,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setCopyTalkAutoSave,
  setDefaultTalkLanguagePreference,
  setUiLanguagePreference,
} from './ui-settings-storage';
import { showMyTalksDialog as openMyTalksDialog } from './my-talks-dialog';
import { showPreferencesDialog as openPreferencesDialog, type AnswerPreferenceUiMode } from './preferences-dialog';
import { showTalkResponseDialog as openTalkResponseDialog } from './talk-response-dialog';
import {
  addAnswerToQuestion as addTalkEditorAnswerToQuestion,
  addQuestionToForm as addTalkEditorQuestionToForm,
  appendIgnoreRow as appendTalkEditorIgnoreRow,
  setupTalkFormHandlers as setupTalkEditorFormHandlers,
  updateAllAnswerDropdowns as updateTalkEditorAnswerDropdowns,
} from './talk-editor-form-helpers';
import { showTalkEditorDialog as openTalkEditorDialog } from './talk-editor-dialog';
import { openPeerDetailView, refreshPeerThreadList } from './user-detail-view';
import { avatarInnerHtml } from './profile-avatar';
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
  hasStoredTalkIntakeFilters,
  setTalkIntakeFilters,
} from './talk-intake-filters';
import { normalizeCustomBlockedTerms, normalizeDirtyWords, DEFAULT_DIRTY_WORDS } from '../../shared/talk-intake-filters';
import { filterOutgoingMessage, filterIncomingMessage, type MessageFilterResult } from '../../shared/message-content-filter';
import { CONFIG } from '../../shared/config';
import { showLinkedDevicesDialog, type LinkedDeviceRow } from './linked-devices-dialog';
import { decodePairingCode, isPairingExpired } from '../../shared/identity-linking';
import { showEraseDeviceDialog } from './erase-device-dialog';
import { eraseDevice } from '../services/device-wipe';

function resolveExpiresAtMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return new Date(value).getTime();
  return Number.NaN;
}

const TALK_TYPE_VALUES: TalkIntakeFilters['allowedTalkTypes'] = ['flow', 'survey', 'tag', 'route'];
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
];

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

const CREATOR_REPLY_FILTERS_KEY = 'creatorReplyFilterState';
const CREATOR_REPLY_PAGE_SIZE = 25;

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
  private talksViewMode: 'all' | 'in' | 'out' = 'all';
  private talksOutSortMode: 'recent' | 'oldest' | 'latest-reply' | 'matches' | 'responses' | 'match-rate' | 'weighted' | 'title' = 'recent';
  private talksQuery = '';
  private talksTypeFilter = 'all';
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
  /** Incoming messages already surfaced via a "hidden by your filters" toast (dedupe, §9). */
  private hiddenMessageToastIds = new Set<string>();
  /** Last message set rendered into the open conversation, for filter-toggle re-render (§9). */
  private lastConversationMessages: any[] = [];

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
  private talksListDelegationBound = false;
  private chatroomActionDelegationBound = false;
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

  private formatTalkCount(count: number): string {
    return this.tf(count === 1 ? 'talksCountOne' : 'talksCount', { count });
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
      ['#contacts-status-text', 'statusContacts'],
      ['#talks-status-text', 'statusTalks'],
      ['#me-status-text', 'statusMe'],
      ['#settings-status-text', 'statusSettings'],
      ['#create-custom-chatroom-btn .app-bar-btn-label', 'newRoom'],
      ['#return-home-btn .app-bar-btn-label', 'returnHome'],
      ['#broadcast-talk-btn .app-bar-btn-label', 'broadcast'],
      ['#creator-replies-panel strong', 'repliesTitle'],
      ['#reply-clear-filters', 'clear'],
      ['#settings-refresh-location-btn .app-bar-btn-label', 'refreshLocation'],
      ['#talks-nav-all', 'talksAll'],
      ['#me-talk-type-filter-label', 'meTalkTypeFilters'],
      ['.me-talk-type-filter[data-me-talk-type="tag"]', 'talkTypeTag'],
      ['.me-talk-type-filter[data-me-talk-type="flow"]', 'talkTypeFlow'],
      ['.me-talk-type-filter[data-me-talk-type="survey"]', 'talkTypeSurvey'],
      ['.me-talk-type-filter[data-me-talk-type="route"]', 'talkTypeRoute'],
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
    for (const id of ['back-to-chatrooms', 'back-to-contacts-list', 'talks-nav-back']) {
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

  private getBroadcastHistory(): Record<string, { sentAt: string; chatroomId: string; receiverIds: string[]; location?: string }> {
    try {
      const raw = localStorage.getItem('broadcastConversationHistory');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private getBroadcastRevisionKey(talkId: string, talk: any): string {
    const fullTalk = talk?.fullTalk || talk || {};
    const contentKey = UIManager.getTalkContentKey(fullTalk);
    const updated = String(talk?.updatedAt || talk?.lastInteraction || fullTalk?.updatedAt || fullTalk?.timestamp || '');
    return `${talkId}:${contentKey}:${updated}`;
  }

  private getUnsentBroadcastTalkIds(chatroomId: string, receiverIds: string[]): string[] {
    return this.getBroadcastableTalkIds().filter((talkId) => receiverIds.some((receiverId) => {
      const talk = this.getMyTalks()[talkId];
      return !this.getBroadcastHistory()[`${chatroomId}|${receiverId}|${this.getBroadcastRevisionKey(talkId, talk)}`];
    }));
  }

  private getUnsentBroadcastTalkIdsForReceiver(chatroomId: string, receiverId: string): string[] {
    return this.getBroadcastableTalkIds().filter((talkId) => {
      const talk = this.getMyTalks()[talkId];
      return !this.getBroadcastHistory()[`${chatroomId}|${receiverId}|${this.getBroadcastRevisionKey(talkId, talk)}`];
    });
  }

  recordBroadcastConversation(chatroomId: string, talkIds: string[], receivers: Array<{ userId: string }>): void {
    const receiverIds = receivers.map((r) => String(r.userId || '').trim()).filter(Boolean).sort();
    const location = this.currentLocation
      ? `${this.currentLocation.latitude.toFixed(3)},${this.currentLocation.longitude.toFixed(3)}`
      : undefined;
    const history = this.getBroadcastHistory();
    const sentAt = new Date().toISOString();
    for (const talkId of talkIds) {
      const talk = this.getMyTalks()[talkId];
      if (!talk) continue;
      for (const receiverId of receiverIds) {
        const key = `${chatroomId}|${receiverId}|${this.getBroadcastRevisionKey(talkId, talk)}`;
        history[key] = { sentAt, chatroomId, receiverIds: [receiverId], ...(location ? { location } : {}) };
      }
    }
    localStorage.setItem('broadcastConversationHistory', JSON.stringify(history));
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
            <button class="app-bar-back-btn talks-nav-back" id="talks-nav-back" data-testid="talks-nav-back" data-appbar-view="talks" type="button" title="Back" style="display: none;">‹</button>
          </div>
          <div class="app-bar-center" id="app-bar-center">
            <div class="header-title" id="header-title"></div>
            <div class="header-status" id="header-status" style="display: none;">
              <div class="header-user-info" id="header-user-info"></div>
              <span class="header-status-text" id="status-bar-text" data-header-status-view="chatrooms">Connecting...</span>
              <span class="header-status-text" id="contacts-status-text" data-header-status-view="contacts" hidden>Contacts from exchanged talks</span>
              <span class="header-status-text" id="talks-status-text" data-header-status-view="talks" hidden>Incoming talks are consolidated by content.</span>
              <span class="header-status-text" id="me-status-text" data-header-status-view="me" hidden>Answered question history</span>
              <span class="header-status-text" id="settings-status-text" data-header-status-view="settings" hidden>Feature and filter controls</span>
              <span id="broadcast-bulk-ack" data-testid="broadcast-bulk-ack" hidden></span>
            </div>
          </div>
          <div class="header-actions app-bar-right" id="header-actions">
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
            <div class="view-content">
              <div class="filter-bar talks-action-bar">
                <div class="talks-nav-tabs">
                  <button class="btn talks-nav-btn active" id="talks-nav-all" data-talks-mode="all" type="button">
                    All
                  </button>
                  <button class="btn talks-nav-btn" id="talks-nav-in" data-talks-mode="in" type="button">
                    IN
                  </button>
                  <button class="btn talks-nav-btn" id="talks-nav-out" data-talks-mode="out" type="button">
                    OUT
                  </button>
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
                <select class="form-input" id="talks-filter-type" aria-label="Filter talks by type" style="flex:0 0 125px;">
                  <option value="all">All types</option>
                  <option value="tag">Tag</option>
                  <option value="flow">Flow</option>
                  <option value="survey">Survey</option>
                  <option value="route">Route</option>
                </select>
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
              <section id="creator-replies-panel" style="display:none;padding:12px;border-bottom:1px solid var(--border);background:#fff;">
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
                <button class="btn me-talk-type-filter active" data-me-talk-type="tag" type="button">Tag</button>
                <button class="btn me-talk-type-filter active" data-me-talk-type="flow" type="button">Flow</button>
                <button class="btn me-talk-type-filter active" data-me-talk-type="survey" type="button">Survey</button>
                <button class="btn me-talk-type-filter active" data-me-talk-type="route" type="button">Route</button>
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
    document.querySelectorAll('.me-talk-type-filter').forEach((button) => {
      button.addEventListener('click', () => {
        button.classList.toggle('active');
        this.applyMeAnswerFilter();
      });
    });
    document.querySelectorAll('.me-tag-state-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => this.applyMeAnswerFilter());
    });
    ['me-outcome-filter', 'me-answer-sort', 'me-answer-date-from', 'me-answer-date-to'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => this.applyMeAnswerFilter());
    });
    document.getElementById('me-answer-filter')?.addEventListener('input', () => this.applyMeAnswerFilter());
    document.getElementById('me-clear-filters')?.addEventListener('click', () => {
      document.querySelectorAll('.me-talk-type-filter').forEach((button) => button.classList.add('active'));
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

    const broadcastTalkBtn = document.getElementById('broadcast-talk-btn');
    if (broadcastTalkBtn) {
      broadcastTalkBtn.addEventListener('click', () => this.handleBroadcastTalkFromCurrentRoom());
    }

    document.querySelectorAll('.talks-nav-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = (button as HTMLElement).dataset.talksMode as 'all' | 'in' | 'out' | undefined;
        if (!nextMode) return;
        this.talksViewMode = nextMode;
        this.displayTalksList();
      });
    });
    document.getElementById('talks-out-sort-order')?.addEventListener('change', (event) => {
      this.talksOutSortMode = (event.currentTarget as HTMLSelectElement).value as typeof this.talksOutSortMode;
      this.displayTalksList();
    });
    document.getElementById('talks-filter-query')?.addEventListener('input', (event) => {
      this.talksQuery = (event.currentTarget as HTMLInputElement).value;
      this.displayTalksList();
    });
    document.getElementById('talks-filter-type')?.addEventListener('change', (event) => {
      this.talksTypeFilter = (event.currentTarget as HTMLSelectElement).value;
      this.displayTalksList();
    });
    document.getElementById('talks-filter-completion')?.addEventListener('change', (event) => {
      this.talksCompletionFilter = (event.currentTarget as HTMLSelectElement).value as typeof this.talksCompletionFilter;
      this.displayTalksList();
    });
    document.getElementById('talks-filter-outcome')?.addEventListener('change', (event) => {
      this.talksOutcomeFilter = (event.currentTarget as HTMLSelectElement).value as typeof this.talksOutcomeFilter;
      this.displayTalksList();
    });
    ['talks-filter-date-from', 'talks-filter-date-to'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', (event) => {
        if (id.endsWith('from')) this.talksDateFrom = (event.currentTarget as HTMLInputElement).value;
        else this.talksDateTo = (event.currentTarget as HTMLInputElement).value;
        this.displayTalksList();
      });
    });
    this.restoreCreatorReplyFilterState();
    ['reply-filter-query', 'reply-filter-outcome', 'reply-filter-relationship', 'reply-filter-type', 'reply-filter-language', 'reply-filter-from', 'reply-filter-to', 'reply-sort-order', 'reply-group-order'].forEach((id) => {
      // TODO §M1: #creator-replies-panel is hidden (display:none); skip renderCreatorReplies()
      // here since it would only re-render DOM the user can't see.
      document.getElementById(id)?.addEventListener(id === 'reply-filter-query' ? 'input' : 'change', () => {
        this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
        this.persistCreatorReplyFilterState();
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
      this.persistCreatorReplyFilterState();
    });

    const talksNavBack = document.getElementById('talks-nav-back');
    if (talksNavBack) {
      talksNavBack.addEventListener('click', () => {
        this.talksViewMode = 'all';
        this.displayTalksList();
      });
    }
  }

  /**
   * Send all broadcastable OUT talks to everyone in the current chatroom (Gun announce + server IN registration).
   */
  private handleBroadcastTalkFromCurrentRoom(): void {
    void this.runBroadcastFromCurrentRoom();
  }

  /** Auto-send only the OUT talk revisions not yet delivered to each individual peer. */
  public broadcastPendingTalksOnRoomEntry(): void {
    if (!this.currentChatroom) return;
    for (const peer of this.getCurrentChatroomMembers()) {
      const talkIds = this.getUnsentBroadcastTalkIdsForReceiver(this.currentChatroom, peer.userId);
      if (talkIds.length > 0) {
        this.emit('broadcastTalk', { chatroomId: this.currentChatroom, members: [peer], talkIds, automatic: true });
      }
    }
  }

  private async runBroadcastFromCurrentRoom(): Promise<void> {
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

    this.emit('broadcastTalk', {
      chatroomId,
      members,
      talkIds,
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
          this.showContactsList();
          this.displayContextualStatistics('contacts-stats-strip');
        }

        // Special handling for talks view
        if (targetView === 'talks') {
          this.emit('needIncomingTalkClusters');
          this.displayTalksList();
          void this.refreshCreatorReplies();
          this.displayContextualStatistics('talks-stats-strip');
        }

        // Special handling for me view: refresh conversations list and request a source sync.
        if (targetView === 'me') {
          if (this.currentUser) this.showMainInterface(this.currentUser);
          this.emit('needConversationSync');
          this.displayAnswersList();
        }

        if (targetView === 'settings') {
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

    // Initialize chatroom list view (default view)
    this.showChatroomList();
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
      // Rule N2a (redesign §5): a contact click lands on the DM Conversation directly,
      // with the shared User layout underneath — identical to a chatroom member click.
      openPeerDetail: this.openUserConversationFirst.bind(this),
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
      const headerTitle = document.getElementById('header-title');
      const chatroomTitle = document.getElementById('current-chatroom-title');
      const chatroomStatus = document.getElementById('current-chatroom-status');
      if (headerTitle) headerTitle.textContent = roomName;
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
          if (!target.closest('#talks-list')) return;
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
          const removeBtn = target.closest('.remove-talk-btn');
          if (removeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = (removeBtn as HTMLElement).dataset.talkId;
            if (talkId) {
              setTimeout(() => this.deleteMyTalk(talkId), 0);
            }
            return;
          }
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
          const broadcastToggle = target.closest('.talk-broadcast-toggle-btn') as HTMLButtonElement | null;
          if (broadcastToggle && broadcastToggle.dataset) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = broadcastToggle.dataset.talkId;
            if (talkId) {
              const disabled = broadcastToggle.dataset.broadcastEnabled === 'true';
              setTimeout(() => {
                this.setTalkDisabled(talkId, disabled);
                this.showNotification(this.t(disabled ? 'talksBroadcastDisabled' : 'talksBroadcastEnabled'), 'success');
              }, 0);
            }
            return;
          }
        },
        { capture: true },
      );
    }

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
        && (this.talksTypeFilter === 'all' || type === this.talksTypeFilter)
        && (this.talksOutcomeFilter === 'all' || outcome === this.talksOutcomeFilter)
        && timestamp >= from && timestamp <= to
        && (this.talksCompletionFilter === 'all'
          || (this.talksCompletionFilter === 'answered' && answered)
          || (this.talksCompletionFilter === 'unanswered' && !answered));
    };
    const filteredOutEntries = outEntries.filter((entry) => matchesTalkFilter(entry, false));
    const inEntries = allIncomingEntries
      .filter((entry) => matchesTalkFilter(entry, true))
      .sort((a: any, b: any) => {
        if (a.isAnswered !== b.isAnswered) return a.isAnswered ? 1 : -1;
        if (this.talksOutSortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
        if (this.talksOutSortMode === 'oldest') return new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
    const talksNavBack = document.getElementById('talks-nav-back');
    const activeMode = this.talksViewMode;
    const talksStatus = document.getElementById('talks-status-text');
    if (talksStatus) {
      const sortLabel = this.t(({
        recent: 'talksLatestActivity',
        oldest: 'talksOldestCreation',
        'latest-reply': 'talksLatestReply',
        matches: 'talksMostMatches',
        responses: 'talksMostReplies',
        'match-rate': 'talksBestMatchRate',
        weighted: 'talksWeightedPerformance',
        title: 'talksTitle',
      } as const)[this.talksOutSortMode]);
      talksStatus.textContent = this.tf('talksStatusSummary', {
        incoming: inEntries.length,
        outgoing: filteredOutEntries.length,
        sort: sortLabel,
      });
    }
    const talksSort = document.getElementById('talks-out-sort-order') as HTMLSelectElement | null;
    if (talksSort) talksSort.value = this.talksOutSortMode;
    const talksQuery = document.getElementById('talks-filter-query') as HTMLInputElement | null;
    if (talksQuery && talksQuery.value !== this.talksQuery) talksQuery.value = this.talksQuery;
    const talksTypeFilter = document.getElementById('talks-filter-type') as HTMLSelectElement | null;
    if (talksTypeFilter) talksTypeFilter.value = this.talksTypeFilter;
    const talksCompletionFilter = document.getElementById('talks-filter-completion') as HTMLSelectElement | null;
    if (talksCompletionFilter) talksCompletionFilter.value = this.talksCompletionFilter;
    const talksOutcomeFilter = document.getElementById('talks-filter-outcome') as HTMLSelectElement | null;
    if (talksOutcomeFilter) talksOutcomeFilter.value = this.talksOutcomeFilter;
    const talksDateFrom = document.getElementById('talks-filter-date-from') as HTMLInputElement | null;
    const talksDateTo = document.getElementById('talks-filter-date-to') as HTMLInputElement | null;
    if (talksDateFrom) talksDateFrom.value = this.talksDateFrom;
    if (talksDateTo) talksDateTo.value = this.talksDateTo;

    document.querySelectorAll('.talks-nav-btn').forEach((button) => {
      button.classList.toggle('active', (button as HTMLElement).dataset.talksMode === activeMode);
    });
    if (talksNavBack) {
      talksNavBack.style.display = activeMode === 'all' ? 'none' : 'inline-flex';
    }

    if (filteredOutEntries.length === 0 && inEntries.length === 0) {
      talksList.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">${this.t('talksNoTalks')}</p>
          <p style="font-size: 0.9em; color: #999;">${this.t('talksNoTalksHelp')}</p>
        </div>
      `;
    } else {
      const outHtml =
        filteredOutEntries.length > 0
          ? filteredOutEntries
              .map(
                ([talkId, talk]) => {
                  const stats = this.talkStatsMap[talkId];
                  const matchedNames = Object.values(conversations)
                    .filter((c: any) => c.talkId === talkId)
                    .map((c: any) => c.respondedByBot ? `${c.otherUserName} 🤖` : c.otherUserName);
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
                    matchedNames.length > 0
                      ? `<div class="talk-item-matched" style="font-size: 0.85em; color: var(--success-text); margin-top: 4px;">${this.tf('talksMatchedWith', { names: escapeHtml(matchedNames.join(', ')) })}</div>`
                      : '';
                  const disabled = !!talk.disabled;
                  const expText = this.formatTalkExpiration(talk.expiresAt);
                  const locText = this.formatTalkLocation(talk.locationRadiusMiles);
                  const roleBadge = talk.role === 'copied'
                    ? `<span class="talk-badge talk-badge-copied" style="background:var(--accent-soft);color:var(--accent-text);">📋 ${this.t('talksCopied')}</span>`
                    : `<span class="talk-badge talk-badge-created" style="background:var(--accent-soft);color:var(--accent-text);">📝 ${this.t('talksCreated')}</span>`;
                  const talkTypeLower = String(talk.type || talk.fullTalk?.type || '').toLowerCase();
                  const talkLanguage = String(talk.language || talk.fullTalk?.language || 'en').toLowerCase();
                  const surveyStatsBtn =
                    talkTypeLower === 'survey'
                      ? `<button type="button" class="btn survey-stats-btn" data-talk-id="${escapeHtml(talkId)}" data-testid="survey-stats-button" style="padding: 6px 12px; font-size: 0.9em; background:var(--success-soft);color:var(--success-text);border:1px solid var(--success-border);">📊 ${this.t('talksResults')}</button>`
                      : '';
                  const typeAccent =
                    talkTypeLower === 'tag' ? '#7c3aed'
                    : talkTypeLower === 'survey' ? 'var(--success)'
                    : talkTypeLower === 'route' ? '#d97706'
                    : 'var(--accent)';
                  if (talkTypeLower === 'tag') {
                    return `
        <div class="talk-list-item talk-tag-chip talk-tag-out ${disabled ? 'talk-broadcast-disabled' : 'talk-broadcast-enabled'}" data-talk-id="${talkId}" data-role="${talk.role || 'created'}" data-talk-type="tag">
          <label class="talk-tag-checkbox-wrap" aria-label="${escapeHtml(this.t('talksTagChecked'))}">
            <input type="checkbox" class="talk-tag-checkbox talk-tag-out-checkbox" data-talk-id="${escapeHtml(talkId)}" checked>
          </label>
          <span class="talk-tag-text">${escapeHtml(talk.title)}</span>
        </div>
      `;
                  }
                  return `
        <div class="talk-list-item talk-type-${escapeHtml(talkTypeLower || 'flow')} ${disabled ? 'talk-broadcast-disabled' : 'talk-broadcast-enabled'}" data-talk-id="${talkId}" data-role="${talk.role || 'created'}" data-talk-type="${escapeHtml(talkTypeLower || 'flow')}" style="border-left:5px solid ${typeAccent};">
          <div class="talk-item-header">
            <div class="talk-item-title">${escapeHtml(talk.title)}</div>
            <div class="talk-item-badges">
              ${roleBadge}
              <span class="talk-badge talk-badge-type">${escapeHtml(this.formatTalkType(String(talk.type || 'flow')))}</span>
              <span class="talk-badge talk-badge-language" data-language="${escapeHtml(talkLanguage)}">${escapeHtml(this.formatTalkLanguage(talkLanguage))}</span>
            </div>
          </div>
          <div class="talk-item-meta">
            <span class="talk-item-time">${this.formatTalkRelativeTime(new Date(talk.lastInteraction || 0))}</span>
          </div>
          <div class="talk-item-meta" style="font-size: 0.85em; color: #666;">
            ${this.tf('talksExpiration', { value: expText })} · ${this.tf('talksLocation', { value: locText })}
          </div>
          <div class="talk-item-stats" style="font-size: 0.85em; color: #666; margin-top: 6px;">
            ${statsLine}
          </div>
          ${rankLine}
          ${matchedLine}
          <div class="talk-item-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            ${surveyStatsBtn}
            <button type="button" class="btn talk-broadcast-toggle-btn ${disabled ? 'talk-broadcast-toggle-off' : 'talk-broadcast-toggle-on'}" data-talk-id="${talkId}" data-broadcast-enabled="${disabled ? 'false' : 'true'}" style="padding: 6px 12px; font-size: 0.9em;">
              ${disabled ? this.t('talksBroadcastOff') : this.t('talksBroadcastOn')}
            </button>
            <button type="button" class="btn remove-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em; background: var(--danger); color: white;">🗑️ ${this.t('talksRemove')}</button>
          </div>
        </div>
      `;
                },
              )
              .join('')
          : '';

      const inHtml =
        inEntries.length > 0
          ? inEntries
              .map((cluster: any) => {
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
                const senderInitial = primarySenderName.trim().charAt(0).toUpperCase() || '?';
                const talkId = this.pickIncomingRowTalkId(cluster);
                const identityKey = String(cluster?.identityKey || '');
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
                return `
        <div class="talk-list-item talk-type-${escapeHtml(incomingType)} ${isAnswered ? 'talk-incoming-answered' : 'talk-incoming-new'}" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="${escapeHtml(incomingType)}" style="border-left:5px solid ${typeAccent};">
          <div class="talk-item-header">
            <div class="talk-item-title" style="${titleStyle}">${escapeHtml(cluster?.title || this.t('talksIncomingFallback'))}</div>
            <div class="talk-item-badges">
              ${statusBadge}
              <span class="talk-badge talk-badge-type">${escapeHtml(this.formatTalkType(String(cluster?.type || 'flow')))}</span>
            </div>
          </div>
          <div class="talk-incoming-sender">
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
          <div class="talk-item-meta" style="font-size: 0.85em; ${metaStyle}">
            ${this.tf('talksFrom', { names: escapeHtml(senderNames.join(', ') || this.t('settingsUnknown')) })}
          </div>
          <div class="talk-item-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="btn view-talk-btn" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" style="padding: 6px 12px; font-size: 0.9em;" ${talkId || identityKey ? '' : 'disabled'}>🔍 ${this.t('talksView')}</button>
          </div>
        </div>
      `;
              })
              .join('')
          : '';

      const sectionOut =
        filteredOutEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: var(--text-secondary); background: var(--bg-muted); border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📤</span> OUT <span style="font-size: 0.8em; font-weight: 400; color: var(--text-tertiary);">(${this.tf('talksOutSection', { count: this.formatTalkCount(filteredOutEntries.length) })})</span>
             </div>${outHtml}`
          : '';
      const sectionIn =
        inEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: var(--text-secondary); background: var(--bg-muted); border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📥</span> IN <span style="font-size: 0.8em; font-weight: 400; color: var(--text-tertiary);">(${this.tf('talksInSection', { count: this.formatTalkCount(inEntries.length), filtered: incomingFilterResult.hiddenCount > 0 ? this.tf('talksFilteredCount', { count: incomingFilterResult.hiddenCount }) : '' })})</span>
             </div>${inHtml}`
          : '';

      if (activeMode === 'in') {
        talksList.innerHTML = sectionIn || `
          <div class="empty-state" style="padding: 40px 20px; text-align: center; color: #999;">
            ${incomingFilterResult.hiddenCount > 0 ? this.tf('talksAllIncomingFiltered', { count: incomingFilterResult.hiddenCount }) : this.t('talksNoIncoming')}
            ${hiddenReasonsText ? `<div class="talk-filter-reasons" style="font-size:0.88em;margin-top:6px;">${escapeHtml(hiddenReasonsText)}</div>` : ''}
            ${!this.currentLocation && rawIncomingEntries.some((c: any) => c?.latestTalk?.locationRadiusMiles != null || c?.locationRadiusMiles != null) ? `<div class="talk-filter-reasons" style="font-size:0.88em;margin-top:6px;color:var(--warning-text);font-style:italic;">${escapeHtml(this.t('filterLocationPending'))}</div>` : ''}
          </div>
        `;
      } else if (activeMode === 'out') {
        talksList.innerHTML = sectionOut || `
          <div class="empty-state" style="padding: 40px 20px; text-align: center; color: #999;">
            ${this.t('talksNoOutgoing')}
          </div>
        `;
      } else {
        talksList.innerHTML = sectionIn + sectionOut;
      }

      // Request stats for out talks (created/copied) only
      if (filteredOutEntries.length > 0) {
        const talkIds = filteredOutEntries.map(([id]) => id);
        this.emit('needTalkStats', { talkIds });
      }

      talksList.querySelectorAll<HTMLInputElement>('.talk-tag-in-checkbox[data-indeterminate="true"]').forEach((checkbox) => {
        checkbox.indeterminate = true;
      });

      // Row click opens edit/detail only when not clicking an action button (handled in capture above)
      talksList.querySelectorAll('.talk-list-item').forEach((item) => {
        const el = item as HTMLElement;
        const talkId = el.dataset.talkId || '';
        const identityKey = el.dataset.identityKey || '';
        const role = el.dataset.role;
        if (role === 'incoming' && !talkId && !identityKey) return;
        if (role !== 'incoming' && !talkId) return;
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.talk-item-actions, .talk-tag-checkbox-wrap, .view-talk-btn')) return;
          if (role === 'copied') {
            const copied = myTalks[talkId];
            if (copied?.fullTalk) {
              this.showTalkEditorDialog(this.toOwnedOutgoingTalk(copied.fullTalk));
            } else {
              this.showNotification(this.t('talksCouldNotLoad'), 'error');
            }
          } else if (role === 'created') {
            this.emit('loadTalkForEdit', { talkId });
          } else {
            this.showTalkDetail(talkId, identityKey || undefined);
          }
        });
      });
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
    // creatorReplyRows also feeds the OUT-row matched-names line in displayTalksList (line ~2313),
    // so this derivation stays even though the panel itself (TODO §M1) is hidden and its own
    // renderCreatorReplies() DOM update is skipped.
    this.creatorReplyRows = deriveLocalCreatorReplies(this.currentUserId) as CreatorReplyRow[];
    if (document.getElementById('talks-view')?.classList.contains('active')) this.displayTalksList();
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
        const label = String(known?.label || 'stranger').toLowerCase();
        const time = new Date(row.date).getTime();
        if (query && !`${row.responderName} ${row.title}`.toLowerCase().includes(query)) return false;
        if (state.outcome !== 'all' && row.outcome !== state.outcome && row.answerMode !== state.outcome) return false;
        if (state.relationship !== 'all' && label !== state.relationship) return false;
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
          const aRel = String(this.getKnownPerson(a.responderId)?.label || 'stranger');
          const bRel = String(this.getKnownPerson(b.responderId)?.label || 'stranger');
          const g = aRel.localeCompare(bRel);
          if (g !== 0) return g;
        }
        if (state.sort === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
        if (state.sort === 'user') return a.responderName.localeCompare(b.responderName) || a.title.localeCompare(b.title);
        if (state.sort === 'talk') return a.title.localeCompare(b.title) || a.responderName.localeCompare(b.responderName);
        if (state.sort === 'relationship') {
          const byRelationship = String(this.getKnownPerson(a.responderId)?.label || 'Stranger')
            .localeCompare(String(this.getKnownPerson(b.responderId)?.label || 'Stranger'));
          if (byRelationship !== 0) return byRelationship;
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
      ).join('');
    }
    if (filtered.length === 0) {
      list.innerHTML = `<div style="color:var(--text-muted);padding:8px;">${this.t('repliesNoMatch')}</div>`;
      return;
    }
    let previousGroup = '';
    list.innerHTML = filtered.slice(0, this.creatorReplyVisibleCount).map((row) => {
      const known = this.getKnownPerson(row.responderId);
      const label = known?.label || this.t('stranger');
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
      return `${groupHeader}
        <div class="creator-reply-row" data-response-id="${escapeHtml(row.responseId)}" data-responder-id="${escapeHtml(row.responderId)}" data-talk-id="${escapeHtml(row.talkId)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
          <div style="display:flex;justify-content:space-between;gap:10px;">
            <strong>${escapeHtml(row.responderName)}</strong>
            <span style="color:${row.outcome === 'match' ? 'var(--success-text)' : 'var(--text-tertiary)'};">${escapeHtml(row.outcome === 'match' ? this.t('match') : row.outcome === 'mismatch' ? this.t('mismatch') : row.outcome)}</span>
          </div>
          <div style="font-size:0.86em;color:var(--text-secondary);">${escapeHtml(row.title)} · ${escapeHtml(row.type)} · ${escapeHtml(this.formatTalkLanguage(String(row.language || 'en').toLowerCase()))} · ${escapeHtml(row.answerMode || 'manual')} · ${escapeHtml(String(label))} · ${escapeHtml(new Date(row.date).toLocaleString())}${escapeHtml(score)}</div>
          ${answerPreview ? `<div class="creator-reply-answers" style="font-size:0.84em;color:var(--text-primary);margin-top:4px;">${this.t('repliesAnswers')}: ${escapeHtml(answerPreview)}</div>` : ''}
        </div>
      `;
    }).join('');
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
      getMyTalks: this.getMyTalks.bind(this),
      getExactChatbotMemory,
      escapeHtml: escapeHtml,
      getFlatAnswerHistory,
      copyAnsweredTalkToTalks: this.copyAnsweredTalkToTalks.bind(this),
      showTalkDetail: this.showTalkDetailAsAnswer.bind(this),
      showPreferencesDialog: this.showPreferencesDialog.bind(this),
      getTalkContentKey: UIManager.getTalkContentKey,
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
      formatType: this.formatTalkType.bind(this),
      formatLanguage: this.formatTalkLanguage.bind(this),
    });
    document.getElementById('answers-search-input')?.addEventListener('input', () => this.applyMeAnswerFilter());
    this.applyMeAnswerFilter();
  }

  private applyMeAnswerFilter(): void {
    const activeTypes = Array.from(document.querySelectorAll<HTMLElement>('.me-talk-type-filter.active'))
      .map((button) => String(button.dataset.meTalkType || '').toLowerCase())
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
      const talkType = String(item.dataset.talkType || 'flow').toLowerCase();
      const tagState = String(item.dataset.tagState || 'indeterminate');
      const matchesType = activeTypes.length === 0 ? false : activeTypes.includes(talkType);
      const matchesTagState = talkType !== 'tag' || allowedTagStates.includes(tagState);
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
      Array.from(list.querySelectorAll<HTMLElement>('.answer-talk-item'))
        .sort((a, b) => rank(a) - rank(b))
        .forEach((row) => list.insertBefore(row, empty));
    }
    if (empty) empty.style.display = visibleCount === 0 && document.querySelector('#answers-content .answer-talk-item') ? 'block' : 'none';
  }

  private renderSettingsView(user: User): void {
    const container = document.getElementById('settings-content');
    if (!container) return;
    const profileLanguages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.languages = profileLanguages;
    // Intake filters are persisted synchronously to localStorage on every settings change,
    // while user.talkFilters may still hold the *unloaded default shape* (the fallback
    // WebUserService substitutes until private Gun data arrives). Rule:
    //   - real (non-default) user filters win — they may carry legacy string-valued fields
    //     that this render is responsible for normalizing, or fresher private data;
    //   - the unloaded default shape must NOT clobber persisted localStorage filters on
    //     render (that loses the user's settings across reload).
    const hasUserFilters =
      user.talkFilters && typeof user.talkFilters === 'object' && Object.keys(user.talkFilters).length > 0;
    const normalizedUserFilters = hasUserFilters
      ? normalizeTalkFilterShape(user.talkFilters, profileLanguages)
      : null;
    const isUnloadedDefaultShape =
      !normalizedUserFilters ||
      ((normalizedUserFilters.minDistanceMiles ?? 0) === 0 &&
        (normalizedUserFilters.maxDistanceMiles ?? 50) === 50 &&
        normalizedUserFilters.requireGoodGrammar === true &&
        normalizedUserFilters.blockDirtyWords === true &&
        normalizedUserFilters.allowedTalkTypes.length === 4 &&
        (normalizedUserFilters.customBlockedTerms || []).length === 0 &&
        normalizedUserFilters.allowedLanguages.join(',') === profileLanguages.join(','));
    const talkFilters = !isUnloadedDefaultShape
      ? normalizedUserFilters!
      : hasStoredTalkIntakeFilters()
        ? getTalkIntakeFilters()
        : normalizedUserFilters ?? normalizeTalkFilterShape(undefined, profileLanguages);
    user.talkFilters = talkFilters;
    setTalkIntakeFilters(talkFilters);
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
    container.innerHTML = `
      <div style="display:grid;gap:14px;">
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
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
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;color:var(--text-primary);">${this.t('credit')}</div>
              <div style="font-size:0.82em;color:var(--text-tertiary);">${this.t('meCreditHelp')}</div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;">
              <input type="checkbox" id="settings-credit-visible" ${isCreditVisible ? 'checked' : ''}>
              <span>${this.t('settingsCreditVisible')}</span>
            </label>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meReviews')}</div><div style="font-size:1.15em;font-weight:700;">${reviewCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meStarRating')}</div><div style="font-size:1.15em;font-weight:700;">${starRating.toFixed(1)}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meFriends')}</div><div style="font-size:1.15em;font-weight:700;">${friendsCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meLiked')}</div><div style="font-size:1.15em;font-weight:700;">${likedCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meDisliked')}</div><div style="font-size:1.15em;font-weight:700;">${dislikedCount}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meMatches')}</div><div style="font-size:1.15em;font-weight:700;">${matchesFound}</div></div>
            <div style="padding:10px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);grid-column:span 2;"><div style="font-size:0.78em;color:var(--warning-text);">${this.t('meAgeVerified')}</div><div style="font-size:1.15em;font-weight:700;">${ageVerified ? '18+' : this.t('unavailable')}</div></div>
          </div>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">${this.t('settingsLanguages')}</div>
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
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:white;">
                    <input type="checkbox" class="settings-filter-language-option" value="${lang.code}" ${talkFilters.allowedLanguages.includes(lang.code) ? 'checked' : ''}>
                    <span>${lang.label}</span>
                  </label>
                `)
                .join('')}
            </div>
            <div id="settings-filter-languages-count" style="font-size:0.82em;color:var(--text-tertiary);">${talkFilters.allowedLanguages.length} ${this.t('settingsActive')}</div>
          </div>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">${this.t('settingsTalkBehavior')}</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;">
            <input type="checkbox" id="settings-copy-talk-autosave" ${getCopyTalkAutoSave() ? 'checked' : ''}>
            <span>${this.t('settingsCopyTalk')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-chatbot-enabled" ${getChatbotEnabled() ? 'checked' : ''}>
            <span>${this.t('settingsChatbot')}</span>
          </label>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">${this.t('settingsDistanceHome')}</div>
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
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">${this.t('settingsContentFilters')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-grammar-filter" ${talkFilters.requireGoodGrammar ? 'checked' : ''}> ${this.t('settingsGrammar')}</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-dirty-words-filter" ${talkFilters.blockDirtyWords ? 'checked' : ''}> ${this.t('settingsDirtyWords')}</label>
          </div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:8px;">${this.t('settingsGrammarHelp')} ${this.tf('settingsGrammarStrictness', { threshold: String(CONFIG.GRAMMAR_THRESHOLD) })}</div>
          <div style="font-size:0.8em;color:var(--text-tertiary);margin-top:4px;">${this.t('settingsDirtyWordsHelp')}</div>
          <div id="settings-dirty-words-editor" style="margin-top:10px;">
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
          <div style="margin-top:12px;">
            <div style="font-size:0.9em;margin-bottom:6px;">${this.t('settingsAllowedTypes')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${(['tag', 'flow', 'route', 'survey'] as const)
                .map((type) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:white;">
                    <input type="checkbox" class="settings-talk-filter-type" value="${type}" ${talkFilters.allowedTalkTypes.includes(type) ? 'checked' : ''}>
                    <span>${type}</span>
                  </label>
                `)
                .join('')}
            </div>
          </div>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsBlockedPhrases')}</span>
            <textarea class="form-input" id="settings-custom-blocked" rows="3">${escapeHtml((talkFilters.customBlockedTerms || []).join(', '))}</textarea>
          </label>
          <div id="settings-filtered-incoming-summary" style="font-size:0.84em;color:var(--text-tertiary);margin-top:10px;">
            ${this.t('settingsHiddenIncoming')}: ${filteredIncoming.hiddenCount}
            ${hiddenIncomingText ? `<div>${escapeHtml(hiddenIncomingText)}</div>` : ''}
            ${!this.currentLocation && (this.incomingTalkClusters || []).some((c: any) => c?.latestTalk?.locationRadiusMiles != null || c?.locationRadiusMiles != null) ? `<div style="color:var(--warning-text);font-style:italic;margin-top:4px;">${escapeHtml(this.t('filterLocationPending'))}</div>` : ''}
          </div>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div>
              <div style="font-weight:700;color:var(--text-primary);">${this.t('settingsLinkedDevices')}</div>
              <div style="font-size:0.82em;color:var(--text-tertiary);">${this.t('settingsLinkedDevicesHelp')}</div>
            </div>
            <button type="button" class="btn" id="settings-linked-devices-btn" data-testid="settings-linked-devices-btn">${this.t('settingsManage')}</button>
          </div>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid var(--danger-border);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div>
              <div style="font-weight:700;color:var(--danger-hover);">${this.t('settingsEraseDevice')}</div>
              <div style="font-size:0.82em;color:var(--text-tertiary);">${this.t('settingsEraseDeviceHelp')}</div>
            </div>
            <button type="button" class="btn" id="settings-erase-device-btn" data-testid="settings-erase-device-btn" style="background:var(--danger);color:#fff;">${this.t('settingsEraseDevice')}</button>
          </div>
        </section>
        <section id="settings-storage-inspector" style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="font-weight:700;color:var(--text-primary);">${this.t('settingsStorage')}</div>
            <button type="button" class="btn" id="settings-refresh-storage-btn">${this.t('settingsRefresh')}</button>
          </div>
          <div id="settings-storage-inspector-body" style="font-size:0.9em;color:var(--text-tertiary);">${this.t('settingsStorageLoading')}</div>
        </section>
        ${user.id === TECHSUPPORT_ROOT_USER_ID ? '<div id="support-inbox-section"></div>' : ''}
      </div>
    `;
    this.bindSettingsControls();
    void this.refreshStorageInspector();
    this.renderSupportInboxSectionIfPresent();
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
    const dirty = result.reason === 'dirty_words';
    let text: string;
    let attr: string;
    if (direction === 'send') {
      text = dirty
        ? `${this.t('messageBlockedDirtyWord')}${result.word ? ` ('${result.word}')` : ''}`
        : this.t('messageBlockedGrammar');
      attr = dirty ? 'send' : 'grammar-send';
    } else {
      text = dirty ? this.t('messageHiddenDirtyWord') : this.t('messageHiddenGrammar');
      attr = dirty ? 'receive' : 'grammar-receive';
    }
    this.showNotification(text, 'error', { contentFilter: attr });
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
   * Open the Linked devices page (§10 / item I). Uses the local display model for
   * the list and the shared pairing protocol for code validation; signed-attestation
   * publishing is delegated to the identity-link service when the app wires one
   * (via `setIdentityLinkCompleter`), else a local record is recorded so the
   * single-device page flows (stage1/71) are exercised.
   */
  private openLinkedDevicesDialog(): void {
    const LOCAL_KEY = 'iinpublic_linked_devices';
    const listRecords = (): LinkedDeviceRow[] => {
      try {
        const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    };
    const saveRecords = (rows: LinkedDeviceRow[]): void => localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
    showLinkedDevicesDialog({
      text: (key: string, fallback?: string) => {
        const value = this.t(key as any);
        return value && value !== key ? value : (fallback ?? key);
      },
      listRecords,
      selfPub: () => this.currentUserId || '',
      randomSecret: () => {
        const bytes = new Uint8Array(18);
        (globalThis.crypto || (window as any).crypto).getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      },
      completeFromCode: async (code: string) => {
        const decoded = decodePairingCode(code);
        if (!decoded) return 'invalid';
        if (decoded.pub === (this.currentUserId || '')) return 'self';
        if (isPairingExpired(decoded)) return 'expired';
        const rows = listRecords();
        if (rows.some((r) => r.pub === decoded.pub)) return 'reused';
        if (this.identityLinkCompleter) {
          const err = await this.identityLinkCompleter(code);
          if (err) return err;
        }
        rows.push({ pub: decoded.pub, stageName: this.t('linkedDeviceDefaultName'), platform: 'web', linkedAt: Date.now() });
        saveRecords(rows);
        return null;
      },
      unlink: async (pub: string) => {
        if (this.identityLinkUnlinker) await this.identityLinkUnlinker(pub);
        saveRecords(listRecords().filter((r) => r.pub !== pub));
      },
    });
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
      linked = Array.isArray(arr) ? arr : [];
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
      ...(this.deviceHandoffSync ? { onSyncFirst: this.deviceHandoffSync } : {}),
    });
  }

  /** Optional handoff-sync hook the app wires for §11.2 (encrypted archive transfer). */
  private deviceHandoffSync?: (progress: (category: import('../../shared/device-handoff').HandoffCategory) => void) => Promise<void>;
  setDeviceHandoffSync(fn: (progress: (category: import('../../shared/device-handoff').HandoffCategory) => void) => Promise<void>): void {
    this.deviceHandoffSync = fn;
  }

  /** Optional hooks the app wires to publish real signed attestations/revocations (§10). */
  private identityLinkCompleter?: (code: string) => Promise<'invalid' | 'expired' | 'reused' | 'self' | null>;
  private identityLinkUnlinker?: (pub: string) => Promise<void>;
  setIdentityLinkHooks(hooks: {
    completeFromCode?: (code: string) => Promise<'invalid' | 'expired' | 'reused' | 'self' | null>;
    unlink?: (pub: string) => Promise<void>;
  }): void {
    if (hooks.completeFromCode) this.identityLinkCompleter = hooks.completeFromCode;
    if (hooks.unlink) this.identityLinkUnlinker = hooks.unlink;
  }

  private bindSettingsControls(): void {
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
    document.getElementById('settings-linked-devices-btn')?.addEventListener('click', () => this.openLinkedDevicesDialog());
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

  private displayContextualStatistics(elementId: string): void {
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
      element.textContent = this.tf('contextualStatsSummary', {
        responses: totals.responses,
        matches: totals.matches,
        rate: totals.matchRate,
        room: roomText,
      });
    } catch {
      element.textContent = this.t('contextualStatsEmpty');
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
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:white;overflow:auto;">
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
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:white;overflow:auto;">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${this.t('statsBroadcastTagsHeader')}</div>
            ${tagFrequencyBars}
            <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">Tag</th><th style="text-align:right;padding:6px 8px;">Uses</th></tr></thead>
              <tbody>${tagRows || `<tr><td colspan="2" style="padding:8px;color:var(--text-tertiary);">No data yet.</td></tr>`}</tbody>
            </table>
            ${tagTrendSection}
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:white;overflow:auto;">
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
      <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:white;overflow:auto;">
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
      fullTalk: this.toOwnedOutgoingTalk(talk.fullTalk),
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
   * Me-tab Q&A traceback (TODO §P) always means "show my answer," never "edit the talk" — even
   * for a self-answered own-created talk, which otherwise keeps role:'created' and would route
   * to the editor. Route through showTalkDetail's preferAnswerView option instead of duplicating
   * its role/fullTalk lookup here.
   */
  private showTalkDetailAsAnswer(talkId: string): void {
    this.showTalkDetail(talkId, undefined, { preferAnswerView: true });
  }

  private showTalkDetail(talkId: string, identityKeyFallback?: string, options?: { preferAnswerView?: boolean }): void {
    const raw = (talkId || '').trim();
    const tid = isValidTalkId(raw) ? raw : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', {
        identityKey: identityKeyFallback,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true });
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
        this.showTalkResponseDialog(talk.fullTalk, { skipAutoAnswer: true });
      } else {
        this.showNotification(this.tf('talksDetailNotice', { title: talk.title }), 'info');
      }
    } else {
      // Incoming: load by id; if Gun gave a bad id, app retries via identityKey from server API.
      this.emit('demandFullTalk', {
        talkId: tid,
        identityKeyFallback: identityKeyFallback || undefined,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true });
          else
            this.showNotification(
              this.t('talksCouldNotLoadRetry'),
              'error',
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

  public formatTalkSendSuccess(): string {
    return this.t('talksSendSuccess');
  }

  public formatTalkSendFailed(reason: string): string {
    return this.tf('talksSendFailed', { reason });
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

      const sendMessage = () => {
        const message = messageInput.value.trim();
        if (message) {
          // Send-path content filter (redesign §9): a blocked message is not sent
          // and the composer text is preserved for editing.
          if (!this.allowOutgoingMessage(message)) return;
          this.emit('sendConversationMessage', {
            conversationId,
            message,
            ...(this.currentThreadTalkId ? { talkId: this.currentThreadTalkId } : {}),
          });
          messageInput.value = '';
        }
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
        <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid var(--border-strong);border-radius:999px;background:white;">
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
      <div style="width:min(620px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 18px 55px rgba(15,23,42,0.2);">
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

  showTalkResponseDialog(talk: any, options?: { skipAutoAnswer?: boolean; isTalkSuperseded?: boolean; senderName?: string }): void {
    openTalkResponseDialog({
      talk,
      ...(options?.skipAutoAnswer !== undefined ? { skipAutoAnswer: options.skipAutoAnswer } : {}),
      ...(options?.isTalkSuperseded ? { isTalkSuperseded: true } : {}),
      ...(options?.senderName ? { senderName: options.senderName } : {}),
      escapeHtml: escapeHtml,
      showNotification: this.showNotification.bind(this),
      completeTalk: this.completeTalk.bind(this),
      resolveAnswerPreferenceForTalkQuestion: this.resolveAnswerPreferenceForTalkQuestion.bind(this),
      saveAnswerPreference: this.saveAnswerPreference.bind(this),
      text: this.t.bind(this),
    });
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

  private toOwnedOutgoingTalk(talk: any): any {
    if (!talk || typeof talk !== 'object' || !this.currentUserId) return talk;
    return {
      ...talk,
      authorId: this.currentUserId,
      ...(this.currentUser?.stageName ? { authorName: this.currentUser.stageName } : {}),
    };
  }

  private completeTalk(talk: any, answers: any[], outcome?: 'match' | 'mismatch'): void {
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
      fullTalk: role === 'copied'
        ? this.toOwnedOutgoingTalk(existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk)
        : existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk,
      completedAnswers,
      outcome: outcome ?? existingEntry?.outcome ?? 'mismatch',
      senders,
    });
    this.saveFlatAnswerHistoryRecord(talkIdToUse, talk, completedAnswers, outcome ?? existingEntry?.outcome ?? 'mismatch', senders);

    this.emit('talkCompleted', {
      talkId: talk.id,
      answers,
      talkData: talk,
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
      const isTag = talkType === 'tag';
      const prompt = String(question?.text || talk?.title || `Question ${index + 1}`).trim();
      const rawChoice = String(entry.answerText || '').trim();
      const choice = isTag
        ? answer?.isMatch
          ? 'Checked'
          : 'Unchecked'
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
      return {
        questionId: entry.questionId,
        answerId: entry.answerId,
        prompt,
        choice,
        kind: isTag ? 'tag' : 'question',
        contextPath,
        contextLabel,
        ...(entry.mode ? { mode: entry.mode } : {}),
        ...(contextHash ? { contextHash } : {}),
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
   * Prefer context-aware flat key (cross-talk + multi-question path), then legacy `${talkId}_${questionId}`.
   */
  private resolveAnswerPreferenceForTalkQuestion(
    talk: any,
    questionIndex: number,
    previousQAPairs: QAPair[],
    currentQuestion: { id: string; text?: string; answers?: any[] },
    talkInstanceId: string,
  ): {
    answerId: string;
    answerText: string;
    mode: string;
    questionText?: string;
    allAnswers?: any[];
    autoAnswerAction?: string;
    autoAnswerReason?: string;
  } | null {
    const exactMemory = getExactChatbotMemory();
    const currentOptions = (currentQuestion.answers || []).map((answer: any) => String(answer?.text || ''));
    const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
    if (currentQuestion.text && currentOptions.length > 0) {
      const exact = findAutoAnswer(
        exactMemory,
        LOCAL_EXACT_CHATBOT_USER_ID,
        currentQuestion.text,
        currentOptions,
        undefined,
        languageContext,
      );
      setExactChatbotMemory(exactMemory);
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

    const talkContentHash = computeTalkIdFromTalkData(talk);
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      talkContentHash,
      questionIndex,
      previousQAPairs,
      currentQuestion.text || '',
    );
    const flat = getFlattenedAnswerPreferences()[flatKey];
    if (flat) return flat;
    const preferences = getAnswerPreferences();
    const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
    return preferences[legacyKey] || null;
  }

  private saveAnswerPreference(
    talk: any,
    talkInstanceId: string,
    currentQuestion: { id: string; text?: string; answers?: any[] },
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode: 'auto' | 'manual' | 'permanent' | 'suppressed' = 'auto',
  ): void {
    const exactMemory = getExactChatbotMemory();
    const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
    if (currentQuestion.text) {
      if (mode === 'suppressed') {
        saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, undefined, languageContext);
      } else if (mode === 'permanent') {
        savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext);
      } else if (mode === 'auto') {
        saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext);
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
    const previous = sessionAnswersToQAPairs(talk, fullSessionAnswersIncludingCurrent.slice(0, -1));
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      talkContentHash,
      qIndex,
      previous,
      currentQuestion.text || '',
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
      flatKey,
    };

    preferences[legacyKey] = entry;
    setAnswerPreferences(preferences);

    const flatMap = getFlattenedAnswerPreferences();
    flatMap[flatKey] = entry;
    setFlattenedAnswerPreferences(flatMap);
    console.log('💾 Saved answer (exact + flat + legacy):', flatKey, answerText, mode);
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
  ): Array<{ questionId: string; answerId: string; answerText: string; mode?: string }> | null {
    const questions = talkData?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const out: Array<{ questionId: string; answerId: string; answerText: string; mode?: string }> =
      [];
    const pairs: QAPair[] = [];
    const gunId = talkData.id || '';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const pref = this.resolveAnswerPreferenceForTalkQuestion(talkData, i, pairs, q, gunId);
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
      pairs.push({
        questionText: (q.text || '').trim(),
        answerText: (pref.answerText || '').trim(),
      });
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
    const full = row?.role === 'copied' ? this.toOwnedOutgoingTalk(row?.fullTalk) : row?.fullTalk;
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
        const btn = row.querySelector('.talk-broadcast-toggle-btn') as HTMLButtonElement | null;
        if (btn) {
          btn.dataset.broadcastEnabled = disabled ? 'false' : 'true';
          btn.classList.toggle('talk-broadcast-toggle-off', !!disabled);
          btn.classList.toggle('talk-broadcast-toggle-on', !disabled);
          btn.textContent = disabled ? this.t('talksBroadcastOff') : this.t('talksBroadcastOn');
        }
      });
    } else {
      this.displayTalksList();
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
    options?: { persistent?: boolean; conversationId?: string; contentFilter?: string },
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
    // on click (rule N6).
    notification.style.cursor = 'pointer';
    notification.addEventListener('click', () => {
      if (document.body.contains(notification)) document.body.removeChild(notification);
      if (isMatchNotification && options?.conversationId) {
        this.showConversationDetail(options.conversationId);
      }
    });

    document.body.appendChild(notification);

    const hideAfter = isMatchNotification
      ? 8000
      : message === this.t('chatroomNoTalksToBroadcast')
        ? 10000
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
    const defaultLanguage = String(existingTalk?.language || getDefaultTalkLanguagePreference(this.getUiLanguage())).toLowerCase();
    openTalkEditorDialog({
      existingTalk,
      defaultLanguage,
      languageOptions: LANGUAGE_OPTIONS.map((language) => ({
        ...language,
        label: languageOptionLabel(this.getUiLanguage(), language.code, language.label),
      })),
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
    const language = String(
      (document.getElementById('talk-language') as HTMLSelectElement | null)?.value ||
      this.getUiLanguage() ||
      'en',
    ).toLowerCase();

    const expiresSelect = document.getElementById('talk-expires') as HTMLSelectElement;
    const locationSelect = document.getElementById('talk-location-radius') as HTMLSelectElement;
    const sendToChatroomCheck = document.getElementById('talk-send-to-chatroom') as HTMLInputElement;
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

      if (type === 'tag') {
      const keyword = title || (document.getElementById('talk-title') as HTMLInputElement).value.trim();
      if (!keyword) {
        this.showTalkValidationError([this.t('editorTagRequired')]);
        return false;
      }
      questions = [
        {
          id: 'q_0',
          text: keyword,
          answers: [
            { id: 'a_0_match', text: 'Match.', isMatch: true, isTerminal: true },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ];
      const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
      const likesTag = tagLikeCheckbox ? tagLikeCheckbox.checked : true;
      selfAnswers.push({ questionId: 'q_0', answerId: likesTag ? 'a_0_match' : 'a_0_ignore' });
    } else if (type === 'route') {
      questions = this.collectRouteEditorQuestions();
      if (questions.length === 0) {
        this.showTalkValidationError([this.t('editorRouteRequired')]);
        return false;
      }
    } else {
      // flow + survey share the linear editor
      questions = [];
      const questionItems = form.querySelectorAll('.question-item');

      questionItems.forEach((item, qIndex) => {
        const questionId = `q_${qIndex}`;
        const selfRadio = item.querySelector(`input[name="self-answer-${questionId}"]:checked`) as HTMLInputElement;
        if (selfRadio && selfRadio.value !== 'ignore') {
          selfAnswers.push({ questionId, answerId: selfRadio.value });
        }
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
        if (type === 'survey') {
          questionObj.isAggregatable = true;
          questionObj.contextHashId = '';
        }
        questions.push(questionObj);
      });
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
      tags: [],
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
        tags: [],
        expiresAt,
        locationRadiusMiles,
      });
    } else {
      const attachmentInput = document.getElementById('talk-attachment-input') as HTMLInputElement | null;
      const mediaFile = attachmentInput?.files?.[0];
      this.emit('createTalk', {
        title,
        type,
        isAdult,
        questions,
        language,
        tags: [],
        sendToChatroom,
        expiresAt,
        locationRadiusMiles,
        selfAnswers,
        ...(mediaFile ? { mediaFile } : {}),
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
    answers: Array<{ id: string; text: string; isMatch?: boolean; isIgnore?: boolean; isTerminal?: boolean }>;
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
            isTerminal: a.isTerminal !== false,
          })),
        }));
      } else {
        // Seed with a single root question.
        this.routeEditorQuestions = [
          {
            id: 'q_0',
            text: '',
            parentAnswer: null,
            answers: [
              { id: 'a_0_match', text: this.t('editorRouteDefaultMatch'), isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: this.t('editorRouteDefaultIgnore'), isIgnore: true, isTerminal: true },
            ],
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
      const answersHtml = q.answers
        .map((a) => {
          const childIds = childrenOf.get(`${q.id}::${a.id}`) ?? [];
          const kind = a.isMatch
            ? this.t('editorRouteKindMatch')
            : a.isIgnore
              ? this.t('editorRouteKindIgnore')
              : a.isTerminal
                ? this.t('editorRouteKindTerminal')
                : this.t('editorRouteKindLink');
          return `
            <div class="route-answer" data-qid="${q.id}" data-aid="${a.id}" style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
              <span class="route-answer-kind" style="font-size:0.8em; padding:2px 6px; border-radius:10px; background:#eef; color:#334;">${kind}</span>
              <input type="text" class="form-input route-answer-text" value="${escapeHtml(a.text)}" placeholder="${this.t('editorRouteAnswerPlaceholder')}" data-qid="${q.id}" data-aid="${a.id}" style="flex:1;">
              <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:var(--accent); color:white; padding:2px 6px;">${this.t('editorRouteAddChild')}</button>
              <button type="button" class="btn route-remove-answer-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:var(--danger); color:white; padding:2px 6px;">×</button>
            </div>
            ${childIds.map((c) => renderNode(c, depth + 1)).join('')}
          `;
        })
        .join('');
      return `
        <div class="route-node" data-qid="${q.id}" style="border:1px solid #ddd; border-radius:6px; padding:8px; margin:6px 0; ${indent} background:var(--bg-subtle);">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:var(--accent);">${this.t('editorRouteQuestionPrefix')}</strong>
            <input type="text" class="form-input route-question-text" value="${escapeHtml(q.text)}" placeholder="${this.t('editorRouteQuestionPlaceholder')}" data-qid="${q.id}" style="flex:1;">
            <button type="button" class="btn route-add-answer-btn" data-qid="${q.id}" style="font-size:0.8em; background:var(--success); color:white; padding:2px 6px;">${this.t('editorAddAnswer')}</button>
            ${q.parentAnswer ? `<button type="button" class="btn route-remove-question-btn" data-qid="${q.id}" style="font-size:0.8em; background:var(--danger); color:white; padding:2px 6px;">${this.t('editorRouteRemoveQuestion')}</button>` : ''}
          </div>
          ${answersHtml}
        </div>
      `;
    };
    host.innerHTML = roots.map((r) => renderNode(r, 0)).join('');

    // Bind events (delegation-free for clarity).
    host.querySelectorAll<HTMLInputElement>('.route-question-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (q) q.text = inp.value;
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-answer-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q) return;
        const a = q.answers.find((x) => x.id === inp.dataset.aid);
        if (a) a.text = inp.value;
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
            { id: `${newId}_match`, text: this.t('editorRouteDefaultMatch'), isMatch: true, isTerminal: true },
            { id: `${newId}_ignore`, text: this.t('editorRouteDefaultIgnore'), isIgnore: true, isTerminal: true },
          ],
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
   * Converts the route-editor model into the validator-ready Question[] shape.
   * Sets each question's contextPath by walking up its parent chain.
   */
  private collectRouteEditorQuestions(): any[] {
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
    return this.routeEditorQuestions.map((q) => {
      const contextPath = computeContextPath(q.id);
      return {
        id: q.id,
        text: q.text.trim(),
        contextPath,
        answers: q.answers.map((a) => {
          const obj: any = { id: a.id, text: a.text.trim() };
          if (a.isMatch) obj.isMatch = true;
          if (a.isIgnore) obj.isIgnore = true;
          if (a.isTerminal) obj.isTerminal = true;
          return obj;
        }),
      };
    });
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

  private async openDirectConversationWithPeer(peerId: string, peerName: string): Promise<void> {
    try {
      const conversationId = await new Promise<string>((resolve, reject) => {
        this.emit('openDirectConversation', { peerId, peerName, resolve, reject });
      });
      if (conversationId) this.showConversationDetail(conversationId);
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
      openDirectConversation: (peerId: string, peerName: string) => {
        void this.openDirectConversationWithPeer(peerId, peerName);
      },
      renderPeerContext: (container: HTMLElement, peerId: string, peerName: string) => {
        this.renderPeerContextSection(container, peerId, peerName);
      },
      resolvePeerStageName: this.resolvePeerStageNameLive.bind(this),
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
      label: KnownPerson['label'];
      nickname?: string;
      customLabel?: string;
      rating?: number;
      notes?: string;
    },
  ): Promise<void> {
    if (!this.currentUser) return;
    const nextEntry: KnownPerson = {
      userId,
      label: details.label,
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
  }): void {
    const conversations = this.getMyConversations();
    const existing = conversations[conversationData.conversationId];
    const isNew = !existing;

    // Keep bot provenance sticky once true; some sync paths can emit records without this field.
    const respondedByBot = !!existing?.respondedByBot || conversationData.respondedByBot === true;
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
      this.showNotification(this.tf('conversationNewMessage', { name }), 'info');
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
    if (!changed) return;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) this.displayConversationsList();
  }
}
