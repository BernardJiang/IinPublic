import {
  User,
  type GPSCoordinate,
  type KnownPerson,
  type TalkIntakeFilters,
  type QuestionAnswer,
  type Tag,
} from '../../shared/types';
import { EventEmitter } from 'events';
import { formatTimeAgo, formatExpiration, escapeHtml } from './ui-formatters';
import { pickLatestTalkIdFromIncomingCluster } from '../../shared/incoming-talk-ids';
import { completeTalk as completeTalkImpl, saveMyTalk as saveMyTalkImpl } from './talk-completion';
import { renderAppDownloadBanner as renderAppDownloadBannerImpl } from './app-download-banner';
import { openAnswerPreferencesDialog } from './answer-preference-mutations';
import {
  displayContextualStatistics as displayContextualStatisticsImpl,
  type LocalStatisticsDeps,
} from './local-statistics';
import { openEraseDeviceDialog as openEraseDeviceDialogImpl } from './erase-device-flow';
import {
  getBroadcastableTalkIds as getBroadcastableTalkIdsImpl,
  getBroadcastTalkPayload as getBroadcastTalkPayloadImpl,
  type BroadcastAudiencePreview,
  getSenderOmittedBroadcastPreviews as getSenderOmittedBroadcastPreviewsImpl,
} from './broadcast-audience-preview';
import {
  getUnsentBroadcastTalkIds as getUnsentBroadcastTalkIdsImpl,
  getUnsentBroadcastTalkIdsForReceiver as getUnsentBroadcastTalkIdsForReceiverImpl,
  getUnsentBroadcastTalkReceiverIds as getUnsentBroadcastTalkReceiverIdsImpl,
} from './broadcast-delivery-selection';
import { refreshFlowAnswerConstraints as refreshFlowAnswerConstraintsImpl } from './flow-answer-constraints';
import {
  LANGUAGE_OPTIONS,
  normalizeStringList,
  normalizeTalkFilterShape,
  renderSettingsView as renderSettingsViewImpl,
} from './settings-view';
import { bindSettingsControls as bindSettingsControlsImpl } from './settings-controls';
import { showContentFilterToast as showContentFilterToastImpl } from './content-filter-toast';
import { applySettingsSectionView as applySettingsSectionViewImpl } from './settings-section-view';
import { parseIpfsSharePayload as parseIpfsSharePayloadImpl } from './attachment-metadata';
import { type QAPair } from '../../shared/flattened-answer-keys';
import { listContactGroups, resolveContactGroupUserIds, type ContactGroupOption } from '../../shared/contact-groups';
import { SORT_STRATEGIES } from '../../shared/find-similar';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { LocationPrivacy } from '../../shared/location';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import type { SupportInboxEntry, SupportFaqEntry } from '../../shared/techsupport-faq';
import { renderSupportInboxSection } from './support-inbox-view';
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
  showContactsList as openContactsList,
  type ContactsViewDeps,
} from './contacts-view';
import { displayConversationsList as renderConversationsList } from './conversations-view';
import {
  addNewConversation as addNewConversationImpl,
  syncConversationMessageSummary as syncConversationMessageSummaryImpl,
  updateConversationMessage as updateConversationMessageImpl,
  type ConversationListUpdatesDeps,
} from './conversation-list-updates';
import {
  displayConversationMessages as displayConversationMessagesImpl,
  showConversationDetail as showConversationDetailImpl,
  type ConversationDetailViewDeps,
} from './conversation-detail-view';
import { connectivityDiagnosticsText, type ConnectivityDiagnostics } from './connectivity-settings';
import {
  getAnswerPreferences,
  getExactChatbotMemory,
  saveQuestionAnswersFromCompletion as saveQuestionAnswersFromCompletionStorage,
} from './answer-preferences-storage';
import {
  getSelfTagForQuestionText,
  LOCAL_EXACT_CHATBOT_USER_ID,
} from '../../shared/exact-chatbot-memory';
import {
  clearMyTalks,
  getMyTalks,
  type MyTalkEntry,
} from './my-talks-storage';
import {
  getFlatAnswerHistory,
  getTalkContentKey,
  saveFlatAnswerHistoryRecord,
} from './answer-history-storage';
import {
  getChatbotEnabled,
  getChatbotTemplate as loadChatbotTemplate,
  getCopyTalkAutoSave,
  getDefaultTalkLanguagePreference,
  getHasSeenWalkthrough,
  getKeepOldTalkOnEdit,
  getUiLanguagePreference,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setCopyTalkAutoSave,
  setHasSeenWalkthrough,
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
import { createPeerController, type PeerController } from './peer-controller';
import {
  createConversationMediaController,
  type ConversationMediaController,
} from './conversation-media-controller';
import { syncAppBarOverflow, setupAppBarChrome } from './app-bar-overflow';
import { showSystemAnnouncement as renderSystemAnnouncement } from './system-announcement-banner';
import { showDetailsPopupFor as renderItemDetailsPopup } from './item-details-popup';
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
import { showTalkDetail as showTalkDetailImpl } from './talk-detail-view';
import { showLocationRoomSuggestion as showLocationRoomSuggestionImpl } from './location-room-suggestion';
import { formatTalkDistanceFromAuthor as formatTalkDistanceFromAuthorImpl } from './talk-distance';
import { displayTalksList as displayTalksListView } from './talks-list-view';
import { updateChatroomInfo as updateChatroomInfoImpl } from './chatroom-info';
import { setCurrentChatroomId as setCurrentChatroomIdImpl } from './current-chatroom';
import { navigateToMyAnswerForTalk as navigateToMyAnswerForTalkImpl } from './navigate-to-answer';
import { quickAnswerIncomingTag as quickAnswerIncomingTagImpl } from './quick-answer-incoming-tag';
import { syncReturnHomeButton as syncReturnHomeButtonImpl } from './return-home-button';
import { deleteMyTalk as deleteMyTalkImpl } from './talk-deletion';
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
import { bindAppShellControls, type AppShellControlsDeps } from './app-shell-controls';
import { refreshPeerThreadList, closePeerDetailView } from './user-detail-view';
import { avatarInnerHtml } from './profile-avatar';
import { languageOptionLabel, uiLanguageFromProfile, uiText, type UiTranslationKey } from './ui-translations';
import {
  deriveLocalCreatorReplies,
  readLocalTalkExchanges,
} from '../services/local-peer-derivation';
import { getTalkIntakeFilters } from './talk-intake-filters';
import { renderChatroomMessage } from './chatroom-message-view';
import { renderMatchBadge } from './notification-badges';
import { confirmCapturedQuestionDialog as confirmCapturedQuestionDialogView } from './captured-question-dialog';
import { filterOutgoingMessage, filterIncomingMessage, type MessageFilterResult } from '../../shared/message-content-filter';
import { openLinkedDevicesDialog as openLinkedDevicesDialogImpl } from './linked-devices-dialog';
import {
  renderCreatorReplies as renderCreatorRepliesImpl,
  CREATOR_REPLY_PAGE_SIZE,
  readCreatorReplyFilterState,
  type CreatorReplyRow,
} from './creator-replies-view';
import { bindTalksRowGestures as bindTalksRowGesturesImpl } from './talks-row-gestures';
import { showIdentityUnlockDialog as openIdentityUnlockDialog } from './identity-password-dialog';
import { type PairingPayload } from '../../shared/identity-linking';
import { getTalkLedgerDoc } from '../services/web-talk-ledger-store';

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
type PublicProfileFoundationReader = (userId: string) => Promise<{
  headshot?: string | null;
  languagesJson?: string;
  profileJson?: string;
  interestsJson?: string;
  reputation?: { questionsAnswered?: number; matchesFound?: number; blockCount?: number; isHidden?: boolean };
} | null>;

type ContactPreRenderSync = () => Promise<void>;
type PeerLocationReader = (userId: string) => Promise<GPSCoordinate | undefined>;

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

  /** Other users in the current chatroom detail view (excludes self); used for broadcast delivery. */
  getCurrentChatroomMembers(): Array<{ userId: string; stageName: string }> {
    return [...this.currentChatroomMembers];
  }
  private currentConversationId: string | undefined = undefined;
  /** Per-talk Thread scope of the open conversation view (redesign §5); undefined = DM. */
  private currentThreadTalkId: string | undefined = undefined;
  private conversationMediaController?: ConversationMediaController;
  private peerController?: PeerController;
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
  /** Row-drag gesture recognizer (ignore/copy/delete) — bound once. */
  /** A committed or cancelled drag swallows the click that would otherwise follow release. */
  private talksGestureSuppressClickUntil = 0;
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
    return formatTalkDistanceFromAuthorImpl(authorLocation, this.currentLocation);
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
    syncReturnHomeButtonImpl({
      getHomeChatroomId: () => this.getHomeChatroomId(),
      currentChatroom: this.currentChatroom,
      resolveChatroomTitle: (chatroomId) => this.resolveChatroomTitle(chatroomId),
    });
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

  private getUnsentBroadcastTalkIds(_chatroomId: string, receiverIds: string[]): string[] {
    return getUnsentBroadcastTalkIdsImpl(receiverIds);
  }

  /**
   * docs/TODO.md §W Gap 1: `getUnsentBroadcastTalkIds` above is room-wide — a talk stays in
   * everyone's batch if *any* member still needs it, which can re-attempt delivery to a
   * receiver who already has it. This returns the same per-receiver truth from
   * `broadcast-delivery-selection`, but keyed by talk, so a single broadcast call can pass each
   * talk its own narrower receiver list instead of the full room.
   */
  getUnsentBroadcastTalkReceiverIds(
    _chatroomId: string,
    talkIds: string[],
    receiverIds: string[],
  ): Record<string, string[]> {
    return getUnsentBroadcastTalkReceiverIdsImpl(talkIds, receiverIds);
  }

  initialize(): void {
    const container = document.getElementById('app');
    if (!container) {
      throw new Error('App container not found');
    }
    this.appContainer = container;
    this.setupBaseUI();
    this.conversationMedia().setup();
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

    bindAppShellControls(this.appShellControlsDeps());
    this.setupAppBarChrome();
    this.syncAppBarActionsForView('chatrooms');
  }

  private appShellControlsDeps(): AppShellControlsDeps {
    return {
      t: (key) => this.t(key),
      emit: (event, payload) => this.emit(event, payload),
      showDmInboxPicker: () => this.showDmInboxPicker(),
      allowOutgoingMessage: (message) => this.allowOutgoingMessage(message),
      showTalkEditorDialog: () => this.showTalkEditorDialog(),
      showPreferencesDialog: () => this.showPreferencesDialog(),
      showChatroomList: () => this.showChatroomList(),
      handleCreateCustomChatroomClick: () => this.handleCreateCustomChatroomClick(),
      showContactsList: () => this.showContactsList(),
      resetSettingsSection: () => {
        this.settingsActiveSectionId = null;
        this.applySettingsSectionView(null);
      },
      handleBroadcastTalkFromCurrentRoom: (automatic) => {
        this.handleBroadcastTalkFromCurrentRoom(automatic);
      },
      restoreTalksTabState: () => this.restoreTalksTabState(),
      setTalksShowIncoming: (value) => { this.talksShowIncoming = value; },
      setTalksShowOutgoing: (value) => { this.talksShowOutgoing = value; },
      setTalkTypeEnabled: (type, enabled) => {
        if (enabled) this.talksEnabledTypes.add(type);
        else this.talksEnabledTypes.delete(type);
      },
      setTalksOutSortMode: (value) => {
        this.talksOutSortMode = value as typeof this.talksOutSortMode;
      },
      setTalksQuery: (value) => { this.talksQuery = value; },
      setTalksCompletionFilter: (value) => {
        this.talksCompletionFilter = value as typeof this.talksCompletionFilter;
      },
      setTalksOutcomeFilter: (value) => {
        this.talksOutcomeFilter = value as typeof this.talksOutcomeFilter;
      },
      setTalksDateFrom: (value) => { this.talksDateFrom = value; },
      setTalksDateTo: (value) => { this.talksDateTo = value; },
      persistTalksTabState: () => this.persistTalksTabState(),
      displayTalksList: () => this.displayTalksList(),
      resetCreatorReplyVisibleCount: () => {
        this.creatorReplyVisibleCount = CREATOR_REPLY_PAGE_SIZE;
      },
      clearCreatorReplyScope: () => {
        this.creatorReplyScopedTalkId = null;
        this.creatorReplyScopedTalkTitle = '';
      },
      renderCreatorRepliesIfVisible: () => {
        if (document.getElementById('creator-replies-panel')?.style.display !== 'none') {
          this.renderCreatorReplies();
        }
      },
      getChatroomsDetailRoomId: () => this.chatroomsDetailRoomId,
      showChatroomDetail: (chatroomId) => this.showChatroomDetail(chatroomId),
      dismissMatchNotifications: () => this.dismissMatchNotifications(),
      refreshCreatorReplies: () => this.refreshCreatorReplies(),
      getCurrentUser: () => this.currentUser,
      showMainInterface: (user) => this.showMainInterface(user),
      displayAnswersList: () => this.displayAnswersList(),
      renderSettingsView: (user) => this.renderSettingsView(user),
      syncHeaderStatusView: (viewName) => this.syncHeaderStatusView(viewName),
      syncAppBarActionsForView: (viewName) => this.syncAppBarActionsForView(viewName),
    };
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
      const talkIds = getUnsentBroadcastTalkIdsForReceiverImpl(peer.userId);
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

  private peer(): PeerController {
    if (!this.peerController) {
      this.peerController = createPeerController({
        getCurrentUser: () => this.currentUser,
        getCurrentUserId: () => this.currentUserId,
        getApiBase: () => this.apiBase,
        getCurrentChatroomMembers: () => this.currentChatroomMembers,
        getIncomingTalkClusters: () => this.incomingTalkClusters,
        getMyConversations: () => this.getMyConversations(),
        getMyTalks: () => this.getMyTalks(),
        getContactsViewDeps: () => this.contactsViewDeps(() => this.displayContactsList()),
        getPublicProfileFoundationReader: () => this.publicProfileFoundationReader,
        getIdentityLinkChecker: () => this.identityLinkChecker,
        showConversationDetail: (conversationId, talkId) => this.showConversationDetail(conversationId, talkId),
        showCreatorRepliesForTalk: (talkId, title) => this.showCreatorRepliesForTalk(talkId, title),
        displayContactsList: () => this.displayContactsList(),
        showNotification: (message, type) => this.showNotification(message, type),
        allowOutgoingMessage: (message) => this.allowOutgoingMessage(message),
        emit: (event, payload) => this.emit(event, payload),
        t: (key) => this.t(key),
        formatTalkRelativeTime: (date) => this.formatTalkRelativeTime(date),
        formatTalkType: (type) => this.formatTalkType(type),
        formatTalkLanguage: (language) => this.formatTalkLanguage(language),
      });
    }
    return this.peerController;
  }

  /**
   * The single ContactsViewDeps builder — every contacts-view entry point uses this
   * object (key invariant: the deps object must stay complete at every call site).
   */
  private contactsViewDeps(onSortRerender?: () => void): ContactsViewDeps {
    const peer = this.peer();
    return {
      apiBase: this.apiBase,
      currentUserId: this.currentUserId,
      escapeHtml: escapeHtml,
      getKnownPeople: peer.getKnownPeople,
      getKnownPerson: peer.getKnownPerson,
      isBlockedByMe: peer.isBlockedByMe,
      getPeerName: peer.getPeerName,
      resolvePeerStageName: peer.resolvePeerStageNameLive,
      // Rule N2a (redesign §5): tapping the contact's NAME lands on the DM Conversation
      // directly, with the shared User layout underneath — identical to a chatroom member
      // click. Tapping the row anywhere else opens the User layout alone (openPeerDetailOnly).
      openPeerDetail: peer.openUserConversationFirst,
      openPeerDetailOnly: peer.openPeerDetailForUser,
      updateStatsStrip: (prefix: string) => this.displayContextualStatistics('contacts-stats-strip', prefix),
      getMyConversations: this.getMyConversations.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      saveKnownPerson: peer.saveKnownPerson,
      submitPeerReview: peer.submitPeerReview,
      vouchAgeVerified: peer.vouchAgeVerified,
      setBlocked: peer.setBlocked,
      hasSupportContact: peer.hasSupportContact,
      isSupportNotificationsMuted: peer.isSupportNotificationsMuted,
      setSupportNotificationsMuted: peer.setSupportNotificationsMuted,
      isTechSupportOnline: peer.isTechSupportOnline,
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
        await this.prefetchPeerLocations(peer.getKnownPeople().map((p) => p.userId));
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
    setCurrentChatroomIdImpl(chatroomId, {
      setCurrentChatroom: (id) => { this.currentChatroom = id; },
      renderChatroomList: () => this.renderChatroomList(),
      resolveChatroomTitle: (id) => this.resolveChatroomTitle(id),
      t: (key) => this.t(key),
      syncReturnHomeButton: () => this.syncReturnHomeButton(),
    });
  }

  displayTalksList(): void {
    displayTalksListView({
      currentUser: this.currentUser,
      currentLocation: this.currentLocation,
      creatorReplyRows: this.creatorReplyRows,
      incomingTalkClusters: this.incomingTalkClusters,
      talkStatsMap: this.talkStatsMap,
      talksShowIncoming: this.talksShowIncoming,
      talksShowOutgoing: this.talksShowOutgoing,
      talksEnabledTypes: this.talksEnabledTypes,
      talksOutSortMode: this.talksOutSortMode,
      talksQuery: this.talksQuery,
      talksCompletionFilter: this.talksCompletionFilter,
      talksOutcomeFilter: this.talksOutcomeFilter,
      talksDateFrom: this.talksDateFrom,
      talksDateTo: this.talksDateTo,
      syncStatusBarMatchCount: () => this.syncStatusBarMatchCount(),
      deleteMyTalk: (talkId) => this.deleteMyTalk(talkId),
      quickAnswerIncomingTag: (talkId, identityKey, checked) => this.quickAnswerIncomingTag(talkId, identityKey, checked),
      showTalkDetail: (talkId, identityKey) => this.showTalkDetail(talkId, identityKey),
      showSurveyStatsDialog: (talkId) => this.showSurveyStatsDialog(talkId),
      showCreatorRepliesForTalk: (talkId, title) => this.showCreatorRepliesForTalk(talkId, title),
      setTalkDisabled: (talkId, disabled) => this.setTalkDisabled(talkId, disabled),
      showNotification: (message, type) => this.showNotification(message, type),
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
      bindTalksRowGestures: () => this.bindTalksRowGestures(),
      getMyConversations: () => this.getMyConversations(),
      formatReasonCounts: (counts) => this.formatReasonCounts(counts),
      displayContextualStatistics: (elementId, prefix) => this.displayContextualStatistics(elementId, prefix),
      getCoExchangedPeople: (identityKey, excluded) => this.getCoExchangedPeople(identityKey, excluded),
      formatTalkDistanceFromAuthor: (location) => this.formatTalkDistanceFromAuthor(location),
      formatTalkExpiration: (expiresAt) => this.formatTalkExpiration(expiresAt),
      formatTalkLanguage: (code) => this.formatTalkLanguage(code),
      formatTalkLocation: (radius) => this.formatTalkLocation(radius),
      formatTalkRelativeTime: (date) => this.formatTalkRelativeTime(date),
      formatTalkType: (type) => this.formatTalkType(type),
      getIncomingResponseCount: (talkId) => this.getIncomingResponseCount(talkId),
      getPreferredTalkLanguage: () => this.getPreferredTalkLanguage(),
      pickIncomingRowTalkId: (cluster) => this.pickIncomingRowTalkId(cluster),
      showTalkEditorDialog: (talk) => this.showTalkEditorDialog(talk),
      navigateToGraphNode: (target) => this.navigateToGraphNode(target),
      showChooseWhoToDmPicker: (people) => this.showChooseWhoToDmPicker(people),
      emit: (event, payload) => this.emit(event, payload),
      persistTalksTabState: () => this.persistTalksTabState(),
      getTalksGestureSuppressClickUntil: () => this.talksGestureSuppressClickUntil,
    });
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

  private renderSettingsView(user: User): void {
    renderSettingsViewImpl(user, {
      currentLocation: this.currentLocation,
      incomingTalkClusters: this.incomingTalkClusters,
      customChatrooms: this.customChatrooms,
      getHomeChatroomId: () => this.getHomeChatroomId(),
      formatReasonCounts: (counts) => this.formatReasonCounts(counts),
      getUiLanguage: () => this.getUiLanguage(),
      formatTalkLanguage: (code) => this.formatTalkLanguage(code),
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
      appDownloadTextDeps: () => this.appDownloadTextDeps(),
      techSupportDelegateEligible: this.techSupportDelegateEligible,
      techSupportDelegateOptedIn: this.techSupportDelegateOptedIn,
      bindSettingsControls: () => this.bindSettingsControls(),
      refreshStorageInspector: () => this.refreshStorageInspector(),
      refreshDownloadAppSection: () => this.refreshDownloadAppSection(),
      renderSupportInboxSectionIfPresent: () => this.renderSupportInboxSectionIfPresent(),
      renderSupportDelegatesSectionIfPresent: () => this.renderSupportDelegatesSectionIfPresent(),
      renderSupportDelegateOptInSectionIfPresent: () => this.renderSupportDelegateOptInSectionIfPresent(),
      applySettingsSectionView: (sectionId) => this.applySettingsSectionView(sectionId),
      settingsActiveSectionId: this.settingsActiveSectionId,
    });
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
    bindSettingsControlsImpl({
      currentUser: this.currentUser,
      incomingTalkClusters: this.incomingTalkClusters,
      currentLocation: this.currentLocation,
      t: (key) => this.t(key),
      showNotification: (message, type) => this.showNotification(message, type),
      emit: (event, payload) => this.emit(event, payload),
      setSettingsActiveSectionId: (sectionId) => { this.settingsActiveSectionId = sectionId; },
      applySettingsSectionView: (sectionId) => this.applySettingsSectionView(sectionId),
      clearHiddenMessageToasts: () => this.hiddenMessageToastIds.clear(),
      rerenderOpenConversation: () => this.rerenderOpenConversation(),
      formatReasonCounts: (counts) => this.formatReasonCounts(counts),
      applyShellTranslations: () => this.applyShellTranslations(),
      renderSettingsView: (user) => this.renderSettingsView(user),
      displayTalksList: () => this.displayTalksList(),
      openLinkedDevicesDialog: () => this.openLinkedDevicesDialog(),
      openEraseDeviceDialog: () => this.openEraseDeviceDialog(),
      showWalkthrough: () => this.showWalkthrough(),
      onStageNameChange: this.onStageNameChange,
      onProfileChange: this.onProfileChange,
      showEditProfileDialog: (user) => this.showEditProfileDialog(user),
      refreshStorageInspector: () => this.refreshStorageInspector(),
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
    quickAnswerIncomingTagImpl(talkId, identityKeyFallback, checked, {
      emit: (event, payload) => this.emit(event, payload),
      showNotification: (message, type) => this.showNotification(message, type),
      t: (key) => this.t(key),
      quickCompleteTagTalk: (talk, checked) => this.quickCompleteTagTalk(talk, checked),
    });
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
    showTalkDetailImpl(talkId, identityKeyFallback, options, {
      emit: (event, payload) => this.emit(event, payload),
      showTalkResponseDialog: (talk, opts) => this.showTalkResponseDialog(talk, opts),
      showNotification: (message, type, opts) => this.showNotification(message, type, opts),
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
      showTalkDetail: (id, fallback, opts) => this.showTalkDetail(id, fallback, opts),
    });
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

  private conversationMedia(): ConversationMediaController {
    if (!this.conversationMediaController) {
      this.conversationMediaController = createConversationMediaController({
        getCurrentConversationId: () => this.currentConversationId,
        getCurrentThreadTalkId: () => this.currentThreadTalkId,
        getLastConversationMessages: () => this.lastConversationMessages,
        emit: (event, payload) => this.emit(event, payload),
        t: (key) => this.t(key),
        tf: (key, values) => this.tf(key, values),
        formatTalkRelativeTime: (date) => this.formatTalkRelativeTime(date),
      });
    }
    return this.conversationMediaController;
  }

  private conversationDetailViewDeps(): ConversationDetailViewDeps {
    const media = this.conversationMedia();
    return {
      getMyConversations: () => this.getMyConversations(),
      closeMediaGallery: () => media.closeMediaGallery(),
      getCurrentConversationId: () => this.currentConversationId,
      setCurrentConversationId: (conversationId) => { this.currentConversationId = conversationId; },
      getCurrentThreadTalkId: () => this.currentThreadTalkId,
      setCurrentThreadTalkId: (talkId) => { this.currentThreadTalkId = talkId; },
      captureSessionsByConversationId: this.captureSessionsByConversationId,
      currentUserId: this.currentUserId,
      getCurrentUserStageName: () => this.currentUser?.stageName || '',
      getPeerName: (userId, fallback) => this.getPeerName(userId, fallback),
      resolvePeerStageNameLive: (userId) => this.resolvePeerStageNameLive(userId),
      getMyTalks: () => this.getMyTalks(),
      t: (key) => this.t(key),
      formatTransportMode: (mode) => this.formatTransportMode(mode),
      formatTransportFallback: (mode, reason) => this.formatTransportFallback(mode, reason),
      formatLastHealthyContact: (time) => this.formatLastHealthyContact(time),
      updateMatchBadge: () => this.updateMatchBadge(),
      refreshOpenPeerThreadList: () => this.refreshOpenPeerThreadList(),
      allowOutgoingMessage: (message) => this.allowOutgoingMessage(message),
      confirmCapturedQuestionDialog: (captured) => this.confirmCapturedQuestionDialog(captured),
      emit: (event, payload) => this.emit(event, payload),
      bindCapturedQuestionChipDelegation: () => media.bindCapturedQuestionChipDelegation(),
      messageInCurrentThread: (message) => this.messageInCurrentThread(message),
      setLastConversationMessages: (messages) => { this.lastConversationMessages = messages; },
      parseIpfsSharePayload: parseIpfsSharePayloadImpl,
      renderIpfsAttachmentMessage: (share, isOwn, timestamp) => media.renderIpfsAttachmentMessage(share, isOwn, timestamp),
      renderCapturedQuestionMessage: (captured, isOwn, timestamp, messageId) => media.renderCapturedQuestionMessage(captured, isOwn, timestamp, messageId),
      shouldHideIncomingMessage: (message, senderId) => this.shouldHideIncomingMessage(message, senderId),
      hiddenMessageToastIds: this.hiddenMessageToastIds,
      formatTalkRelativeTime: (date) => this.formatTalkRelativeTime(date),
      showContentFilterToast: (result, direction) => this.showContentFilterToast(result, direction),
      hydrateAttachmentImages: (root) => media.hydrateAttachmentImages(root),
    };
  }

  showConversationDetail(conversationId: string, threadTalkId?: string): void {
    showConversationDetailImpl(conversationId, threadTalkId, this.conversationDetailViewDeps());
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
    updateChatroomInfoImpl(info, {
      setCurrentChatroom: (id) => { this.currentChatroom = id; },
      syncStatusBroadcastButtonVisibility: () => this.syncStatusBroadcastButtonVisibility(),
    });
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
    navigateToMyAnswerForTalkImpl(talkId);
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
    return getBroadcastableTalkIdsImpl();
  }

  /** OUT talks omitted from broadcast/peer send because they are disabled or expired. */
  getSenderOmittedBroadcastPreviews(): BroadcastAudiencePreview[] {
    return getSenderOmittedBroadcastPreviewsImpl();
  }

  /**
   * Full talk from OUT/myTalks when Gun `getTalk` is slow — bulk broadcast still needs a local payload.
   */
  getBroadcastTalkPayload(talkId: string): any | null {
    return getBroadcastTalkPayloadImpl(talkId);
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
    deleteMyTalkImpl(talkId, {
      displayTalksList: () => this.displayTalksList(),
      displayAnswersList: () => this.displayAnswersList(),
      showNotification: (message, type) => this.showNotification(message, type),
      t: (key) => this.t(key),
      emit: (event, payload) => this.emit(event, payload),
    });
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
    showLocationRoomSuggestionImpl(roomName, onJoin, {
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
    });
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
    this.peer().openUserConversationFirst(userId, stageName);
  }

  // Kept as a compatibility shim: focused E2E helpers invoke this private method dynamically.
  public openPeerDetailForUser(userId: string, stageName: string): void {
    this.peer().openPeerDetailForUser(userId, stageName);
  }

  private getKnownPeople(): KnownPerson[] { return this.peer().getKnownPeople(); }
  private getKnownPerson(userId: string): KnownPerson | undefined { return this.peer().getKnownPerson(userId); }
  private hasSupportContact(): boolean { return this.peer().hasSupportContact(); }
  private isTechSupportOnline(): boolean { return this.peer().isTechSupportOnline(); }

  public setTechSupportOnlineStatus(online: boolean): void {
    this.peer().setTechSupportOnlineStatus(online);
  }

  public isSupportNotificationsMuted(): boolean {
    return this.peer().isSupportNotificationsMuted();
  }

  // Kept as a compatibility shim: browser reputation helpers invoke it dynamically.
  public saveKnownPerson(
    userId: string,
    details: {
      labels: KnownPerson['labels'];
      nickname?: string;
      customLabel?: string;
      rating?: number;
      notes?: string;
    },
  ): Promise<void> {
    return this.peer().saveKnownPerson(userId, details);
  }

  private getPeerName(userId: string, fallbackName?: string): string {
    return this.peer().getPeerName(userId, fallbackName);
  }

  private resolvePeerStageNameLive(userId: string): Promise<string | null> {
    return this.peer().resolvePeerStageNameLive(userId);
  }

  private rememberPeerName(userId: string, stageName: string): void {
    this.peer().rememberPeerName(userId, stageName);
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
    this.conversationMedia().setSharedAttachmentResolver(fn);
  }

  /** app.ts calls this once a shared attachment's bytes finish downloading, so the image appears. */
  refreshOpenConversationForAttachment(): void {
    this.rerenderOpenConversation();
  }

  async displayConversationMessages(conversationId: string, messages: any[]): Promise<void> {
    return displayConversationMessagesImpl(conversationId, messages, this.conversationDetailViewDeps());
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

  private conversationListUpdatesDeps(): ConversationListUpdatesDeps {
    return {
      getMyConversations: () => this.getMyConversations(),
      getPeerName: (userId, fallback) => this.getPeerName(userId, fallback),
      updateMatchBadge: () => this.updateMatchBadge(),
      syncStatusBarMatchCount: () => this.syncStatusBarMatchCount(),
      emit: (event, payload) => this.emit(event, payload),
      getTotalMatches: () => this.getTotalMatches(),
      t: (key) => this.t(key),
      tf: (key, values) => this.tf(key, values),
      isSupportNotificationsMuted: () => this.isSupportNotificationsMuted(),
      showNotification: (message, type, options) => this.showNotification(message, type, options),
      displayContactsList: () => void this.displayContactsList(),
      displayConversationsList: () => this.displayConversationsList(),
      getCurrentConversationId: () => this.currentConversationId,
      getCurrentThreadTalkId: () => this.currentThreadTalkId,
      refreshOpenPeerThreadList: () => this.refreshOpenPeerThreadList(),
      lastNotifiedMessageIdByConversation: this.lastNotifiedMessageIdByConversation,
    };
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
    addNewConversationImpl(conversationData, this.conversationListUpdatesDeps());
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
    updateConversationMessageImpl(conversationId, message, timestamp, this.conversationListUpdatesDeps());
  }

  public syncConversationMessageSummary(conversationId: string, messages: any[], currentUserId: string): void {
    syncConversationMessageSummaryImpl(conversationId, messages, currentUserId, this.conversationListUpdatesDeps());
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
