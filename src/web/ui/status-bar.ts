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
