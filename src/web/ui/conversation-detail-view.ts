import {
  FlowCapture,
  encodeCapturedQuestionMessage,
  decodeCapturedQuestionMessage,
} from '../../shared/talk-engine';
import type { MessageFilterResult } from '../../shared/message-content-filter';
import { escapeHtml } from './ui-formatters';
import { filterVerifiedSupportMessages } from './verified-support-messages';
import type { UiTranslationKey } from './ui-translations';

export interface ConversationDetailViewDeps {
  getMyConversations: () => Record<string, any>;
  closeMediaGallery: () => void;
  getCurrentConversationId: () => string | undefined;
  setCurrentConversationId: (conversationId: string | undefined) => void;
  getCurrentThreadTalkId: () => string | undefined;
  setCurrentThreadTalkId: (talkId: string | undefined) => void;
  captureSessionsByConversationId: Map<
    string,
    { scopeTalkId: string | undefined; lines: string[] }
  >;
  currentUserId: string | undefined;
  getCurrentUserStageName: () => string;
  getPeerName: (userId: string, fallback?: string) => string;
  resolvePeerStageNameLive: (userId: string) => Promise<string | null>;
  getMyTalks: () => Record<string, any>;
  t: (key: UiTranslationKey) => string;
  formatTransportMode: (mode: string) => string;
  formatTransportFallback: (mode: string, fallbackReason: unknown) => string;
  formatLastHealthyContact: (lastMessageTime: unknown) => string;
  updateMatchBadge: () => void;
  refreshOpenPeerThreadList: () => void;
  allowOutgoingMessage: (message: string) => boolean;
  confirmCapturedQuestionDialog: (captured: {
    question: string;
    answers: string[];
  }) => Promise<boolean>;
  emit: (event: string, payload: unknown) => void;
  bindCapturedQuestionChipDelegation: () => void;
  messageInCurrentThread: (message: { talkId?: string }) => boolean;
  setLastConversationMessages: (messages: any[]) => void;
  parseIpfsSharePayload: (text: string) => any;
  renderIpfsAttachmentMessage: (share: any, isOwn: boolean, timestamp: string) => string;
  renderCapturedQuestionMessage: (
    captured: { question: string; answers: string[] },
    isOwn: boolean,
    timestamp: string,
    messageId: string,
  ) => string;
  shouldHideIncomingMessage: (message: string, senderId?: string) => MessageFilterResult;
  hiddenMessageToastIds: Set<string>;
  formatTalkRelativeTime: (date: Date) => string;
  showContentFilterToast: (result: MessageFilterResult, direction: 'receive') => void;
  hydrateAttachmentImages: (root: HTMLElement) => void;
}

