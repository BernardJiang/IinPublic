/**
 * @jest-environment jsdom
 */

import { displayContactsList, showContactDetail } from '../../web/ui/contacts-view';
import type { KnownPerson } from '../../shared/types';
import { uiText } from '../../web/ui/ui-translations';

describe('Contacts ranking and relationship filters', () => {
  const originalFetch = global.fetch;
  const knownPartner: KnownPerson = {
    userId: 'strong',
    label: 'partner',
    addedAt: new Date('2026-05-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="contacts-filter-name" value="">
      <select id="contacts-filter-relation">
        <option value="all">All</option>
        <option value="partner">Partner</option>
      </select>
      <select id="contacts-sort-order">
        <option value="weighted">Relevance score</option>
        <option value="matches">Matched talks</option>
      </select>
      <div id="contacts-status-text"></div>
      <div id="contacts-list"></div>
    `;
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          peerId: 'weak',
          stageName: 'Weak',
          lastInteractionAt: '2026-05-22T00:00:00.000Z',
          stats: { sent: { talks: 10, matches: 1 }, received: { talks: 0, matches: 0 }, totalTalks: 10, mutualMatchedTalks: 0, mutualTagCount: 0 },
        },
        {
          peerId: 'strong',
          stageName: 'Strong',
          lastInteractionAt: '2026-05-21T00:00:00.000Z',
          stats: { sent: { talks: 10, matches: 8 }, received: { talks: 0, matches: 0 }, totalTalks: 10, mutualMatchedTalks: 0, mutualTagCount: 0 },
        },
      ],
    } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function deps() {
    return {
      apiBase: 'http://example.test',
      currentUserId: 'creator',
      escapeHtml: (text: string) => text,
      getKnownPeople: () => [knownPartner],
      getKnownPerson: (userId: string) => (userId === 'strong' ? knownPartner : undefined),
      isBlockedByMe: () => false,
      getPeerName: (_userId: string, fallback?: string) => fallback || 'Unknown',
      openPeerDetail: jest.fn(),
      getMyTalks: () => ({}),
      saveKnownPerson: jest.fn().mockResolvedValue(undefined),
      submitPeerReview: jest.fn().mockResolvedValue(undefined),
      vouchAgeVerified: jest.fn().mockResolvedValue(undefined),
      setBlocked: jest.fn().mockResolvedValue(undefined),
      text: (key: Parameters<typeof uiText>[1]) => uiText('en', key),
    };
  }

  it('puts the user with more matched talks first under weighted ranking', async () => {
    await displayContactsList(deps());

    const rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['Strong', 'Weak']);
    expect(document.querySelector('.contact-item-rank')?.textContent).toContain('Relevance score');
    expect(document.getElementById('contacts-list')?.textContent).toContain('8 matches');
  });

  it('can filter the list to a saved partner relationship', async () => {
    (document.getElementById('contacts-filter-relation') as HTMLSelectElement).value = 'partner';
    await displayContactsList(deps());

    const rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['Strong']);
  });

  it('preserves English singular counts after moving contact summaries into translations', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        peerId: 'strong',
        stageName: 'Strong',
        lastInteractionAt: '2026-05-21T00:00:00.000Z',
        stats: { sent: { talks: 1, matches: 1 }, received: { talks: 0, matches: 0 }, totalTalks: 1, mutualMatchedTalks: 0, mutualTagCount: 1 },
      }],
    } as Response);

    await displayContactsList(deps());

    expect(document.getElementById('contacts-status-text')?.textContent).toBe('1 contact from exchanged talks');
    expect(document.getElementById('contacts-list')?.textContent).toContain('1 talk · 1 match · 1 common tag');
  });

  it('localizes contact details and relationship controls independently of English labels', async () => {
    document.body.innerHTML += `
      <div id="contacts-list-container"></div>
      <div id="contact-detail-container">
        <div id="contact-detail-info"></div>
        <div id="contact-detail-name"></div>
        <div id="contact-detail-matches"></div>
        <div id="contact-talks-list"></div>
      </div>
    `;
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ totalTalks: 0 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          languages: ['zh'],
          profile: [],
          interests: [],
          reputation: {
            isHidden: false,
            starRating: 4.5,
            reviewCount: 2,
            friendsCount: 1,
            likedCount: 2,
            dislikedCount: 0,
          },
        }),
      } as Response);
    const chineseDeps = {
      ...deps(),
      text: (key: Parameters<typeof uiText>[1]) => uiText('zh', key),
    };

    await showContactDetail(chineseDeps, 'strong', 'Strong');

    expect(document.getElementById('contact-edit-relationship-btn')?.textContent).toBe('关系与信用');
    expect(document.getElementById('contact-detail-matches')?.textContent).toBe('0 个话题');
    expect(document.getElementById('contact-talks-list')?.textContent).toContain('尚未交换话题');

    (document.getElementById('contact-edit-relationship-btn') as HTMLButtonElement).click();
    await Promise.resolve();

    const modal = document.getElementById('contact-relationship-modal');
    expect(modal?.textContent).toContain('关系与信用');
    expect(modal?.textContent).toContain('公开信用');
    expect(modal?.textContent).toContain('2 条评价');
    expect(modal?.textContent).toContain('屏蔽状态');
    expect(modal?.textContent).toContain('当前没有屏蔽');
  });
});
