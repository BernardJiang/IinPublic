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
import { formatTimeAgo, formatExpiration, formatLocationRadius, escapeHtml } from './ui-formatters';
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
import { BROADCAST_TAG_CATALOG_ENTRIES } from '../../shared/broadcast-tag-catalog';
import { TalkValidator, TalkAutofix } from '../../shared/talk-engine';
import { getFlatChatroomList, CHATROOM_HIERARCHY } from '../../shared/chatroom-hierarchy';
import type { StatsByRegion, StatsByTime, StatsSummary } from '../../shared/talk-stats';
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
  getChatbotEnabled,
  getChatbotTemplate as loadChatbotTemplate,
  getCopyTalkAutoSave,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setCopyTalkAutoSave,
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
import {
  filterIncomingTalkClusters,
  getTalkIntakeFilters,
  setTalkIntakeFilters,
} from './talk-intake-filters';
import { LocationPrivacy } from '../../shared/location';
import { normalizeCustomBlockedTerms } from '../../shared/talk-intake-filters';

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;
  private currentUser?: User;
  private currentChatroom: string = 'global';
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];
  private talksViewMode: 'all' | 'in' | 'out' = 'all';
  private apiBase: string = '';
  private currentUserId: string = '';
  private currentUserStageName: string = '';
  private currentLocation: GPSCoordinate | undefined = undefined;

  /** Resolves receiver ids merged with Gun for `POST /api/talks/broadcast-receiver-preview` (same chatroom only; set by `IinPublicApp`). */
  private broadcastAudiencePreviewCollector?:
    | ((args: {
        chatroomId: string;
        members: Array<{ userId: string; stageName: string }>;
      }) => Promise<string[]>)
    | undefined;

  /** Other users in the current chatroom detail view (excludes self); used for broadcast + server-side IN registration. */
  getCurrentChatroomMembers(): Array<{ userId: string; stageName: string }> {
    return [...this.currentChatroomMembers];
  }
  private currentConversationId: string | undefined = undefined;
  private chatroomMemberCounts: Map<string, number> = new Map(); // Track member count per chatroom
  private expandedChatrooms: Set<string> = new Set(['global']); // Track which chatrooms are expanded (default: global expanded)
  private matchedUserIds: Set<string> = new Set(); // Users who matched with me (for green indicator)
  // private newMatchesCount: number = 0; // TODO: implement match count tracking
  private talkStatsMap: Record<string, { responses: number; matches: number; ignores: number }> = {};
  private talksListDelegationBound = false;
  private incomingTalkClusters: any[] = [];
  private customChatrooms: CustomChatroomRow[] = [];
  private travelModeActive: boolean = false;
  private travelHomeChatroomId: string | undefined = undefined;
  private static readonly SURVEY_ANONYMITY_MIN_COUNT = 3;

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
  }

  setBroadcastAudiencePreviewCollector(
    fn:
      | ((
          args: {
            chatroomId: string;
            members: Array<{ userId: string; stageName: string }>;
          },
        ) => Promise<string[]>)
      | undefined,
  ): void {
    this.broadcastAudiencePreviewCollector = fn;
  }

  setCustomChatroomsFromServer(rows: CustomChatroomRow[]): void {
    this.customChatrooms = Array.isArray(rows) ? [...rows] : [];
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
        '<p style="font-size:0.85em;color:#6b7280;margin:0;">Connect to the app server to load broadcast tag trends.</p>';
      return;
    }
    host.innerHTML = '<p style="font-size:0.85em;color:#6b7280;margin:0;">Loading…</p>';
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
          '<p style="font-size:0.85em;color:#6b7280;margin:0;">No broadcast targeting data yet. Bulk sends with preamble tags populate this view.</p>';
        return;
      }
      const top = tags.slice(0, 8);
      const head =
        '<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Tag</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Window</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Daily (UTC)</th></tr>';
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
        <p style="font-size:0.82em;color:#6b7280;margin:0 0 10px 0;">Rolling UTC day buckets for broadcast preamble tags (interest targeting).</p>
        <div style="overflow:auto;max-width:100%;">
          <table style="width:100%;border-collapse:collapse;font-size:0.88em;">${head}${rows}</table>
        </div>`;
    } catch {
      host.innerHTML =
        '<p style="font-size:0.85em;color:#b45309;margin:0;">Could not load broadcast tag trends.</p>';
    }
  }

  /**
   * Before bulk broadcast: confirm blurred location summary, optional max recipient distance cap,
   * and choose ≥1 targeting tag(s). Tags intersect receivers' interests server-side
   * (`register-receivers-for-broadcast`). Delivery is **this chatroom only** (never descendant hierarchy rooms).
   */
  showBroadcastTagPreamble(ctx: {
    chatroomId: string;
    members: Array<{ userId: string; stageName: string }>;
  }): Promise<{
    tags: string[];
    broadcastMaxDistanceMiles?: number;
  } | null> {
    return this.openBroadcastTagPreambleModal(ctx);
  }

  private async openBroadcastTagPreambleModal(ctx: {
    chatroomId: string;
    members: Array<{ userId: string; stageName: string }>;
  }): Promise<{
    tags: string[];
    broadcastMaxDistanceMiles?: number;
  } | null> {
    let orderedEntries = [...BROADCAST_TAG_CATALOG_ENTRIES];
    const base = (this.apiBase || '').trim();
    if (base) {
      try {
        const c = new AbortController();
        const tid = window.setTimeout(() => c.abort(), 2500);
        try {
          const res = await fetch(`${base}/api/stats/broadcast-tags`, { signal: c.signal });
          if (res.ok) {
            const body = (await res.json()) as { tags?: Array<{ id?: string; count?: number }> };
            const rows = Array.isArray(body.tags) ? body.tags : [];
            const countById = new Map<string, number>();
            for (const row of rows) {
              const id = String(row?.id || '').trim();
              if (!id) continue;
              countById.set(id, Math.max(0, Math.floor(Number(row?.count ?? 0))) || 0);
            }
            orderedEntries.sort(
              (a, b) =>
                (countById.get(b.id) ?? 0) - (countById.get(a.id) ?? 0) || a.label.localeCompare(b.label),
            );
          }
        } finally {
          window.clearTimeout(tid);
        }
      } catch {
        /* fallback: static catalog order */
      }
    }

    const blurred = this.currentLocation
      ? LocationPrivacy.blurLocation(this.currentLocation)
      : null;
    const regionPhrase =
      (blurred?.region?.trim()?.length ?? 0) > 0
        ? blurred!.region!.trim()
        : 'unknown (enable location for distance rules)';
    const regionHtml = `<strong>Approximate broadcast region:</strong> ${escapeHtml(regionPhrase)}`;

    const distanceOptionsHtml = ['', '5', '10', '25', '50', '100', '250', '500']
      .map((mi) =>
        mi === ''
          ? '<option value="">No distance limit</option>'
          : `<option value="${mi}">${mi} mi</option>`,
      )
      .join('');

    const chipButtonsHtml = orderedEntries
      .map((e) => `<button type="button" class="btn broadcast-chip" style="font-size:0.85em;">${escapeHtml(e.label)}</button>`)
      .join('');

    return await new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.setAttribute('data-testid', 'broadcast-preamble-modal');
      modal.innerHTML = `
        <div class="modal-content" style="max-width:460px;">
          <div class="modal-header">
            <h2 class="modal-title">Before you broadcast</h2>
            <p style="color:#444;font-size:0.92em;line-height:1.35;margin-top:6px;">
              Receivers with profile interests must share at least one selected tag or a tag on each talk (recipients without interests remain eligible).
            </p>
            <p style="margin-top:10px;font-size:0.88em;color:#374151;line-height:1.35;">
              ${regionHtml}
            </p>
          </div>
          <div style="padding:12px 20px 0;font-size:0.82em;line-height:1.4;color:#475569;font-style:italic;">
            Reach is limited to others in this same chatroom (not sub-rooms under it in the list).
          </div>
          <div style="padding:12px 20px 0;font-size:0.85em;line-height:1.45;color:#334155;">
            <div style="margin-top:0;">
              <label for="broadcast-max-distance-select" style="display:block;margin-bottom:4px;">Max receiver distance (from sender / talk pin)</label>
              <select id="broadcast-max-distance-select" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #cbd5e1;">
                ${distanceOptionsHtml}
              </select>
            </div>
            <p data-testid="broadcast-audience-preview" style="margin-top:10px;color:#4338ca;font-size:0.92em;line-height:1.35;min-height:1.35em;"></p>
          </div>
          <div style="padding:8px 20px 0;font-size:0.82em;color:#64748b;">Pick at least one tag (popular choices listed first)</div>
          <div id="broadcast-preamble-chips" style="padding:12px 20px; display:flex; flex-wrap:wrap; gap:8px; max-height:220px; overflow-y:auto;">
            ${chipButtonsHtml}
          </div>
          <div class="modal-actions" style="margin-top:8px;">
            <button type="button" class="btn" id="broadcast-preamble-cancel" style="background:#6c757d;">Cancel</button>
            <button type="button" class="btn primary-btn" id="broadcast-preamble-send" data-testid="broadcast-preamble-send">Broadcast</button>
          </div>
        </div>`;

      document.body.appendChild(modal);

      const selected = new Set<string>();
      let previewGeneration = 0;
      let previewDebounceTimer: number | undefined;

      const readMaxDistance = (): number | undefined => {
        const sel = modal.querySelector('#broadcast-max-distance-select') as HTMLSelectElement | null;
        const v = sel?.value ?? '';
        if (v === '') return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      const scheduleAudiencePreviewRefresh = (): void => {
        if (previewDebounceTimer !== undefined) window.clearTimeout(previewDebounceTimer);
        previewDebounceTimer = window.setTimeout(() => void runAudiencePreviewRefresh(), 400);
      };

      const runAudiencePreviewRefresh = async (): Promise<void> => {
        const previewEl = modal.querySelector('[data-testid="broadcast-audience-preview"]');
        if (!(previewEl instanceof HTMLElement)) return;
        const seq = ++previewGeneration;
        const senderId = (this.currentUserId || '').trim();
        const base = (this.apiBase || '').trim();
        const firstBid = this.getBroadcastableTalkIds()[0];
        const fp = firstBid ? this.getBroadcastTalkPayload(firstBid) : null;
        const broadcastMaxDistanceMiles = readMaxDistance();

        let receiverIds = ctx.members.map((m) => m.userId).filter((id) => id && id !== senderId);
        if (this.broadcastAudiencePreviewCollector) {
          try {
            receiverIds = await this.broadcastAudiencePreviewCollector({
              chatroomId: ctx.chatroomId,
              members: ctx.members,
            });
          } catch {
            /* keep primary-room ids */
          }
        }

        if (!senderId || !fp || !base) {
          if (seq === previewGeneration) previewEl.textContent = '';
          return;
        }

        previewEl.textContent = 'Estimating audience…';

        try {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 8000);
          const res = await fetch(`${base}/api/talks/broadcast-receiver-preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              senderId,
              receiverIds,
              talkId: fp.id,
              talkData: fp,
              broadcastTargetTags: Array.from(selected.values()),
              broadcastMaxDistanceMiles,
            }),
          }).finally(() => window.clearTimeout(timeoutId));
          if (seq !== previewGeneration) return;
          if (!res.ok) {
            previewEl.textContent = 'Could not estimate audience (server error).';
            return;
          }
          const body = (await res.json()) as {
            totalCandidates?: number;
            eligibleReceivers?: number;
          };
          const pool = typeof body.totalCandidates === 'number' ? body.totalCandidates : receiverIds.length;
          const elig = typeof body.eligibleReceivers === 'number' ? body.eligibleReceivers : 0;
          previewEl.textContent = `Audience pool ~${pool} users; after intake & filters ~${elig} likely receive the talk here.`;
        } catch {
          if (seq === previewGeneration) previewEl.textContent = '';
        }
      };

      const chipWrap = modal.querySelector('#broadcast-preamble-chips');
      chipWrap?.querySelectorAll('.broadcast-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          const label = String((btn as HTMLButtonElement).textContent || '').trim();
          if (!label) return;
          const el = btn as HTMLElement;
          if (selected.has(label)) {
            selected.delete(label);
            el.style.boxShadow = 'none';
            el.style.background = '';
          } else {
            selected.add(label);
            el.style.boxShadow = 'inset 0 0 0 2px #6366f1';
            el.style.background = '#eef2ff';
          }
          scheduleAudiencePreviewRefresh();
        });
      });

      modal.querySelector('#broadcast-max-distance-select')?.addEventListener('change', scheduleAudiencePreviewRefresh);

      const cleanup = () => {
        if (previewDebounceTimer !== undefined) window.clearTimeout(previewDebounceTimer);
        document.body.removeChild(modal);
      };

      modal.querySelector('#broadcast-preamble-cancel')?.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(null);
        }
      });
      modal.querySelector('#broadcast-preamble-send')?.addEventListener('click', () => {
        const tags = Array.from(selected.values());
        if (tags.length < 1) {
          this.showNotification('Choose at least one tag before broadcasting.', 'warning');
          return;
        }
        const maxDm = readMaxDistance();
        cleanup();
        resolve({
          tags,
          ...(typeof maxDm === 'number' ? { broadcastMaxDistanceMiles: maxDm } : {}),
        });
      });

      window.setTimeout(() => void runAudiencePreviewRefresh(), 0);
    });
  }

  private getMyTalks(): Record<string, any> {
    return getMyTalks();
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
          <div class="header-title" id="header-title">Chatrooms</div>
          <div class="header-user-info" id="header-user-info" style="display: none;"></div>
          <div class="header-actions" id="header-actions">
            <button class="header-btn" id="create-talk-btn">➕</button>
          </div>
        </div>

        <!-- Main View Container -->
        <div class="view-container">
          
          <!-- Chatrooms View (Default) -->
          <div class="view-panel active" id="chatrooms-view">
            <!-- Status Bar (Always visible, shows current user and chatroom info) -->
            <div class="status-bar" id="status-bar">
              <div class="status-bar-content">
                <span id="status-bar-text">Connecting...</span>
                <span id="broadcast-bulk-ack" data-testid="broadcast-bulk-ack" hidden></span>
              </div>
              <div class="status-bar-actions" id="status-bar-actions" style="display: none;">
                <button type="button" class="btn status-broadcast-btn" id="broadcast-talk-btn" title="Send every talk in your OUT list to everyone in this chatroom">
                  📢 Broadcast to everyone in this room
                </button>
                <p class="status-broadcast-hint" id="status-broadcast-hint">Uses talks from <strong>Talks</strong> (your OUT list). Create or copy a talk there first, then broadcast.</p>
              </div>
            </div>
            
            <!-- Chatroom List -->
            <div class="chatroom-list-container" id="chatroom-list-container">
              <div class="chatroom-list-toolbar" style="padding: 8px 12px; border-bottom: 1px solid #eee; display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" class="btn" id="create-custom-chatroom-btn" data-testid="create-custom-chatroom-btn">➕ New room</button>
                <button type="button" class="btn" id="toggle-travel-mode-btn" data-testid="toggle-travel-mode-btn">🧳 Travel mode</button>
                <button type="button" class="btn" id="return-home-btn" data-testid="return-home-btn" style="display:none;">🏠 Return home</button>
              </div>
              <div class="chatroom-list" id="chatroom-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading chatrooms...</p>
              </div>
            </div>

            <!-- Chatroom Detail (Hidden by default) -->
            <div class="chatroom-detail-container" id="chatroom-detail-container" style="display: none;">
              <div class="chatroom-detail-header">
                <button class="back-btn" id="back-to-chatrooms">‹ Back</button>
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
              <div class="contacts-list-container" id="contacts-list-container">
                <div class="contacts-list" id="contacts-list">
                  <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Match with others via Talks to see them here.</p>
                </div>
              </div>
              <!-- Contact detail: list of talks with this user (hidden by default) -->
              <div class="contact-detail-container" id="contact-detail-container" style="display: none;">
                <div class="contact-detail-header">
                  <button class="back-btn" id="back-to-contacts-list">‹ Back</button>
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
              <div class="talks-header">
                <button class="btn create-talk-btn" id="create-talk-btn-talks">
                  ➕ Create New Talk
                </button>
              </div>
              <div class="talks-nav-bar" id="talks-nav-bar">
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
              </div>
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
                  <div class="peer-section-title" style="font-weight:700;padding:12px 16px 4px;">Talk History</div>
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
                    <span>Auto mode — send all new talks automatically</span>
                  </label>
                  <div style="padding:8px 16px 16px;">
                    <button class="btn primary-btn" id="peer-send-talks-btn" style="width:100%;">📤 Send My Talks</button>
                    <button class="btn" id="peer-block-user-btn" style="width:100%;margin-top:8px;">Block User</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Answers View -->
          <div class="view-panel" id="answers-view">
            <div class="view-content" id="answers-content">
              <div style="padding: 20px; text-align: center; color: #999;">
                <p>Your answered questions will appear here.</p>
                <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">
                  View My Answers
                </button>
              </div>
            </div>
          </div>

          <!-- Me View -->
          <div class="view-panel" id="me-view">
            <div class="view-content">
              <div class="user-profile">
                <div class="user-info" id="user-info-me"></div>
                <div class="profile-actions">
                  <button class="profile-btn" id="view-my-talks-btn">
                    📋 My Talks
                  </button>
                  <button class="profile-btn" id="my-answers-btn">
                    📝 My Answers
                  </button>
                </div>
              </div>
              <div class="conversations-section" style="margin-top: 24px;">
                <h3 style="font-size: 1em; margin-bottom: 12px; color: #666;">Conversations</h3>
                <div id="conversations-list"></div>
              </div>
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
          <button class="nav-btn" data-view="answers">
            <div class="nav-icon">📝</div>
            <div class="nav-label">Answers</div>
          </button>
          <button class="nav-btn" data-view="me" data-testid="bottom-navigation-button-me">
            <div class="nav-icon">👤</div>
            <div class="nav-label">Me</div>
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

    // Create talk button in Talks view
    const createTalkBtnTalks = document.getElementById('create-talk-btn-talks');
    if (createTalkBtnTalks) {
      createTalkBtnTalks.addEventListener('click', () => {
        this.showTalkEditorDialog();
      });
    }

    const viewMyTalksBtn = document.getElementById('view-my-talks-btn');
    if (viewMyTalksBtn) {
      viewMyTalksBtn.addEventListener('click', () => {
        this.showMyTalksDialog();
      });
    }

    const viewPreferencesBtn = document.getElementById('view-preferences-btn');
    if (viewPreferencesBtn) {
      viewPreferencesBtn.addEventListener('click', () => {
        this.showPreferencesDialog();
      });
    }

    const myAnswersBtn = document.getElementById('my-answers-btn');
    if (myAnswersBtn) {
      myAnswersBtn.addEventListener('click', () => {
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

    const createCustomRoomBtn = document.getElementById('create-custom-chatroom-btn');
    if (createCustomRoomBtn) {
      createCustomRoomBtn.addEventListener('click', () => {
        void this.handleCreateCustomChatroomClick();
      });
    }

    const travelToggleBtn = document.getElementById('toggle-travel-mode-btn');
    if (travelToggleBtn) {
      travelToggleBtn.addEventListener('click', () => {
        this.emit('toggleTravelMode', {});
      });
    }

    const returnHomeBtn = document.getElementById('return-home-btn');
    if (returnHomeBtn) {
      returnHomeBtn.addEventListener('click', () => {
        this.emit('returnHomeFromTravel', {});
      });
    }

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

    const preamble = await this.showBroadcastTagPreamble({
      chatroomId: this.currentChatroom,
      members,
    });
    if (!preamble) return;

    this.emit('broadcastTalk', {
      chatroomId: this.currentChatroom,
      members,
      broadcastTargetTags: preamble.tags,
      broadcastMaxDistanceMiles: preamble.broadcastMaxDistanceMiles,
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
          const titles: Record<string, string> = {
            chatrooms: 'Chatrooms',
            contacts: 'Contacts',
            talks: 'Talks',
            answers: 'My Answers',
            me: 'Me',
          };
          headerTitle.textContent = titles[targetView] || 'IinPublic';
        }

        // Show/hide create talk button based on view
        if (headerActions) {
          if (targetView === 'chatrooms' || targetView === 'talks') {
            headerActions.style.display = 'block';
          } else {
            headerActions.style.display = 'none';
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
        }

        // Special handling for talks view
        if (targetView === 'talks') {
          this.emit('needIncomingTalkClusters');
          this.displayTalksList();
        }

        // Special handling for answers view: show answered talks with match/mismatch
        if (targetView === 'answers') {
          this.displayAnswersList();
        }

        // Special handling for me view: refresh conversations list and request a source sync.
        if (targetView === 'me') {
          this.emit('needConversationSync');
          this.displayConversationsList();
        }
      });
    });
  }

  /**
   * Point session state at the app's current `User` reference after server-backed updates
   * (e.g. block/unblock) so `isBlockedByMe` is not stale on a divergent object.
   */
  adoptSessionUser(user: User): void {
    this.currentUser = user;
    this.currentUserId = user.id;
    this.currentUserStageName = user.stageName;
  }

  showMainInterface(user: User): void {
    this.currentUser = user;
    this.currentUserId = user.id;
    this.currentUserStageName = user.stageName;
    // Update header with user's stageName
    const headerUserInfo = document.getElementById('header-user-info');
    if (headerUserInfo) {
      headerUserInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="user-avatar" style="width: 32px; height: 32px; font-size: 0.9em;">
            ${user.stageName.charAt(0).toUpperCase()}
          </div>
          <div style="font-size: 0.95em; font-weight: 500; color: white;" data-testid="user-stage-name">${user.stageName}</div>
        </div>
      `;
      headerUserInfo.style.display = 'block';
    }

    // Update user info in Me view
    const userInfoMe = document.getElementById('user-info-me');
    if (userInfoMe) {
      const copyTalkChecked = getCopyTalkAutoSave();
      const talkFilters = user.talkFilters || {
        ...getTalkIntakeFilters(),
        allowedLanguages: Array.isArray(user.languages) && user.languages.length > 0 ? user.languages : ['en'],
      };
      setTalkIntakeFilters(talkFilters);
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
              const visNote =
                vis === 'public'
                  ? ''
                  : `<div style="font-size:0.72em;color:#64748b;margin-top:2px;">${escapeHtml(PROFILE_VISIBILITY_LABELS[vis])}</div>`;
              return `<div style="padding:8px 10px;border-radius:10px;background:white;border:1px solid #e5e7eb;"><div style="font-size:0.78em;color:#64748b;">${escapeHtml(qa.question)}</div>${visNote}<div style="font-size:0.92em;font-weight:600;color:#111827;margin-top:2px;">${escapeHtml(qa.answer)}</div></div>`;
            })
            .join('')
        : '<div style="font-size:0.88em;color:#6b7280;">No public profile attributes yet.</div>';
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
          ${escapeHtml(headshot || user.stageName.charAt(0).toUpperCase())}
        </div>
        <div style="text-align: center; margin-top: 10px;">
          <div style="font-size: 1.2em; font-weight: 600;">${user.stageName}</div>
          <div style="font-size: 0.9em; color: #999; margin-top: 5px;">Online</div>
          <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap; margin-top:10px;">
            <button class="btn" id="edit-stagename-btn" data-testid="edit-stage-name-button">Edit Stage Name</button>
            <button class="btn" id="edit-profile-btn" data-testid="edit-profile-button">Edit Profile</button>
          </div>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #ffffff; border-radius: 12px; text-align: left; border:1px solid #e5e7eb;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;">
            <div style="font-weight:700; color:#111827;">Profile</div>
            <div style="font-size:0.82em; color:#6b7280;">Visibility per Q&amp;A (see Edit Profile)</div>
          </div>
          <div style="font-size:0.88em; color:#374151; margin-bottom:10px;">
            Languages: ${escapeHtml((Array.isArray(user.languages) && user.languages.length > 0 ? user.languages.join(', ') : 'en'))}
          </div>
          <div style="font-size:0.88em; color:#374151; margin-bottom:10px;">
            Interests: ${
              interestNames.length > 0
                ? escapeHtml(interestNames.join(', '))
                : '<span style="color:#94a3b8;">Add in Edit Profile</span>'
            }
          </div>
          <div style="display:grid; gap:8px;">
            ${profilePreview}
          </div>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 12px; text-align: left;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.95em;">
            <input type="checkbox" id="copy-talk-autosave-checkbox" ${copyTalkChecked ? 'checked' : ''}>
            <span>Auto-save received talks (copy talk)</span>
          </label>
          <p style="margin: 8px 0 0 28px; font-size: 0.85em; color: #6b7280;">When off, received talks are not saved to My Talks.</p>
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.95em; margin-top: 14px;">
            <input type="checkbox" id="chatbot-enabled-checkbox" ${getChatbotEnabled() ? 'checked' : ''}>
            <span>Enable chatbot (auto-reply with previous match answers)</span>
          </label>
          <p style="margin: 8px 0 0 28px; font-size: 0.85em; color: #6b7280;">When the same talk is sent to you again, reply automatically with your last match answer. Replies show a bot icon.</p>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 12px; text-align: left;">
          <div style="font-weight: 700; color: #111827; margin-bottom: 12px;">Talk Filters</div>
          <div style="display:grid; gap: 12px;">
            <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
              <label style="display:flex; flex-direction:column; gap:4px; font-size:0.9em;">
                <span>Min distance (miles)</span>
                <input type="number" id="talk-filter-min-distance" min="0" step="1" value="${talkFilters.minDistanceMiles ?? ''}" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
              </label>
              <label style="display:flex; flex-direction:column; gap:4px; font-size:0.9em;">
                <span>Max distance (miles)</span>
                <input type="number" id="talk-filter-max-distance" min="0" step="1" value="${talkFilters.maxDistanceMiles ?? ''}" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
              </label>
            </div>
            <label style="display:flex; flex-direction:column; gap:4px; font-size:0.9em;">
              <span>Ignore talks sent before</span>
              <input type="datetime-local" id="talk-filter-sent-after" value="${talkFilters.sentAfter ? new Date(talkFilters.sentAfter).toISOString().slice(0, 16) : ''}" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
            </label>
            <label style="display:flex; flex-direction:column; gap:4px; font-size:0.9em;">
              <span>Allowed languages (comma separated)</span>
              <input type="text" id="talk-filter-languages" value="${escapeHtml(talkFilters.allowedLanguages.join(', '))}" placeholder="en, zh" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
            </label>
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
              <label style="display:flex; align-items:center; gap:8px; font-size:0.9em;">
                <input type="checkbox" id="talk-filter-grammar" ${talkFilters.requireGoodGrammar ? 'checked' : ''}>
                <span>Ignore grammar errors</span>
              </label>
              <label style="display:flex; align-items:center; gap:8px; font-size:0.9em;">
                <input type="checkbox" id="talk-filter-dirty-words" ${talkFilters.blockDirtyWords ? 'checked' : ''}>
                <span>Ignore dirty words</span>
              </label>
            </div>
            <div>
              <div style="font-size:0.9em; margin-bottom:6px;">Allowed talk types</div>
              <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${(['tag', 'flow', 'route', 'survey'] as const)
                  .map(
                    (type) => `
                      <label style="display:flex; align-items:center; gap:6px; font-size:0.9em; padding:6px 10px; border:1px solid #d1d5db; border-radius:999px; background:white;">
                        <input type="checkbox" class="talk-filter-type" value="${type}" ${talkFilters.allowedTalkTypes.includes(type) ? 'checked' : ''}>
                        <span>${type}</span>
                      </label>
                    `,
                  )
                  .join('')}
              </div>
            </div>
            <label style="display:flex; flex-direction:column; gap:4px; font-size:0.9em;">
              <span>Custom blocked phrases (optional)</span>
              <textarea id="talk-filter-custom-blocked" rows="3" placeholder="Comma or lines, e.g. wire transfer, prize winner" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;font-family:inherit;resize:vertical;">${escapeHtml((talkFilters.customBlockedTerms ?? []).join(', '))}</textarea>
            </label>
          </div>
          <p style="margin: 10px 0 0 0; font-size: 0.82em; color: #6b7280;">These filters hide incoming talks that do not match your current intake rules.</p>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #f0fdf4; border-radius: 12px; text-align: left; border:1px solid #bbf7d0;">
          <div style="font-weight: 700; color: #111827; margin-bottom: 8px;">Broadcast tag trends</div>
          <div id="me-broadcast-tag-trends" data-testid="me-broadcast-tag-trends"></div>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #fff7ed; border-radius: 12px; text-align: left;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
            <div>
              <div style="font-weight: 700; color: #111827;">Credit</div>
              <div style="font-size: 0.82em; color: #6b7280;">Read-only reputation summary from other users' interactions.</div>
            </div>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85em;">
              <input type="checkbox" id="credit-visibility-checkbox" ${isCreditVisible ? 'checked' : ''}>
              <span>Show to others</span>
            </label>
          </div>
          <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">Reviews</div><div style="font-size:1.15em;font-weight:700;">${reviewCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">Star rating</div><div style="font-size:1.15em;font-weight:700;">${starRating.toFixed(1)}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">Friends</div><div style="font-size:1.15em;font-weight:700;">${friendsCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">Liked</div><div style="font-size:1.15em;font-weight:700;">${likedCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">Disliked</div><div style="font-size:1.15em;font-weight:700;">${dislikedCount}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;"><div style="font-size:0.78em;color:#9a3412;">Matches</div><div style="font-size:1.15em;font-weight:700;">${matchesFound}</div></div>
            <div style="padding:10px;border-radius:10px;background:white;border:1px solid #fed7aa;grid-column:span 2;"><div style="font-size:0.78em;color:#9a3412;">Age verified</div><div style="font-size:1.15em;font-weight:700;">${ageVerified ? '✓ 18+' : '—'}</div></div>
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
      const copyTalkCheckbox = document.getElementById('copy-talk-autosave-checkbox') as HTMLInputElement;
      if (copyTalkCheckbox) {
        copyTalkCheckbox.addEventListener('change', () => {
          setCopyTalkAutoSave(copyTalkCheckbox.checked);
        });
      }
      const chatbotCheckbox = document.getElementById('chatbot-enabled-checkbox') as HTMLInputElement;
      if (chatbotCheckbox) {
        chatbotCheckbox.addEventListener('change', () => {
          setChatbotEnabled(chatbotCheckbox.checked);
        });
      }
      const syncTalkFilters = () => {
        const minDistanceEl = document.getElementById('talk-filter-min-distance') as HTMLInputElement | null;
        const maxDistanceEl = document.getElementById('talk-filter-max-distance') as HTMLInputElement | null;
        const sentAfterEl = document.getElementById('talk-filter-sent-after') as HTMLInputElement | null;
        const languagesEl = document.getElementById('talk-filter-languages') as HTMLInputElement | null;
        const grammarEl = document.getElementById('talk-filter-grammar') as HTMLInputElement | null;
        const dirtyEl = document.getElementById('talk-filter-dirty-words') as HTMLInputElement | null;
        const typeEls = Array.from(document.querySelectorAll('.talk-filter-type')) as HTMLInputElement[];
        const customBlockedEl = document.getElementById('talk-filter-custom-blocked') as HTMLTextAreaElement | null;
        const customParts = (customBlockedEl?.value ?? '')
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const nextFilters: TalkIntakeFilters = {
          allowedLanguages: (languagesEl?.value || 'en')
            .split(',')
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean),
          requireGoodGrammar: !!grammarEl?.checked,
          blockDirtyWords: !!dirtyEl?.checked,
          allowedTalkTypes: typeEls.filter((el) => el.checked).map((el) => el.value as any),
          customBlockedTerms: normalizeCustomBlockedTerms(customParts),
        };
        if (minDistanceEl && minDistanceEl.value !== '') {
          nextFilters.minDistanceMiles = Number(minDistanceEl.value);
        }
        if (maxDistanceEl && maxDistanceEl.value !== '') {
          nextFilters.maxDistanceMiles = Number(maxDistanceEl.value);
        }
        if (sentAfterEl?.value) {
          nextFilters.sentAfter = new Date(sentAfterEl.value).toISOString();
        }
        if (nextFilters.allowedTalkTypes.length === 0) {
          nextFilters.allowedTalkTypes = ['flow', 'survey', 'tag', 'route'];
        }
        if (nextFilters.allowedLanguages.length === 0) {
          nextFilters.allowedLanguages = ['en'];
        }
        setTalkIntakeFilters(nextFilters);
        if (this.currentUser) this.currentUser.talkFilters = nextFilters;
        this.emit('updateTalkFilters', nextFilters);
        const talksView = document.getElementById('talks-view');
        if (talksView?.classList.contains('active')) this.displayTalksList();
      };
      [
        'talk-filter-min-distance',
        'talk-filter-max-distance',
        'talk-filter-sent-after',
        'talk-filter-languages',
        'talk-filter-grammar',
        'talk-filter-dirty-words',
      ].forEach((id) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        el?.addEventListener('change', syncTalkFilters);
      });
      document.getElementById('talk-filter-custom-blocked')?.addEventListener('input', syncTalkFilters);
      document.querySelectorAll('.talk-filter-type').forEach((el) => {
        el.addEventListener('change', syncTalkFilters);
      });
      const creditVisibilityCheckbox = document.getElementById('credit-visibility-checkbox') as HTMLInputElement | null;
      if (creditVisibilityCheckbox) {
        creditVisibilityCheckbox.addEventListener('change', () => {
          if (this.currentUser) this.currentUser.reputation.isHidden = !creditVisibilityCheckbox.checked;
          this.emit('setCreditVisibility', { visible: creditVisibilityCheckbox.checked });
        });
      }
    }

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

    const ownerBar = document.getElementById('chatroom-owner-bar');
    if (ownerBar) {
      ownerBar.style.display = 'none';
      ownerBar.innerHTML = '';
    }

    // Update header
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = 'Chatrooms';

    // Render the chatroom list
    this.renderChatroomList();
  }

  setTravelModeState(state: { active: boolean; homeChatroomId?: string }): void {
    this.travelModeActive = !!state.active;
    this.travelHomeChatroomId = state.homeChatroomId;
    const travelBtn = document.getElementById('toggle-travel-mode-btn');
    if (travelBtn) {
      travelBtn.textContent = this.travelModeActive ? '🧳 Travelling' : '🧳 Travel mode';
      travelBtn.classList.toggle('primary-btn', this.travelModeActive);
    }
    const homeBtn = document.getElementById('return-home-btn');
    if (homeBtn) {
      homeBtn.style.display = this.travelModeActive ? 'inline-flex' : 'none';
    }
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
      },
      otherUserId,
      otherUserName,
    );
  }

  private chatroomsDeps(): Parameters<typeof renderChatrooms>[0] {
    return {
      currentChatroom: this.currentChatroom,
      chatroomMemberCounts: this.chatroomMemberCounts,
      expandedChatrooms: this.expandedChatrooms,
      matchedUserIds: this.matchedUserIds,
      customChatrooms: this.customChatrooms,
      setCurrentChatroom: (chatroomId) => { this.currentChatroom = chatroomId; },
      setCurrentChatroomMembers: (members) => { this.currentChatroomMembers = members; },
      escapeHtml: escapeHtml,
      renderChatroomList: this.renderChatroomList.bind(this),
      openPeerDetail: this.openPeerDetailForUser.bind(this),
      emit: (eventName, payload) => this.emit(eventName, payload),
      currentUserId: this.currentUserId,
      apiBase: this.apiBase,
    };
  }

  private async handleCreateCustomChatroomClick(): Promise<void> {
    if (!this.currentUserId) {
      this.showNotification('Sign in required to create a room.', 'error');
      return;
    }
    const payload = await this.showCreateCustomChatroomDialog();
    if (payload) {
      this.emit('createCustomChatroom', payload);
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
  }

  /**
   * Programmatic room switches (outside the Chatrooms detail click path) still need
   * the chatroom list highlight to stay in sync.
   */
  setCurrentChatroomId(chatroomId: string): void {
    if (!chatroomId) return;
    this.currentChatroom = chatroomId;
    this.renderChatroomList();
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
          const editBtn = target.closest('.edit-talk-btn');
          if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = (editBtn as HTMLElement).dataset.talkId;
            if (talkId) {
              // Always open the talk editor when Edit is clicked (never open response flow here)
              setTimeout(() => this.emit('loadTalkForEdit', { talkId }), 0);
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
          const label = target.closest('.talk-disable-broadcast-label');
          const checkbox = target.closest('.talk-disable-broadcast-checkbox') as HTMLInputElement | null;
          const control = checkbox ?? (label ? label.querySelector('.talk-disable-broadcast-checkbox') : null) as HTMLInputElement | null;
          if (control && control.dataset) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = control.dataset.talkId;
            if (talkId) {
              control.checked = !control.checked;
              const disabled = control.checked;
              setTimeout(() => {
                this.setTalkDisabled(talkId, disabled);
                this.showNotification(disabled ? 'Talk disabled for broadcast' : 'Talk enabled for broadcast', 'success');
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
    const outEntries = allEntries.filter(([, t]: [string, any]) => t.role === 'created' || t.role === 'copied');
    // IN: backend-consolidated incoming talks (content-hash merged)
    const rawIncomingEntries = (this.incomingTalkClusters || []).filter((c: any) => c && c.identityKey);
    const incomingFilterResult = filterIncomingTalkClusters(
      rawIncomingEntries,
      this.currentUser?.talkFilters || getTalkIntakeFilters(),
      this.currentLocation,
    );
    const backendInEntries = incomingFilterResult.visible;
    const inEntries = backendInEntries;
    const talksNavBack = document.getElementById('talks-nav-back');
    const activeMode = this.talksViewMode;

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
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">No talks yet</p>
          <p style="font-size: 0.9em; color: #999;">Create your first talk or wait for talks from others.</p>
        </div>
      `;
    } else {
      const outHtml =
        outEntries.length > 0
          ? outEntries
              .map(
                ([talkId, talk]) => {
                  const stats = this.talkStatsMap[talkId];
                  const statsLine = stats
                    ? `Responses: ${stats.responses} · Matches: ${stats.matches} · Ignores: ${stats.ignores}`
                    : '—';
                  const conversations = this.getMyConversations();
                  const matchedNames = Object.values(conversations)
                    .filter((c: any) => c.talkId === talkId)
                    .map((c: any) => c.respondedByBot ? `${c.otherUserName} 🤖` : c.otherUserName);
                  const matchedLine =
                    matchedNames.length > 0
                      ? `<div class="talk-item-matched" style="font-size: 0.85em; color: #2e7d32; margin-top: 4px;">Matched with: ${matchedNames.join(', ')}</div>`
                      : '';
                  const disabled = !!talk.disabled;
                  const expText = formatExpiration(talk.expiresAt);
                  const locText = formatLocationRadius(talk.locationRadiusMiles);
                  const roleBadge = talk.role === 'copied'
                    ? '<span class="talk-badge talk-badge-copied" style="background:#e0e7ff;color:#3730a3;">📋 Copied</span>'
                    : '<span class="talk-badge talk-badge-created" style="background:#dbeafe;color:#1e40af;">📝 Created</span>';
                  const talkTypeLower = String(talk.type || talk.fullTalk?.type || '').toLowerCase();
                  const surveyStatsBtn =
                    talkTypeLower === 'survey'
                      ? `<button type="button" class="btn survey-stats-btn" data-talk-id="${escapeHtml(talkId)}" data-testid="survey-stats-button" style="padding: 6px 12px; font-size: 0.9em; background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;">📊 Results</button>`
                      : '';
                  return `
        <div class="talk-list-item" data-talk-id="${talkId}" data-role="${talk.role || 'created'}">
          <div class="talk-item-header">
            <div class="talk-item-title">${escapeHtml(talk.title)}</div>
            <div class="talk-item-badges">
              ${roleBadge}
              <span class="talk-badge talk-badge-type">${talk.type}</span>
              ${disabled ? '<span class="talk-badge talk-badge-disabled" style="background:#fef3c7;color:#92400e;">🚫 Disabled</span>' : ''}
            </div>
          </div>
          <div class="talk-item-meta">
            <span class="talk-item-time">${formatTimeAgo(new Date(talk.lastInteraction || 0))}</span>
          </div>
          <div class="talk-item-meta" style="font-size: 0.85em; color: #666;">
            Expiration: ${expText} · Location: ${locText}
          </div>
          <div class="talk-item-stats" style="font-size: 0.85em; color: #666; margin-top: 6px;">
            ${statsLine}
          </div>
          ${matchedLine}
          <div class="talk-item-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            ${surveyStatsBtn}
            <button type="button" class="btn edit-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">✏️ Edit</button>
            <label class="talk-disable-broadcast-label" style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
              <input type="checkbox" class="talk-disable-broadcast-checkbox" data-talk-id="${talkId}" ${disabled ? 'checked' : ''}>
              <span>Disable for broadcast</span>
            </label>
            <button type="button" class="btn remove-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em; background: #dc3545; color: white;">🗑️ Remove</button>
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
                  ? '<span class="talk-badge" style="background:#f3f4f6;color:#6b7280;">✅ Answered</span>'
                  : '<span class="talk-badge" style="background:#dbeafe;color:#1d4ed8;font-weight:700;">🆕 New</span>';
                const incomingType = String(cluster?.type || 'flow').toLowerCase();
                return `
        <div class="talk-list-item" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="${escapeHtml(incomingType)}" style="${isAnswered ? 'background:#fafafa;' : ''}">
          <div class="talk-item-header">
            <div class="talk-item-title" style="${titleStyle}">${escapeHtml(cluster?.title || 'Incoming Talk')}</div>
            <div class="talk-item-badges">
              ${statusBadge}
              <span class="talk-badge talk-badge-type">${escapeHtml(cluster?.type || 'flow')}</span>
              <span class="talk-badge" style="background:#eef2ff;color:#3730a3;">👥 ${senderNames.length} sender${senderNames.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="talk-item-meta" style="${metaStyle}">
            <span class="talk-item-time">${formatTimeAgo(new Date(cluster?.updatedAt || Date.now()))}</span>
          </div>
          <div class="talk-item-meta" style="font-size: 0.85em; ${metaStyle}">
            From: ${escapeHtml(senderNames.join(', ') || 'Unknown')}
          </div>
          <div class="talk-item-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="btn view-talk-btn" data-talk-id="${talkId}" data-identity-key="${escapeHtml(identityKey)}" style="padding: 6px 12px; font-size: 0.9em;" ${talkId || identityKey ? '' : 'disabled'}>🔍 View</button>
          </div>
        </div>
      `;
              })
              .join('')
          : '';

      const sectionOut =
        outEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📤</span> OUT <span style="font-size: 0.8em; font-weight: 400; color: #6b7280;">(${outEntries.length} talk${outEntries.length !== 1 ? 's' : ''} · created or copied)</span>
             </div>${outHtml}`
          : '';
      const sectionIn =
        inEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📥</span> IN <span style="font-size: 0.8em; font-weight: 400; color: #6b7280;">(${inEntries.length} talk${inEntries.length !== 1 ? 's' : ''} · consolidated by content${incomingFilterResult.hiddenCount > 0 ? ` · ${incomingFilterResult.hiddenCount} filtered` : ''})</span>
             </div>${inHtml}`
          : '';

      if (activeMode === 'in') {
        talksList.innerHTML = sectionIn || `
          <div class="empty-state" style="padding: 40px 20px; text-align: center; color: #999;">
            ${incomingFilterResult.hiddenCount > 0 ? `All incoming talks are currently filtered out (${incomingFilterResult.hiddenCount}).` : 'No incoming talks yet.'}
          </div>
        `;
      } else if (activeMode === 'out') {
        talksList.innerHTML = sectionOut || `
          <div class="empty-state" style="padding: 40px 20px; text-align: center; color: #999;">
            No outgoing talks yet.
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
    this.talkStatsMap = { ...statsMap };
    const talksList = document.getElementById('talks-list');
    if (talksList) {
      Object.entries(statsMap).forEach(([talkId, stats]) => {
        const row = talksList.querySelector(`.talk-list-item[data-talk-id="${talkId}"][data-role="created"],
          .talk-list-item[data-talk-id="${talkId}"][data-role="copied"]`) as HTMLElement | null;
        const statsEl = row?.querySelector('.talk-item-stats') as HTMLElement | null;
        if (statsEl) {
          statsEl.textContent = `Responses: ${stats.responses} · Matches: ${stats.matches} · Ignores: ${stats.ignores}`;
        }
      });
    }
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

  displayAnswersList(): void {
    renderAnswersList({
      getMyTalks: this.getMyTalks.bind(this),
      getExactChatbotMemory,
      escapeHtml: escapeHtml,
      copyAnsweredTalkToTalks: this.copyAnsweredTalkToTalks.bind(this),
      showTalkDetail: this.showTalkDetail.bind(this),
      showPreferencesDialog: this.showPreferencesDialog.bind(this),
      getTalkContentKey: UIManager.getTalkContentKey,
    });
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
      fullTalk: talk.fullTalk,
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
      formatTimeAgo: formatTimeAgo,
      showConversationDetail: this.showConversationDetail.bind(this),
    });
  }

  private getMyConversations(): Record<string, any> {
    const conversationsJson = localStorage.getItem('myConversations');
    return conversationsJson ? JSON.parse(conversationsJson) : {};
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
    if (userName) userName.textContent = conversation.otherUserName || 'Unknown';

    // Mark conversation as read
    conversation.unread = false;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();

    // Load messages
    this.emit('loadConversation', { conversationId });

    // Setup back button
    const backBtn = document.getElementById('back-from-conversation');
    if (backBtn) {
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

  updateStatusBar(
    stageName: string,
    chatroomName: string,
    memberCount: number,
    totalMatches?: number,
  ): void {
    const statusBar = document.getElementById('status-bar');
    const statusBarText = document.getElementById('status-bar-text');

    if (statusBar && statusBarText) {
      let text = `${stageName} in ${chatroomName} with ${memberCount} ${memberCount === 1 ? 'user' : 'users'}`;
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
      return !!conversation && typeof conversation === 'object' && !!conversation.talkId;
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
      this.showNotification(`📥 New talk from ${talk.authorName}: ${talk.title}`, 'info');
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
      setAnsweredTalkByContent(answeredByContent);
    }

    const existingEntry = myTalks[talkIdToUse];
    const role = existingEntry?.role === 'copied' ? 'copied'
               : existingEntry?.role === 'created' ? 'created'
               : 'answered';

    this.saveMyTalk({
      talkId: talkIdToUse,
      title: talk.title,
      type: talk.type,
      timestamp: talk.createdAt || new Date().toISOString(),
      role,
      fullTalk: existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk,
      completedAnswers: answers.map((answer) => ({
        questionId: answer.questionId,
        answerId: answer.answerId,
        ...(answer.answerText ? { answerText: answer.answerText } : {}),
        ...(answer.mode ? { mode: answer.mode } : {}),
      })),
      outcome: outcome ?? existingEntry?.outcome ?? 'mismatch',
      senders,
    });

    this.emit('talkCompleted', {
      talkId: talk.id,
      answers,
      talkData: talk,
    });

    this.showNotification(
      talk.type === 'flow'
        ? "Response submitted! We'll notify you of matches."
        : talk.type === 'tag'
          ? "Tag response submitted!"
          : 'Survey response submitted! Thank you.',
      'success',
    );
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
    const answersView = document.getElementById('answers-view');
    if (answersView?.classList.contains('active')) {
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
        this.showNotification('Answer updated', 'success');
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
        this.showNotification(`Mode changed to ${isAuto ? 'AUTO' : 'MANUAL'}`, 'success');
      },
      deletePreference: (key) => {
        this.deleteAnswerPreference(key);
        this.showNotification('Answer deleted', 'success');
      },
      clearAll: () => {
        clearAnswerPreferences();
        this.showNotification('All answers cleared', 'success');
      },
      notify: this.showNotification.bind(this),
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
    talk: { id: string; title: string; type: string; questions: any[]; expiresAt?: number | null; locationRadiusMiles?: number | null },
    options: { selfAnswers: { questionId: string; answerId: string }[] },
  ): void {
    const myTalks = getMyTalks();
    myTalks[talk.id] = {
      ...myTalks[talk.id],
      talkId: talk.id,
      title: talk.title,
      type: talk.type,
      timestamp: new Date().toISOString(),
      role: 'created',
      fullTalk: talk,
      disabled: false,
      expiresAt: talk.expiresAt ?? undefined,
      locationRadiusMiles: talk.locationRadiusMiles ?? undefined,
      lastInteraction: new Date().toISOString(),
    };
    setMyTalks(myTalks);

    // Save self-answers to answer preferences (user's answer list) for chatbot/auto-reply
    const acc: Array<{ questionId: string; answerText?: string }> = [];
    for (const { questionId, answerId } of options.selfAnswers) {
      const q = talk.questions?.find((qu: any) => qu.id === questionId);
      if (!q) continue;
      const a = q.answers?.find((an: any) => an.id === answerId);
      if (!a) continue;
      acc.push({ questionId, answerText: a.text });
      this.saveAnswerPreference(talk, talk.id, q, a.id, a.text || '', acc, 'auto');
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
        const cb = row.querySelector('.talk-disable-broadcast-checkbox') as HTMLInputElement | null;
        if (cb) cb.checked = !!disabled;
        const badges = row.querySelector('.talk-item-badges');
        const existingBadge = row.querySelector('.talk-badge-disabled');
        if (!!disabled && !existingBadge && badges) {
          const badge = document.createElement('span');
          badge.className = 'talk-badge talk-badge-disabled';
          badge.setAttribute('style', 'background:#fef3c7;color:#92400e;');
          badge.textContent = '🚫 Disabled';
          badges.appendChild(badge);
        } else if (!disabled && existingBadge) {
          existingBadge.remove();
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
      onDeleteTalk: (talkId) => {
        this.deleteMyTalk(talkId);
        this.showNotification('Talk removed from history', 'success');
      },
      onToggleBroadcast: (talkId, disabled) => {
        this.setTalkDisabled(talkId, disabled);
      },
      onOpenTalk: (talkId) => {
        this.showTalkDetail(talkId);
      },
      onClearAll: () => {
        clearMyTalks();
        this.showNotification('All talk history cleared', 'success');
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

    if (message.startsWith('Match!')) {
      notification.dataset.matchNotification = 'true';
    }
    // All toasts: tap to dismiss (E2E and users need to clear overlays blocking the header).
    notification.style.cursor = 'pointer';
    notification.addEventListener('click', () => {
      if (document.body.contains(notification)) document.body.removeChild(notification);
    });

    document.body.appendChild(notification);

    if (!message.startsWith('Match!')) {
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
    openTalkEditorDialog({
      existingTalk,
      escapeHtml: escapeHtml,
      getAnswerPreferences,
      addQuestionToForm: (index, container) =>
        addTalkEditorQuestionToForm(index, container, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
        }),
      addAnswerToQuestion: (container, index) =>
        addTalkEditorAnswerToQuestion(container, index, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
        }),
      appendIgnoreRow: appendTalkEditorIgnoreRow,
      updateAllAnswerDropdowns: this.updateAllAnswerDropdowns.bind(this),
      refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
      ensureRouteEditorRendered: this.ensureRouteEditorRendered.bind(this),
      setupTalkFormHandlers: (modal) =>
        setupTalkEditorFormHandlers(modal, {
          refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
          processTalkForm: this.processTalkForm.bind(this),
        }),
    });
  }

  private updateAllAnswerDropdowns(): void {
    updateTalkEditorAnswerDropdowns({
      refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
      processTalkForm: this.processTalkForm.bind(this),
    });
  }

  private processTalkForm(form: HTMLFormElement): boolean {
    const title = (document.getElementById('talk-title') as HTMLInputElement).value.trim();
    const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
      | 'flow'
      | 'survey'
      | 'tag'
      | 'route';

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
        this.showTalkValidationError(['Route must have at least one question']);
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
      language: 'en',
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
        language: 'en',
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
        language: 'en',
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
          select.title = 'Flow talks: only the first answer decides; others are normalized to Ignore when you save.';
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
              { id: 'a_0_match', text: 'Match.', isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
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
          const kind = a.isMatch ? 'match' : a.isIgnore ? 'ignore' : a.isTerminal ? 'terminal' : 'link';
          return `
            <div class="route-answer" data-qid="${q.id}" data-aid="${a.id}" style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
              <span class="route-answer-kind" style="font-size:0.8em; padding:2px 6px; border-radius:10px; background:#eef; color:#334;">${kind}</span>
              <input type="text" class="form-input route-answer-text" value="${escapeHtml(a.text)}" placeholder="Answer text (e.g., Yes.)" data-qid="${q.id}" data-aid="${a.id}" style="flex:1;">
              <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:#667eea; color:white; padding:2px 6px;">+ Child Q</button>
              <button type="button" class="btn route-remove-answer-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:#f44336; color:white; padding:2px 6px;">×</button>
            </div>
            ${childIds.map((c) => renderNode(c, depth + 1)).join('')}
          `;
        })
        .join('');
      return `
        <div class="route-node" data-qid="${q.id}" style="border:1px solid #ddd; border-radius:6px; padding:8px; margin:6px 0; ${indent} background:#fafafa;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:#667eea;">Q:</strong>
            <input type="text" class="form-input route-question-text" value="${escapeHtml(q.text)}" placeholder="Question (end with ?)" data-qid="${q.id}" style="flex:1;">
            <button type="button" class="btn route-add-answer-btn" data-qid="${q.id}" style="font-size:0.8em; background:#4CAF50; color:white; padding:2px 6px;">+ Answer</button>
            ${q.parentAnswer ? `<button type="button" class="btn route-remove-question-btn" data-qid="${q.id}" style="font-size:0.8em; background:#f44336; color:white; padding:2px 6px;">Remove Q</button>` : ''}
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
          text: 'New answer.',
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
            { id: `${newId}_match`, text: 'Match.', isMatch: true, isTerminal: true },
            { id: `${newId}_ignore`, text: 'Ignore.', isIgnore: true, isTerminal: true },
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
    const unreadCount = Object.values(conversations).filter((conv: any) => conv.unread).length;

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
          <p>You matched! Start your conversation...</p>
        </div>
      `;
      return;
    }

    messagesContainer.innerHTML = messages
      .map((msg) => {
        const isOwn = msg.isOwnMessage;
        return `
          <div class="message ${isOwn ? 'message-own' : 'message-other'}">
            <div class="message-content">
              <div class="message-text">${escapeHtml(msg.text)}</div>
              <div class="message-time">${formatTimeAgo(new Date(msg.timestamp))}</div>
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

    conversations[conversationData.conversationId] = {
      otherUserId: conversationData.otherUserId,
      otherUserName: resolvedOtherUserName,
      talkId: conversationData.talkId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastMessage: existing?.lastMessage ?? null,
      lastMessageTime: existing?.lastMessageTime ?? null,
      unread: isNew ? true : (existing?.unread ?? false),
      respondedByBot,
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
      const name = conversationData.otherUserName?.trim() || 'Someone';
      this.showNotification(`Match! You and ${name} can now chat.`, 'success');
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
      if (this.currentConversationId !== conversationId) {
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
