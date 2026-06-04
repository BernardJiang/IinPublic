/**
 * @jest-environment jsdom
 */

import { displayContactsList, showContactDetail } from '../../web/ui/contacts-view';
import type { KnownPerson } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { languageOptionLabel, uiText } from '../../web/ui/ui-translations';

describe('Contacts ranking and relationship filters', () => {
  const originalFetch = global.fetch;
  const knownPartner: KnownPerson = {
    userId: 'strong',
    label: 'partner',
    addedAt: new Date('2026-05-01T00:00:00.000Z'),
  };
  const knownCustom: KnownPerson = {
    userId: 'weak',
    label: 'custom',
    customLabel: 'Book Circle',
    addedAt: new Date('2026-05-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="contacts-filter-name" value="">
      <select id="contacts-filter-relation">
        <option value="all">All</option>
        <option value="partner">Partner</option>
        <option value="custom">Custom</option>
      </select>
      <select id="contacts-sort-order">
        <option value="weighted">Relevance score</option>
        <option value="matches">Matched talks</option>
        <option value="relationship">Relationship</option>
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

  function deps(knownPeople: KnownPerson[] = [knownPartner]) {
    const englishLanguageLabel = (code: string) => ({
      en: 'English',
      zh: 'Chinese',
      es: 'Spanish',
    } as Record<string, string>)[code] || code;
    return {
      apiBase: 'http://example.test',
      currentUserId: 'creator',
      escapeHtml: (text: string) => text,
      getKnownPeople: () => knownPeople,
      getKnownPerson: (userId: string) => knownPeople.find((entry) => entry.userId === userId),
      isBlockedByMe: () => false,
      getPeerName: (_userId: string, fallback?: string) => fallback || 'Unknown',
      openPeerDetail: jest.fn(),
      getMyConversations: () => ({}),
      getMyTalks: () => ({}),
      saveKnownPerson: jest.fn().mockResolvedValue(undefined),
      submitPeerReview: jest.fn().mockResolvedValue(undefined),
      vouchAgeVerified: jest.fn().mockResolvedValue(undefined),
      setBlocked: jest.fn().mockResolvedValue(undefined),
      hasSupportContact: () => false,
      isSupportNotificationsMuted: () => false,
      setSupportNotificationsMuted: jest.fn().mockResolvedValue(undefined),
      text: (key: Parameters<typeof uiText>[1]) => uiText('en', key),
      formatLanguage: (code: string) => languageOptionLabel('en', code, englishLanguageLabel(code)),
      getProfileLanguages: () => ['en'],
    };
  }

  async function waitForElementById(id: string): Promise<HTMLElement> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const element = document.getElementById(id);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Element not found: ${id}`);
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

  it('renders, searches, filters, and sorts custom relationship labels by their saved text', async () => {
    const customPeople: KnownPerson[] = [
      { ...knownPartner, label: 'custom', customLabel: 'Zoom Group' },
      knownCustom,
    ];
    const contactDeps = deps(customPeople);
    (document.getElementById('contacts-sort-order') as HTMLSelectElement).value = 'relationship';
    await displayContactsList(contactDeps);

    let rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['Weak', 'Strong']);
    expect(document.getElementById('contacts-list')?.textContent).toContain('Book Circle');
    expect(document.getElementById('contacts-list')?.textContent).toContain('Zoom Group');

    (document.getElementById('contacts-filter-name') as HTMLInputElement).value = 'book circle';
    (document.getElementById('contacts-filter-relation') as HTMLSelectElement).value = 'custom';
    await displayContactsList(contactDeps);

    rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['Weak']);
  });

  it('pins an established TechSupport channel above ranked ordinary contacts without counting it', async () => {
    await displayContactsList({
      ...deps(),
      hasSupportContact: () => true,
    });

    const rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows[0]).toContain('TechSupport');
    expect(document.querySelector('.contact-support-item')?.getAttribute('data-support-contact')).toBe('true');
    expect(document.getElementById('contacts-status-text')?.textContent).toBe('2 contacts from exchanged talks');
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
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ blocked: false, blockedBy: false, eitherBlocked: false }),
      } as Response);
    const chineseDeps = {
      ...deps(),
      text: (key: Parameters<typeof uiText>[1]) => uiText('zh', key),
      formatLanguage: (code: string) => languageOptionLabel('zh', code, code),
    };

    await showContactDetail(chineseDeps, 'strong', 'Strong');

    expect(document.getElementById('contact-edit-relationship-btn')?.textContent).toBe('关系与信用');
    expect(document.getElementById('contact-detail-matches')?.textContent).toBe('0 个话题');
    expect(document.getElementById('contact-talks-list')?.textContent).toContain('尚未交换话题');
    expect(document.querySelector('.contact-profile-languages')?.textContent).toContain('中文');
    expect(document.querySelector('.contact-language-hint')?.textContent).toContain('没有共同的个人资料语言');
    expect(document.querySelector('.contact-context-credit')?.textContent).toContain('2 条评价');
    expect(document.querySelector('.contact-context-block-status')?.textContent).toContain('当前没有屏蔽');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ blocked: false, blockedBy: false }),
    } as Response);
    (document.getElementById('contact-edit-relationship-btn') as HTMLButtonElement).click();

    const modal = await waitForElementById('contact-relationship-modal');
    expect(modal.textContent).toContain('关系与信用');
    expect(modal.textContent).toContain('公开信用');
    expect(modal.textContent).toContain('2 条评价');
    expect(modal.textContent).toContain('屏蔽状态');
    expect(modal.textContent).toContain('当前没有屏蔽');
  });

  it('shows local mute controls instead of ordinary relationship or block actions for TechSupport', async () => {
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ totalTalks: 0 }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ languages: ['en'], profile: [], interests: [] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ blocked: false, blockedBy: false }) } as Response);
    const setSupportNotificationsMuted = jest.fn().mockResolvedValue(undefined);
    const supportDeps = {
      ...deps(),
      hasSupportContact: () => true,
      setSupportNotificationsMuted,
    };

    await showContactDetail(supportDeps, TECHSUPPORT_ROOT_USER_ID, 'TechSupport');
    expect(document.querySelector('.contact-profile-languages')?.textContent).toContain('English (shared)');
    (document.getElementById('contact-edit-relationship-btn') as HTMLButtonElement).click();

    const modal = document.getElementById('contact-relationship-modal');
    expect(modal?.textContent).toContain('Support Notifications');
    expect(modal?.textContent).toContain('Built-in support contact');
    expect(document.getElementById('contact-block-toggle-btn')).toBeNull();

    (document.getElementById('contact-support-mute-btn') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(setSupportNotificationsMuted).toHaveBeenCalledWith(true);
  });
});
