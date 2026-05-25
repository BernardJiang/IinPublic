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
import { computeTalkIdFromTalkData } from '../../shared/talk-content-id';
import {
  buildAnswerPreferenceLookupKey,
  sessionAnswersToQAPairs,
  type QAPair,
} from '../../shared/flattened-answer-keys';
import { normalizeQuestionKey, interestsFromCommaInput } from '../../shared/user-utils';
import { PROFILE_VISIBILITY_LABELS, normalizeProfileAttributeVisibility } from '../../shared/profile-privacy';
import { INTEREST_CATEGORY_LABELS, INTEREST_CATEGORY_SELECT_ORDER } from '../../shared/interest-catalog';
import { TalkValidator, TalkAutofix } from '../../shared/talk-engine';
import { getFlatChatroomList, CHATROOM_HIERARCHY } from '../../shared/chatroom-hierarchy';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import type { StatsByRegion, StatsByTime, StatsDashboard, StatsSummary } from '../../shared/talk-stats';
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
  showContactDetail as openContactDetail,
  showContactsList as openContactsList,
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
  type AnswerPreferenceMap,
  type MyQuestionAnswerEntry,
} from './answer-preferences-storage';
import {
  findAutoAnswer,
  LOCAL_EXACT_CHATBOT_USER_ID,
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
  getUiLanguagePreference,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setCopyTalkAutoSave,
  setUiLanguagePreference,
} from './ui-settings-storage';
import { showMyTalksDialog as openMyTalksDialog } from './my-talks-dialog';
import { showPreferencesDialog as openPreferencesDialog } from './preferences-dialog';
import { showTalkResponseDialog as openTalkResponseDialog } from './talk-response-dialog';
import {
  addAnswerToQuestion as addTalkEditorAnswerToQuestion,
  addQuestionToForm as addTalkEditorQuestionToForm,
  appendIgnoreRow as appendTalkEditorIgnoreRow,
  setupTalkFormHandlers as setupTalkEditorFormHandlers,
  updateAllAnswerDropdowns as updateTalkEditorAnswerDropdowns,
} from './talk-editor-form-helpers';
import { showTalkEditorDialog as openTalkEditorDialog } from './talk-editor-dialog';
import { openPeerDetailView } from './user-detail-view';
import { avatarInnerHtml } from './profile-avatar';
import { languageOptionLabel, uiLanguageFromProfile, uiText, type UiTranslationKey } from './ui-translations';
import {
  filterIncomingTalkClusters,
  getTalkIntakeFilters,
  setTalkIntakeFilters,
} from './talk-intake-filters';
import { normalizeCustomBlockedTerms } from '../../shared/talk-intake-filters';

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
  rejectedByCounts: Record<string, number>;
  previewUnavailable?: boolean;
};

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
  };
}

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;
  private currentUser?: User;
  private currentChatroom: string = 'global';
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];
  private talksViewMode: 'all' | 'in' | 'out' = 'all';
  private talksOutSortMode: 'recent' | 'oldest' | 'latest-reply' | 'matches' | 'responses' | 'match-rate' | 'weighted' | 'title' = 'recent';
  private apiBase: string = '';
  private currentUserId: string = '';
  private currentUserStageName: string = '';
  private currentLocation: GPSCoordinate | undefined = undefined;

  /** Other users in the current chatroom detail view (excludes self); used for broadcast + server-side IN registration. */
  getCurrentChatroomMembers(): Array<{ userId: string; stageName: string }> {
    return [...this.currentChatroomMembers];
  }
  private currentConversationId: string | undefined = undefined;
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
      ['#create-custom-chatroom-btn', 'newRoom'],
      ['#return-home-btn', 'returnHome'],
      ['#broadcast-talk-btn', 'broadcast'],
      ['#back-to-chatrooms', 'back'],
      ['#creator-replies-panel strong', 'repliesTitle'],
      ['#reply-clear-filters', 'clear'],
      ['#settings-refresh-location-btn', 'refreshLocation'],
      ['#back-to-contacts-list', 'back'],
      ['#talks-nav-back', 'back'],
      ['#talks-nav-all', 'talksAll'],
      ['.me-answer-filter[data-me-answer-filter="all"]', 'meAll'],
      ['.me-answer-filter[data-me-answer-filter="auto"]', 'meAuto'],
      ['.me-answer-filter[data-me-answer-filter="manual"]', 'meManualFilter'],
      ['.me-answer-filter[data-me-answer-filter="conditional"]', 'meConditional'],
      ['#me-view-preferences-btn', 'preferences'],
    ];
    for (const [selector, key] of textBySelector) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.textContent = this.t(key);
    }
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

  private getHomeChatroomId(): string {
    if (this.travelHomeChatroomId) return this.travelHomeChatroomId;
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
    const away = !!this.currentChatroom && this.currentChatroom !== home;
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
    const findInTree = (node: typeof CHATROOM_HIERARCHY): string | null => {
      if (node.id === chatroomId) return node.name;
      if (node.children) {
        for (const ch of node.children) {
          const r = findInTree(ch);
          if (r) return r;
        }
      }
      return null;
    };
    const treeName = findInTree(CHATROOM_HIERARCHY);
    if (treeName) return treeName;
    return chatroomId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private async refreshMeBroadcastTagTrends(): Promise<void> {
    const host = document.getElementById('me-broadcast-tag-trends');
    if (!host) return;
    const base = (this.apiBase || '').trim();
    if (!base) {
      host.innerHTML =
        `<p style="font-size:0.85em;color:#6b7280;margin:0;">${escapeHtml(this.t('meTrendConnect'))}</p>`;
      return;
    }
    host.innerHTML = `<p style="font-size:0.85em;color:#6b7280;margin:0;">${escapeHtml(this.t('loading'))}</p>`;
    try {
      const c = new AbortController();
      const tid = window.setTimeout(() => c.abort(), 4000);
      const res = await fetch(`${base}/api/stats/broadcast-tags/trends?days=7`, { signal: c.signal });
      window.clearTimeout(tid);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        days?: string[];
        tags?: Array<{ id?: string; total?: number; byDay?: number[] }>;
      };
      const days = Array.isArray(body.days) ? body.days : [];
      const tags = Array.isArray(body.tags) ? body.tags : [];
      if (tags.length === 0) {
        host.innerHTML =
          `<p style="font-size:0.85em;color:#6b7280;margin:0;">${escapeHtml(this.t('meTrendNoData'))}</p>`;
        return;
      }
      const top = tags.slice(0, 8);
      const head =
        `<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(this.t('meTrendTag'))}</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(this.t('meTrendWindow'))}</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(this.t('meTrendDaily'))}</th></tr>`;
      const rows = top
        .map((row) => {
          const id = escapeHtml(String(row.id || ''));
          const byDay = Array.isArray(row.byDay) ? row.byDay : [];
          const sumWindow = byDay.reduce((a, b) => a + (Number(b) || 0), 0);
          const mini = days
            .map((d, i) => `${escapeHtml(d.slice(5))}:${byDay[i] ?? 0}`)
            .join(' ');
          return `<tr><td style="padding:6px 8px;font-weight:600;">${id}</td><td style="padding:6px 8px;text-align:right;">${sumWindow}</td><td style="padding:6px 8px;font-size:0.78em;color:#374151;">${mini}</td></tr>`;
        })
        .join('');
      host.innerHTML = `
        <p style="font-size:0.82em;color:#6b7280;margin:0 0 10px 0;">${escapeHtml(this.t('meTrendHelp'))}</p>
        <div style="overflow:auto;max-width:100%;">
          <table style="width:100%;border-collapse:collapse;font-size:0.88em;">${head}${rows}</table>
        </div>`;
    } catch {
      host.innerHTML =
        `<p style="font-size:0.85em;color:#b45309;margin:0;">${escapeHtml(this.t('meTrendUnavailable'))}</p>`;
    }
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
    const sortedReceivers = [...new Set(receiverIds)].sort();
    const receiverKey = sortedReceivers.join(',');
    const history = this.getBroadcastHistory();
    return this.getBroadcastableTalkIds().filter((talkId) => {
      const talk = this.getMyTalks()[talkId];
      const key = `${chatroomId}|${receiverKey}|${this.getBroadcastRevisionKey(talkId, talk)}`;
      return !history[key];
    });
  }

  recordBroadcastConversation(chatroomId: string, talkIds: string[], receivers: Array<{ userId: string }>): void {
    const receiverIds = receivers.map((r) => String(r.userId || '').trim()).filter(Boolean).sort();
    const receiverKey = receiverIds.join(',');
    const location = this.currentLocation
      ? `${this.currentLocation.latitude.toFixed(3)},${this.currentLocation.longitude.toFixed(3)}`
      : undefined;
    const history = this.getBroadcastHistory();
    const sentAt = new Date().toISOString();
    for (const talkId of talkIds) {
      const talk = this.getMyTalks()[talkId];
      if (!talk) continue;
      const key = `${chatroomId}|${receiverKey}|${this.getBroadcastRevisionKey(talkId, talk)}`;
      history[key] = {
        sentAt,
        chatroomId,
        receiverIds,
        ...(location ? { location } : {}),
      };
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
  }

  private setupBaseUI(): void {
    if (!this.appContainer) return;

    this.appContainer.innerHTML = `
      <div class="app-container">
        <!-- Top Header -->
        <div class="top-header" id="top-header">
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
          <div class="header-actions" id="header-actions">
            <button class="header-btn" id="create-talk-btn">➕</button>
          </div>
        </div>

        <!-- Main View Container -->
        <div class="view-container">
          
          <!-- Chatrooms View (Default) -->
          <div class="view-panel active" id="chatrooms-view">
            <div class="tab-action-bar chatroom-action-bar" id="chatroom-action-bar" style="padding: 8px 12px; border-bottom: 1px solid #eee; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              <button class="back-btn" id="back-to-chatrooms" style="display:none;">‹ Back</button>
              <button type="button" class="btn" id="create-custom-chatroom-btn" data-testid="create-custom-chatroom-btn">New Room</button>
              <button type="button" class="btn" id="return-home-btn" data-testid="return-home-btn" disabled>Return Home</button>
              <button type="button" class="btn status-broadcast-btn" id="broadcast-talk-btn" title="Send every talk in your OUT list to everyone in this chatroom">
                Broadcast
              </button>
            </div>
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
              <div class="chatroom-members-list" id="chatroom-members-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading members...</p>
              </div>
            </div>
          </div>

          <!-- Contacts View (users who have matches with current user) -->
          <div class="view-panel" id="contacts-view">
            <div class="view-content">
              <div class="tab-action-bar contacts-action-bar" style="padding: 8px 12px; border-bottom: 1px solid #eee; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <button class="back-btn" id="back-to-contacts-list" style="display:none;">‹ Back</button>
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
                </select>
              </div>
              <div class="embedded-stats-strip" id="contacts-stats-strip" style="padding:8px 12px;color:#64748b;font-size:0.88em;"></div>
              <div class="contacts-list-container" id="contacts-list-container">
                <div class="contacts-list" id="contacts-list">
                  <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Match with others via Talks to see them here.</p>
                </div>
              </div>
              <!-- Contact detail: list of talks with this user (hidden by default) -->
              <div class="contact-detail-container" id="contact-detail-container" style="display: none;">
                <div class="contact-detail-header">
                  <div class="contact-detail-info" id="contact-detail-info">
                    <div class="contact-detail-name" id="contact-detail-name">Contact</div>
                    <div class="contact-detail-matches" id="contact-detail-matches">0 matches</div>
                  </div>
                </div>
                <div class="contact-talks-list" id="contact-talks-list">
                  <p style="text-align: center; padding: 20px; color: #999;">Loading...</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Talks View -->
          <div class="view-panel" id="talks-view">
            <div class="view-content">
              <div class="tab-action-bar talks-action-bar" style="padding: 8px 12px; border-bottom: 1px solid #eee; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <button class="btn talks-nav-back" id="talks-nav-back" type="button" style="display: none;">
                  ‹ Back
                </button>
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
              </div>
              <div class="embedded-stats-strip" id="talks-stats-strip" style="padding:8px 12px;color:#64748b;font-size:0.88em;"></div>
              <section id="creator-replies-panel" style="padding:12px;border-bottom:1px solid #e5e7eb;background:#fff;">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px;">
                  <strong>Replies To My Talks</strong>
                  <span id="creator-replies-summary" style="font-size:0.85em;color:#64748b;">Loading...</span>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
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
                  <div class="conversation-detail-status" id="conversation-status">Online</div>
                </div>
              </div>
              <div class="conversation-messages" id="conversation-messages">
                <p style="text-align: center; padding: 20px; color: #999;">Start your conversation!</p>
              </div>
              <div class="conversation-input-container">
                <textarea id="conversation-message-input" placeholder="Type a message..." rows="2"></textarea>
                <button class="btn send-btn" id="send-conversation-message">Send</button>
              </div>
            </div>
          </div>

          <!-- Peer Detail Overlay -->
          <div class="peer-detail-overlay" id="peer-detail-overlay" style="display: none;">
            <div class="peer-detail-container">
              <div class="peer-detail-header">
                <button class="back-btn" id="back-from-peer-detail">‹ Back</button>
                <div class="peer-detail-info">
                  <div class="peer-detail-name" id="peer-detail-name">User</div>
                  <div class="peer-detail-subtitle" id="peer-detail-subtitle">Loading...</div>
                </div>
              </div>
              <div class="peer-detail-body">
                <div id="peer-stats-section"></div>
                <div id="peer-conversations-section"></div>
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
                  <label class="peer-auto-mode-label" style="display:flex;align-items:center;gap:8px;padding:12px 16px 4px;font-size:0.9em;cursor:pointer;">
                    <input type="checkbox" id="peer-auto-mode-checkbox" checked>
                    <span id="peer-auto-mode-text">Auto mode - send all new talks automatically</span>
                  </label>
                  <div style="padding:8px 16px 16px;">
                    <button class="btn primary-btn" id="peer-send-talks-btn" style="width:100%;">📤 Send My Talks</button>
                    <div style="margin-top:12px;">
                      <div id="peer-dm-label" style="font-size:0.85em;color:#64748b;margin-bottom:4px;">Send a direct message</div>
                      <textarea id="peer-dm-input" rows="2" placeholder="Type a message…" data-testid="peer-dm-input" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.9em;resize:none;"></textarea>
                      <button class="btn primary-btn" id="peer-dm-send-btn" data-testid="peer-dm-send-btn" style="width:100%;margin-top:6px;">💬 Send Message</button>
                    </div>
                    <button class="btn" id="peer-block-user-btn" style="width:100%;margin-top:8px;">Block User</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Me View -->
          <div class="view-panel" id="me-view">
            <div class="view-content">
              <div class="tab-action-bar me-action-bar" style="padding: 8px 12px; border-bottom: 1px solid #eee; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <button class="btn me-answer-filter active" data-me-answer-filter="all" type="button">All</button>
                <button class="btn me-answer-filter" data-me-answer-filter="auto" type="button">Auto</button>
                <button class="btn me-answer-filter" data-me-answer-filter="manual" type="button">Manual</button>
                <button class="btn me-answer-filter" data-me-answer-filter="conditional" type="button">Conditional</button>
                <button class="btn primary-btn" id="me-view-preferences-btn" type="button">Preferences</button>
              </div>
              <div class="embedded-stats-strip" id="me-stats-strip" style="padding:8px 12px;color:#64748b;font-size:0.88em;"></div>
              <div id="user-info-me" style="padding:0 12px;"></div>
              <div class="answers-section" style="margin-top: 24px;">
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
              <div class="tab-action-bar settings-action-bar" style="padding: 8px 12px; border-bottom: 1px solid #eee; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <button class="btn" id="settings-refresh-location-btn" type="button">Refresh Location</button>
              </div>
              <div id="settings-content" style="padding:16px;max-width:min(980px,96%);margin:0 auto;"></div>
            </div>
          </div>

        </div>

        <!-- Bottom Navigation Bar -->
        <div class="bottom-nav">
          <button class="nav-btn active" data-view="chatrooms" data-testid="bottom-navigation-button-chat">
            <div class="nav-icon">🌍</div>
            <div class="nav-label">Chatrooms</div>
          </button>
          <button class="nav-btn" data-view="contacts" data-testid="bottom-navigation-button-contacts">
            <div class="nav-icon">👥</div>
            <div class="nav-label">Contacts</div>
          </button>
          <button class="nav-btn" data-view="talks">
            <div class="nav-icon">📢</div>
            <div class="nav-label">Talks</div>
          </button>
          <button class="nav-btn" data-view="me" data-testid="bottom-navigation-button-me">
            <div class="nav-icon">👤</div>
            <div class="nav-label">Me</div>
          </button>
          <button class="nav-btn" data-view="settings" data-testid="bottom-navigation-button-settings">
            <div class="nav-icon">⚙️</div>
            <div class="nav-label">Settings</div>
          </button>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.setupBottomNavigation();
  }

  private setupEventListeners(): void {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
    const createTalkBtn = document.getElementById('create-talk-btn');

    if (sendButton && messageInput) {
      sendButton.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message) {
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
    const meViewPreferencesBtn = document.getElementById('me-view-preferences-btn');
    if (meViewPreferencesBtn) {
      meViewPreferencesBtn.addEventListener('click', () => {
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
    document.querySelectorAll('.me-answer-filter').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.me-answer-filter').forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        this.applyMeAnswerFilter((button as HTMLElement).dataset.meAnswerFilter || 'all');
      });
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
    this.restoreCreatorReplyFilterState();
    ['reply-filter-query', 'reply-filter-outcome', 'reply-filter-relationship', 'reply-filter-type', 'reply-filter-language', 'reply-filter-from', 'reply-filter-to', 'reply-sort-order', 'reply-group-order'].forEach((id) => {
      document.getElementById(id)?.addEventListener(id === 'reply-filter-query' ? 'input' : 'change', () => {
        this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
        this.persistCreatorReplyFilterState();
        this.renderCreatorReplies();
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
      this.renderCreatorReplies();
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

  private async runBroadcastFromCurrentRoom(): Promise<void> {
    if (!this.currentChatroom) {
      this.showNotification('Open a chatroom from the list (tap a room), or wait until you are placed in one.', 'info');
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
        this.showNotification('You have no talks to broadcast. Create one first or enable copied talks.', 'info');
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

    const receiverIds = members.map((m) => m.userId).filter((id) => id && id !== this.currentUserId);
    const talkIds = this.getUnsentBroadcastTalkIds(this.currentChatroom, receiverIds);
    if (talkIds.length === 0) {
      this.showNotification('Everything current has already been broadcast to this room.', 'info');
      return;
    }

    this.emit('broadcastTalk', {
      chatroomId: this.currentChatroom,
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

        // Show/hide create talk button based on view
        if (headerActions) {
          headerActions.style.display = 'flex';
          if (targetView === 'chatrooms' || targetView === 'talks') {
            headerActions.style.visibility = 'visible';
          } else {
            headerActions.style.visibility = 'hidden';
          }
        }

        // Special handling for chatrooms view
        if (targetView === 'chatrooms') {
          this.showChatroomList();
        }

        // Special handling for contacts view
        if (targetView === 'contacts') {
          this.dismissMatchNotifications();
          this.showContactsList();
          void this.displayContextualStatistics('contacts-stats-strip');
        }

        // Special handling for talks view
        if (targetView === 'talks') {
          this.emit('needIncomingTalkClusters');
          this.displayTalksList();
          void this.refreshCreatorReplies();
          void this.displayContextualStatistics('talks-stats-strip');
        }

        // Special handling for me view: refresh conversations list and request a source sync.
        if (targetView === 'me') {
          if (this.currentUser) this.showMainInterface(this.currentUser);
          this.emit('needConversationSync');
          this.displayAnswersList();
          void this.displayContextualStatistics('me-stats-strip');
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
    this.currentUserStageName = user.stageName;
    this.applyShellTranslations();
  }

  showMainInterface(user: User): void {
    user.languages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.talkFilters = normalizeTalkFilterShape(user.talkFilters, user.languages);
    this.currentUser = user;
    this.currentUserId = user.id;
    this.currentUserStageName = user.stageName;
    this.applyShellTranslations();
    // Update the persistent header identity without duplicating the generated stage name.
    const headerStatus = document.getElementById('header-status');
    const headerUserInfo = document.getElementById('header-user-info');
    if (headerUserInfo) {
      headerUserInfo.innerHTML = `
        <div class="user-avatar">
          ${avatarInnerHtml(user.headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
        </div>
        <span class="visually-hidden" data-testid="user-stage-name">${user.stageName}</span>
      `;
    }
    if (headerStatus) {
      headerStatus.style.display = 'flex';
    }

    // Update user info in Me view
    const userInfoMe = document.getElementById('user-info-me');
    if (userInfoMe) {
      const headshot = String(user.headshot || '').trim();
      const profileAnswers = Array.isArray(user.profile) ? user.profile : [];
      const interestNames = Array.isArray(user.interests)
        ? user.interests.map((t: Tag) => String(t?.name || '').trim()).filter(Boolean)
        : [];
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
                  : `<div style="font-size:0.72em;color:#64748b;margin-top:2px;">${escapeHtml(
                      vis === 'contacts_only' ? this.t('meVisibilityContacts') : this.t('meVisibilityPrivate'),
                    )}</div>`;
              const question = canonicalSupportRole ? this.t('meTechSupportRole') : qa.question;
              const answer = canonicalSupportRole ? this.t('meTechSupportRoleValue') : qa.answer;
              return `<div style="padding:8px 10px;border-radius:10px;background:white;border:1px solid #e5e7eb;"><div style="font-size:0.78em;color:#64748b;">${escapeHtml(question)}</div>${visNote}<div style="font-size:0.92em;font-weight:600;color:#111827;margin-top:2px;">${escapeHtml(answer)}</div></div>`;
            })
            .join('')
        : `<div style="font-size:0.88em;color:#6b7280;">${escapeHtml(this.t('meNoPublicProfile'))}</div>`;
      const reputation = user.reputation || ({} as typeof user.reputation);
      const reviewCount = reputation.reviewCount ?? 0;
      const starRating = Number(reputation.starRating ?? 0);
      const friendsCount = reputation.friendsCount ?? 0;
      const matchesFound = reputation.matchesFound ?? 0;
      const likedCount = reputation.likedCount ?? 0;
      const dislikedCount = reputation.dislikedCount ?? 0;
      const ageVerified = reputation.ageVerified === true;
      const isCreditVisible = reputation.isHidden !== true;
      userInfoMe.innerHTML = `
        <div class="user-avatar" style="width: 80px; height: 80px; font-size: 2em; margin: 20px auto;">
          ${avatarInnerHtml(headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
        </div>
        <div style="text-align: center; margin-top: 10px;">
          <div style="font-size: 1.2em; font-weight: 600;">${user.stageName}</div>
          <div style="font-size: 0.9em; color: #999; margin-top: 5px;">${this.t('online')}</div>
          <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap; margin-top:10px;">
            <button class="btn" id="edit-stagename-btn" data-testid="edit-stage-name-button">${this.t('editStageName')}</button>
            <button class="btn" id="edit-profile-btn" data-testid="edit-profile-button">${this.t('editProfile')}</button>
          </div>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #ffffff; border-radius: 12px; text-align: left; border:1px solid #e5e7eb;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;">
            <div style="font-weight:700; color:#111827;">${this.t('profile')}</div>
            <div style="font-size:0.82em; color:#6b7280;">${this.t('meProfileVisibilityHelp')}</div>
          </div>
          <div style="font-size:0.88em; color:#374151; margin-bottom:10px;">
            ${this.t('languagesLabel')}: ${escapeHtml((Array.isArray(user.languages) && user.languages.length > 0 ? user.languages : ['en']).map((code) => this.formatTalkLanguage(code)).join(', '))}
          </div>
          ${interestNames.length > 0 ? `<div style="font-size:0.88em; color:#374151; margin-bottom:10px;">${this.t('interestsLabel')}: ${escapeHtml(interestNames.join(', '))}</div>` : ''}
          <div style="display:grid; gap:8px;">
            ${profilePreview}
          </div>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #f0fdf4; border-radius: 12px; text-align: left; border:1px solid #bbf7d0;">
          <div style="font-weight: 700; color: #111827; margin-bottom: 8px;">${this.t('broadcastTagTrends')}</div>
          <div id="me-broadcast-tag-trends" data-testid="me-broadcast-tag-trends"></div>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #fff7ed; border-radius: 12px; text-align: left;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
            <div>
              <div style="font-weight: 700; color: #111827;">${this.t('credit')}</div>
              <div style="font-size: 0.82em; color: #6b7280;">${this.t('meCreditHelp')}</div>
            </div>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85em;">
              <input type="checkbox" id="credit-visibility-checkbox" ${isCreditVisible ? 'checked' : ''}>
              <span>${this.t('showToOthers')}</span>
            </label>
          </div>
          <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meReviews')}</div><div style="font-size:1.15em;font-weight:700;">${reviewCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meStarRating')}</div><div style="font-size:1.15em;font-weight:700;">${starRating.toFixed(1)}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meFriends')}</div><div style="font-size:1.15em;font-weight:700;">${friendsCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meLiked')}</div><div style="font-size:1.15em;font-weight:700;">${likedCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meDisliked')}</div><div style="font-size:1.15em;font-weight:700;">${dislikedCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meMatches')}</div><div style="font-size:1.15em;font-weight:700;">${matchesFound}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;grid-column:span 2;"><div style="font-size:0.78em;color:#9a3412;">${this.t('meAgeVerified')}</div><div style="font-size:1.15em;font-weight:700;">${ageVerified ? '✓ 18+' : '—'}</div></div>
          </div>
        </div>
      `;

      void this.refreshMeBroadcastTagTrends();

      // Add event listener for edit stage name button
      const editBtn = document.getElementById('edit-stagename-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => this.showEditStageNameDialog(user));
      }
      const editProfileBtn = document.getElementById('edit-profile-btn');
      if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => this.showEditProfileDialog(user));
      }
      const creditVisibilityCheckbox = document.getElementById('credit-visibility-checkbox') as HTMLInputElement | null;
      if (creditVisibilityCheckbox) {
        creditVisibilityCheckbox.addEventListener('change', () => {
          if (this.currentUser?.reputation) this.currentUser.reputation.isHidden = !creditVisibilityCheckbox.checked;
          this.emit('setCreditVisibility', { visible: creditVisibilityCheckbox.checked });
        });
      }
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
  }

  isTravelModeActive(): boolean {
    return this.travelModeActive;
  }

  getTravelHomeChatroomId(): string | undefined {
    return this.travelHomeChatroomId;
  }

  showContactsList(): void {
    openContactsList({
      apiBase: this.apiBase,
      currentUserId: this.currentUserId,
      escapeHtml: escapeHtml,
      getKnownPeople: this.getKnownPeople.bind(this),
      getKnownPerson: this.getKnownPerson.bind(this),
      isBlockedByMe: this.isBlockedByMe.bind(this),
      getPeerName: this.getPeerName.bind(this),
      openPeerDetail: this.openPeerDetailForUser.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      saveKnownPerson: this.saveKnownPerson.bind(this),
      submitPeerReview: this.submitPeerReview.bind(this),
      vouchAgeVerified: this.vouchAgeVerified.bind(this),
      setBlocked: this.setBlocked.bind(this),
      text: this.t.bind(this),
    });
  }

  displayContactsList(): void {
    renderContactsList({
      apiBase: this.apiBase,
      currentUserId: this.currentUserId,
      escapeHtml: escapeHtml,
      getKnownPeople: this.getKnownPeople.bind(this),
      getKnownPerson: this.getKnownPerson.bind(this),
      isBlockedByMe: this.isBlockedByMe.bind(this),
      getPeerName: this.getPeerName.bind(this),
      openPeerDetail: this.openPeerDetailForUser.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      saveKnownPerson: this.saveKnownPerson.bind(this),
      submitPeerReview: this.submitPeerReview.bind(this),
      vouchAgeVerified: this.vouchAgeVerified.bind(this),
      setBlocked: this.setBlocked.bind(this),
      text: this.t.bind(this),
    });
  }

  showContactDetail(otherUserId: string, otherUserName: string): void {
    void openContactDetail(
      {
        apiBase: this.apiBase,
        currentUserId: this.currentUserId,
        escapeHtml: escapeHtml,
        getKnownPeople: this.getKnownPeople.bind(this),
        getKnownPerson: this.getKnownPerson.bind(this),
        isBlockedByMe: this.isBlockedByMe.bind(this),
        getPeerName: this.getPeerName.bind(this),
        openPeerDetail: this.openPeerDetailForUser.bind(this),
        getMyTalks: this.getMyTalks.bind(this),
        saveKnownPerson: this.saveKnownPerson.bind(this),
        submitPeerReview: this.submitPeerReview.bind(this),
        vouchAgeVerified: this.vouchAgeVerified.bind(this),
        setBlocked: this.setBlocked.bind(this),
        text: this.t.bind(this),
      },
      otherUserId,
      otherUserName,
    );
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
      openPeerDetail: this.openPeerDetailForUser.bind(this),
      emit: (eventName, payload) => this.emit(eventName, payload),
      currentUserId: this.currentUserId,
      apiBase: this.apiBase,
      text: this.t.bind(this),
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
          this.showNotification(text || 'Could not create room.', 'error');
          return;
        }
        const created = text
          ? JSON.parse(text) as {
              id?: string;
              name?: string;
              type?: string;
              description?: string;
              createdBy?: string;
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
          });
          this.showChatroomDetail(createdId);
        }
        this.showNotification(`${created?.name || payload.name} created.`, 'success');
      } catch (e) {
        this.showNotification('Could not create room: ' + (e as Error).message, 'error');
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
            <h2 class="modal-title">New chatroom</h2>
            <p style="color:#666;font-size:0.9em;">Create a community or business room. Anyone can join from the list.</p>
          </div>
          <form id="create-custom-chatroom-form">
            <div class="form-group">
              <label class="form-label">Type</label>
              <select class="form-input" id="custom-room-type" name="type">
                <option value="custom">Community / custom</option>
                <option value="business">Business</option>
              </select>
            </div>
            <div class="form-group" id="custom-room-business-headline-group" style="display:none;">
              <label class="form-label">Business headline (optional)</label>
              <input type="text" class="form-input" id="custom-room-business-headline" maxlength="120" placeholder="Short tagline" />
            </div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" class="form-input" id="custom-room-name" name="name" required minlength="2" maxlength="80" data-testid="custom-room-name-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Description (optional)</label>
              <textarea class="form-input" id="custom-room-description" rows="2" maxlength="500"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Capacity (optional)</label>
              <input type="number" class="form-input" id="custom-room-capacity" min="1" max="50000" placeholder="Default 50" />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-custom-room-btn" style="background:#6c757d;">Cancel</button>
              <button type="submit" class="btn primary-btn" data-testid="custom-room-submit-btn">Create</button>
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
          this.showNotification('Name must be at least 2 characters.', 'warning');
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
            <h2 class="modal-title">Rename room</h2>
            <p class="rename-custom-room-current" style="color:#666;font-size:0.9em;"></p>
          </div>
          <form id="rename-custom-chatroom-form">
            <div class="form-group">
              <label class="form-label">New name</label>
              <input type="text" class="form-input" id="rename-custom-room-name" required minlength="2" maxlength="80" data-testid="rename-custom-room-input" />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-rename-room-btn" style="background:#6c757d;">Cancel</button>
              <button type="submit" class="btn primary-btn">Save</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);
      const curEl = modal.querySelector('.rename-custom-room-current');
      if (curEl) curEl.textContent = `Current: ${currentName}`;
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
          this.showNotification('Name must be at least 2 characters.', 'warning');
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
      if (chatroomStatus) chatroomStatus.textContent = 'Loading members...';
      const membersList = document.getElementById('chatroom-members-list');
      if (membersList) {
        membersList.innerHTML =
          '<div style="padding: 20px; text-align: center; color: #999;">Loading online users...</div>';
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
                this.showNotification(disabled ? 'Broadcasting disabled' : 'Broadcasting enabled', 'success');
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
    const inEntries = backendInEntries;
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
        outgoing: outEntries.length,
        sort: sortLabel,
      });
    }
    const talksSort = document.getElementById('talks-out-sort-order') as HTMLSelectElement | null;
    if (talksSort) talksSort.value = this.talksOutSortMode;

    document.querySelectorAll('.talks-nav-btn').forEach((button) => {
      button.classList.toggle('active', (button as HTMLElement).dataset.talksMode === activeMode);
    });
    if (talksNavBack) {
      talksNavBack.style.display = activeMode === 'all' ? 'none' : 'inline-flex';
    }

    if (allEntries.length === 0 && inEntries.length === 0) {
      talksList.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">${this.t('talksNoTalks')}</p>
          <p style="font-size: 0.9em; color: #999;">${this.t('talksNoTalksHelp')}</p>
        </div>
      `;
    } else {
      const outHtml =
        outEntries.length > 0
          ? outEntries
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
                    ? `<div class="talk-weighted-score" style="font-size:0.82em;color:#64748b;margin-top:4px;">${this.tf('talksWeightedScore', { score: metrics.weighted })}</div>`
                    : this.talksOutSortMode === 'latest-reply' && metrics.latestResponseAt > 0
                      ? `<div class="talk-weighted-score" style="font-size:0.82em;color:#64748b;margin-top:4px;">${this.tf('talksLatestReplyLabel', { date: escapeHtml(new Date(metrics.latestResponseAt).toLocaleString()) })}</div>`
                      : '';
                  const matchedLine =
                    matchedNames.length > 0
                      ? `<div class="talk-item-matched" style="font-size: 0.85em; color: #2e7d32; margin-top: 4px;">${this.tf('talksMatchedWith', { names: escapeHtml(matchedNames.join(', ')) })}</div>`
                      : '';
                  const disabled = !!talk.disabled;
                  const expText = this.formatTalkExpiration(talk.expiresAt);
                  const locText = this.formatTalkLocation(talk.locationRadiusMiles);
                  const roleBadge = talk.role === 'copied'
                    ? `<span class="talk-badge talk-badge-copied" style="background:#e0e7ff;color:#3730a3;">📋 ${this.t('talksCopied')}</span>`
                    : `<span class="talk-badge talk-badge-created" style="background:#dbeafe;color:#1e40af;">📝 ${this.t('talksCreated')}</span>`;
                  const talkTypeLower = String(talk.type || talk.fullTalk?.type || '').toLowerCase();
                  const talkLanguage = String(talk.language || talk.fullTalk?.language || 'en').toLowerCase();
                  const surveyStatsBtn =
                    talkTypeLower === 'survey'
                      ? `<button type="button" class="btn survey-stats-btn" data-talk-id="${escapeHtml(talkId)}" data-testid="survey-stats-button" style="padding: 6px 12px; font-size: 0.9em; background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;">📊 ${this.t('talksResults')}</button>`
                      : '';
                  const typeAccent =
                    talkTypeLower === 'tag' ? '#7c3aed'
                    : talkTypeLower === 'survey' ? '#059669'
                    : talkTypeLower === 'route' ? '#d97706'
                    : '#2563eb';
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
            <button type="button" class="btn remove-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em; background: #dc3545; color: white;">🗑️ ${this.t('talksRemove')}</button>
          </div>
        </div>
      `;
                },
              )
              .join('')
          : '';

      const inHtml =
        inEntries.length > 0
          ? backendInEntries
              .map((cluster: any) => {
                const sendersObj = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
                const senderNames = Array.from(
                  new Set(
                    Object.values(sendersObj)
                      .map((s: any) => String(s?.senderName || '').trim())
                      .filter(Boolean),
                  ),
                );
                const talkId = this.pickIncomingRowTalkId(cluster);
                const identityKey = String(cluster?.identityKey || '');
                const isAnswered = !!cluster?.isAnswered;
                const titleStyle = isAnswered
                  ? 'font-weight: 500; color: #9ca3af;'
                  : 'font-weight: 700; color: #1d4ed8;';
                const metaStyle = isAnswered ? 'color: #9ca3af;' : 'color: #4b5563;';
                const statusBadge = isAnswered
                  ? `<span class="talk-badge" style="background:#f3f4f6;color:#6b7280;">✅ ${this.t('talksAnswered')}</span>`
                  : `<span class="talk-badge" style="background:#dbeafe;color:#1d4ed8;font-weight:700;">🆕 ${this.t('talksNew')}</span>`;
                const incomingType = String(cluster?.type || 'flow').toLowerCase();
                const incomingLanguage = String(cluster?.language || cluster?.latestTalk?.language || 'en').toLowerCase();
                const typeAccent =
                  incomingType === 'tag' ? '#7c3aed'
                  : incomingType === 'survey' ? '#059669'
                  : incomingType === 'route' ? '#d97706'
                  : '#2563eb';
                return `
        <div class="talk-list-item talk-type-${escapeHtml(incomingType)} ${isAnswered ? 'talk-incoming-answered' : 'talk-incoming-new'}" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="${escapeHtml(incomingType)}" style="border-left:5px solid ${typeAccent};">
          <div class="talk-item-header">
            <div class="talk-item-title" style="${titleStyle}">${escapeHtml(cluster?.title || this.t('talksIncomingFallback'))}</div>
            <div class="talk-item-badges">
              ${statusBadge}
              <span class="talk-badge talk-badge-type">${escapeHtml(this.formatTalkType(String(cluster?.type || 'flow')))}</span>
              <span class="talk-badge talk-badge-language" data-language="${escapeHtml(incomingLanguage)}">${escapeHtml(this.formatTalkLanguage(incomingLanguage))}</span>
              <span class="talk-badge" style="background:#eef2ff;color:#3730a3;">👥 ${this.tf(senderNames.length === 1 ? 'talksSenderOne' : 'talksSenders', { count: senderNames.length })}</span>
            </div>
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
        outEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📤</span> OUT <span style="font-size: 0.8em; font-weight: 400; color: #6b7280;">(${this.tf('talksOutSection', { count: this.formatTalkCount(outEntries.length) })})</span>
             </div>${outHtml}`
          : '';
      const sectionIn =
        inEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📥</span> IN <span style="font-size: 0.8em; font-weight: 400; color: #6b7280;">(${this.tf('talksInSection', { count: this.formatTalkCount(inEntries.length), filtered: incomingFilterResult.hiddenCount > 0 ? this.tf('talksFilteredCount', { count: incomingFilterResult.hiddenCount }) : '' })})</span>
             </div>${inHtml}`
          : '';

      if (activeMode === 'in') {
        talksList.innerHTML = sectionIn || `
          <div class="empty-state" style="padding: 40px 20px; text-align: center; color: #999;">
            ${incomingFilterResult.hiddenCount > 0 ? this.tf('talksAllIncomingFiltered', { count: incomingFilterResult.hiddenCount }) : this.t('talksNoIncoming')}
            ${hiddenReasonsText ? `<div class="talk-filter-reasons" style="font-size:0.88em;margin-top:6px;">${escapeHtml(hiddenReasonsText)}</div>` : ''}
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
      if (outEntries.length > 0) {
        const talkIds = outEntries.map(([id]) => id);
        this.emit('needTalkStats', { talkIds });
      }

      // Row click opens edit/detail only when not clicking an action button (handled in capture above)
      talksList.querySelectorAll('.talk-list-item').forEach((item) => {
        const el = item as HTMLElement;
        const talkId = el.dataset.talkId || '';
        const identityKey = el.dataset.identityKey || '';
        const role = el.dataset.role;
        if (role === 'incoming' && !talkId && !identityKey) return;
        if (role !== 'incoming' && !talkId) return;
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.talk-item-actions')) return;
          if (role === 'created' || role === 'copied') {
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
    if (!this.apiBase || !this.currentUserId) return;
    const summary = document.getElementById('creator-replies-summary');
    try {
      const response = await fetch(`${this.apiBase}/api/users/${encodeURIComponent(this.currentUserId)}/replies`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.creatorReplyRows = (await response.json()) as CreatorReplyRow[];
      this.renderCreatorReplies();
      if (document.getElementById('talks-view')?.classList.contains('active')) this.displayTalksList();
    } catch {
      if (summary) summary.textContent = this.t('repliesUnavailable');
    }
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
        state.language !== 'all' ? `${this.getUiLanguage() === 'zh' ? this.t('languagesLabel') : 'Language'}: ${state.language}` : '',
        state.from ? `${this.getUiLanguage() === 'zh' ? '起始日期' : 'From'}: ${state.from}` : '',
        state.to ? `${this.getUiLanguage() === 'zh' ? '结束日期' : 'To'}: ${state.to}` : '',
      ].filter(Boolean);
      activeFilters.innerHTML = chips.map((chip) =>
        `<span class="reply-filter-chip" style="font-size:0.8em;background:#e2e8f0;border-radius:999px;padding:3px 8px;">${escapeHtml(chip)}</span>`,
      ).join('');
    }
    if (filtered.length === 0) {
      list.innerHTML = `<div style="color:#94a3b8;padding:8px;">${this.t('repliesNoMatch')}</div>`;
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
        ? `<div class="creator-reply-group" style="font-weight:700;color:#475569;margin-top:5px;">${escapeHtml(group)}</div>`
        : '';
      previousGroup = group;
      return `${groupHeader}
        <div class="creator-reply-row" data-response-id="${escapeHtml(row.responseId)}" data-responder-id="${escapeHtml(row.responderId)}" data-talk-id="${escapeHtml(row.talkId)}" style="padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;">
          <div style="display:flex;justify-content:space-between;gap:10px;">
            <strong>${escapeHtml(row.responderName)}</strong>
            <span style="color:${row.outcome === 'match' ? '#166534' : '#64748b'};">${escapeHtml(row.outcome === 'match' ? this.t('match') : row.outcome === 'mismatch' ? this.t('mismatch') : row.outcome)}</span>
          </div>
          <div style="font-size:0.86em;color:#475569;">${escapeHtml(row.title)} · ${escapeHtml(row.type)} · ${escapeHtml(row.language || 'en')} · ${escapeHtml(row.answerMode || 'manual')} · ${escapeHtml(String(label))} · ${escapeHtml(new Date(row.date).toLocaleString())}${escapeHtml(score)}</div>
          ${answerPreview ? `<div class="creator-reply-answers" style="font-size:0.84em;color:#334155;margin-top:4px;">${this.t('repliesAnswers')}: ${escapeHtml(answerPreview)}</div>` : ''}
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
      showTalkDetail: this.showTalkDetail.bind(this),
      showPreferencesDialog: this.showPreferencesDialog.bind(this),
      getTalkContentKey: UIManager.getTalkContentKey,
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
      formatType: this.formatTalkType.bind(this),
    });
    const activeFilter = (document.querySelector('.me-answer-filter.active') as HTMLElement | null)?.dataset.meAnswerFilter || 'all';
    this.applyMeAnswerFilter(activeFilter);
  }

  private applyMeAnswerFilter(filter: string): void {
    document.querySelectorAll<HTMLElement>('#answers-content .answer-outcome-item').forEach((item) => {
      const mode = item.dataset.answerMode || 'manual';
      item.style.display = filter === 'all' || filter === mode ? 'block' : 'none';
    });
  }

  private renderSettingsView(user: User): void {
    const container = document.getElementById('settings-content');
    if (!container) return;
    const profileLanguages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.languages = profileLanguages;
    const talkFilters = normalizeTalkFilterShape(user.talkFilters, profileLanguages);
    user.talkFilters = talkFilters;
    setTalkIntakeFilters(talkFilters);
    const reputation = user.reputation || ({} as typeof user.reputation);
    const home = this.getHomeChatroomId();
    const headshot = String(user.headshot || '').trim();
    const interestNames = Array.isArray(user.interests)
      ? user.interests.map((t: Tag) => String(t?.name || '').trim()).filter(Boolean)
      : [];
    const locationText = this.currentLocation
      ? `${this.currentLocation.latitude.toFixed(3)}, ${this.currentLocation.longitude.toFixed(3)}`
      : this.t('settingsUnknown');
    const filteredIncoming = filterIncomingTalkClusters(
      (this.incomingTalkClusters || []).filter((cluster: any) => cluster && cluster.identityKey),
      talkFilters,
      this.currentLocation,
    );
    const hiddenIncomingText = this.formatReasonCounts(filteredIncoming.hiddenByReason);
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
    const languageOptions = LANGUAGE_OPTIONS.map((language) => ({
      ...language,
      label: languageOptionLabel(uiLanguage, language.code, language.label),
    }));
    const headshotChoices = ['🙂', '😎', '🤠', '🎾', '☕', '🌟', '🐱', '🦊'];
    container.innerHTML = `
      <div style="display:grid;gap:14px;">
        <section style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;">
              <div class="user-avatar" style="width:48px;height:48px;font-size:1.25em;flex:0 0 auto;">
                ${avatarInnerHtml(headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
              </div>
              <div style="min-width:0;">
                <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
                  <span>${this.t('settingsStageName')}</span>
                  <input type="text" class="form-input" id="settings-stage-name-input" data-testid="settings-stage-name-input" value="${escapeHtml(user.stageName)}" minlength="3">
                </label>
                <div id="settings-stage-name-error" role="alert" style="display:none;font-size:0.82em;color:#b91c1c;margin-top:5px;"></div>
                ${interestNames.length > 0 ? `<div style="font-size:0.86em;color:#64748b;">Interests: ${escapeHtml(interestNames.join(', '))}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
              <span>${this.t('settingsHeadshot')}</span>
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
              <div style="font-size:0.78em;color:#64748b;">${this.t('settingsPhotoHelp')}</div>
              <div id="settings-camera-status" role="status" style="display:none;font-size:0.8em;color:#b91c1c;"></div>
            </div>
          </div>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="font-weight:700;color:#111827;margin-bottom:10px;">${this.t('settingsLanguages')}</div>
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
          <div style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsIncomingLanguage')}</span>
            <div id="settings-filter-languages" data-testid="settings-incoming-language-select" style="display:flex;flex-wrap:wrap;gap:8px;">
              ${languageOptions
                .map((lang) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid #d1d5db;border-radius:999px;background:white;">
                    <input type="checkbox" class="settings-filter-language-option" value="${lang.code}" ${talkFilters.allowedLanguages.includes(lang.code) ? 'checked' : ''}>
                    <span>${lang.label}</span>
                  </label>
                `)
                .join('')}
            </div>
            <div id="settings-filter-languages-count" style="font-size:0.82em;color:#64748b;">${talkFilters.allowedLanguages.length} ${this.t('settingsActive')}</div>
          </div>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="font-weight:700;color:#111827;margin-bottom:10px;">${this.t('settingsTalkBehavior')}</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;">
            <input type="checkbox" id="settings-copy-talk-autosave" ${getCopyTalkAutoSave() ? 'checked' : ''}>
            <span>${this.t('settingsCopyTalk')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-chatbot-enabled" ${getChatbotEnabled() ? 'checked' : ''}>
            <span>${this.t('settingsChatbot')}</span>
          </label>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="font-weight:700;color:#111827;margin-bottom:10px;">${this.t('settingsDistanceHome')}</div>
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
          <div style="margin-top:4px;font-size:0.82em;color:#64748b;">${this.t('settingsLocation')}: ${escapeHtml(locationText)}</div>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:0.9em;margin-top:10px;">
            <span>${this.t('settingsSentAfter')}</span>
            <input type="datetime-local" class="form-input" id="settings-sent-after" value="${escapeHtml(talkFilters.sentAfter ? String(talkFilters.sentAfter).slice(0, 16) : '')}">
          </label>
        </section>
        <section style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="font-weight:700;color:#111827;margin-bottom:10px;">${this.t('settingsContentFilters')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-grammar-filter" ${talkFilters.requireGoodGrammar ? 'checked' : ''}> ${this.t('settingsGrammar')}</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-dirty-words-filter" ${talkFilters.blockDirtyWords ? 'checked' : ''}> ${this.t('settingsDirtyWords')}</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;"><input type="checkbox" id="settings-credit-visible" ${reputation.isHidden === true ? '' : 'checked'}> ${this.t('settingsCreditVisible')}</label>
          </div>
          <div style="font-size:0.8em;color:#64748b;margin-top:8px;">${this.t('settingsGrammarHelp')}</div>
          <div style="font-size:0.8em;color:#64748b;margin-top:4px;">${this.t('settingsDirtyWordsHelp')}</div>
          <div style="margin-top:12px;">
            <div style="font-size:0.9em;margin-bottom:6px;">${this.t('settingsAllowedTypes')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${(['tag', 'flow', 'route', 'survey'] as const)
                .map((type) => `
                  <label style="display:flex;align-items:center;gap:6px;font-size:0.9em;padding:6px 10px;border:1px solid #d1d5db;border-radius:999px;background:white;">
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
          <div id="settings-filtered-incoming-summary" style="font-size:0.84em;color:#64748b;margin-top:10px;">
            ${this.t('settingsHiddenIncoming')}: ${filteredIncoming.hiddenCount}
            ${hiddenIncomingText ? `<div>${escapeHtml(hiddenIncomingText)}</div>` : ''}
          </div>
        </section>
        <section id="settings-storage-inspector" style="padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="font-weight:700;color:#111827;">${this.t('settingsStorage')}</div>
            <button type="button" class="btn" id="settings-refresh-storage-btn">${this.t('settingsRefresh')}</button>
          </div>
          <div id="settings-storage-inspector-body" style="font-size:0.9em;color:#64748b;">${this.t('settingsStorageLoading')}</div>
        </section>
      </div>
    `;
    this.bindSettingsControls();
    void this.refreshStorageInspector();
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
      const nextFilters: TalkIntakeFilters = {
        allowedLanguages: filterLanguages,
        requireGoodGrammar: !!(document.getElementById('settings-grammar-filter') as HTMLInputElement | null)?.checked,
        blockDirtyWords: !!(document.getElementById('settings-dirty-words-filter') as HTMLInputElement | null)?.checked,
        allowedTalkTypes: typeEls.filter((el) => el.checked).map((el) => el.value as any),
        customBlockedTerms: normalizeCustomBlockedTerms((customBlockedEl?.value || '').split(/[\n,]+/).map((part) => part.trim()).filter(Boolean)),
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
        this.showNotification('Minimum distance cannot be greater than maximum distance.', 'error');
        if (this.currentUser?.talkFilters) {
          if (minDistanceEl) minDistanceEl.value = String(this.currentUser.talkFilters.minDistanceMiles ?? '');
          if (maxDistanceEl) maxDistanceEl.value = String(this.currentUser.talkFilters.maxDistanceMiles ?? '');
        }
        return;
      }
      setTalkIntakeFilters(nextFilters);
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
    document.getElementById('settings-custom-blocked')?.addEventListener('input', sync);
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
        const message = 'Stage name must be at least 3 characters.';
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
          ? 'That stage name is reserved. Please choose another name.'
          : 'Stage name could not be updated.';
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
        this.showNotification('Choose a PNG, JPEG, WebP, or GIF image.', 'error');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.showNotification('Photo must be 2 MB or smaller.', 'error');
        return;
      }
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.addEventListener('load', () => resolve(String(reader.result || '')));
        reader.addEventListener('error', () => reject(reader.error || new Error('Photo could not be read.')));
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
          <video id="settings-camera-preview-video" autoplay muted playsinline style="display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:14px;background:#0f172a;"></video>
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
    const serverRows = serverStorage?.pathClassifications || [];
    body.innerHTML = `
      <div style="display:grid;gap:12px;">
        <div id="storage-inspector-flags" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${this.renderStoragePill(this.t('storageMode'), serverStorage?.mode || 'star')}
          ${this.renderStoragePill(this.t('storagePersistence'), this.storageValue(flags.starServerPersistence || 'unknown'))}
          ${this.renderStoragePill(this.t('storageLocalNode'), this.storageValue(flags.p2pNodeEnabled ? 'enabled' : 'disabled'))}
          ${this.renderStoragePill(this.t('storageDirectChat'), this.storageValue(flags.p2pDirectChatEnabled ? 'enabled' : 'disabled'))}
        </div>
        ${this.renderLocalNodeInspector(serverStorage?.localNode)}
        ${this.renderSeaIdentityInspector(serverStorage?.seaIdentityPolicy, serverStorage?.seaStorageScan)}
        ${this.renderConversationTransportInspector(serverStorage?.conversationTransport)}
        ${this.renderP2PNetworkProtocolInspector(serverStorage?.p2pNetworkProtocol)}
        ${this.renderP2PNeighborMemoryInspector(serverStorage?.neighborMemory)}
        ${this.renderDataOwnershipInspector(serverStorage?.dataOwnership, serverStorage?.relayTtlPolicy, serverStorage?.transportDiagnostics)}
        <div>
          <div style="font-weight:600;color:#334155;margin-bottom:6px;">${this.t('storageBrowserLocal')}</div>
          <div id="storage-inspector-local" style="display:flex;flex-wrap:wrap;gap:6px;">
            ${
              browserStorage.localStorageKeys.length === 0
                ? `<span style="color:#94a3b8;">${this.t('storageNoLocalKeys')}</span>`
                : browserStorage.localStorageKeys
                    .map((item) => this.renderStoragePill(item.key, `${item.bytes} B`))
                    .join('')
            }
          </div>
          <div id="storage-inspector-indexeddb" style="margin-top:6px;color:#475569;">
            ${this.t('storageIndexedDb')}: ${browserStorage.indexedDBNames.length > 0 ? browserStorage.indexedDBNames.map(escapeHtml).join(', ') : this.t('storageNone')}
          </div>
        </div>
        <div>
          <div style="font-weight:600;color:#334155;margin-bottom:6px;">${this.t('storageServerPaths')}</div>
          ${
            serverError
              ? `<div id="storage-inspector-server-error" style="color:#b45309;">${escapeHtml(serverError)}</div>`
              : `<div id="storage-inspector-server" style="display:grid;gap:6px;">
                  ${serverRows
                    .map((row: any) => `
                      <div style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
                        <div style="font-weight:600;color:#0f172a;">${escapeHtml(row.path)} <span style="font-weight:500;color:#64748b;">${escapeHtml(row.category)}</span></div>
                        <div style="color:#64748b;">${escapeHtml(this.storagePathPurpose(row.path, row.purpose))}</div>
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
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#334155;"><span style="font-weight:600;">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></span>`;
  }

  private renderLocalNodeInspector(localNode: any): string {
    if (!localNode) return '';
    const disclosures = Array.isArray(localNode.permissionDisclosures) ? localNode.permissionDisclosures : [];
    const controls = Array.isArray(localNode.persistenceControls) ? localNode.persistenceControls : [];
    return `
      <div id="storage-inspector-local-node" style="display:grid;gap:8px;padding:10px;border:1px solid #dbeafe;border-radius:8px;background:#eff6ff;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:#1e3a8a;">${this.t('storageLocalNodeSupervisor')}</div>
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
      <div id="storage-inspector-sea-identity" style="display:grid;gap:8px;padding:10px;border:1px solid #ccfbf1;border-radius:8px;background:#f0fdfa;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:#134e4a;">${this.t('storageSeaCustody')}</div>
          ${this.renderStoragePill(this.t('storageRelayScan'), this.storageValue(scan?.ok ? 'clean' : 'needs review'))}
          ${this.renderStoragePill(this.t('storagePublicKeys'), publicKeys.join(', ') || this.t('storageUnknown'))}
          ${this.renderStoragePill(this.t('storageForbidden'), forbidden.join(', ') || this.t('storageUnknown'))}
        </div>
        <div id="storage-inspector-sea-custody" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${custodyFormats.map((format: string) => this.renderStoragePill(format, this.t('storageSupported'))).join('')}
        </div>
        <div id="storage-inspector-sea-rules" style="color:#475569;">
          ${this.t('storageRelayRule')}
        </div>
      </div>
    `;
  }

  private renderConversationTransportInspector(transport: any): string {
    if (!transport) return '';
    const modes = Array.isArray(transport.availableModes) ? transport.availableModes : [];
    return `
      <div id="storage-inspector-conversation-transport" style="display:grid;gap:8px;padding:10px;border:1px solid #fde68a;border-radius:8px;background:#fffbeb;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:#78350f;">${this.t('storageConversationTransport')}</div>
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
      <div id="storage-inspector-p2p-neighbor-memory" style="display:grid;gap:8px;padding:10px;border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:#14532d;">${this.t('storageNeighborMemory')}</div>
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
      <div id="storage-inspector-data-ownership" style="display:grid;gap:8px;padding:10px;border:1px solid #fed7aa;border-radius:8px;background:#fff7ed;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div style="font-weight:700;color:#7c2d12;">${this.t('storageDataOwnership')}</div>
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

  private async displayContextualStatistics(elementId: string): Promise<void> {
    const element = document.getElementById(elementId);
    if (!element || !this.apiBase) return;
    try {
      const qs = this.currentUserId ? `?viewerId=${encodeURIComponent(this.currentUserId)}` : '';
      const res = await fetch(`${this.apiBase}/api/stats/dashboard${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dashboard = (await res.json()) as StatsDashboard;
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
    const base = (this.apiBase || '').trim();
    if (!base) {
      container.innerHTML = '<div style="padding:20px;color:#b45309;">Connect to the server to load statistics.</div>';
      return;
    }
    container.innerHTML = '<div style="padding:20px;color:#64748b;">Loading statistics…</div>';
    try {
      const qs = this.currentUserId ? `?viewerId=${encodeURIComponent(this.currentUserId)}` : '';
      const res = await fetch(`${base}/api/stats/dashboard${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dashboard = (await res.json()) as StatsDashboard;
      this.renderStatisticsDashboard(container, dashboard);
    } catch (error) {
      container.innerHTML = `<div style="padding:20px;color:#b91c1c;">Could not load statistics: ${escapeHtml((error as Error).message)}</div>`;
    }
  }

  private renderStatisticsDashboard(container: HTMLElement, dashboard: StatsDashboard): void {
    const totals = dashboard.totals || { talks: 0, responses: 0, matches: 0, ignores: 0, matchRate: 0 };
    const typeRows = (dashboard.byTalkType || [])
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid #e2e8f0;">${escapeHtml(row.talkType)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.responses}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.matches}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.matchRate}%</td>
        </tr>`)
      .join('');
    const talkRows = (dashboard.topTalks || [])
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid #e2e8f0;max-width:220px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.talkId)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;">${escapeHtml(row.talkType)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.responses}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.matches}</td>
        </tr>`)
      .join('');
    const roomRows = (dashboard.chatrooms?.regions || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid #e2e8f0;">${row.masked ? 'Hidden region' : escapeHtml(row.region)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.masked ? '—' : row.count}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.masked ? '—' : `${row.matchRate}%`}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.masked ? '—' : `${row.localCount}/${row.travellerCount}`}</td>
        </tr>`)
      .join('');
    const peerRows = (dashboard.peers?.peers || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid #e2e8f0;max-width:180px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.peerId)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.responses}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.matches}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.matchRate}%</td>
        </tr>`)
      .join('');
    const tagRows = (dashboard.broadcastTags?.popularity || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td style="padding:8px;border-top:1px solid #e2e8f0;">${escapeHtml(row.id)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;">${row.count}</td>
        </tr>`)
      .join('');
    const latestBucket = dashboard.timeSeries?.day?.[dashboard.timeSeries.day.length - 1]?.bucket || '—';
    container.innerHTML = `
      <div style="padding:16px;max-width:min(1040px,96%);margin:0 auto;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px;">
          <div>
            <h2 style="margin:0 0 4px;font-size:1.25em;color:#0f172a;">Statistics dashboard</h2>
            <p style="margin:0;color:#64748b;font-size:0.9em;">Generated ${escapeHtml(new Date(dashboard.generatedAt).toLocaleString())}</p>
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
          ${this.renderStatsTable('By talk type', ['Type', 'Responses', 'Matches', 'Match rate'], typeRows)}
          ${this.renderStatsTable('Top talks', ['Talk', 'Type', 'Responses', 'Matches'], talkRows)}
          ${this.renderStatsTable('Chatroom and location', ['Region', 'Responses', 'Match rate', 'Local/Travel'], roomRows)}
          ${this.renderStatsTable('Peer and reputation summary', ['Peer', 'Responses', 'Matches', 'Match rate'], peerRows)}
          ${this.renderStatsTable('Broadcast tags', ['Tag', 'Uses'], tagRows)}
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
            <div style="font-weight:700;color:#0f172a;margin-bottom:8px;">Privacy and source of truth</div>
            <p style="margin:0 0 6px;color:#475569;font-size:0.88em;">Minimum cohort: ${dashboard.privacy?.minCohortSize ?? 3}; location: blurred regions only; CSV small-cohort masking: ${dashboard.privacy?.csvExportsMaskSmallCohorts ? 'on' : 'off'}.</p>
            <p style="margin:0;color:#475569;font-size:0.88em;">Events are append-only Gun mirrors with in-memory derived indices for fast reads.</p>
          </div>
        </div>
      </div>`;
    container.querySelector('#statistics-refresh-btn')?.addEventListener('click', () => {
      void this.displayStatisticsDashboard();
    });
  }

  private renderStatsTable(title: string, headers: string[], rows: string): string {
    return `
      <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:white;overflow:auto;">
        <div style="font-weight:700;color:#0f172a;margin-bottom:8px;">${escapeHtml(title)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.88em;">
          <thead><tr>${headers.map((header, index) => `<th style="text-align:${index === 0 ? 'left' : 'right'};padding:6px 8px;">${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${headers.length}" style="padding:8px;color:#64748b;">No data yet.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  private copyAnsweredTalkToTalks(talkId: string): void {
    const myTalks = getMyTalks();
    const talk = myTalks[talkId];
    if (!talk?.fullTalk) {
      this.showNotification('Talk data not found', 'error');
      return;
    }
    if (talk.role === 'copied') {
      this.showNotification('Already in your Talks list', 'info');
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
    this.showNotification('Copied to Talks tab', 'success');
    this.displayTalksList();
    this.displayAnswersList();
  }

  /** Resolve a concrete talk UUID for an incoming cluster (Gun may reshape talkIds). */
  private pickIncomingRowTalkId(cluster: any): string {
    return pickLatestTalkIdFromIncomingCluster(cluster || {});
  }

  private showTalkDetail(talkId: string, identityKeyFallback?: string): void {
    const raw = (talkId || '').trim();
    const tid = isValidTalkId(raw) ? raw : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', {
        identityKey: identityKeyFallback,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true });
          else this.showNotification('Could not load talk.', 'error');
        },
      });
      return;
    }
    if (!tid) {
      this.showNotification('Could not open talk.', 'error');
      return;
    }

    const myTalks = getMyTalks();
    const talk = myTalks[tid];

    if (talk) {
      if (talk.role === 'created') {
        // Open editor for editing
        this.emit('loadTalkForEdit', { talkId: tid });
      } else if ((talk.role === 'answered' || talk.role === 'copied') && talk.fullTalk) {
        // Open response view without auto-answering (avoid instant "Match!" toast when just viewing)
        this.showTalkResponseDialog(talk.fullTalk, { skipAutoAnswer: true });
      } else {
        this.showNotification(`Talk: ${talk.title}`, 'info');
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
              'Could not load this talk yet. Check your connection and try again.',
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
      formatMessage: this.formatConversationMessage.bind(this),
    });
  }

  private getMyConversations(): Record<string, any> {
    const conversationsJson = localStorage.getItem('myConversations');
    return conversationsJson ? JSON.parse(conversationsJson) : {};
  }

  public formatSupportWelcome(stageName: string): string {
    return this.tf('supportWelcome', { name: stageName });
  }

  private formatConversationMessage(message: string, supportChannel: boolean): string {
    if (!supportChannel) return message;
    const match = /^Welcome to IinPublic, (.+)\. TechSupport is here if you need help\.$/.exec(message);
    return match ? this.formatSupportWelcome(match[1] || '') : message;
  }

  showConversationDetail(conversationId: string): void {
    const conversations = this.getMyConversations();
    const conversation = conversations[conversationId];

    if (!conversation) {
      console.warn('showConversationDetail: conversation not found', conversationId);
      return;
    }

    const overlay = document.getElementById('conversation-detail-overlay');
    if (overlay) overlay.style.display = 'flex';

    this.currentConversationId = conversationId;

    // Update header with user name
    const userName = document.getElementById('conversation-user-name');
    if (userName) userName.textContent = conversation.otherUserName || this.t('conversationUnknown');
    const status = document.getElementById('conversation-status');
    if (status) status.textContent = this.t('online');
    const messagesContainer = document.getElementById('conversation-messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${escapeHtml(this.t('conversationStart'))}</p>`;
    }

    // Mark conversation as read
    conversation.unread = false;
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
          this.emit('sendConversationMessage', { conversationId, message });
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
            <h2 class="modal-title">Edit Stage Name</h2>
            <p>Current: ${user.stageName}</p>
          </div>
          <form id="edit-stagename-form">
            <div class="form-group">
              <label class="form-label">New Stage Name</label>
              <input type="text" class="form-input" id="new-stage-name" name="new-stage-name" 
                     data-testid="stage-name-input"
                     required minlength="3" maxlength="50"
                     placeholder="Enter your new stage name"
                     value="${user.stageName}">
              <small style="color: #666; font-size: 0.85em;">3-50 characters</small>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-edit-btn" style="background: #6c757d;">Cancel</button>
              <button type="submit" class="btn" data-testid="save-stage-name-button">Save</button>
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
            alert('Failed to update stage name. Please try again.');
            reject(error);
          }
        } else {
          alert('Stage name must be at least 3 characters long.');
        }
      });
    });
  }

  async showEditProfileDialog(user: User): Promise<void> {
    const currentProfile = Array.isArray(user.profile) ? user.profile : [];
    const currentLanguages = Array.isArray(user.languages) && user.languages.length > 0 ? user.languages : ['en'];
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
            `<option value="${v}"${v === current ? ' selected' : ''}>${escapeHtml(PROFILE_VISIBILITY_LABELS[v])}</option>`,
        )
        .join('');
    const interestCategoryOptionsHtml = INTEREST_CATEGORY_SELECT_ORDER.map(
      (cat) =>
        `<option value="${cat}"${cat === defaultInterestCategory ? ' selected' : ''}>${escapeHtml(
          INTEREST_CATEGORY_LABELS[cat],
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
                  <input type="text" class="form-input profile-question-input" value="${escapeHtml(qa.question)}" placeholder="Question">
                  <input type="text" class="form-input profile-answer-input" value="${escapeHtml(qa.answer)}" placeholder="Answer">
                  <select class="form-input profile-visibility-select" title="Who can see this row on your public profile">${visibilityOptionsHtml(normalizeProfileAttributeVisibility(qa.visibility))}</select>
                  <button type="button" class="btn remove-profile-qa-btn" style="background:#ef4444;">Remove</button>
                </div>
              `,
            )
            .join('')
        : `
          <div class="profile-qa-row" data-qa-id="" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(154px,auto) auto; gap:8px; margin-bottom:8px; align-items:start;">
            <input type="text" class="form-input profile-question-input" placeholder="Question">
            <input type="text" class="form-input profile-answer-input" placeholder="Answer">
            <select class="form-input profile-visibility-select" title="Who can see this row on your public profile">${visibilityOptionsHtml('public')}</select>
            <button type="button" class="btn remove-profile-qa-btn" style="background:#ef4444;">Remove</button>
          </div>
        `;
      const headshotChoices = ['🙂', '😎', '🤠', '🎾', '☕', '🌟', '🐱', '🦊'];
      modal.innerHTML = `
        <div class="modal-content" style="max-width:760px;">
          <div class="modal-header">
            <h2 class="modal-title">Edit Profile</h2>
            <p>Update profile basics. Q&amp;A visibility controls what others see when they load your profile (contacts are people you add in Relationships).</p>
          </div>
          <form id="edit-profile-form">
            <div class="form-group">
              <label class="form-label">Headshot</label>
              <div style="display:flex; flex-wrap:wrap; gap:8px;" id="headshot-choice-group">
                ${headshotChoices
                  .map(
                    (choice) => `
                      <label style="display:flex; align-items:center; justify-content:center; width:52px; height:52px; border:1px solid #d1d5db; border-radius:14px; cursor:pointer; font-size:1.5em; background:${choice === currentHeadshot ? '#e0f2fe' : 'white'};">
                        <input type="radio" name="profile-headshot" value="${choice}" ${choice === currentHeadshot ? 'checked' : ''} style="display:none;">
                        <span>${choice}</span>
                      </label>
                    `,
                  )
                  .join('')}
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Languages</label>
              <input type="text" class="form-input" id="profile-languages-input" value="${escapeHtml(currentLanguages.join(', '))}" placeholder="en, zh">
            </div>
            <div class="form-group">
              <label class="form-label">Interests</label>
              <input type="text" class="form-input" id="profile-interests-input" value="${escapeHtml(interestsFieldValue)}" placeholder="e.g. tennis, coffee, Hiking">
              <label class="form-label" style="margin-top:10px;">Default category for typed interests</label>
              <select class="form-input" id="profile-interest-category-default">${interestCategoryOptionsHtml}</select>
              <small style="color:#666;font-size:0.85em;">Known words (e.g. Hiking, Open to work) pick a category automatically; others use the default.</small>
            </div>
            <div class="form-group">
              <label class="form-label">Profile Attributes</label>
              <div id="profile-qa-list">${profileRowsHtml}</div>
              <button type="button" class="btn" id="add-profile-qa-btn">Add Attribute</button>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-profile-btn" style="background: #6c757d;">Cancel</button>
              <button type="submit" class="btn" id="save-profile-btn">Save Profile</button>
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
          <input type="text" class="form-input profile-question-input" placeholder="Question">
          <input type="text" class="form-input profile-answer-input" placeholder="Answer">
          <select class="form-input profile-visibility-select" title="Who can see this row on your public profile">${visibilityOptionsHtml('public')}</select>
          <button type="button" class="btn remove-profile-qa-btn" style="background:#ef4444;">Remove</button>
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
        const languagesInput = (document.getElementById('profile-languages-input') as HTMLInputElement | null)?.value || '';
        const languages = languagesInput
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean);
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
          alert('Please enter at least one language.');
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
          alert('Failed to update profile. Please try again.');
          reject(error);
        }
      });
    });
  }

  /**
   * Survey creators: show aggregated response counts from GET /api/stats/talks/:id/summary (STAT-01).
   */
  private async showSurveyStatsDialog(talkId: string): Promise<void> {
    const entry = this.getMyTalks()[talkId];
    const title = escapeHtml(String(entry?.title || 'Survey').trim() || 'Survey');
    if (!this.apiBase) {
      this.showNotification('Connect to the server to load survey results.', 'error');
      return;
    }
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
      <div class="modal-content" style="max-width:860px;">
        <div class="modal-header">
          <h2 class="modal-title">Survey analytics dashboard</h2>
          <p style="margin:0;color:#64748b;font-size:0.92em;">${title}</p>
        </div>
        <div id="survey-stats-body" style="padding:8px 0 16px;min-height:120px;">
          <p style="text-align:center;color:#64748b;">Loading…</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="survey-stats-followup-btn" style="background:#2563eb;">Create follow-up survey</button>
          <button type="button" class="btn" id="survey-stats-close-btn" style="background:#6c757d;">Close</button>
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
    try {
      const [summaryRes, byDayRes, byRegionRes] = await Promise.all([
        fetch(`${this.apiBase}/api/stats/talks/${encodeURIComponent(talkId)}/summary`, { cache: 'no-store' }),
        fetch(`${this.apiBase}/api/stats/talks/${encodeURIComponent(talkId)}/by-day?bucket=day`, { cache: 'no-store' }),
        fetch(`${this.apiBase}/api/stats/talks/${encodeURIComponent(talkId)}/by-region`, { cache: 'no-store' }),
      ]);
      if (!summaryRes.ok || !byDayRes.ok || !byRegionRes.ok) {
        const firstBad = [summaryRes, byDayRes, byRegionRes].find((r) => !r.ok) as Response;
        const errText = await firstBad.text().catch(() => firstBad.statusText);
        if (body) {
          body.innerHTML = `<p style="color:#b91c1c;">Could not load dashboard (${firstBad.status}). ${escapeHtml(errText.slice(0, 200))}</p>`;
        }
        return;
      }
      const summary = (await summaryRes.json()) as StatsSummary;
      const byDay = (await byDayRes.json()) as StatsByTime;
      const byRegion = (await byRegionRes.json()) as StatsByRegion;
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
      this.renderSurveyStatsDashboard(body, summary, byDay, byRegion, questionLabel, title);
    } catch {
      if (body) {
        body.innerHTML = '<p style="color:#b91c1c;">Network error while loading survey analytics dashboard.</p>';
      }
    }
  }

  private renderSurveyStatsDashboard(
    body: HTMLElement | null,
    summary: StatsSummary,
    byDay: StatsByTime,
    byRegion: StatsByRegion,
    questionLabel: (questionId: string) => string,
    title: string,
  ): void {
    if (!body) return;
    const anonymityMasking = summary.total < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
    const render = (maskSmallCounts: boolean): void => {
      const cards = `
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px;">
          ${this.surveyMetricCard('Responses', String(summary.total))}
          ${this.surveyMetricCard('Questions', String(summary.byQuestion?.length || 0))}
          ${this.surveyMetricCard('Regions', String(byRegion.series?.length || 0))}
          ${this.surveyMetricCard('Latest day bucket', escapeHtml(byDay.series?.[byDay.series.length - 1]?.bucket || '—'))}
        </div>`;
      const privacyLine = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9em;color:#334155;">
          <input type="checkbox" id="survey-anon-toggle" ${maskSmallCounts ? 'checked' : ''}>
          <span>Anonymize small cohorts (< ${UIManager.SURVEY_ANONYMITY_MIN_COUNT} responses)</span>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn" id="survey-export-summary-btn" style="padding:6px 10px;background:#0f766e;">Export summary CSV</button>
          <button type="button" class="btn" id="survey-export-day-btn" style="padding:6px 10px;background:#0f766e;">Export by-day CSV</button>
          <button type="button" class="btn" id="survey-export-region-btn" style="padding:6px 10px;background:#0f766e;">Export region CSV</button>
        </div>
      </div>`;

      const byQuestionParts: string[] = [];
      if (!summary.byQuestion || summary.byQuestion.length === 0) {
        byQuestionParts.push('<p style="color:#64748b;font-size:0.92em;">No per-question breakdown yet. Responses will appear here after people answer.</p>');
      } else {
        for (const q of summary.byQuestion) {
          const hideQuestion = maskSmallCounts && q.total < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
          const qTitle = escapeHtml(questionLabel(q.questionId));
          const rows = hideQuestion
            ? `<div style="margin-top:8px;padding:10px;border-radius:8px;border:1px dashed #cbd5e1;background:#f8fafc;color:#64748b;">Hidden to preserve anonymity until this question has at least ${UIManager.SURVEY_ANONYMITY_MIN_COUNT} responses.</div>`
            : q.answers
                .map(
                  (a) => `
              <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;background:#f8fafc;margin-top:6px;border:1px solid #e2e8f0;">
                <span style="min-width:0;">${escapeHtml(a.answerText || a.answerId)}</span>
                <span style="flex-shrink:0;font-weight:600;">${a.count} <span style="color:#64748b;font-weight:500;">(${a.percentage}%)</span></span>
              </div>`,
                )
                .join('');
          byQuestionParts.push(`
            <div style="margin-top:16px;">
              <div style="font-weight:700;font-size:0.95em;color:#0f172a;margin-bottom:4px;">${qTitle}</div>
              <div style="font-size:0.8em;color:#64748b;">${q.total} answer${q.total !== 1 ? 's' : ''} recorded</div>
              ${rows}
            </div>`);
        }
      }

      const dayRows = (byDay.series || [])
        .map((item) => `<tr><td style="padding:6px 8px;border-top:1px solid #e2e8f0;">${escapeHtml(item.bucket)}</td><td style="padding:6px 8px;border-top:1px solid #e2e8f0;text-align:right;">${item.count}</td></tr>`)
        .join('');
      const regionRows = (byRegion.series || [])
        .map((item) => {
          const hidden = maskSmallCounts && item.count < UIManager.SURVEY_ANONYMITY_MIN_COUNT;
          return `<tr><td style="padding:6px 8px;border-top:1px solid #e2e8f0;">${hidden ? 'Hidden region' : escapeHtml(item.region || 'unknown')}</td><td style="padding:6px 8px;border-top:1px solid #e2e8f0;text-align:right;">${hidden ? '—' : item.count}</td></tr>`;
        })
        .join('');
      const followUpCandidates = (summary.byQuestion || []).filter(
        (q) => q.total > 0 && q.total < Math.max(UIManager.SURVEY_ANONYMITY_MIN_COUNT, Math.ceil(summary.total * 0.6)),
      );
      const followUpHint =
        followUpCandidates.length === 0
          ? '<p style="margin:8px 0 0;color:#64748b;font-size:0.9em;">No immediate follow-up gaps detected.</p>'
          : `<p style="margin:8px 0 0;color:#334155;font-size:0.9em;">Follow-up candidates: ${followUpCandidates
              .map((q) => escapeHtml(questionLabel(q.questionId)))
              .join(', ')}</p>`;

      body.innerHTML = `
        ${cards}
        ${privacyLine}
        <div style="margin-top:14px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;">
          <div style="font-weight:700;color:#0f172a;">Per-question distribution</div>
          ${byQuestionParts.join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;">
            <div style="font-weight:700;color:#0f172a;">Responses by day</div>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">Bucket</th><th style="text-align:right;padding:6px 8px;">Count</th></tr></thead>
              <tbody>${dayRows || '<tr><td colspan="2" style="padding:8px;color:#64748b;">No responses yet.</td></tr>'}</tbody>
            </table>
          </div>
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;">
            <div style="font-weight:700;color:#0f172a;">Responses by region</div>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em;">
              <thead><tr><th style="text-align:left;padding:6px 8px;">Region</th><th style="text-align:right;padding:6px 8px;">Count</th></tr></thead>
              <tbody>${regionRows || '<tr><td colspan="2" style="padding:8px;color:#64748b;">No regional data yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div style="margin-top:12px;padding:12px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;">
          <div style="font-weight:700;color:#0f172a;">Follow-up handling</div>
          <p style="margin:8px 0 0;color:#64748b;font-size:0.9em;">Use "Create follow-up survey" to start a new survey from this dashboard. It pre-fills questions from your current survey and labels it as a follow-up to ${escapeHtml(title)}.</p>
          ${followUpHint}
        </div>`;

      body.querySelector('#survey-anon-toggle')?.addEventListener('change', (event) => {
        const checked = !!(event.target as HTMLInputElement | null)?.checked;
        render(checked);
      });
      body.querySelector('#survey-export-summary-btn')?.addEventListener('click', () => {
        this.downloadCsv(`survey-summary-${summary.talkId}.csv`, this.toSurveySummaryCsv(summary, questionLabel));
      });
      body.querySelector('#survey-export-day-btn')?.addEventListener('click', () => {
        this.downloadCsv(`survey-by-day-${summary.talkId}.csv`, this.toByDayCsv(byDay));
      });
      body.querySelector('#survey-export-region-btn')?.addEventListener('click', () => {
        this.downloadCsv(`survey-by-region-${summary.talkId}.csv`, this.toByRegionCsv(byRegion, maskSmallCounts));
      });
    };

    render(anonymityMasking);
  }

  private surveyMetricCard(label: string, value: string): string {
    return `<div style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
      <div style="font-size:0.78em;color:#64748b;">${escapeHtml(label)}</div>
      <div style="font-size:1.2em;font-weight:700;color:#0f172a;">${escapeHtml(value)}</div>
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
    this.showNotification(`Exported ${filename}`, 'success');
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
        text: 'What should we improve next based on this survey?',
        answers: [
          { id: 'a_0_0', text: 'Follow-up details', isTerminal: true, counter: 0 },
          { id: 'a_0_1', text: 'No follow-up needed', isTerminal: true, counter: 0 },
        ],
      });
    }
    this.showTalkEditorDialog({
      title: `Follow-up: ${String(entry?.title || summary.talkId).trim()}`,
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
   * Durable bulk-send outcome for QA/E2E. Success toasts auto-hide after ~3s while register-receivers
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
    const excludedCount = Math.max(0, candidateCount - deliveryCount);
    const hasUnavailable = knownPreviews.length !== previews.length;
    const rows = previews.map((preview) => {
      if (preview.previewUnavailable) {
        return `
          <div class="broadcast-preview-row" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid #e5e7eb;border-radius:10px;">
            <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
            <div class="broadcast-preview-reasons" style="font-size:0.82em;color:#64748b;margin-top:4px;">${this.t('broadcastPreviewUnavailable')}</div>
          </div>
        `;
      }
      const reasonText = this.formatReasonCounts(preview.rejectedByCounts);
      return `
        <div class="broadcast-preview-row" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid #e5e7eb;border-radius:10px;">
          <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
          <div style="font-size:0.88em;color:#475569;margin-top:4px;">${preview.eligibleReceivers} ${this.t('broadcastPreviewEligible')} · ${Math.max(0, preview.totalCandidates - preview.eligibleReceivers)} ${this.t('broadcastPreviewExcluded')}</div>
          ${reasonText ? `<div class="broadcast-preview-reasons" style="font-size:0.82em;color:#64748b;margin-top:4px;">${escapeHtml(reasonText)}</div>` : ''}
        </div>
      `;
    }).join('');
    modal.innerHTML = `
      <div style="width:min(620px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 18px 55px rgba(15,23,42,0.2);">
        <div style="padding:18px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:1.05em;font-weight:700;">${this.t('broadcastPreviewTitle')}</div>
          <div style="font-size:0.88em;color:#64748b;margin-top:5px;">${this.t('broadcastPreviewHelp')}</div>
          <span class="broadcast-chip" style="display:inline-flex;margin-top:10px;padding:4px 9px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:0.82em;">${previews.length} talk${previews.length === 1 ? '' : 's'} · ${deliveryCount} ${this.t('broadcastPreviewEligible')} · ${excludedCount} ${this.t('broadcastPreviewExcluded')}${hasUnavailable ? ` · ${this.t('broadcastPreviewFinalCheck')}` : ''}</span>
        </div>
        <div style="display:grid;gap:8px;padding:14px;">${rows}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid #e5e7eb;">
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
      let text = `${chatroomName} · ${memberCount} ${memberCount === 1 ? 'user' : 'users'}`;
      const localTotalMatches = this.getTotalMatches();
      const effectiveTotalMatches = localTotalMatches > 0 ? localTotalMatches : (totalMatches ?? 0);
      if (effectiveTotalMatches > 0) {
        text += ` · ${effectiveTotalMatches} match${effectiveTotalMatches !== 1 ? 'es' : ''}`;
      }
      statusBarText.textContent = text;
    }
  }

  private syncStatusBarMatchCount(): void {
    const statusBarText = document.getElementById('status-bar-text');
    if (!statusBarText) return;
    const current = statusBarText.textContent || '';
    const base = current.replace(/\s*·\s*\d+\s+match(?:es)?\s*$/i, '').trim();
    const totalMatches = this.getTotalMatches();
    statusBarText.textContent =
      totalMatches > 0 ? `${base} · ${totalMatches} match${totalMatches !== 1 ? 'es' : ''}` : base;
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

  showTalkResponseDialog(talk: any, options?: { skipAutoAnswer?: boolean }): void {
    openTalkResponseDialog({
      talk,
      ...(options?.skipAutoAnswer !== undefined ? { skipAutoAnswer: options.skipAutoAnswer } : {}),
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
    const items: FlatAnswerHistoryItem[] = completedAnswers.map((entry, index) => {
      const question = questions.find((item: any) => String(item?.id || '') === entry.questionId) || {};
      const answer = Array.isArray(question?.answers)
        ? question.answers.find((item: any) => String(item?.id || '') === entry.answerId)
        : null;
      const isTag = String(talk?.type || '').toLowerCase() === 'tag';
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
            const questionId = String(step?.questionId || '').trim() || `Q${stepIndex + 1}`;
            const answerId = String(step?.answerId || '').trim() || '?';
            return `${questionId} -> ${answerId}`;
          })
        : [];
      return {
        questionId: entry.questionId,
        answerId: entry.answerId,
        prompt,
        choice,
        kind: isTag ? 'tag' : 'question',
        contextPath,
        ...(entry.mode ? { mode: entry.mode } : {}),
        ...(String(question?.contextHashId || '').trim() ? { contextHash: String(question.contextHashId).trim() } : {}),
      };
    });
    upsertFlatAnswerHistory({
      id: `${UIManager.getTalkContentKey(talk)}:${talkId}`,
      talkId,
      title: String(talk?.title || 'Answered Talk'),
      type: String(talk?.type || 'flow'),
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
    if (currentQuestion.text && currentOptions.length > 0) {
      const exact = findAutoAnswer(
        exactMemory,
        LOCAL_EXACT_CHATBOT_USER_ID,
        currentQuestion.text,
        currentOptions,
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
    if (currentQuestion.text) {
      if (mode === 'suppressed') {
        saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text);
      } else if (mode === 'permanent') {
        savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText);
      } else if (mode === 'auto') {
        saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText);
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
      mode: mode === 'permanent' ? 'auto' : mode === 'suppressed' ? 'manual' : mode,
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
        } else {
          const prefs = getAnswerPreferences();
          if (!prefs[key]) return;
          prefs[key].answerId = answerId;
          prefs[key].answerText = answerText;
          prefs[key].timestamp = new Date().toISOString();
          setAnswerPreferences(prefs);
        }
        this.showNotification(this.t('preferencesAnswerUpdated'), 'success');
      },
      updateMode: (key, isAuto) => {
        const prefs: AnswerPreferenceMap = key.startsWith('flat_')
          ? getFlattenedAnswerPreferences()
          : getAnswerPreferences();
        if (!prefs[key]) return;
        prefs[key].mode = isAuto ? 'auto' : 'manual';
        prefs[key].timestamp = new Date().toISOString();
        if (key.startsWith('flat_')) {
          setFlattenedAnswerPreferences(prefs);
        } else {
          setAnswerPreferences(prefs);
        }
        this.showNotification(this.t(isAuto ? 'preferencesModeChangedAuto' : 'preferencesModeChangedManual'), 'success');
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

  private deleteAnswerPreference(key: string): void {
    if (key.startsWith('flat_')) {
      const flat = getFlattenedAnswerPreferences();
      delete flat[key];
      setFlattenedAnswerPreferences(flat);
      return;
    }
    const preferences = getAnswerPreferences();
    delete preferences[key];
    setAnswerPreferences(preferences);
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

  /** Talks that can be included in broadcast: created or copied, not disabled, and not expired */
  getBroadcastableTalkIds(): string[] {
    const myTalks = getMyTalks();
    const now = Date.now();
    return Object.entries(myTalks)
      .filter(([, t]: [string, any]) => {
        if (t?.disabled) return false;
        if (t?.role !== 'created' && t?.role !== 'copied') return false;
        if (t?.expiresAt != null && typeof t.expiresAt === 'number' && now > t.expiresAt) return false;
        return true;
      })
      .map(([id]) => id);
  }

  /**
   * Full talk from OUT/myTalks when Gun `getTalk` is slow — bulk broadcast must still POST register-receivers.
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
    this.showNotification('Talk removed from list', 'success');
  }

  showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    const isMatchNotification =
      message.startsWith('Match!') ||
      message === this.t('responseMatch') ||
      message === this.t('responseMatchAuto');
    if (isMatchNotification) {
      notification.dataset.matchNotification = 'true';
    }
    // All toasts: tap to dismiss (E2E and users need to clear overlays blocking the header).
    notification.style.cursor = 'pointer';
    notification.addEventListener('click', () => {
      if (document.body.contains(notification)) document.body.removeChild(notification);
    });

    document.body.appendChild(notification);

    if (!isMatchNotification) {
      const hideAfter = message.includes('You have no talks to broadcast') ? 10000 : 3000;
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, hideAfter);
    }
  }

  private dismissMatchNotifications(): void {
    document.querySelectorAll('.notification[data-match-notification="true"]').forEach((el) => {
      if (document.body.contains(el)) document.body.removeChild(el);
    });
  }

  showTalkCompletion(_conversationId: string, outcome: string): void {
    this.showNotification(`Talk completed with outcome: ${outcome}`, 'success');
  }

  showLinearCaptureInterface(_conversationId: string, _capture: any): void {
    this.showNotification('Auto-talk captured! You can reuse this later.', 'info');
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
        ${!message.isOwnMessage ? `<div style="font-weight: bold; font-size: 0.85em; margin-bottom: 4px; color: #667eea;">${escapeHtml(message.senderName)}</div>` : ''}
        <div>${escapeHtml(message.text)}</div>
        <div class="message-time">${messageTime}</div>
      </div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showTalkEditorDialog(existingTalk?: any): void {
    const defaultLanguage = String(existingTalk?.language || this.getUiLanguage()).toLowerCase();
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
        this.showTalkValidationError(['Tag keyword is required']);
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
              <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:#667eea; color:white; padding:2px 6px;">${this.t('editorRouteAddChild')}</button>
              <button type="button" class="btn route-remove-answer-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:#f44336; color:white; padding:2px 6px;">×</button>
            </div>
            ${childIds.map((c) => renderNode(c, depth + 1)).join('')}
          `;
        })
        .join('');
      return `
        <div class="route-node" data-qid="${q.id}" style="border:1px solid #ddd; border-radius:6px; padding:8px; margin:6px 0; ${indent} background:#fafafa;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:#667eea;">${this.t('editorRouteQuestionPrefix')}</strong>
            <input type="text" class="form-input route-question-text" value="${escapeHtml(q.text)}" placeholder="${this.t('editorRouteQuestionPlaceholder')}" data-qid="${q.id}" style="flex:1;">
            <button type="button" class="btn route-add-answer-btn" data-qid="${q.id}" style="font-size:0.8em; background:#4CAF50; color:white; padding:2px 6px;">${this.t('editorAddAnswer')}</button>
            ${q.parentAnswer ? `<button type="button" class="btn route-remove-question-btn" data-qid="${q.id}" style="font-size:0.8em; background:#f44336; color:white; padding:2px 6px;">${this.t('editorRouteRemoveQuestion')}</button>` : ''}
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
      errBox.innerHTML = '<strong>Cannot save — please fix:</strong><ul style="margin:6px 0 0 16px; padding:0;">' +
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
      banner.innerHTML = '<strong>Auto-fixed:</strong><ul style="margin:6px 0 0 16px; padding:0;">' +
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
      status.textContent = `👥 ${members} member${members !== 1 ? 's' : ''} total · 🚪 ${counts.visitCount} visits · ◎ ${counts.uniqueVisitorCount} unique`;
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

  setMemberMatched(userId: string): void {
    this.matchedUserIds.add(userId);
    const list = document.getElementById('chatroom-members-list');
    const item = list?.querySelector(`.chatroom-member-item[data-user-id="${userId}"]`);
    if (item) {
      item.classList.add('member-matched');
      (item as HTMLElement).dataset.matched = 'true';
      const status = item.querySelector('.chatroom-member-status');
      if (status) status.textContent = 'Matched';
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

  private openPeerDetailForUser(userId: string, stageName: string): void {
    const knownPerson = this.getKnownPerson(userId);
    const deps = {
      currentUserId: this.currentUserId,
      apiBase: this.apiBase,
      getMyConversations: this.getMyConversations.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      showConversationDetail: this.showConversationDetail.bind(this),
      registerTalkForPeer: this.registerTalkForPeer.bind(this),
      isBlockedByMe: this.isBlockedByMe.bind(this),
      setBlocked: this.setBlocked.bind(this),
      text: this.t.bind(this),
      formatRelativeTime: this.formatTalkRelativeTime.bind(this),
      formatType: this.formatTalkType.bind(this),
      formatLanguage: this.formatTalkLanguage.bind(this),
      sendDirectMessage: (peerId: string, peerName: string, text: string) => {
        return new Promise<void>((resolve, reject) => {
          this.emit('sendDirectMessage', { peerId, peerName, text, resolve, reject });
        });
      },
      ...(knownPerson ? { knownPerson } : {}),
    };
    openPeerDetailView(userId, stageName, deps);
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
    this.currentUser.blockedUserIds = blocked
      ? Array.from(new Set([...(this.currentUser.blockedUserIds || []), userId]))
      : (this.currentUser.blockedUserIds || []).filter((candidate) => candidate !== userId);
    this.emit('setUserBlocked', { userId, blocked });
    this.displayContactsList();
  }

  private getPeerName(userId: string, fallbackName?: string): string {
    const conversationMatch = Object.values(this.getMyConversations()).find(
      (conversation: any) => conversation.otherUserId === userId && conversation.otherUserName,
    ) as { otherUserName?: string } | undefined;
    const currentMember = this.currentChatroomMembers.find((member) => member.userId === userId);
    const incomingSenderName = this.incomingTalkClusters
      .flatMap((cluster: any) => Object.values(cluster?.senders || {}) as Array<{ senderId?: string; senderName?: string }>)
      .find((sender) => sender?.senderId === userId && sender?.senderName)?.senderName;
    const cachedName = this.getPeerNameCache()[userId];
    const resolved = conversationMatch?.otherUserName || currentMember?.stageName || incomingSenderName || cachedName || fallbackName || 'Unknown';
    if (resolved && resolved !== 'Unknown') this.rememberPeerName(userId, resolved);
    return resolved;
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
  }

  private async registerTalkForPeer(talkId: string, talkData: any, peerId: string, peerName: string): Promise<void> {
    if (!this.apiBase || !this.currentUserId) return;
    const res = await fetch(`${this.apiBase}/api/talks/${encodeURIComponent(talkId)}/received`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiverId: peerId,
        receiverName: peerName,
        senderId: this.currentUserId,
        senderName: this.currentUserStageName,
        talkData,
      }),
    });
    if (!res.ok) throw new Error(`register talk for peer failed: HTTP ${res.status}`);
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

  displayConversationMessages(conversationId: string, messages: any[]): void {
    if (this.currentConversationId !== conversationId) return;

    const messagesContainer = document.getElementById('conversation-messages');
    if (!messagesContainer) return;

    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #999;">
          <p>${escapeHtml(this.t('conversationMatchedStart'))}</p>
        </div>
      `;
      return;
    }

    const isSupportChannel = this.getMyConversations()[conversationId]?.supportChannel === true;
    messagesContainer.innerHTML = messages
      .map((msg) => {
        const isOwn = msg.isOwnMessage;
        return `
          <div class="message ${isOwn ? 'message-own' : 'message-other'}">
            <div class="message-content">
              <div class="message-text">${escapeHtml(this.formatConversationMessage(String(msg.text || ''), isSupportChannel))}</div>
              <div class="message-time">${this.formatTalkRelativeTime(new Date(msg.timestamp))}</div>
            </div>
          </div>
        `;
      })
      .join('');

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  addNewConversation(conversationData: {
    conversationId: string;
    otherUserId: string;
    otherUserName: string;
    talkId?: string;
    respondedByBot?: boolean;
    supportChannel?: boolean;
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

    conversations[conversationData.conversationId] = {
      otherUserId: conversationData.otherUserId,
      otherUserName: resolvedOtherUserName,
      ...(isSupportChannel ? {} : { talkId: conversationData.talkId }),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastMessage: existing?.lastMessage ?? null,
      lastMessageTime: existing?.lastMessageTime ?? null,
      unread: isSupportChannel ? false : (isNew ? true : (existing?.unread ?? false)),
      respondedByBot,
      supportChannel: isSupportChannel,
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
      if (conversationData.supportChannel) {
        this.showNotification(this.tf('supportChannelReady', { name }), 'info');
      } else {
        this.showNotification(this.tf('matchChatReady', { name }), 'success');
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
}
