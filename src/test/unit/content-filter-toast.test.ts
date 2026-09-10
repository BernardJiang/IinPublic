import { showContentFilterToast, type ContentFilterToastDeps } from '../../web/ui/content-filter-toast';
import type { MessageFilterResult } from '../../shared/message-content-filter';

function deps(overrides: Partial<ContentFilterToastDeps> = {}): ContentFilterToastDeps {
  return {
    t: (key) => key,
    showNotification: jest.fn(),
    ...overrides,
  };
}

function result(overrides: Partial<MessageFilterResult> = {}): MessageFilterResult {
  return { passed: false, ...overrides };
}

describe('showContentFilterToast', () => {
  it('shows the same financial-data message for both directions (FR-FIN-4)', () => {
    const d = deps();
    showContentFilterToast(result({ reason: 'financial_data' }), 'send', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      'messageBlockedFinancialData', 'error', { contentFilter: 'financial-send' },
    );

    (d.showNotification as jest.Mock).mockClear();
    showContentFilterToast(result({ reason: 'financial_data' }), 'receive', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      'messageBlockedFinancialData', 'error', { contentFilter: 'financial-receive' },
    );
  });

  it('includes the offending word on the send side for dirty_words when present', () => {
    const d = deps();
    showContentFilterToast(result({ reason: 'dirty_words', word: 'badword' }), 'send', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      "messageBlockedDirtyWord ('badword')", 'error', { contentFilter: 'send' },
    );
  });

  it('omits the word suffix when dirty_words has no captured word', () => {
    const d = deps();
    showContentFilterToast(result({ reason: 'dirty_words' }), 'send', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      'messageBlockedDirtyWord', 'error', { contentFilter: 'send' },
    );
  });

  it('uses the hidden (not blocked) message for dirty_words on the receive side', () => {
    const d = deps();
    showContentFilterToast(result({ reason: 'dirty_words', word: 'badword' }), 'receive', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      'messageHiddenDirtyWord', 'error', { contentFilter: 'receive' },
    );
  });

  it('falls back to the grammar message/attr for any other reason, per direction', () => {
    const d = deps();
    showContentFilterToast(result({ reason: 'grammar' as any }), 'send', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      'messageBlockedGrammar', 'error', { contentFilter: 'grammar-send' },
    );

    (d.showNotification as jest.Mock).mockClear();
    showContentFilterToast(result({ reason: 'grammar' as any }), 'receive', d);
    expect(d.showNotification).toHaveBeenCalledWith(
      'messageHiddenGrammar', 'error', { contentFilter: 'grammar-receive' },
    );
  });
});
