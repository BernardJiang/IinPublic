import type { MessageFilterResult } from '../../shared/message-content-filter';
import type { UiTranslationKey } from './ui-translations';

export type ContentFilterToastDeps = {
  t: (key: UiTranslationKey) => string;
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning', options?: { contentFilter?: string }) => void;
};

export function showContentFilterToast(result: MessageFilterResult, direction: 'send' | 'receive', deps: ContentFilterToastDeps): void {
  let text: string;
  let attr: string;
  if (result.reason === 'financial_data') {
    // Mandatory, non-configurable (FR-FIN-2) — same message on both paths since a
    // financial-data hit is never rendered for the receiver either (FR-FIN-4).
    text = deps.t('messageBlockedFinancialData');
    attr = direction === 'send' ? 'financial-send' : 'financial-receive';
  } else if (result.reason === 'dirty_words') {
    text =
      direction === 'send'
        ? `${deps.t('messageBlockedDirtyWord')}${result.word ? ` ('${result.word}')` : ''}`
        : deps.t('messageHiddenDirtyWord');
    attr = direction === 'send' ? 'send' : 'receive';
  } else {
    text = direction === 'send' ? deps.t('messageBlockedGrammar') : deps.t('messageHiddenGrammar');
    attr = direction === 'send' ? 'grammar-send' : 'grammar-receive';
  }
  deps.showNotification(text, 'error', { contentFilter: attr });
}
