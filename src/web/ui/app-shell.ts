import type { UiTranslationKey } from './ui-translations';

export type AppShellLanguageOption = {
  code: string;
  label: string;
};

type RenderAppShellOptions = {
  text: (key: UiTranslationKey) => string;
  languageOptions: readonly AppShellLanguageOption[];
};

/**
 * Renders the stable application shell. Feature renderers hydrate the owned regions after this
 * first paint; navigation and event listeners remain the UIManager controller's responsibility.
 */
export function renderAppShell(
  container: HTMLElement,
  { text, languageOptions }: RenderAppShellOptions,
): void {
  container.innerHTML = `
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
              <button type="button" class="header-btn app-bar-action-btn chatroom-view-mode-btn" id="chatroom-tree-view-btn" data-testid="chatroom-tree-view-btn" data-appbar-view="chatrooms" data-appbar-priority="0" aria-pressed="true" title="${text('chatroomTreeView')}"><span class="app-bar-btn-icon" aria-hidden="true">🌳</span><span class="app-bar-btn-label">${text('chatroomTreeView')}</span></button>
              <button type="button" class="header-btn app-bar-action-btn chatroom-view-mode-btn" id="chatroom-map-view-btn" data-testid="chatroom-map-view-btn" data-appbar-view="chatrooms" data-appbar-priority="1" aria-pressed="false" title="${text('chatroomMapView')}"><span class="app-bar-btn-icon" aria-hidden="true">🗺️</span><span class="app-bar-btn-label">${text('chatroomMapView')}</span></button>
              <button class="header-btn app-bar-action-btn" id="create-talk-btn" data-testid="create-talk-btn" data-appbar-view="chatrooms talks" data-appbar-priority="2" title="Create talk"><span class="app-bar-btn-icon">➕</span><span class="app-bar-btn-label">Create talk</span></button>
              <button type="button" class="header-btn app-bar-action-btn status-broadcast-btn" id="broadcast-talk-btn" data-testid="broadcast-talk-btn" data-appbar-view="chatrooms" data-appbar-priority="3" title="Send every talk in your OUT list to everyone in this chatroom"><span class="app-bar-btn-icon">📣</span><span class="app-bar-btn-label">Broadcast</span></button>
              <button type="button" class="header-btn app-bar-action-btn" id="return-home-btn" data-testid="return-home-btn" data-appbar-view="chatrooms" data-appbar-priority="4" disabled title="Return Home"><span class="app-bar-btn-icon">🏠</span><span class="app-bar-btn-label">Return Home</span></button>
              <button type="button" class="header-btn app-bar-action-btn" id="create-custom-chatroom-btn" data-testid="create-custom-chatroom-btn" data-appbar-view="chatrooms" data-appbar-priority="5" title="New Room"><span class="app-bar-btn-icon">🆕</span><span class="app-bar-btn-label">New Room</span></button>
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
              <div class="chatroom-map-status" id="chatroom-map-status" role="status" aria-live="polite" hidden></div>
              <div class="chatroom-list" id="chatroom-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading chatrooms...</p>
              </div>
              <div class="chatroom-map" id="chatroom-map" data-testid="chatroom-map" aria-label="${text('chatroomMapAriaLabel')}" hidden></div>
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
                <button type="button" class="btn contacts-broadcast-icon-btn" id="contacts-broadcast-group-btn" data-testid="contacts-broadcast-group-btn" title="${text('contactsBroadcastGroupBtn')}" aria-label="${text('contactsBroadcastGroupBtn')}">📣</button>
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
                    ${languageOptions.map((lang) => `<option value="${lang.code}">${lang.label}</option>`).join('')}
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
}
type ApplyAppShellTranslationsOptions = {
  text: (key: UiTranslationKey) => string;
  languageOptions: readonly AppShellLanguageOption[];
  languageLabel: (code: string, fallback: string) => string;
};

/** Reapplies localized labels to the stable shell without rebinding any behavior. */
export function applyAppShellTranslations(
  root: Document,
  { text, languageOptions, languageLabel }: ApplyAppShellTranslationsOptions,
): void {
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
    ['#chatroom-tree-view-btn .app-bar-btn-label', 'chatroomTreeView'],
    ['#chatroom-map-view-btn .app-bar-btn-label', 'chatroomMapView'],
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
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = text(key);
  }
  const chatroomMap = root.getElementById('chatroom-map');
  if (chatroomMap) chatroomMap.setAttribute('aria-label', text('chatroomMapAriaLabel'));
  // AppBar icon buttons: translated label doubles as the tooltip.
  for (const id of ['chatroom-tree-view-btn', 'chatroom-map-view-btn', 'create-custom-chatroom-btn', 'return-home-btn', 'broadcast-talk-btn', 'settings-refresh-location-btn']) {
    const btn = root.getElementById(id);
    const label = btn?.querySelector<HTMLElement>('.app-bar-btn-label');
    if (btn && label && id !== 'return-home-btn') btn.title = label.textContent || '';
    if (btn && label && id.startsWith('chatroom-')) btn.setAttribute('aria-label', label.textContent || '');
  }
  for (const id of ['back-to-chatrooms', 'back-to-contacts-list', 'back-to-settings-menu']) {
    const btn = root.getElementById(id);
    if (btn) btn.title = text('back');
  }
  root.querySelectorAll<HTMLElement>('.filter-bar-toggle').forEach((toggle) => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.textContent = open ? `${text('filters')} ▴` : `${text('filters')} ▾`;
  });
  const contactsFilter = root.getElementById('contacts-filter-name') as HTMLInputElement | null;
  if (contactsFilter) contactsFilter.placeholder = text('filterByName');
  const replyFilter = root.getElementById('reply-filter-query') as HTMLInputElement | null;
  if (replyFilter) replyFilter.placeholder = text('repliesSearchPlaceholder');
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
    const option = root.querySelector<HTMLOptionElement>(selector);
    if (option) option.textContent = text(key);
  }
  for (const language of languageOptions) {
    const option = root.querySelector<HTMLOptionElement>(`#reply-filter-language option[value="${language.code}"]`);
    if (option) option.textContent = languageLabel(language.code, language.label);
  }
}
