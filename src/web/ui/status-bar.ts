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
 * Renders the persistent status bar line (`#status-bar-text`): "⟨room⟩ · N users[ · M matches]".
 * Stores the pre-match-suffix text in `data-status-bar-base` so other code (e.g. a language
 * change) can rebuild the suffix without needing the original room name/count again.
 */
export function updateStatusBar(
  chatroomName: string,
  memberCount: number,
  totalMatches: number | undefined,
  deps: UpdateStatusBarDeps,
): void {
  const statusBarText = document.getElementById('status-bar-text');
  if (!statusBarText) return;

  const userText = deps.tf(memberCount === 1 ? 'statusBarUser' : 'statusBarUsers', { count: memberCount });
  const base = `${chatroomName} · ${userText}`;
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
 * Two short lines that always fit between the app-bar buttons: the room name (bold), then
 * "N users · M matches" (small). The full line stays in the element's text (" · " separator kept
 * for screen readers and tests) and in its tooltip; tapping toggles a wrapped, fully readable view.
 */
function renderStatusBar(element: HTMLElement, text: string): void {
  const [name = '', ...rest] = text.split(' · ');
  const nameEl = document.createElement('span');
  nameEl.className = 'status-bar-name';
  nameEl.textContent = name;
  const sep = document.createElement('span');
  sep.className = 'status-bar-sep';
  sep.textContent = ' · ';
  const metaEl = document.createElement('span');
  metaEl.className = 'status-bar-meta';
  metaEl.textContent = rest.join(' · ');
  element.replaceChildren(nameEl, ...(rest.length > 0 ? [sep, metaEl] : []));
  element.title = text;
  if (!element.dataset.expandBound) {
    element.dataset.expandBound = 'true';
    element.addEventListener('click', () => element.classList.toggle('status-bar-expanded'));
  }
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
