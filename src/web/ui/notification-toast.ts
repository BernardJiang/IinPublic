import type { UiTranslationKey } from './ui-translations';

export type NotificationOptions = {
  persistent?: boolean;
  conversationId?: string;
  contentFilter?: string;
  peerId?: string;
  peerName?: string;
  retry?: () => void;
  safetyToast?: 'pre-send' | 'post-match';
};

export type ShowNotificationDeps = {
  isSuppressedForE2e: () => boolean;
  t: (key: UiTranslationKey) => string;
  openConversation: (conversationId: string) => void;
  navigateToPerson: (person: { type: 'person'; id: string; name: string }) => void;
};

/**
 * Click-to-dismiss toast (redesign §4/§9, TODO §CC/§P/N1/N2a/N6): a Match! notice navigates to
 * its conversation on click, a DM-arrival notice navigates to the sender via the same 'person'
 * graph-node destination every other click-to-a-person surface uses, and a retry-capable toast
 * re-attempts its failed action instead of just dismissing. Every toast auto-dismisses — Match!
 * after 8s, "no talks to broadcast" and a retryable toast after longer windows, everything else
 * after 3s.
 */
export function showNotification(
  message: string,
  type: 'success' | 'error' | 'info' | 'warning' = 'info',
  options: NotificationOptions | undefined,
  deps: ShowNotificationDeps,
): void {
  if (deps.isSuppressedForE2e()) return;

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
    (message.startsWith(deps.t('talksMatchNoticePrefix')) ||
      message === deps.t('responseMatch') ||
      message === deps.t('responseMatchAuto'));
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
      deps.openConversation(options.conversationId);
    } else if (options?.peerId) {
      deps.navigateToPerson({ type: 'person', id: options.peerId, name: options.peerName || '' });
    } else if (options?.retry) {
      options.retry();
    }
  });

  document.body.appendChild(notification);

  const hideAfter = isMatchNotification
    ? 8000
    : message === deps.t('chatroomNoTalksToBroadcast')
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
