/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {
  endMatchCollectionSession,
  MATCH_COLLECTION_STORE_KEY,
  recordMatchCollectionDelivery,
  recordMatchCollectionExchange,
  startMatchCollectionSession,
} from '../../web/services/match-collection-session';
import { showMatchCollectionReviewDialog } from '../../web/ui/match-collection-review-dialog';
import { uiText } from '../../web/ui/ui-translations';

describe('match collection review dialog', () => {
  beforeEach(() => {
    localStorage.removeItem(MATCH_COLLECTION_STORE_KEY);
    document.body.innerHTML = '<button id="opener">Review</button>';
  });

  afterEach(() => {
    localStorage.removeItem(MATCH_COLLECTION_STORE_KEY);
    document.body.innerHTML = '';
  });

  it('shows honest totals, repeated outcomes, private review controls, and opens a person', () => {
    const session = startMatchCollectionSession(
      { label: 'Train ride', scopeId: 'nearby-v3' },
      new Date('2026-10-20T10:00:00Z'),
    );
    recordMatchCollectionDelivery({ talkIds: ['talk-a', 'talk-b'], peerIds: ['alice'] });
    recordMatchCollectionExchange('alice', 'talk-a', 'mismatch', new Date('2026-10-20T10:10:00Z'));
    recordMatchCollectionExchange('alice', 'talk-a', 'match', new Date('2026-10-20T10:11:00Z'));
    endMatchCollectionSession(new Date('2026-10-20T10:30:00Z'));
    recordMatchCollectionExchange('alice', 'talk-b', 'ignore', new Date('2026-10-20T11:00:00Z'));
    const openPerson = jest.fn();

    showMatchCollectionReviewDialog({ sessionId: session.id, text: (key) => uiText('en', key), openPerson });

    expect(document.querySelector('[data-testid="match-collection-review-summary"]')).toHaveTextContent(
      '1 reached · 2 replies · 0 pending · 1 matches · 0 mismatches · 1 late',
    );
    expect(document.querySelectorAll('[data-testid="match-collection-person"] li')).toHaveLength(3);
    const row = document.querySelector('[data-testid="match-collection-person"]') as HTMLElement;
    (row.querySelector('[data-action="pin"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-action="pin"]')).toHaveTextContent('Unpin');
    const note = document.querySelector('[data-action="note"]') as HTMLTextAreaElement;
    note.value = 'Worth following up';
    note.dispatchEvent(new Event('change', { bubbles: true }));
    (document.querySelector('[data-action="open"]') as HTMLButtonElement).click();
    expect(openPerson).toHaveBeenCalledWith('alice');
    expect(document.getElementById('match-collection-review-overlay')).toBeNull();
  });

  it('makes pending people filterable and directly actionable', () => {
    const session = startMatchCollectionSession({ label: 'Cold start', scopeId: 'nearby-v3' });
    recordMatchCollectionDelivery({ talkIds: ['talk-a'], peerIds: ['alice', 'bob'] });
    recordMatchCollectionExchange('alice', 'talk-a', 'match');
    showMatchCollectionReviewDialog({ sessionId: session.id, text: (key) => uiText('en', key), openPerson: jest.fn() });

    (document.querySelector('[data-filter="pending"]') as HTMLButtonElement).click();
    const people = document.querySelectorAll('[data-testid="match-collection-person"]');
    expect(people).toHaveLength(1);
    expect(people[0]).toHaveAttribute('data-peer-id', 'bob');
    expect(people[0]?.querySelector('[data-testid="match-collection-pending-action"]')).toHaveTextContent('open chat to follow up');
  });
});
