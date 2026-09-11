import {
  User,
  type GPSCoordinate,
  type KnownPerson,
  type TalkIntakeFilters,
  type QuestionAnswer,
  type Tag,
} from '../../shared/types';
import { EventEmitter } from 'events';
import { formatTimeAgo, formatExpiration, escapeHtml, tagAnswerSuffix } from './ui-formatters';
import { pickLatestTalkIdFromIncomingCluster, isValidTalkId } from '../../shared/incoming-talk-ids';
import { computeTalkIdFromTalkData } from '../../shared/cid';
import { completeTalk as completeTalkImpl, saveMyTalk as saveMyTalkImpl } from './talk-completion';
import { renderAppDownloadBanner as renderAppDownloadBannerImpl } from './app-download-banner';
import { openAnswerPreferencesDialog } from './answer-preference-mutations';
import {
  displayContextualStatistics as displayContextualStatisticsImpl,
  type LocalStatisticsDeps,
} from './local-statistics';
import { hydrateAttachmentImages as hydrateAttachmentImagesImpl } from './attachment-hydration';
import { openEraseDeviceDialog as openEraseDeviceDialogImpl } from './erase-device-flow';
import { registerTalkForPeer } from './talk-peer-registration';
import {
  resolveExpiresAtMs,
  type BroadcastAudiencePreview,
  getSenderOmittedBroadcastPreviews as getSenderOmittedBroadcastPreviewsImpl,
} from './broadcast-audience-preview';
import { refreshFlowAnswerConstraints as refreshFlowAnswerConstraintsImpl } from './flow-answer-constraints';
import { renderSettingsSection as renderSettingsSectionImpl } from './settings-section-template';
import { showContentFilterToast as showContentFilterToastImpl } from './content-filter-toast';
import { applySettingsSectionView as applySettingsSectionViewImpl } from './settings-section-view';
import {
  attachmentDownloadFilename as attachmentDownloadFilenameImpl,
  attachmentIconForMime as attachmentIconForMimeImpl,
  formatAttachmentSize as formatAttachmentSizeImpl,
  renderMediaTile as renderMediaTileImpl,
} from './attachment-metadata';
import { type QAPair } from '../../shared/flattened-answer-keys';
import { normalizeProfileAttributeVisibility } from '../../shared/profile-privacy';
import { FlowCapture, encodeCapturedQuestionMessage, decodeCapturedQuestionMessage } from '../../shared/talk-engine';
import { listContactGroups, resolveContactGroupUserIds, type ContactGroupOption } from '../../shared/contact-groups';
import { SORT_STRATEGIES } from '../../shared/find-similar';
import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { LocationPrivacy } from '../../shared/location';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import type { SupportInboxEntry, SupportFaqEntry } from '../../shared/techsupport-faq';
import { renderSupportInboxSection } from './support-inbox-view';
import { filterVerifiedSupportMessages } from './verified-support-messages';
import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import { renderSupportDelegatesSection } from './support-delegates-view';
import { renderSupportDelegateOptInSection } from './support-delegate-optin-view';
import type { GraphNodeTarget } from './graph-navigation';
import { displayAnswersList as renderAnswersList, applyMeAnswerFilter } from './answers-view';
import {
  type CustomChatroomRow,
  renderChatroomList as renderChatrooms,
  resolveChatroomTitle,
  showChatroomDetail as openChatroomDetail,
  syncStatusBroadcastButtonVisibility as syncChatroomBroadcastVisibility,
  updateChatroomMembers as renderChatroomMembers,
} from './chatrooms-view';
import {
  showCreateCustomChatroomDialog as openCreateCustomChatroomDialog,
  showRenameCustomChatroomDialog as openRenameCustomChatroomDialog,
  type CustomChatroomDraft,
} from './custom-chatroom-dialogs';
import {
  displayContactsList as renderContactsList,
  openRelationshipDialog,
  renderContactContextSummaryInto,
  saveKnownPerson as saveKnownPersonImpl,
  setBlocked as setBlockedImpl,
  showContactsList as openContactsList,
  type ContactsViewDeps,
} from './contacts-view';
import { displayConversationsList as renderConversationsList } from './conversations-view';
import { applyConnectivityPreset, connectivityDiagnosticsText, loadConnectivitySettings, saveConnectivitySettings, type ConnectivityDiagnostics, type ConnectivityPreset } from './connectivity-settings';
import {
  getAnswerPreferences,
  getAnsweredTalkByContent,
  getExactChatbotMemory,
  saveQuestionAnswersFromCompletion as saveQuestionAnswersFromCompletionStorage,
  setAnsweredTalkByContent,
} from './answer-preferences-storage';
import {
  getSelfTagForQuestionText,
  LOCAL_EXACT_CHATBOT_USER_ID,
} from '../../shared/exact-chatbot-memory';
import {
  clearMyTalks,
  deleteMyTalkEntry,
  getMyTalks,
  type MyTalkEntry,
} from './my-talks-storage';
import {
  getFlatAnswerHistory,
  getTalkContentKey,
  saveFlatAnswerHistoryRecord,
} from './answer-history-storage';
import {
  COLOR_SCHEMES,
  getChatbotEnabled,
  getChatbotTemplate as loadChatbotTemplate,
  getColorSchemePreference,
  getCopyTalkAutoSave,
  getDefaultTalkLanguagePreference,
  getHasSeenWalkthrough,
  getKeepOldTalkOnEdit,
  getLocationAutoMatchConsent,
  getUiLanguagePreference,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setColorSchemePreference,
  setCopyTalkAutoSave,
  setDefaultTalkLanguagePreference,
  setHasSeenWalkthrough,
  setKeepOldTalkOnEdit,
  setLocationAutoMatchConsent,
  setUiLanguagePreference,
  type ColorScheme,
} from './ui-settings-storage';
import { showWalkthroughDialog } from './onboarding-walkthrough';
import { showMyTalksDialog as openMyTalksDialog } from './my-talks-dialog';
import { showTalkResponseDialog as openTalkResponseDialog } from './talk-response-dialog';
import {
  addAnswerToQuestion as addTalkEditorAnswerToQuestion,
  addQuestionToForm as addTalkEditorQuestionToForm,
  appendIgnoreRow as appendTalkEditorIgnoreRow,
  applyBuiltInKindToQuestion,
  applyTagKindVisibilityToQuestion,
  collectFlowSurveyEditorQuestions,
  setupTalkFormHandlers as setupTalkEditorFormHandlers,
  syncAdultLockFromBuiltInKinds,
  updateAllAnswerDropdowns as updateTalkEditorAnswerDropdowns,
} from './talk-editor-form-helpers';
import { showTalkEditorDialog as openTalkEditorDialog } from './talk-editor-dialog';
import { showTalkTemplatePicker as renderTalkTemplatePicker } from './talk-template-picker';
import {
  showChooseWhoToDmPicker as renderChooseWhoToDmPicker,
  showDmInboxPicker as renderDmInboxPicker,
} from './person-picker-dialogs';
import { confirmBroadcastAudience as renderConfirmBroadcastAudience } from './broadcast-audience-dialog';
import { showNotification as renderNotificationToast, type NotificationOptions } from './notification-toast';
import { getPeerNameCache, rememberPeerName } from './peer-name-cache';
import {
  renderCapturedQuestionMessage as renderCapturedQuestionMessageCard,
  renderIpfsAttachmentMessage as renderIpfsAttachmentMessageCard,
} from './conversation-message-cards';
import { syncAppBarOverflow, setupAppBarChrome } from './app-bar-overflow';
import { showSystemAnnouncement as renderSystemAnnouncement } from './system-announcement-banner';
import { showDetailsPopupFor as renderItemDetailsPopup } from './item-details-popup';
import { saveObjectUrlAs as saveFileFromObjectUrl } from './browser-file-save';
import { setTalkDisabled as setTalkDisabledImpl } from './talk-broadcast-toggle';
import {
  saveCreatedTalk as saveCreatedTalkImpl,
  copyAnsweredTalkToTalks as copyAnsweredTalkToTalksImpl,
} from './talk-creation-storage';
import { deliveryReasonLabel, formatReasonCounts } from './delivery-reason-labels';
import {
  updateConversationTransportMode as updateConversationTransportModeImpl,
  setConversationOnlineStatus as setConversationOnlineStatusImpl,
} from './conversation-status-updates';
import { updateStatusBar as updateStatusBarImpl, syncStatusBarMatchCount as syncStatusBarMatchCountImpl } from './status-bar';
import {
  markConversationWithdrawn as markConversationWithdrawnImpl,
  markConversationEnded as markConversationEndedImpl,
  markOtherDealConversationsEnded as markOtherDealConversationsEndedImpl,
  type ConversationRecordUpdateDeps,
} from './conversation-record-updates';
import {
  quickIgnoreIncomingTalk as quickIgnoreIncomingTalkImpl,
  quickCopyIncomingTalk as quickCopyIncomingTalkImpl,
} from './quick-incoming-talk-actions';
import { displayIncomingTalk as displayIncomingTalkImpl } from './incoming-talk-notification';
import {
  buildRouteSelfAnswers as buildRouteEditorSelfAnswers,
  collectRouteEditorQuestions as collectRouteQuestions,
  initializeRouteEditorQuestions,
  type RouteEditorQuestion,
} from './route-editor-model';
import { renderRouteEditor as renderRouteEditorController } from './route-editor-controller';
import { processTalkForm as processTalkFormImpl } from './talk-form-processor';
import { fetchDownloadManifest, renderDownloadAppSectionBody, type AppDownloadTextDeps } from './app-download';
import { showSurveyStatisticsDialog } from './survey-statistics-dialog';
import { showEditProfileDialog as openEditProfileDialog } from './edit-profile-dialog';
import { refreshStorageInspector as renderStorageInspector } from './storage-inspector';
import {
  resolveAnswerPreferenceForTalkQuestion as resolveStoredAnswerPreference,
  saveAnswerPreference as persistAnswerPreference,
  tryBuildChatbotAnswersFromFlattened as buildChatbotAnswersFromPreferences,
} from './answer-preference-resolution';
import { applyAppShellTranslations, renderAppShell } from './app-shell';
import { openPeerDetailView, refreshPeerThreadList, closePeerDetailView } from './user-detail-view';
import { avatarInnerHtml } from './profile-avatar';
import { renderListProgressively } from './render-list-progressively';
import { languageOptionLabel, uiLanguageFromProfile, uiText, type UiTranslationKey } from './ui-translations';
import {
  deriveLocalCreatorReplies,
  readLocalTalkExchanges,
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
import { bindDirtyWordEditor } from './dirty-word-editor';
import { renderChatroomMessage } from './chatroom-message-view';
import { renderMatchBadge } from './notification-badges';
import { confirmCapturedQuestionDialog as confirmCapturedQuestionDialogView } from './captured-question-dialog';
import { filterOutgoingMessage, filterIncomingMessage, type MessageFilterResult } from '../../shared/message-content-filter';
import { CONFIG } from '../../shared/config';
import { openLinkedDevicesDialog as openLinkedDevicesDialogImpl } from './linked-devices-dialog';
import {
  renderCreatorReplies as renderCreatorRepliesImpl,
  CREATOR_REPLY_PAGE_SIZE,
  persistCreatorReplyFilterState,
  readCreatorReplyFilterState,
  restoreCreatorReplyFilterState,
  type CreatorReplyRow,
} from './creator-replies-view';
import { bindTalksRowGestures as bindTalksRowGesturesImpl } from './talks-row-gestures';
import { showIdentityUnlockDialog as openIdentityUnlockDialog } from './identity-password-dialog';
import { type PairingPayload } from '../../shared/identity-linking';
import { getTalkLedgerDoc, shouldSuppressForPeer } from '../services/web-talk-ledger-store';
import { buildTagIdentityKeys } from '../../shared/talk-ledger';

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

const TALKS_TAB_STATE_KEY = 'iinpublic_talks_tab_state';
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
/** TODO §R2: first-chunk size for the Talks tab's OUT/IN lists, same precedent as above. */
const TALKS_FIRST_CHUNK_SIZE = 25;

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
  /**
   * Which chatroom's detail panel the user last drilled into (Tree row, Map marker, or any other
   * path — all of them funnel through chatrooms-view.ts's showChatroomDetail, whose
   * onChatroomDetailOpened callback, wired in chatroomsDeps(), is what actually sets this), if
   * any — restored when they leave the Chatrooms tab and come back, instead of always resetting
   * to the list (see setupBottomNavigation's chatrooms case). Cleared in showChatroomList (every
   * real "go back to the list" path — the back button and this same tab-switch handler when
   * there's nothing to restore — already calls showChatroomList()).
   */
  private chatroomsDetailRoomId: string | null = null;
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];
  /** docs/TODO.md K5 — the TechSupport-root session's own pending-question inbox, fed by app.ts's live `techsupport-inbox/*` subscription (never read directly from Gun here). */
  private currentSupportInboxEntries: SupportInboxEntry[] = [];
  /** docs/TODO.md K7 — master-only Delegates panel state, fed by app.ts. */
  private currentTechSupportDelegates: TechSupportDelegateGrant[] = [];
  private currentDelegateActivity: SupportFaqEntry[] = [];
  /** docs/TODO.md K7 — an ordinary user's own delegate eligibility/opt-in state, fed by app.ts. */
  private techSupportDelegateEligible = false;
  private techSupportDelegateLabel = '';
  private techSupportDelegateOptedIn = false;
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
  private currentUserIdValue: string = '';
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
  private chatroomBrowseMode: 'tree' | 'map' = 'tree';
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
    return deliveryReasonLabel(reason, this.t.bind(this));
  }

  private formatReasonCounts(counts: Record<string, number>): string {
    return formatReasonCounts(counts, this.t.bind(this));
  }

  private applyShellTranslations(): void {
    applyAppShellTranslations(document, {
      text: (key) => this.t(key),
      languageOptions: LANGUAGE_OPTIONS,
      languageLabel: (code, fallback) =>
        languageOptionLabel(this.getUiLanguage(), code, fallback),
    });
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
    return resolveChatroomTitle(chatroomId, this.customChatrooms);
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

    renderAppShell(this.appContainer, {
      text: (key) => this.t(key),
      languageOptions: LANGUAGE_OPTIONS,
    });

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
    setupAppBarChrome({
      t: this.t.bind(this),
      showBroadcastToGroupDialog: () => this.showBroadcastToGroupDialog(),
    });
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
   * lowest priority first (the active Tree/Map controls stay inline longest).
   */
  private syncAppBarOverflow(): void {
    syncAppBarOverflow();
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
      checkbox.addEventListener('change', () => applyMeAnswerFilter(this.t.bind(this)));
    });
    document.querySelectorAll('.me-tag-state-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', () => applyMeAnswerFilter(this.t.bind(this)));
    });
    ['me-outcome-filter', 'me-answer-sort', 'me-answer-date-from', 'me-answer-date-to'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => applyMeAnswerFilter(this.t.bind(this)));
    });
    document.getElementById('me-answer-filter')?.addEventListener('input', () => applyMeAnswerFilter(this.t.bind(this)));
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
      applyMeAnswerFilter(this.t.bind(this));
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
    restoreCreatorReplyFilterState();
    ['reply-filter-query', 'reply-filter-outcome', 'reply-filter-relationship', 'reply-filter-type', 'reply-filter-language', 'reply-filter-from', 'reply-filter-to', 'reply-sort-order', 'reply-group-order'].forEach((id) => {
      document.getElementById(id)?.addEventListener(id === 'reply-filter-query' ? 'input' : 'change', () => {
        this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
        persistCreatorReplyFilterState();
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
      persistCreatorReplyFilterState();
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

        // Special handling for chatrooms view: restore whichever room's detail panel the user
        // was last looking at instead of always resetting to the room list (§ save-the-spot).
        if (targetView === 'chatrooms') {
          if (this.chatroomsDetailRoomId) {
            this.showChatroomDetail(this.chatroomsDetailRoomId);
          } else {
            this.showChatroomList();
          }
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

        // Re-render, but keep whichever settings section the user was last looking at
        // (settingsActiveSectionId) instead of resetting to the top-level menu — renderSettingsView
        // already restores it correctly via its own trailing applySettingsSectionView call, the
        // same mechanism a language change relies on to survive a full re-render.
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

  private get currentUserId(): string {
    return this.currentUserIdValue;
  }

  // Every setter (showMainInterface, adoptSessionUser, updateChatroomMembers) retries a
  // Contacts tab stuck on displayContactsList's `!currentUserId` guard, not just whichever
  // one happens to resolve the id first — a per-caller `hadUserId` flag let other setters
  // leave that error permanent.
  private set currentUserId(value: string) {
    const hadUserId = !!this.currentUserIdValue;
    this.currentUserIdValue = value;
    if (!hadUserId && value && document.getElementById('contacts-view')?.classList.contains('active')) {
      this.displayContactsList();
    }
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
    // The Settings tab can be clicked before this identity was known (cold launch, before the
    // rest of the boot chain reaches showMainInterface) — setupBottomNavigation's
    // `targetView === 'settings'` handler no-ops in that case, leaving the panel blank. Paint it
    // now that the user is available instead of leaving the tab waiting on the full boot chain.
    if (document.getElementById('settings-view')?.classList.contains('active')) {
      this.renderSettingsView(user);
    }
  }

  showMainInterface(user: User): void {
    user.languages = normalizeStringList(user.languages, ['en']).map((lang) => lang.toLowerCase());
    user.talkFilters = normalizeTalkFilterShape(user.talkFilters, user.languages);
    this.currentUser = user;
    this.currentUserId = user.id;
    this.applyShellTranslations();
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
    this.chatroomsDetailRoomId = null;
    // Hide chatroom detail view, show chatroom list
    const listContainer = document.getElementById('chatroom-list-container');
    const detailContainer = document.getElementById('chatroom-detail-container');

    if (listContainer) listContainer.style.display = 'flex';
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
    renderChooseWhoToDmPicker(people, {
      t: this.t.bind(this),
      navigateToPerson: (person) => this.navigateToGraphNode(person),
    });
  }

  private showDmInboxPicker(): void {
    renderDmInboxPicker({
      t: this.t.bind(this),
      navigateToPerson: (person) => this.navigateToGraphNode(person),
      getMyConversations: () => this.getMyConversations(),
      getPeerName: (userId, fallbackName) => this.getPeerName(userId, fallbackName),
    });
  }

  /**
   * TODO §M2/§M3: relocates (not clones) a row's hidden `.talk-item-details`/`.answer-item-details`
   * into a shared popup, so already-wired interactive content inside it (matched-names click-to-DM,
   * §N3/item 6) keeps its real event listeners intact — DOM nodes carry their listeners with them
   * across a reparent. Moves it back to its original row on close, restoring display:none.
   */
  private showDetailsPopupFor(detailsEl: HTMLElement, originalParent: HTMLElement): void {
    renderItemDetailsPopup(detailsEl, originalParent, this.t.bind(this));
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
      chatroomBrowseMode: this.chatroomBrowseMode,
      expandedChatrooms: this.expandedChatrooms,
      matchedUserIds: this.matchedUserIds,
      customChatrooms: this.customChatrooms,
      setChatroomBrowseMode: (mode) => { this.chatroomBrowseMode = mode; },
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
      onChatroomDetailOpened: (chatroomId) => { this.chatroomsDetailRoomId = chatroomId; },
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

  showCreateCustomChatroomDialog(): Promise<CustomChatroomDraft | null> {
    return openCreateCustomChatroomDialog({
      text: (key) => this.t(key),
      showWarning: (message) => this.showNotification(message, 'warning'),
    });
  }
  showRenameCustomChatroomDialog(currentName: string): Promise<string | null> {
    return openRenameCustomChatroomDialog({
      currentName,
      text: (key) => this.t(key),
      formatText: (key, values) => this.tf(key, values),
      showWarning: (message) => this.showNotification(message, 'warning'),
    });
  }
  private renderChatroomList(): void {
    renderChatrooms(this.chatroomsDeps());
  }

  showChatroomDetail(chatroomId: string): void {
    // openChatroomDetail's onChatroomDetailOpened callback (chatroomsDeps()) is what actually
    // sets chatroomsDetailRoomId — the same single call path the Tree row click and Map marker
    // click also go through, so every way of opening a room's detail panel is tracked uniformly.
    openChatroomDetail(this.chatroomsDeps(), chatroomId);
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
        if (latestTalk && answeredByContent[getTalkContentKey(latestTalk)]) return false;
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
          <span class="talk-tag-text">${escapeHtml(talk.title)}${tagAnswerSuffix(talk)}</span>
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
            <div class="talk-item-title">${escapeHtml(talk.title)}${tagAnswerSuffix(talk)}</div>
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
    renderCreatorRepliesImpl({
      getRows: () => this.creatorReplyRows,
      readFilterState: () => readCreatorReplyFilterState(),
      getScopedTalkId: () => this.creatorReplyScopedTalkId,
      getScopedTalkTitle: () => this.creatorReplyScopedTalkTitle,
      clearScope: () => {
        this.creatorReplyScopedTalkId = null;
        this.creatorReplyScopedTalkTitle = '';
      },
      getVisibleCount: () => this.creatorReplyVisibleCount,
      growVisibleCount: () => { this.creatorReplyVisibleCount += CREATOR_REPLY_PAGE_SIZE; },
      getMyConversations: () => this.getMyConversations(),
      getKnownPerson: (userId) => this.getKnownPerson(userId),
      getUiLanguage: () => this.getUiLanguage(),
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
      formatTalkLanguage: (code) => this.formatTalkLanguage(code),
      showConversationDetail: (conversationId) => this.showConversationDetail(conversationId),
      navigateToGraphNode: (target) => this.navigateToGraphNode(target),
    });
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
      getTalkContentKey,
      text: this.t.bind(this),
      formatDate: this.formatUiDate.bind(this),
      formatType: this.formatTalkType.bind(this),
      formatLanguage: this.formatTalkLanguage.bind(this),
      // TODO §R3: fires after both the first chunk and the deferred remainder, so a
      // filter applied before the remainder lands still reaches the rows that arrive
      // after it — a single call right after renderAnswersList returns (the old
      // behavior) would miss those.
      onRowsRendered: () => applyMeAnswerFilter(this.t.bind(this)),
    });
    document.getElementById('answers-search-input')?.addEventListener('input', () => applyMeAnswerFilter(this.t.bind(this)));
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
    return renderSettingsSectionImpl(opts, bodyHtml);
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
    // adoptSessionUser can now trigger this render as soon as this device's local Gun read
    // for the user record resolves (see app.ts's initializeUser) — before the rest of boot has
    // had a chance to let Gun finish syncing every field in, that local read can momentarily
    // come back missing stageName. Must not assume it's always a non-empty string here.
    const stageNameSafe = user.stageName || '';
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
      { icon: '📱', label: this.t('settingsDownloadApp'), target: 'settings-section-download-app' },
      { icon: '🔐', label: this.t('settingsIdentityDevices'), target: 'settings-section-linked-devices' },
      { icon: '🗑️', label: this.t('settingsEraseDevice'), target: 'settings-section-erase-device' },
      { icon: '💾', label: this.t('settingsStorage'), target: 'settings-storage-inspector' },
      { icon: '❓', label: this.t('settingsHelp'), target: 'settings-section-help' },
    ];
    const jumpMenuHtml = `
      <div data-testid="settings-product-promise" style="padding:2px 4px;font-size:0.92em;font-weight:650;color:var(--text-secondary);">
        ${this.t('settingsOwnershipPromise')}
      </div>
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
                <input type="text" class="form-input" id="settings-stage-name-input" data-testid="settings-stage-name-input" value="${escapeHtml(stageNameSafe)}" minlength="3">
              </label>
              <div id="settings-stage-name-error" role="alert" style="display:none;font-size:0.82em;color:var(--danger-hover);margin-top:5px;"></div>
              ${interestNames.length > 0 ? `<div style="font-size:0.86em;color:var(--text-tertiary);">${this.t('interestsLabel')}: ${escapeHtml(interestNames.join(', '))}</div>` : ''}
            </div>
            <div style="display:grid;gap:8px;font-size:0.9em;">
              <span>${this.t('settingsHeadshot')}</span>
              <div class="user-avatar" style="width:72px;height:72px;font-size:1.7em;">
                ${avatarInnerHtml(headshot, stageNameSafe.charAt(0).toUpperCase() || '?', escapeHtml)}
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
          <div data-testid="settings-chatbot-promise" style="font-size:0.82em;color:var(--text-tertiary);margin:2px 0 0 26px;">${this.t('settingsChatbotHelp')}</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.95em;margin-top:12px;">
            <input type="checkbox" id="settings-location-auto-match-consent" ${getLocationAutoMatchConsent() ? 'checked' : ''}>
            <span>${this.t('settingsLocationAutoMatch')}</span>
          </label>
          <div style="font-size:0.82em;color:var(--text-tertiary);margin:2px 0 0 26px;">${this.t('settingsLocationAutoMatchNote')}</div>
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
        ${this.renderSettingsSection({ id: 'settings-section-content-filters', title: this.t('settingsContentFilters'), subtitle: this.t('settingsContentFiltersHelp') }, `
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
          { id: 'settings-section-download-app', title: this.t('settingsDownloadApp'), subtitle: this.t('settingsDownloadAppSubtitle') },
          `<div id="settings-download-app-body" data-testid="settings-download-app-body" style="display:grid;gap:10px;">${renderDownloadAppSectionBody(this.appDownloadTextDeps(), {})}</div>`,
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
        ${this.renderSettingsSection(
          {
            id: 'settings-section-help',
            title: this.t('settingsHelp'),
            subtitle: this.t('settingsHelpSubtitle'),
            action: `<button type="button" class="btn" id="settings-replay-walkthrough-btn" data-testid="settings-replay-walkthrough-btn">${this.t('settingsReplayWalkthrough')}</button>`,
          },
          '',
        )}
        </div>
      </div>
    `;
    // TechSupport's support-inbox is an operator inbox, not a settings section — it stays
    // permanently visible above the menu/detail split rather than gated behind a menu tap.
    // docs/TODO.md K7: an eligible (non-master) user gets the opt-in prompt, plus the same
    // inbox section once they've actually opted in.
    if (user.id === TECHSUPPORT_ROOT_USER_ID) {
      container.insertAdjacentHTML(
        'afterbegin',
        '<div id="support-delegates-section" style="margin-bottom:14px;"></div>' +
          '<div id="support-inbox-section" style="margin-bottom:14px;"></div>',
      );
    } else if (this.techSupportDelegateEligible) {
      container.insertAdjacentHTML(
        'afterbegin',
        (this.techSupportDelegateOptedIn ? '<div id="support-inbox-section" style="margin-bottom:14px;"></div>' : '') +
          '<div id="support-delegate-optin-section" style="margin-bottom:14px;"></div>',
      );
    }
    this.bindSettingsControls();
    void this.refreshStorageInspector();
    void this.refreshDownloadAppSection();
    this.renderSupportInboxSectionIfPresent();
    this.renderSupportDelegatesSectionIfPresent();
    this.renderSupportDelegateOptInSectionIfPresent();
    this.applySettingsSectionView(this.settingsActiveSectionId);
  }

  /**
   * Settings drill-down: shows either the menu list (sectionId === null) or exactly one
   * section's detail view (every other `.settings-section` display:none, back button visible).
   * Never touches DOM node identity — safe to call after any renderSettingsView() re-render to
   * restore whichever page the user was on (e.g. a language change re-renders the whole view).
   */
  private applySettingsSectionView(sectionId: string | null): void {
    applySettingsSectionViewImpl(sectionId, {
      setSettingsActiveSectionId: (id) => { this.settingsActiveSectionId = id; },
    });
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
    showContentFilterToastImpl(result, direction, {
      t: (key) => this.t(key),
      showNotification: (message, type, options) => this.showNotification(message, type, options),
    });
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
  /**
   * Open the Identity & devices page (identity architecture WP1). Uses the local display model for
   * the list and the shared pairing protocol for code validation. Pairing-code
   * retention and signed-attestation publishing are delegated to the identity-link
   * service wired by the app. A one-sided attestation is shown as waiting, never as
   * a verified link.
   */
  private async openLinkedDevicesDialog(prefillLinkCode?: string): Promise<void> {
    return openLinkedDevicesDialogImpl(
      {
        t: (key) => this.t(key as any),
        getCurrentUser: () => this.currentUser ?? null,
        identityPasswordStatusReader: this.identityPasswordStatusReader,
        identityPasswordSetter: this.identityPasswordSetter,
        identityPasswordChanger: this.identityPasswordChanger,
        identityPasswordRemover: this.identityPasswordRemover,
        identityPasswordLocker: this.identityPasswordLocker,
        identityLinkCodeCreator: this.identityLinkCodeCreator,
        identityLinkRequestReader: this.identityLinkRequestReader,
        identityLinkRequestApprover: this.identityLinkRequestApprover,
        identityLinkPendingCanceler: this.identityLinkPendingCanceler,
        identityLinkRefresher: this.identityLinkRefresher,
        identityLinkCompleter: this.identityLinkCompleter,
        identityLinkUnlinker: this.identityLinkUnlinker,
        deviceHandoffCheckIncoming: this.deviceHandoffCheckIncoming,
        deviceHandoffImport: this.deviceHandoffImport,
      },
      prefillLinkCode,
    );
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
    openEraseDeviceDialogImpl({
      t: (key) => this.t(key as any),
      identityLinkUnlinker: this.identityLinkUnlinker,
      deviceHandoffSync: this.deviceHandoffSync,
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
    bindDirtyWordEditor({ onChange: sync, t: this.t.bind(this) });
    document.getElementById('settings-linked-devices-btn')?.addEventListener('click', () => {
      void this.openLinkedDevicesDialog();
    });
    document.getElementById('settings-erase-device-btn')?.addEventListener('click', () => this.openEraseDeviceDialog());
    document.getElementById('settings-replay-walkthrough-btn')?.addEventListener('click', () => this.showWalkthrough());
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
    document.getElementById('settings-location-auto-match-consent')?.addEventListener('change', (event) => {
      setLocationAutoMatchConsent((event.currentTarget as HTMLInputElement).checked);
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

  private async refreshStorageInspector(): Promise<void> {
    const filters = getTalkIntakeFilters();
    await renderStorageInspector({
      apiBase: this.apiBase,
      text: (key) => this.t(key),
      appState: {
        currentUserId: this.currentUserId,
        supportActive: this.hasSupportContact(),
        allowedLanguages: filters.allowedLanguages
          .map((language) => this.formatTalkLanguage(language))
          .join(', '),
        defaultTalkLanguage: this.formatTalkLanguage(
          getDefaultTalkLanguagePreference(this.getUiLanguage()),
        ),
        roomVisitCounts: Array.from(this.chatroomVisitCounts.entries()).map(([roomId, counts]) => ({
          roomId,
          ...counts,
        })),
      },
    });
  }

  private localStatisticsDeps(): LocalStatisticsDeps {
    return {
      apiBase: this.apiBase,
      currentUserId: this.currentUserId,
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
    };
  }

  private displayContextualStatistics(elementId: string, prefix = ''): void {
    displayContextualStatisticsImpl(elementId, prefix, this.localStatisticsDeps());
  }

  private copyAnsweredTalkToTalks(talkId: string): void {
    copyAnsweredTalkToTalksImpl(talkId, {
      showNotification: (message, type) => this.showNotification(message, type),
      t: this.t.bind(this),
      saveMyTalk: (talkData) => this.saveMyTalk(talkData),
      refreshTalksList: () => this.displayTalksList(),
      refreshAnswersList: () => this.displayAnswersList(),
    });
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
    quickIgnoreIncomingTalkImpl(talkId, identityKeyFallback, {
      showNotification: (message, type) => this.showNotification(message, type),
      t: this.t.bind(this),
      saveAnswerPreference: (talk, talkInstanceId, currentQuestion, answerId, answerText, fullSessionAnswers, mode) =>
        this.saveAnswerPreference(talk, talkInstanceId, currentQuestion, answerId, answerText, fullSessionAnswers, mode),
      completeTalk: (talk, answers, outcome, meta) => this.completeTalk(talk, answers, outcome, meta),
      emit: (event, payload) => this.emit(event, payload),
    });
  }

  private quickCopyIncomingTalk(talkId: string, identityKeyFallback: string | undefined, cluster?: any): void {
    quickCopyIncomingTalkImpl(talkId, identityKeyFallback, cluster, {
      getMyTalks: () => this.getMyTalks(),
      showNotification: (message, type) => this.showNotification(message, type),
      t: this.t.bind(this),
      saveMyTalk: (talkData) => this.saveMyTalk(talkData),
      refreshTalksList: () => this.displayTalksList(),
      emit: (event, payload) => this.emit(event, payload),
    });
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
    bindTalksRowGesturesImpl({
      setSuppressClickUntil: (timestamp) => { this.talksGestureSuppressClickUntil = timestamp; },
      showDetailsPopupFor: (detailsEl, originalParent) => this.showDetailsPopupFor(detailsEl, originalParent),
      quickIgnoreIncomingTalk: (talkId, identityKeyFallback) => this.quickIgnoreIncomingTalk(talkId, identityKeyFallback),
      quickCopyIncomingTalk: (talkId, identityKeyFallback) => this.quickCopyIncomingTalk(talkId, identityKeyFallback),
      deleteMyTalk: (talkId) => this.deleteMyTalk(talkId),
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
    return openEditProfileDialog({
      user,
      uiLanguage: this.getUiLanguage(),
      languageOptions: LANGUAGE_OPTIONS,
      text: (key) => this.t(key),
      onProfileChange: (userId, updates) => this.onProfileChange?.(userId, updates),
    });
  }

  /**
   * Survey creators: show aggregated response counts from local exchange history (STAT-01).
   * Since P0 Step 7 removed server-side stats, all aggregation is client-local.
   */
  private showSurveyStatsDialog(talkId: string): void {
    showSurveyStatisticsDialog({
      talkId,
      entry: this.getMyTalks()[talkId],
      exchanges: readLocalTalkExchanges(),
      text: (key) => this.t(key),
      formatText: (key, values) => this.tf(key, values),
      downloadCsv: (filename, csvBody) => this.downloadSurveyCsv(filename, csvBody),
      openFollowUp: (draft) => this.showTalkEditorDialog(draft),
    });
  }

  private downloadSurveyCsv(filename: string, csvBody: string): void {
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
    return confirmCapturedQuestionDialogView(parsed, this.t.bind(this));
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
    return renderConfirmBroadcastAudience(previews, {
      t: this.t.bind(this),
      tf: this.tf.bind(this),
      deliveryReasonLabel: this.deliveryReasonLabel.bind(this),
      formatReasonCounts: this.formatReasonCounts.bind(this),
    });
  }

  updateStatusBar(
    _stageName: string,
    chatroomName: string,
    memberCount: number,
    totalMatches?: number,
  ): void {
    updateStatusBarImpl(chatroomName, memberCount, totalMatches, {
      tf: this.tf.bind(this),
      getTotalMatches: () => this.getTotalMatches(),
    });
  }

  private syncStatusBarMatchCount(): void {
    syncStatusBarMatchCountImpl({
      tf: this.tf.bind(this),
      getTotalMatches: () => this.getTotalMatches(),
    });
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
    displayIncomingTalkImpl(talk, {
      showNotification: (message, type) => this.showNotification(message, type),
      tf: this.tf.bind(this),
      flashMemberForNewTalk: (authorId) => this.flashMemberForNewTalk(authorId),
      refreshTalksListIfActive: () => this.displayTalksList(),
    });
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

  private completeTalk(
    talk: any,
    answers: any[],
    outcome?: 'match' | 'mismatch',
    meta?: { withholdFromSender?: boolean },
  ): void {
    completeTalkImpl(talk, answers, outcome, meta, {
      t: (key) => this.t(key),
      emit: (event, payload) => this.emit(event, payload),
      showNotification: (message, type) => this.showNotification(message, type),
      displayTalksList: () => this.displayTalksList(),
    });
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
    return resolveStoredAnswerPreference(
      this.currentUser?.id,
      talk,
      questionIndex,
      previousQAPairs,
      currentQuestion,
      talkInstanceId,
    );
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
    persistAnswerPreference(
      this.currentUser?.id,
      talk,
      talkInstanceId,
      currentQuestion,
      answerId,
      answerText,
      fullSessionAnswersIncludingCurrent,
      mode,
    );
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
    return buildChatbotAnswersFromPreferences(this.currentUser?.id, talkData);
  }

  /**
   * Called by app when user completes a talk: save each question-answer to myQuestionAnswers (keyed by question text; last wins).
   */
  saveQuestionAnswersFromCompletion(
    talkData: { questions?: Array<{ id: string; text?: string }> },
    answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
    location?: { latitude: number; longitude: number },
  ): void {
    saveQuestionAnswersFromCompletionStorage(talkData, answers, location, () => this.displayAnswersList());
  }

  /** Shows the first-run walkthrough once per device, after boot finishes. No-op on replay. */
  showFirstRunWalkthroughIfNeeded(): void {
    if (getHasSeenWalkthrough()) return;
    const enabledForE2E = new URLSearchParams(window.location.search).get('e2e_walkthrough') === '1';
    if (process.env.DISABLE_HMR === 'true' && !enabledForE2E) return;
    this.showWalkthrough();
  }

  /** Settings → Help & Tour "Replay Tour" button, and the automatic first-run trigger. */
  showWalkthrough(): void {
    showWalkthroughDialog({
      text: (key, fallback) => {
        const value = this.t(key as UiTranslationKey);
        return value && value !== key ? value : (fallback ?? key);
      },
      onClose: () => setHasSeenWalkthrough(true),
    });
  }

  showPreferencesDialog(): void {
    openAnswerPreferencesDialog({
      showNotification: (message, type) => this.showNotification(message, type),
      t: (key) => this.t(key),
      formatUiDate: (date) => this.formatUiDate(date),
    });
  }

  // ============================================
  // MY TALKS MANAGEMENT
  // ============================================

  private saveMyTalk(talkData: MyTalkEntry): void {
    saveMyTalkImpl(talkData, { displayTalksList: () => this.displayTalksList() });
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
    return getSenderOmittedBroadcastPreviewsImpl();
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
    saveCreatedTalkImpl(talk, options, {
      saveAnswerPreference: (talkArg, talkInstanceId, currentQuestion, answerId, answerText, fullSessionAnswers, mode) =>
        this.saveAnswerPreference(talkArg, talkInstanceId, currentQuestion, answerId, answerText, fullSessionAnswers, mode),
      saveQuestionAnswersFromCompletion: (talkData, answers) => this.saveQuestionAnswersFromCompletion(talkData, answers),
      saveFlatAnswerHistoryRecord: (talkId, talkArg, completedAnswers, outcome, senders) =>
        saveFlatAnswerHistoryRecord(talkId, talkArg, completedAnswers, outcome, senders),
      refreshTalksListIfActive: () => this.displayTalksList(),
    });
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
    setTalkDisabledImpl(talkId, disabled, {
      emit: (event, payload) => this.emit(event, payload),
      t: this.t.bind(this),
      displayTalksList: () => this.displayTalksList(),
    });
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
    options?: NotificationOptions,
  ): void {
    renderNotificationToast(message, type, options, {
      isSuppressedForE2e: () => this.notificationsSuppressedForE2e,
      t: this.t.bind(this),
      openConversation: (conversationId) => this.showConversationDetail(conversationId),
      navigateToPerson: (person) => this.navigateToGraphNode(person),
    });
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
    renderSystemAnnouncement(announcement);
  }

  /** Best-effort OS sniff for the app-download banner; unmatched UAs fall through to null (no dead link). */
  async renderAppDownloadBanner(): Promise<void> {
    await renderAppDownloadBannerImpl({
      apiBase: this.apiBase,
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
      openDownloadAppSettingsSection: () => {
        this.applySettingsSectionView((this.settingsActiveSectionId = 'settings-section-download-app'));
      },
    });
  }

  private appDownloadTextDeps(): AppDownloadTextDeps {
    return { text: this.t.bind(this), tf: this.tf.bind(this), escapeHtml };
  }

  /** Populates Settings > "Download the app" from the banner's own manifest. */
  private async refreshDownloadAppSection(): Promise<void> {
    const body = document.getElementById('settings-download-app-body');
    if (!body) return;
    body.innerHTML = renderDownloadAppSectionBody(this.appDownloadTextDeps(), await fetchDownloadManifest(this.apiBase));
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
    renderChatroomMessage(message);
  }

  /**
   * Talk editor usability follow-up: "+ Create Talk" opens this picker instead of jumping
   * straight into a blank editor. Picking a template opens the SAME editor pre-filled
   * (`showTalkEditorDialog` already accepts an `existingTalk`-shaped prefill with no `id` —
   * proven by the existing copy-talk/survey-follow-up call sites — so a template is just
   * another one, fully editable, created fresh on save). Modeled on the existing
   * `showChooseWhoToDmPicker` skeleton; rows reuse `.chatroom-item`'s icon+name+description+
   * arrow visual language (main.css) rather than inventing a new one.
   */
  private showTalkTemplatePicker(): void {
    renderTalkTemplatePicker({
      t: this.t.bind(this),
      openEditor: (existingTalk) => this.showTalkEditorDialog(existingTalk),
    });
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
      syncAdultLockFromBuiltInKinds,
      onBrowseTemplates: () => this.showTalkTemplatePicker(),
      previewCollectors: {
        collectFlowSurveyEditorQuestions: (previewType) =>
          collectFlowSurveyEditorQuestions(document.getElementById('talk-editor-form') as HTMLFormElement, previewType, {
            refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
            processTalkForm: this.processTalkForm.bind(this),
            text: this.t.bind(this),
          }).questions,
        collectRouteEditorQuestions: () => this.collectRouteEditorQuestions().questions,
      },
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
    return processTalkFormImpl(form, {
      getUiLanguage: () => this.getUiLanguage(),
      getDefaultTalkLanguagePreference,
      t: (key) => this.t(key),
      emit: (event, payload) => this.emit(event, payload),
      showTalkValidationError: (errors) => this.showTalkValidationError(errors),
      showTalkAutofixReport: (fixes) => this.showTalkAutofixReport(fixes),
      refreshFlowAnswerConstraints: (type) => this.refreshFlowAnswerConstraints(type),
      collectRouteEditorQuestions: () => this.collectRouteEditorQuestions(),
      buildRouteSelfAnswers: (matchThreshold) => this.buildRouteSelfAnswers(matchThreshold),
    });
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
    refreshFlowAnswerConstraintsImpl(type, { t: (key) => this.t(key) });
  }

  /** Mutable editor state; pure initialization/serialization lives in route-editor-model.ts. */
  private routeEditorQuestions: RouteEditorQuestion[] = [];

  /** Builds or re-hydrates the route-editor in-memory state and redraws it. */
  private ensureRouteEditorRendered(existingTalk?: any): void {
    const host = document.getElementById('route-editor');
    if (!host) return;
    if (this.routeEditorQuestions.length === 0) {
      this.routeEditorQuestions = initializeRouteEditorQuestions(existingTalk);
    }
    this.renderRouteEditor();
  }

  private renderRouteEditor(): void {
    const host = document.getElementById('route-editor');
    if (!host) return;
    renderRouteEditorController(host, {
      getQuestions: () => this.routeEditorQuestions,
      replaceQuestions: (questions) => {
        this.routeEditorQuestions = questions;
      },
      text: this.t.bind(this),
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
    return buildRouteEditorSelfAnswers(this.routeEditorQuestions, matchThreshold);
  }
  private collectRouteEditorQuestions(): ReturnType<typeof collectRouteQuestions> {
    return collectRouteQuestions(this.routeEditorQuestions, this.t.bind(this));
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

  /** docs/TODO.md K7. Fed by app.ts's `refreshDelegateAdminPanel` — master session only. */
  updateTechSupportDelegates(grants: TechSupportDelegateGrant[]): void {
    this.currentTechSupportDelegates = grants;
    this.renderSupportDelegatesSectionIfPresent();
  }

  updateDelegateActivity(entries: SupportFaqEntry[]): void {
    this.currentDelegateActivity = entries;
    this.renderSupportDelegatesSectionIfPresent();
  }

  private renderSupportDelegatesSectionIfPresent(): void {
    if (!document.getElementById('support-delegates-section')) return;
    renderSupportDelegatesSection(
      {
        escapeHtml,
        text: this.t.bind(this),
        tf: this.tf.bind(this),
        formatDate: this.formatUiDate.bind(this),
        onIssue: (input) => this.emit('issueTechSupportDelegate', input),
        onRevoke: (delegatePub) => this.emit('revokeTechSupportDelegate', delegatePub),
      },
      this.currentTechSupportDelegates,
      this.currentDelegateActivity,
    );
  }

  /**
   * docs/TODO.md K7. Fed by app.ts's live (or boot-time) grant check for THIS user's own pub —
   * never derived from anything rendered here. Re-renders the opt-in/inbox sections in place if
   * the Me/Settings tab is currently showing them.
   */
  setTechSupportDelegateEligibility(eligible: boolean, label: string, optedIn: boolean): void {
    this.techSupportDelegateEligible = eligible;
    this.techSupportDelegateLabel = label;
    this.techSupportDelegateOptedIn = optedIn;
    if (this.currentUser && document.getElementById('settings-view')?.classList.contains('active')) {
      this.renderSettingsView(this.currentUser);
    }
  }

  private renderSupportDelegateOptInSectionIfPresent(): void {
    if (!document.getElementById('support-delegate-optin-section')) return;
    renderSupportDelegateOptInSection({
      escapeHtml,
      text: this.t.bind(this),
      label: this.techSupportDelegateLabel,
      optedIn: this.techSupportDelegateOptedIn,
      onToggle: (nextOptedIn) => this.emit('toggleTechSupportDelegateOptIn', nextOptedIn),
    });
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
      registerTalkForPeer,
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
    saveKnownPersonImpl(userId, details, {
      getCurrentUser: () => this.currentUser,
      emit: (event, payload) => this.emit(event, payload),
      refreshContactsList: () => void this.displayContactsList(),
    });
  }

  private async submitPeerReview(userId: string, rating: number): Promise<void> {
    this.emit('submitPeerReview', { userId, rating });
  }

  private async vouchAgeVerified(userId: string): Promise<void> {
    this.emit('vouchAgeVerified', { userId });
  }

  private async setBlocked(userId: string, blocked: boolean): Promise<void> {
    return setBlockedImpl(userId, blocked, {
      getCurrentUser: () => this.currentUser,
      apiBase: this.apiBase,
      currentUserId: this.currentUserId,
      emit: (event, payload) => this.emit(event, payload),
      refreshContactsList: () => void this.displayContactsList(),
    });
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
    return getPeerNameCache();
  }

  private rememberPeerName(userId: string, stageName: string): void {
    rememberPeerName(userId, stageName, () => this.getMyConversations());
  }

  updateMatchBadge(): void {
    renderMatchBadge(this.getMyConversations());
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

  /**
   * Re-render the open conversation from the last synced messages (filter toggle, §9). Also
   * called externally after the local TechSupport FAQ-bundle cache refreshes (docs/TODO.md K7):
   * `filterVerifiedSupportMessages` fails closed against that cache, so a delegate's answer
   * whose signature arrives before its bundle finishes syncing renders as if hidden until
   * something re-renders — no new conversation message follows the bundle catching up.
   */
  rerenderOpenConversation(): void {
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
    return formatAttachmentSizeImpl(bytes);
  }

  private attachmentDownloadFilename(rawName: string, mimeType: string): string {
    return attachmentDownloadFilenameImpl(rawName, mimeType);
  }

  private attachmentIconForMime(mimeType: string): string {
    return attachmentIconForMimeImpl(mimeType);
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
    return renderCapturedQuestionMessageCard(payload, isOwn, timestamp, messageId, {
      isAlreadyAnswered: (id) => this.answeredCaptureChipMessageIds.has(id),
      formatTalkRelativeTime: (date) => this.formatTalkRelativeTime(date),
    });
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
    return renderIpfsAttachmentMessageCard(share, isOwn, timestamp, {
      attachmentIconForMime: (mimeType) => this.attachmentIconForMime(mimeType),
      attachmentDownloadFilename: (name, mimeType) => this.attachmentDownloadFilename(name, mimeType),
      formatAttachmentSize: (sizeBytes) => this.formatAttachmentSize(sizeBytes),
      t: this.t.bind(this),
      formatTalkRelativeTime: (date) => this.formatTalkRelativeTime(date),
    });
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
    return saveFileFromObjectUrl(objectUrl, name, mimeType);
  }

  /**
   * After rendering, turn the bytes this device holds into a usable blob URL for each
   * attachment: gallery image tiles get a preview, and every card/tile/chip becomes
   * click-to-save under the real filename once the bytes arrive.
   */
  private hydrateAttachmentImages(container: HTMLElement): void {
    hydrateAttachmentImagesImpl(container, {
      sharedAttachmentResolver: this.sharedAttachmentResolver,
      saveObjectUrlAs: (objectUrl, name, mimeType) => this.saveObjectUrlAs(objectUrl, name, mimeType),
      openLightbox: (url, name, mime) => this.openLightbox(url, name, mime),
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
    return renderMediaTileImpl(share);
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

  async displayConversationMessages(conversationId: string, messages: any[]): Promise<void> {
    if (this.currentConversationId !== conversationId) return;

    const messagesContainer = document.getElementById('conversation-messages');
    if (!messagesContainer) return;

    this.bindCapturedQuestionChipDelegation();

    const isSupportChannel = this.getMyConversations()[conversationId]?.supportChannel === true;
    if (isSupportChannel) {
      messages = await filterVerifiedSupportMessages(messages, this.currentUser?.stageName || '');
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
    updateConversationTransportModeImpl(conversationId, transportMode, transportFallbackReason, {
      getMyConversations: () => this.getMyConversations(),
      getCurrentConversationId: () => this.currentConversationId,
      t: this.t.bind(this),
      formatTransportMode: (mode) => this.formatTransportMode(mode),
      formatTransportFallback: (mode, reason) => this.formatTransportFallback(mode, reason),
    });
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
    markConversationWithdrawnImpl(otherUserId, talkId, retractedAt, this.conversationRecordUpdateDeps());
  }

  /**
   * Step 9: Mark a conversation as ended (match→ignore change-of-mind).
   * Finds the conversation by otherUserId+talkId, sets status:'ignored' and
   * records the changedAt timestamp so the conversation-list renders a durable
   * "answer changed" label assertable by E2E tests.
   */
  markConversationEnded(otherUserId: string, talkId: string, changedAt: string): void {
    markConversationEndedImpl(otherUserId, talkId, changedAt, this.conversationRecordUpdateDeps());
  }

  private conversationRecordUpdateDeps(): ConversationRecordUpdateDeps {
    return {
      getMyConversations: () => this.getMyConversations(),
      updateMatchBadge: () => this.updateMatchBadge(),
      syncStatusBarMatchCount: () => this.syncStatusBarMatchCount(),
      refreshConversationsListIfActive: () => this.displayConversationsList(),
    };
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
    markOtherDealConversationsEndedImpl(talkId, keepOtherUserId, changedAt, this.conversationRecordUpdateDeps());
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
    setConversationOnlineStatusImpl(otherUserIds, {
      getMyConversations: () => this.getMyConversations(),
      refreshConversationsListIfActive: () => this.displayConversationsList(),
      setOnlineUserIds: (ids) => { this.onlineUserIds = ids; },
      refreshContactsListIfActive: () => void this.displayContactsList(),
      patchPresenceIndicators: () => this.patchPresenceIndicators(),
    });
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
