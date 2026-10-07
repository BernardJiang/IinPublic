import type { UiTranslationKey } from './ui-translations';

export type DisplayIncomingTalkDeps = {
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  tf: (key: UiTranslationKey, vars: Record<string, string | number>) => string;
  flashMemberForNewTalk: (authorId: string) => void;
  refreshTalksListIfActive: () => void;
};

/**
 * Notifies of an incoming talk (unless it's the user's own) and flashes the author's member-list
 * icon; refreshes the Talks tab if it's currently active. Never auto-saves to `myTalks` — the
 * backend `incomingTalkClusters` index is relied on instead.
 */
export function displayIncomingTalk(
  talk: {
    id: string;
    title: string;
    authorName: string;
    type: string;
    questionCount: number;
    timestamp: string;
    isOwnTalk: boolean;
    fullTalk: any;
  },
  deps: DisplayIncomingTalkDeps,
): void {
  if (!talk.isOwnTalk) {
    const message = deps.tf('newTalkNotification', { name: talk.authorName, title: talk.title });
    deps.showNotification(message, 'info');
    notifyNativeWhileHidden(message);
    const authorId = talk.fullTalk?.authorId;
    if (authorId) deps.flashMemberForNewTalk(authorId);
  }

  const talksTab = document.getElementById('tab-talks');
  if (talksTab?.classList.contains('active')) {
    deps.refreshTalksListIfActive();
  }
}

/**
 * OPEN-38: on Android the page may still be alive (screen off, app in the background) when a
 * Talk arrives, but an in-page toast is invisible then. Ask the native service for its system
 * notification instead; a frozen page is covered by the service's own mailbox watch. No-op in
 * browsers, while visible, and on builds without the bridge method.
 */
export function notifyNativeWhileHidden(message: string): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  const bridge = (window as unknown as { IinPublicNearby?: { notifyNewActivity?: (text: string) => void } }).IinPublicNearby;
  if (typeof bridge?.notifyNewActivity !== 'function') return;
  try {
    bridge.notifyNewActivity(message.replace(/^\p{Extended_Pictographic}\s*/u, ''));
  } catch {
    /* native shell without the method */
  }
}