export function showConversationDetail(
  conversationId: string,
  threadTalkId: string | undefined,
  deps: ConversationDetailViewDeps,
): void {
  const conversations = deps.getMyConversations();
  const conversation = conversations[conversationId];

  if (!conversation) {
    console.warn('showConversationDetail: conversation not found', conversationId);
    return;
  }

  const overlay = document.getElementById('conversation-detail-overlay');
  if (overlay) overlay.style.display = 'flex';
  // Always land on the message thread, not a leftover media gallery from a prior conversation.
  deps.closeMediaGallery();

  deps.setCurrentConversationId(conversationId);
  // Per-talk Thread scope (redesign §5): messages and the composer are bound to one
  // matched talk; without a talkId this is the pair's talk-independent DM thread.
  deps.setCurrentThreadTalkId(threadTalkId && threadTalkId !== 'direct' ? threadTalkId : undefined);

  // Update header with user name. The name embedded in the conversation record was
  // captured at match time and goes stale when the peer renames. Resolve the live name
  // (roster-first, synchronous) and then self-heal asynchronously from the public-user
  // read so the header matches the chatroom's current stage name after a rename.
  const userName = document.getElementById('conversation-user-name');
  if (userName) {
    const liveName = conversation.otherUserId
      ? deps.getPeerName(conversation.otherUserId, conversation.otherUserName)
      : conversation.otherUserName;
    userName.textContent = liveName || deps.t('conversationUnknown');
    if (conversation.otherUserId) {
      void deps.resolvePeerStageNameLive(conversation.otherUserId).then((resolved) => {
        // Only apply if this conversation is still the one on screen.
        if (resolved && deps.getCurrentConversationId() === conversationId) {
          userName.textContent = resolved;
        }
      });
    }
  }
  const status = document.getElementById('conversation-status');
  if (status) status.textContent = deps.t('online');
  // Per-talk Thread pages (redesign §5) share this component; show the talk scope line
  // when this view is bound to a matched talk.
  const threadScope = document.getElementById('conversation-thread-scope');
  if (threadScope) {
    const talkId = deps.getCurrentThreadTalkId() || '';
    if (talkId && conversation.supportChannel !== true) {
      const talk = deps.getMyTalks()[talkId] as any;
      const talkTitle =
        talk?.title ||
        talk?.fullTalk?.title ||
        `${deps.t('peerTalkFallback')} ${talkId.slice(0, 8)}`;
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
  const dealBtn = document.getElementById(
    'conversation-confirm-deal-btn',
  ) as HTMLButtonElement | null;
  const isDealEligible = conversation.dealEligible === true;
  if (dealBar && dealStatusEl && dealBtn) {
    if (!isDealEligible || conversation.supportChannel === true) {
      dealBar.style.display = 'none';
    } else {
      let confirmedBy: string[] = [];
      try {
        confirmedBy = JSON.parse(conversation.dealConfirmedByJson || '[]');
      } catch {
        /* ignore malformed */
      }
      const myId = deps.currentUserId || '';
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
          deps.emit('confirmDeal', { conversationId });
        });
      }
    }
  }

  const transportStatus = document.getElementById('conversation-transport-status');
  if (transportStatus) {
    const mode = String(conversation.transportMode || 'star-gun');
    transportStatus.dataset.transportMode = mode;
    transportStatus.textContent = `${deps.t('conversationTransport')}: ${deps.formatTransportMode(mode)}`;
    const fallbackStatus = document.getElementById('conversation-fallback-status');
    if (fallbackStatus) {
      fallbackStatus.textContent = deps.formatTransportFallback(
        mode,
        conversation.transportFallbackReason,
      );
    }
    const healthStatus = document.getElementById('conversation-health-status');
    if (healthStatus) {
      healthStatus.textContent = deps.formatLastHealthyContact(conversation.lastMessageTime);
    }
  }
  const messagesContainer = document.getElementById('conversation-messages');
  if (messagesContainer) {
    messagesContainer.innerHTML = `<p style="text-align: center; padding: 20px; color: #999;">${escapeHtml(deps.t('conversationStart'))}</p>`;
  }

  // Record the read cursor for the OPENED scope only (per-thread read state,
  // redesign §5); other threads of the pair keep their unread counts.
  const openKey = deps.getCurrentThreadTalkId() || 'direct';
  const summaries = (
    conversation.threadSummaries && typeof conversation.threadSummaries === 'object'
      ? conversation.threadSummaries
      : {}
  ) as Record<string, { lastMessage?: string; lastMessageTime?: string; unreadCount?: number }>;
  if (summaries[openKey]) {
    summaries[openKey].unreadCount = 0;
    const cursorKey = 'iinpublic:conversation-read-cursors';
    let cursors: Record<string, { timestamp: string; id?: string }> = {};
    try {
      cursors = JSON.parse(localStorage.getItem(cursorKey) || '{}');
    } catch {
      /* ignore malformed local data */
    }
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
  deps.updateMatchBadge();

  // Load messages
  deps.emit('loadConversation', { conversationId });

  // Setup back button
  const backBtn = document.getElementById('back-from-conversation');
  if (backBtn) {
    backBtn.textContent = `‹ ${deps.t('back')}`;
    backBtn.replaceWith(backBtn.cloneNode(true)); // Remove old listeners
    const newBackBtn = document.getElementById('back-from-conversation');
    newBackBtn?.addEventListener('click', () => {
      if (overlay) overlay.style.display = 'none';
      deps.setCurrentConversationId(undefined);
      deps.setCurrentThreadTalkId(undefined);
      // If the shared ⟨User⟩ layout is open underneath (rule N2a), refresh its
      // thread rows so snippets/unread badges reflect this visit.
      deps.refreshOpenPeerThreadList();
    });
  }

  // Setup send message button
  const sendBtn = document.getElementById('send-conversation-message');
  const messageInput = document.getElementById('conversation-message-input') as HTMLTextAreaElement;

  if (sendBtn && messageInput) {
    sendBtn.textContent = deps.t('conversationSend');
    messageInput.placeholder = deps.t('conversationMessagePlaceholder');
    sendBtn.replaceWith(sendBtn.cloneNode(true)); // Remove old listeners
    const newSendBtn = document.getElementById('send-conversation-message');

    const sendMessage = async () => {
      const message = messageInput.value.trim();
      if (!message) return;
      // Send-path content filter (redesign §9): a blocked message is not sent
      // and the composer text is preserved for editing.
      if (!deps.allowOutgoingMessage(message)) return;

      // docs/TODO.md §V — Auto Linear Capture: recognize the shorthand *before* the
      // ordinary send, not after (unlike the IPFS-share precedent, which only ever parses
      // already-sent text at render time). Mandatory confirm, never silent.
      const capturedLine = FlowCapture.parseChatLine(message);
      if (capturedLine) {
        const confirmed = await deps.confirmCapturedQuestionDialog(capturedLine);
        if (confirmed) {
          const session = deps.captureSessionsByConversationId.get(conversationId) ?? {
            scopeTalkId: deps.getCurrentThreadTalkId(),
            lines: [],
          };
          session.lines.push(message);
          deps.captureSessionsByConversationId.set(conversationId, session);
          deps.emit('sendConversationMessage', {
            conversationId,
            message: encodeCapturedQuestionMessage(capturedLine),
            ...(deps.getCurrentThreadTalkId() ? { talkId: deps.getCurrentThreadTalkId() } : {}),
          });
          messageInput.value = '';
          return;
        }
        // Declined — fall through and send the original text as an ordinary message.
      } else {
        const activeSession = deps.captureSessionsByConversationId.get(conversationId);
        if (activeSession) {
          // FR-TK-7: a non-captured message closes the capture — finalize what's been
          // gathered so far, then this message itself still sends normally, below.
          deps.captureSessionsByConversationId.delete(conversationId);
          deps.emit('finalizeCaptureSession', { conversationId, ...activeSession });
        }
      }

      deps.emit('sendConversationMessage', {
        conversationId,
        message,
        ...(deps.getCurrentThreadTalkId() ? { talkId: deps.getCurrentThreadTalkId() } : {}),
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
  // Clone to drop stale listeners; read deps.getCurrentConversationId() at pick time so a
  // media share always routes to the conversation currently on screen.
  const attachBtn = document.getElementById('conversation-attach-btn');
  const attachInput = document.getElementById(
    'conversation-attach-input',
  ) as HTMLInputElement | null;
  if (attachBtn && attachInput) {
    attachBtn.replaceWith(attachBtn.cloneNode(true));
    const newAttachBtn = document.getElementById('conversation-attach-btn');
    const freshInput = attachInput.cloneNode(true) as HTMLInputElement;
    attachInput.replaceWith(freshInput);
    newAttachBtn?.addEventListener('click', () => freshInput.click());
    freshInput.addEventListener('change', () => {
      const file = freshInput.files?.[0];
      if (!file) return;
      const targetConversationId = deps.getCurrentConversationId();
      if (targetConversationId) {
        deps.emit('shareConversationMedia', { conversationId: targetConversationId, file });
      }
      freshInput.value = '';
    });
  }
}

export async function displayConversationMessages(
  conversationId: string,
  messages: any[],
  deps: ConversationDetailViewDeps,
): Promise<void> {
  if (deps.getCurrentConversationId() !== conversationId) return;

  const messagesContainer = document.getElementById('conversation-messages');
  if (!messagesContainer) return;

  deps.bindCapturedQuestionChipDelegation();

  const isSupportChannel = deps.getMyConversations()[conversationId]?.supportChannel === true;
  if (isSupportChannel) {
    messages = await filterVerifiedSupportMessages(messages, deps.getCurrentUserStageName());
    if (deps.getCurrentConversationId() !== conversationId) return; // stale by the time verify resolved
  }

  // Thread isolation (redesign §5): only the open scope's messages render here.
  messages = messages.filter((msg) => deps.messageInCurrentThread(msg));
  // Cache for filter-toggle re-render (§9): toggling a filter off must reveal
  // previously hidden messages without waiting for a new sync event.
  deps.setLastConversationMessages(messages);

  if (messages.length === 0) {
    messagesContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #999;">
          <p>${escapeHtml(deps.t('conversationMatchedStart'))}</p>
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
      const isOwn = !!deps.currentUserId && String(msg.senderId || '') === deps.currentUserId;
      const text = String(msg.text || '');
      // Matched-talk IPFS auto-share (L5): render the shared photo/file as an attachment
      // card (with an image preview once the decrypted bytes arrive) instead of raw JSON.
      const share = deps.parseIpfsSharePayload(text);
      if (share) {
        return deps.renderIpfsAttachmentMessage(share, isOwn, msg.timestamp);
      }
      // docs/TODO.md §V, UI-1d: a confirmed captured question renders as tappable chips,
      // not a plain bubble — same detect-a-marked-payload shape as the IPFS share above.
      const capturedQuestion = decodeCapturedQuestionMessage(text);
      if (capturedQuestion) {
        const messageId = String(msg.id || `${msg.senderId || ''}:${msg.timestamp || ''}`);
        return deps.renderCapturedQuestionMessage(
          capturedQuestion,
          isOwn,
          msg.timestamp,
          messageId,
        );
      }
      // Receive-path content filter (redesign §9): a receiver's own filters hide
      // incoming messages at render (they stay in the Gun graph). Never hide your
      // own outgoing messages.
      if (!isOwn) {
        const verdict = deps.shouldHideIncomingMessage(text, String(msg.senderId || ''));
        if (!verdict.passed) {
          const msgKey = String(msg.id || `${msg.senderId || ''}:${msg.timestamp || ''}`);
          if (!deps.hiddenMessageToastIds.has(msgKey)) {
            deps.hiddenMessageToastIds.add(msgKey);
            toastQueue.push(verdict);
          }
          return `
              <div class="message message-other message-hidden" data-testid="hidden-message-placeholder">
                <div class="message-content">
                  <div class="message-text" style="font-style:italic;color:var(--text-muted);">${escapeHtml(`1 ${deps.t('messageHiddenPlaceholder')}`)}</div>
                </div>
              </div>
            `;
        }
      }
      return `
          <div class="message ${isOwn ? 'message-own' : 'message-other'}">
            <div class="message-content">
              <div class="message-text">${escapeHtml(text)}</div>
              <div class="message-time">${deps.formatTalkRelativeTime(new Date(msg.timestamp))}</div>
            </div>
          </div>
        `;
    })
    .join('');
  // Fire one toast per newly-hidden message (rule §9.1).
  for (const verdict of toastQueue) deps.showContentFilterToast(verdict, 'receive');

  // Swap decrypted bytes into image attachment previews (async, best-effort).
  deps.hydrateAttachmentImages(messagesContainer);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
