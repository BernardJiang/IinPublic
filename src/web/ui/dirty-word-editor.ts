import { normalizeDirtyWords, DEFAULT_DIRTY_WORDS } from '../../shared/talk-intake-filters';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type DirtyWordEditorDeps = {
  onChange: () => void;
  t: (key: UiTranslationKey) => string;
};

/**
 * Binds the Settings "blocked words" chip editor (`#dirty-word-*`): add/remove chips,
 * duplicate/too-short/limit validation, and reset-to-default. Self-contained — owns only
 * its own DOM subtree, no shared state with the rest of the Settings tab beyond the
 * `onChange` callback that tells the caller to re-sync filters.
 */
export function bindDirtyWordEditor(deps: DirtyWordEditorDeps): void {
  const { onChange, t } = deps;
  const chips = document.getElementById('dirty-word-chips');
  const input = document.getElementById('dirty-word-add-input') as HTMLInputElement | null;
  const addBtn = document.getElementById('dirty-word-add-btn');
  const resetBtn = document.getElementById('dirty-word-reset-btn');
  const errorEl = document.getElementById('dirty-word-error');
  if (!chips) return;

  const showError = (message: string): void => {
    if (errorEl) errorEl.textContent = message;
  };
  const currentWords = (): string[] =>
    Array.from(chips.querySelectorAll<HTMLElement>('.dirty-word-chip'))
      .map((el) => el.getAttribute('data-word') || '')
      .filter(Boolean);
  const renderChips = (words: string[]): void => {
    chips.innerHTML = words
      .map((word) => {
        const safe = escapeHtml(word);
        return `<span class="dirty-word-chip" data-testid="dirty-word-chip" data-word="${safe}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border-strong);border-radius:999px;background:var(--bg-subtle);font-size:0.85em;"><span>${safe}</span><button type="button" class="dirty-word-chip-remove" data-testid="dirty-word-chip-remove" data-word="${safe}" aria-label="remove ${safe}" style="border:none;background:none;cursor:pointer;color:var(--text-tertiary);font-size:1em;line-height:1;padding:0;">✕</button></span>`;
      })
      .join('');
  };

  const addWord = (): void => {
    if (!input) return;
    const raw = input.value.trim().toLowerCase();
    showError('');
    if (raw.length < 2) {
      showError(t('settingsDirtyWordTooShort'));
      return;
    }
    const existing = currentWords();
    if (existing.length >= 50) {
      showError(t('settingsDirtyWordLimit'));
      return;
    }
    const [normalized] = normalizeDirtyWords([raw]);
    if (!normalized) {
      showError(t('settingsDirtyWordTooShort'));
      return;
    }
    if (existing.includes(normalized)) {
      showError(t('settingsDirtyWordDuplicate'));
      return;
    }
    renderChips([...existing, normalized]);
    input.value = '';
    onChange();
  };

  addBtn?.addEventListener('click', addWord);
  input?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      addWord();
    }
  });
  chips.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement)?.closest('.dirty-word-chip-remove') as HTMLElement | null;
    if (!target) return;
    const word = target.getAttribute('data-word');
    if (!word) return;
    showError('');
    renderChips(currentWords().filter((w) => w !== word));
    onChange();
  });
  resetBtn?.addEventListener('click', () => {
    showError('');
    renderChips([...DEFAULT_DIRTY_WORDS]);
    onChange();
  });
}
