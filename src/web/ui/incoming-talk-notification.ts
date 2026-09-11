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
    deps.showNotification(deps.tf('newTalkNotification', { name: talk.authorName, title: talk.title }), 'info');
    const authorId = talk.fullTalk?.authorId;
    if (authorId) deps.flashMemberForNewTalk(authorId);
  }

  const talksTab = document.getElementById('tab-talks');
  if (talksTab?.classList.contains('active')) {
    deps.refreshTalksListIfActive();
  }
}
