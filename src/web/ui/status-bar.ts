import type { UiTranslationKey } from './ui-translations';

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
  statusBarText.textContent = text;
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
    statusBarText.textContent = `${base} · ${matchText}`;
  } else {
    statusBarText.textContent = base;
  }
}
