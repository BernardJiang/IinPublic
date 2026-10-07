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
    /** OPEN-42: the chatbot is answering it — say so instead of "New talk" (nothing to do). */
    autoAnsweredByChatbot?: boolean;
    /** OPEN-40: an in-place title/routing update of a talk already answered — no notice at all. */
    silentUpdate?: boolean;
  },
  deps: DisplayIncomingTalkDeps,
): void {
  if (!talk.isOwnTalk && !talk.silentUpdate) {
    const message = deps.tf(
      talk.autoAnsweredByChatbot ? 'talksAutoAnsweredNotification' : 'newTalkNotification',
      { name: talk.authorName, title: talk.title },
    );
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
 * Talk arrives, but an in-page toast is invisible then. Hand the message to the native shell,
 * which posts its system notification only while the app is not in the foreground
 * (MainActivity.isInForeground). The page can't judge that itself: the WebView is never paused,
 * so `document.visibilityState` stays "visible" with the screen off (seen on the C10). A frozen
 * page is covered by the service's own mailbox watch. No-op in browsers and older builds.
 */
export function notifyNativeWhileHidden(message: string): void {
  const bridge = (window as unknown as { IinPublicNearby?: { notifyNewActivity?: (text: string) => void } }).IinPublicNearby;
  if (typeof bridge?.notifyNewActivity !== 'function') return;
  try {
    bridge.notifyNewActivity(message.replace(/^\p{Extended_Pictographic}\s*/u, ''));
  } catch {
    /* native shell without the method */
  }
}
