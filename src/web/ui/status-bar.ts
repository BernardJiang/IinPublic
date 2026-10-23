import type { UiTranslationKey } from './ui-translations';

/**
 * Conversations that came from a match: they carry the matched Talk's id. Support channels and
 * plain DMs opened by tapping a person (talkId 'direct', rule N2a) are not matches — counting the
 * DM made one tap on a stranger show "1 match" on both people's status bars (phone-path 04,
 * 2026-10-14).
 */
export function countMatchConversations(conversations: Record<string, unknown>): number {
  return Object.values(conversations).filter((conversation) => {
    if (!conversation || typeof conversation !== 'object') return false;
    const { supportChannel, talkId } = conversation as { supportChannel?: unknown; talkId?: unknown };
    return supportChannel !== true && !!talkId && talkId !== 'direct';
  }).length;
}

export type UpdateStatusBarDeps = {
  tf: (key: UiTranslationKey, vars: Record<string, string | number>) => string;
  getTotalMatches: () => number;
};

/**
 * Renders only changing status in the AppBar: "N users[ · M matches]". The room/list already
 * names the active scope, so repeating "📍 Nearby" here wastes the narrow center column.
 * Stores the pre-match-suffix count in `data-status-bar-base` so other code can rebuild it.
 */
export function updateStatusBar(
  _chatroomName: string,
  memberCount: number,
  totalMatches: number | undefined,
  deps: UpdateStatusBarDeps,
): void {
  const statusBarText = document.getElementById('status-bar-text');
  if (!statusBarText) return;

  const userText = deps.tf(memberCount === 1 ? 'statusBarUser' : 'statusBarUsers', { count: memberCount });
  const base = userText;
  statusBarText.dataset.statusBarBase = base;
  const localTotalMatches = deps.getTotalMatches();
  const effectiveTotalMatches = localTotalMatches > 0 ? localTotalMatches : (totalMatches ?? 0);
  let text = base;
  if (effectiveTotalMatches > 0) {
    const matchText = deps.tf(
      effectiveTotalMatches === 1 ? 'statusBarMatch' : 'statusBarMatches',
      { count: effectiveTotalMatches },
    );
    text += ` · ${matchText}`;
  }
  renderStatusBar(statusBarText, text);
}

/**
 * One compact dynamic line between the AppBar buttons. The selected folder or detail heading owns
 * the room name; this element owns only counts.
 */
function renderStatusBar(element: HTMLElement, text: string): void {
  const metaEl = document.createElement('span');
  metaEl.className = 'status-bar-meta';
  metaEl.textContent = text;
  element.replaceChildren(metaEl);
  element.title = text;
}

/**
 * Refreshes just the match-count suffix on the status bar (e.g. after a match/ignore
 * change-of-mind), without needing the room name/member count again — reads the base text
 * `updateStatusBar` stashed in `data-status-bar-base`, falling back to stripping a legacy
 * English match suffix for text rendered before that attribute existed.
 */
export function syncStatusBarMatchCount(deps: UpdateStatusBarDeps): void {
  const statusBarText = document.getElementById('status-bar-text');
  if (!statusBarText) return;
  const base =
    statusBarText.dataset.statusBarBase ||
    statusBarText.textContent?.replace(/\s*·\s*\d+\s+match(?:es)?\s*$/i, '').trim() ||
    '';
  const totalMatches = deps.getTotalMatches();
  if (totalMatches > 0) {
    const matchText = deps.tf(
      totalMatches === 1 ? 'statusBarMatch' : 'statusBarMatches',
      { count: totalMatches },
    );
    renderStatusBar(statusBarText, `${base} · ${matchText}`);
  } else {
    renderStatusBar(statusBarText, base);
  }
}
