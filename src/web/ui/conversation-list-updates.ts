import type { UiTranslationKey } from './ui-translations';
import type { NotificationOptions } from './notification-toast';

export interface ConversationListUpdatesDeps {
  getMyConversations: () => Record<string, any>;
  getPeerName: (userId: string, fallback?: string) => string;
  updateMatchBadge: () => void;
  syncStatusBarMatchCount: () => void;
  emit: (event: string, payload: unknown) => void;
  getTotalMatches: () => number;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  isSupportNotificationsMuted: () => boolean;
  showNotification: (
    message: string,
    type: 'info' | 'success',
    options?: NotificationOptions,
  ) => void;
  displayContactsList: () => void;
  displayConversationsList: () => void;
  getCurrentConversationId: () => string | undefined;
  getCurrentThreadTalkId: () => string | undefined;
  refreshOpenPeerThreadList: () => void;
  lastNotifiedMessageIdByConversation: Map<string, string>;
}

export function addNewConversation(
  conversationData: {
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
  },
  deps: ConversationListUpdatesDeps,
): void {
  const conversations = deps.getMyConversations();
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
  const resolvedOtherUserName = deps.getPeerName(
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
    unread: isSupportChannel ? false : isNew ? true : (existing?.unread ?? false),
    respondedByBot,
    dealEligible,
    ...(matchScore !== undefined ? { matchScore } : {}),
    ...(matchTotal !== undefined ? { matchTotal } : {}),
    supportChannel: isSupportChannel,
    transportMode: conversationData.transportMode ?? existing?.transportMode ?? 'star-gun',
    transportFallbackReason:
      existing?.transportFallbackReason ?? conversationData.transportFallbackReason ?? null,
    ...(existing?.status ? { status: existing.status } : {}),
    ...(existing?.changedAt ? { changedAt: existing.changedAt } : {}),
    // Step 9: record change-of-mind timestamp for durable UI assertion
    ...(conversationData.changeOfMindAt || existing?.changeOfMindAt
      ? { changeOfMindAt: conversationData.changeOfMindAt ?? existing?.changeOfMindAt }
      : {}),
  };

  localStorage.setItem('myConversations', JSON.stringify(conversations));

  // Update badge
  deps.updateMatchBadge();
  deps.syncStatusBarMatchCount();
  deps.emit('conversationAdded', {
    conversationId: conversationData.conversationId,
    isNew,
    totalMatches: deps.getTotalMatches(),
  });

  // Only show toast for genuinely new matches (not when re-syncing or opening edit)
  if (isNew) {
    const name = conversationData.otherUserName?.trim() || deps.t('conversationUnknown');
    if (conversationData.supportChannel && !deps.isSupportNotificationsMuted()) {
      deps.showNotification(deps.tf('supportChannelReady', { name }), 'info');
    } else {
      if (!conversationData.supportChannel) {
        // Auto-dismiss: this "can now chat" banner starts with "Match!" but is a transient
        // toast, not a durable talk-match notice that should linger until clicked.
        deps.showNotification(deps.tf('matchChatReady', { name }), 'success', {
          persistent: false,
        });
      }
    }
  }

  const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
  if (contactsTab?.classList.contains('active')) {
    deps.displayContactsList();
  }

  const meTab = document.querySelector('.nav-btn[data-view="me"]');
  if (meTab?.classList.contains('active')) {
    deps.displayConversationsList();
  }
}

export function updateConversationMessage(
  conversationId: string,
  message: string,
  timestamp: string,
  deps: ConversationListUpdatesDeps,
): void {
  const conversations = deps.getMyConversations();

  if (conversations[conversationId]) {
    conversations[conversationId].lastMessage = message;
    conversations[conversationId].lastMessageTime = timestamp;

    // If the current conversation is not open, mark as unread
    if (
      deps.getCurrentConversationId() !== conversationId &&
      conversations[conversationId].supportChannel !== true
    ) {
      conversations[conversationId].unread = true;
    }

    localStorage.setItem('myConversations', JSON.stringify(conversations));
    deps.updateMatchBadge();
    deps.syncStatusBarMatchCount();

    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) {
      deps.displayConversationsList();
    }

    const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
    if (contactsTab?.classList.contains('active')) {
      deps.displayContactsList();
    }
  }
}

export function syncConversationMessageSummary(
  conversationId: string,
  messages: any[],
  currentUserId: string,
  deps: ConversationListUpdatesDeps,
): void {
  const conversations = deps.getMyConversations();
  const conversation = conversations[conversationId];
  if (!conversation || messages.length === 0) return;
  const ordered = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const latest = ordered[ordered.length - 1];
  conversation.lastMessage = String(latest.text || '');
  conversation.lastMessageTime = new Date(latest.timestamp || Date.now()).toISOString();

  const cursorKey = 'iinpublic:conversation-read-cursors';
  let cursors: Record<string, { timestamp: string; id?: string }> = {};
  try {
    cursors = JSON.parse(localStorage.getItem(cursorKey) || '{}');
  } catch {
    /* ignore malformed local data */
  }

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
  const openThreadKey =
    deps.getCurrentConversationId() === conversationId
      ? deps.getCurrentThreadTalkId() || 'direct'
      : null;

  const byThread = new Map<string, any[]>();
  for (const message of ordered) {
    const key = threadKeyOf(message);
    const bucket = byThread.get(key) || [];
    bucket.push(message);
    byThread.set(key, bucket);
  }

  const threadSummaries: Record<
    string,
    { lastMessage: string; lastMessageTime: string; unreadCount: number }
  > = {};
  let totalUnread = 0;
  for (const [threadKey, bucket] of byThread) {
    const last = bucket[bucket.length - 1];
    const lastTime = new Date(last.timestamp || Date.now()).toISOString();
    let unreadCount = 0;
    if (openThreadKey === threadKey) {
      cursors[cursorIdFor(threadKey)] = { timestamp: lastTime, id: String(last.id || '') };
    } else {
      const readAt = new Date(cursors[cursorIdFor(threadKey)]?.timestamp || 0).getTime();
      unreadCount = bucket.filter(
        (message) =>
          String(message.senderId || '') !== currentUserId &&
          new Date(message.timestamp || 0).getTime() > readAt,
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
  deps.updateMatchBadge();
  deps.refreshOpenPeerThreadList();

  // Surface a toast when a fresh message arrives from the peer for a conversation the user
  // isn't currently viewing. Without this the only signal is the nav badge, which is easy to
  // miss — the reported bug was that an incoming message produced no visible change until the
  // user manually reopened the chat. Seed the last-notified id on first sight so history/boot
  // loads don't fire a burst of toasts; only genuine deltas notify.
  const latestId = String(latest.id || '');
  const isIncoming = String(latest.senderId || '') !== currentUserId;
  const alreadySeen = deps.lastNotifiedMessageIdByConversation.has(conversationId);
  const isDelta = deps.lastNotifiedMessageIdByConversation.get(conversationId) !== latestId;
  deps.lastNotifiedMessageIdByConversation.set(conversationId, latestId);
  if (
    alreadySeen &&
    isDelta &&
    isIncoming &&
    deps.getCurrentConversationId() !== conversationId &&
    !conversation.supportChannel
  ) {
    const name = deps.getPeerName(conversation.otherUserId, conversation.otherUserName);
    deps.showNotification(deps.tf('conversationNewMessage', { name }), 'info', {
      peerId: conversation.otherUserId,
      peerName: name,
    });
  }

  // Re-render the conversation list whenever it exists in the DOM (not only when the Me tab is
  // the active nav item) so an arriving message updates the preview/unread row immediately.
  if (document.getElementById('conversations-list')) deps.displayConversationsList();
  // Contacts sort by recency reads the same lastMessageTime this method just updated —
  // without a re-render here the visible order freezes at whatever it was when the tab
  // opened (messages arriving while the user watches never reorder the rows).
  const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
  if (contactsTab?.classList.contains('active')) deps.displayContactsList();
}
