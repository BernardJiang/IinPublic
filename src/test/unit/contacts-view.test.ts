/**
 * @jest-environment jsdom
 *
 * P0 step 5: contacts view now derives peers entirely from local stores.
 * The server calls to /api/users/:id/peers, /relationship, /talk-history, and /replies
 * are removed. These tests verify local-only derivation behavior.
 */

import { displayContactsList, saveKnownPerson, setBlocked, showContactDetail } from '../../web/ui/contacts-view';
import type { KnownPerson } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { languageOptionLabel, uiText } from '../../web/ui/ui-translations';

describe('Contacts ranking and relationship filters', () => {
  const originalFetch = global.fetch;
  const knownPartner: KnownPerson = {
    userId: 'strong',
    labels: ['partner'],
    addedAt: new Date('2026-05-01T00:00:00.000Z'),
  };
  const knownCustom: KnownPerson = {
    userId: 'weak',
    labels: ['custom'],
    customLabel: 'Book Circle',
    addedAt: new Date('2026-05-01T00:00:00.000Z'),
  };

  function seedLocalTalkExchanges(entries: Array<{
    peerId: string;
    peerName: string;
    talkId: string;
    title: string;
    outcome: 'match' | 'mismatch' | 'ignore';
    direction: 'sent' | 'received';
    date: string;
  }>): void {
    const exchanges: Record<string, unknown> = {};
    for (const entry of entries) {
      exchanges[`${entry.peerId}::${entry.talkId}`] = entry;
    }
    localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
  }

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
    // P0 step 5: no /peers server call — seed peers via localTalkExchanges instead.
    seedLocalTalkExchanges([
      // 'weak' peer: 10 sent, 1 match
      ...Array.from({ length: 9 }, (_, i) => ({
        peerId: 'weak',
        peerName: 'Weak',
        talkId: `talk-w-${i}`,
        title: `Talk W${i}`,
        outcome: 'mismatch' as const,
        direction: 'sent' as const,
        date: `2026-05-22T00:00:0${i}.000Z`,
      })),
      {
        peerId: 'weak',
        peerName: 'Weak',
        talkId: 'talk-w-match',
        title: 'Talk WM',
        outcome: 'match',
        direction: 'sent',
        date: '2026-05-22T00:00:09.000Z',
      },
      // 'strong' peer: 10 sent, 8 matches
      ...Array.from({ length: 8 }, (_, i) => ({
        peerId: 'strong',
        peerName: 'Strong',
        talkId: `talk-s-m${i}`,
        title: `Talk SM${i}`,
        outcome: 'match' as const,
        direction: 'sent' as const,
        date: `2026-05-21T00:00:0${i}.000Z`,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        peerId: 'strong',
        peerName: 'Strong',
        talkId: `talk-s-mm${i}`,
        title: `Talk SMM${i}`,
        outcome: 'mismatch' as const,
        direction: 'sent' as const,
        date: `2026-05-21T00:00:0${i + 8}.000Z`,
      })),
    ]);
    // fetch mock for block-status calls (used in showContactDetail)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ blocked: false, blockedBy: false }),
    } as Response);
  });

  afterEach(() => {
    jest.useRealTimers();
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
      openPeerDetailOnly: jest.fn(),
      updateStatsStrip: jest.fn(),
      getMyConversations: () => ({}),
      getMyTalks: () => ({}),
      saveKnownPerson: jest.fn().mockResolvedValue(undefined),
      submitPeerReview: jest.fn().mockResolvedValue(undefined),
      vouchAgeVerified: jest.fn().mockResolvedValue(undefined),
      setBlocked: jest.fn().mockResolvedValue(undefined),
      hasSupportContact: () => false,
      isSupportNotificationsMuted: () => false,
      setSupportNotificationsMuted: jest.fn().mockResolvedValue(undefined),
      isTechSupportOnline: () => false,
      isUserOnline: () => false,
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
      { ...knownPartner, labels: ['custom'], customLabel: 'Zoom Group' },
      knownCustom,
    ];
    const contactDeps = deps(customPeople);
    (document.getElementById('contacts-sort-order') as HTMLSelectElement).value = 'relationship';
    await displayContactsList(contactDeps);

    let rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['Weak', 'Strong']);
    expect(document.getElementById('contacts-list')?.textContent).toContain('Book Circle');
    expect(document.getElementById('contacts-list')?.textContent).toContain('Zoom Group');

    (document.getElementById('contacts-filter-name') as HTMLInputElement).value = 'Book Circle';
    (document.getElementById('contacts-filter-relation') as HTMLSelectElement).value = 'custom';
    await displayContactsList(contactDeps);

    rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['Weak']);
  });

  it('keeps saved known contacts visible when local exchange history is empty', async () => {
    localStorage.clear(); // no exchanges
    const contactDeps = deps([{
      userId: 'jerry-id',
      labels: ['custom'],
      nickname: 'J',
      customLabel: 'Coffee Circle',
      addedAt: new Date('2026-06-04T00:00:00.000Z'),
    }]);
    (document.getElementById('contacts-filter-name') as HTMLInputElement).value = 'Coffee Circle';
    (document.getElementById('contacts-filter-relation') as HTMLSelectElement).value = 'custom';

    await displayContactsList(contactDeps);

    const rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['J']);
    expect(document.getElementById('contacts-list')?.textContent).toContain('Coffee Circle');
  });

  it('renders contacts from local exchange store immediately (no server round-trip)', async () => {
    // This test previously verified stall behavior; now it verifies that local-only
    // rendering completes synchronously without needing any fetch.
    const contactDeps = deps([{
      userId: 'jerry-id',
      labels: ['custom'],
      nickname: 'J',
      customLabel: 'Coffee Circle',
      addedAt: new Date('2026-06-04T00:00:00.000Z'),
    }]);
    // Add an exchange so jerry-id appears
    const exchanges = { 'jerry-id::talk1': { peerId: 'jerry-id', peerName: 'J', talkId: 'talk1', title: 'T', outcome: 'match', direction: 'sent', date: '2026-06-04T00:00:00.000Z' } };
    localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
    (document.getElementById('contacts-filter-name') as HTMLInputElement).value = 'Coffee Circle';
    (document.getElementById('contacts-filter-relation') as HTMLSelectElement).value = 'custom';

    await displayContactsList(contactDeps);

    const rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows).toEqual(['J']);
    expect(document.getElementById('contacts-list')?.textContent).toContain('Coffee Circle');
  });

  it('pins an established TechSupport channel above ranked ordinary contacts without counting it', async () => {
    const contactDeps = { ...deps(), hasSupportContact: () => true };
    await displayContactsList(contactDeps);

    const rows = Array.from(document.querySelectorAll('.contact-item-name')).map((row) => row.textContent);
    expect(rows[0]).toContain('TechSupport');
    expect(document.querySelector('.contact-support-item')?.getAttribute('data-support-contact')).toBe('true');
    // The row-count header line now merges into the stats strip via updateStatsStrip's
    // prefix (§AA) instead of a separate #contacts-status-text element.
    expect(contactDeps.updateStatsStrip).toHaveBeenCalledWith('2 contacts from exchanged talks · ');
  });

  it('preserves English singular counts after moving contact summaries into translations', async () => {
    // P0 step 5: seed a single exchange for 'strong' so the count is exactly 1 talk, 1 match.
    localStorage.clear();
    localStorage.setItem('localTalkExchanges', JSON.stringify({
      'strong::talk-s1': { peerId: 'strong', peerName: 'Strong', talkId: 'talk-s1', title: 'T', outcome: 'match', direction: 'sent', date: '2026-05-21T00:00:00.000Z' },
    }));

    const contactDeps = deps();
    await displayContactsList(contactDeps);

    expect(contactDeps.updateStatsStrip).toHaveBeenCalledWith('1 contact from exchanged talks · ');
    // 1 talk, 1 match; mutualTagCount comes from exchanges (0 stored)
    expect(document.getElementById('contacts-list')?.textContent).toContain('1 talk');
    expect(document.getElementById('contacts-list')?.textContent).toContain('1 match');
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
    // P0 step 5: no /talk-history or /relationship calls; only block-status still
    // fetched (existing endpoint). getPublicProfileFoundation provides profile via Gun.
    // Clear localStorage so 'strong' has no local exchanges → 0 talks.
    localStorage.clear();
    const chineseDeps = {
      ...deps(),
      text: (key: Parameters<typeof uiText>[1]) => uiText('zh', key),
      formatLanguage: (code: string) => languageOptionLabel('zh', code, code),
      getPublicProfileFoundation: async (_userId: string) => ({
        headshot: null,
        languagesJson: JSON.stringify(['zh']),
        profileJson: JSON.stringify([]),
        interestsJson: JSON.stringify([]),
      }),
    };

    await showContactDetail(chineseDeps, 'strong', 'Strong');

    expect(document.getElementById('contact-edit-relationship-btn')?.textContent).toBe('关系与信用');
    expect(document.getElementById('contact-detail-matches')?.textContent).toBe('0 个话题');
    expect(document.getElementById('contact-talks-list')?.textContent).toContain('尚未交换话题');
    expect(document.querySelector('.contact-profile-languages')?.textContent).toContain('中文');
    // No shared language between 'zh' peer profile and 'en' current user
    expect(document.querySelector('.contact-language-hint')?.textContent).toContain('没有共同的个人资料语言');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ blocked: false, blockedBy: false }),
    } as Response);
    (document.getElementById('contact-edit-relationship-btn') as HTMLButtonElement).click();

    const modal = await waitForElementById('contact-relationship-modal');
    expect(modal.textContent).toContain('关系与信用');
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
    // P0 step 5: no server calls for history/relationship in showContactDetail.
    // getPublicProfileFoundation provides profile via Gun, block-status via existing fetch mock.
    const setSupportNotificationsMuted = jest.fn().mockResolvedValue(undefined);
    const supportDeps = {
      ...deps(),
      hasSupportContact: () => true,
      setSupportNotificationsMuted,
      getPublicProfileFoundation: async (_userId: string) => ({
        headshot: null,
        languagesJson: JSON.stringify(['en']),
        profileJson: JSON.stringify([]),
        interestsJson: JSON.stringify([]),
      }),
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

  describe('TODO §R1: fast first-chunk render for long contact lists', () => {
    function seedManyPeers(count: number): KnownPerson[] {
      const known: KnownPerson[] = [];
      const exchanges: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const id = `peer-${String(i).padStart(3, '0')}`;
        known.push({ userId: id, labels: ['friend'], addedAt: new Date('2026-05-01T00:00:00.000Z') });
        exchanges[`${id}::talk-${i}`] = {
          peerId: id,
          peerName: id,
          talkId: `talk-${i}`,
          title: 'T',
          outcome: 'match',
          direction: 'sent',
          date: `2026-05-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
        };
      }
      localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      return known;
    }

    it('renders the first chunk immediately, before beforeRender resolves', async () => {
      const known = seedManyPeers(60);
      let releaseBeforeRender: () => void = () => {};
      const gate = new Promise<void>((resolve) => { releaseBeforeRender = resolve; });
      const contactDeps = { ...deps(known), beforeRender: () => gate };

      const renderDone = displayContactsList(contactDeps);
      // Give the synchronous first phase a chance to run without letting beforeRender resolve.
      await Promise.resolve();
      await Promise.resolve();

      expect(document.querySelectorAll('.contact-item').length).toBeGreaterThan(0);
      expect(document.querySelectorAll('.contact-item').length).toBeLessThanOrEqual(25);

      releaseBeforeRender();
      await renderDone;
    });

    it('fills the remainder in without dropping or duplicating any row, and every row is clickable', async () => {
      const known = seedManyPeers(60);
      await displayContactsList(deps(known));
      await new Promise((resolve) => setTimeout(resolve, 300));

      const rows = Array.from(document.querySelectorAll('.contact-item[data-contact-user-id]'));
      const ids = rows.map((row) => (row as HTMLElement).dataset.contactUserId);
      expect(ids).toHaveLength(60);
      expect(new Set(ids).size).toBe(60); // no duplicates from the two renderContactsListCore passes

      const openPeerDetail = jest.fn();
      const openPeerDetailOnly = jest.fn();
      const clickableDeps = { ...deps(known), openPeerDetail, openPeerDetailOnly };
      await displayContactsList(clickableDeps);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // A row from the deferred remainder (well past the first-chunk size) is clickable
      // with no per-row listener re-attachment needed — delegated on the container.
      // Tapping the name specifically opens the DM directly; tapping the row anywhere
      // else opens the details-only view without also opening a conversation.
      const remainderRow = document.querySelector('.contact-item[data-contact-user-id="peer-059"]') as HTMLElement;
      expect(remainderRow).toBeTruthy();
      const remainderAvatar = remainderRow.querySelector('.contact-item-avatar') as HTMLElement;
      remainderAvatar.click();
      expect(openPeerDetailOnly).toHaveBeenCalledWith('peer-059', 'peer-059');
      expect(openPeerDetail).not.toHaveBeenCalled();

      const remainderName = remainderRow.querySelector('.contact-item-name') as HTMLElement;
      remainderName.click();
      expect(openPeerDetail).toHaveBeenCalledWith('peer-059', 'peer-059');
    });

    it('does not duplicate rows when beforeRender resolves and triggers the post-enrichment re-render', async () => {
      const known = seedManyPeers(60);
      const contactDeps = { ...deps(known), beforeRender: async () => { /* resolves immediately */ } };

      await displayContactsList(contactDeps);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const ids = Array.from(document.querySelectorAll('.contact-item[data-contact-user-id]'))
        .map((row) => (row as HTMLElement).dataset.contactUserId);
      expect(ids).toHaveLength(60);
      expect(new Set(ids).size).toBe(60);
    });
  });
});

describe('saveKnownPerson', () => {
  function deps(overrides: Partial<Parameters<typeof saveKnownPerson>[2]> = {}) {
    return {
      getCurrentUser: jest.fn(() => ({ knownPeople: [] as KnownPerson[] })),
      emit: jest.fn(),
      refreshContactsList: jest.fn(),
      ...overrides,
    };
  }

  it('is a no-op when there is no current user', () => {
    const d = deps({ getCurrentUser: jest.fn(() => null) });
    saveKnownPerson('u1', { labels: ['friend'] }, d);
    expect(d.emit).not.toHaveBeenCalled();
    expect(d.refreshContactsList).not.toHaveBeenCalled();
  });

  it('adds a new known-person entry to the current user', () => {
    const currentUser: { knownPeople: KnownPerson[] } = { knownPeople: [] };
    const d = deps({ getCurrentUser: jest.fn(() => currentUser) });
    saveKnownPerson('u1', { labels: ['friend'], nickname: 'Bud' }, d);
    expect(currentUser.knownPeople).toHaveLength(1);
    expect(currentUser.knownPeople[0]).toMatchObject({ userId: 'u1', labels: ['friend'], nickname: 'Bud' });
  });

  it('replaces an existing entry for the same userId rather than duplicating it', () => {
    const currentUser: { knownPeople: KnownPerson[] } = {
      knownPeople: [{ userId: 'u1', labels: ['friend'], addedAt: new Date('2026-01-01') }],
    };
    const d = deps({ getCurrentUser: jest.fn(() => currentUser) });
    saveKnownPerson('u1', { labels: ['partner'] }, d);
    expect(currentUser.knownPeople).toHaveLength(1);
    expect(currentUser.knownPeople[0].labels).toEqual(['partner']);
  });

  it('omits optional fields (nickname/customLabel/rating/notes) when not provided', () => {
    const currentUser: { knownPeople: KnownPerson[] } = { knownPeople: [] };
    const d = deps({ getCurrentUser: jest.fn(() => currentUser) });
    saveKnownPerson('u1', { labels: ['friend'] }, d);
    const entry = currentUser.knownPeople[0] as any;
    expect(entry.nickname).toBeUndefined();
    expect(entry.customLabel).toBeUndefined();
    expect(entry.rating).toBeUndefined();
    expect(entry.notes).toBeUndefined();
  });

  it('includes a numeric rating of 0', () => {
    const currentUser: { knownPeople: KnownPerson[] } = { knownPeople: [] };
    const d = deps({ getCurrentUser: jest.fn(() => currentUser) });
    saveKnownPerson('u1', { labels: ['friend'], rating: 0 }, d);
    expect((currentUser.knownPeople[0] as any).rating).toBe(0);
  });

  it('emits saveKnownPerson with the userId and details, and refreshes the contacts list', () => {
    const d = deps();
    saveKnownPerson('u1', { labels: ['friend'], notes: 'met at a conference' }, d);
    expect(d.emit).toHaveBeenCalledWith('saveKnownPerson', { userId: 'u1', labels: ['friend'], notes: 'met at a conference' });
    expect(d.refreshContactsList).toHaveBeenCalledTimes(1);
  });
});

describe('setBlocked', () => {
  const originalFetch2 = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch2;
  });

  function blockDeps(overrides: Partial<Parameters<typeof setBlocked>[2]> = {}) {
    return {
      getCurrentUser: jest.fn(() => ({ blockedUserIds: [] as string[] })),
      apiBase: 'https://api.example.com',
      currentUserId: 'me',
      emit: jest.fn(),
      refreshContactsList: jest.fn(),
      ...overrides,
    };
  }

  it('is a no-op when there is no current user', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const d = blockDeps({ getCurrentUser: jest.fn(() => null) });
    await setBlocked('u1', true, d);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('POSTs to the blocks endpoint when blocking', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as any;
    const d = blockDeps();
    await setBlocked('u1', true, d);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/api/users/me/blocks',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ targetId: 'u1' }) }),
    );
  });

  it('DELETEs the specific block entry when unblocking', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as any;
    const d = blockDeps();
    await setBlocked('u1', false, d);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/api/users/me/blocks/u1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('skips the network call entirely when apiBase or currentUserId is missing', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const d = blockDeps({ apiBase: '' });
    await setBlocked('u1', true, d);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(d.emit).toHaveBeenCalled(); // local mutation still happens
  });

  it('throws when the server responds with a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const d = blockDeps();
    await expect(setBlocked('u1', true, d)).rejects.toThrow('Failed to block user: HTTP 500');
  });

  it('adds the userId to blockedUserIds, deduped, when blocking', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const currentUser = { blockedUserIds: ['u1'] };
    const d = blockDeps({ getCurrentUser: jest.fn(() => currentUser) });
    await setBlocked('u1', true, d);
    expect(currentUser.blockedUserIds).toEqual(['u1']);
  });

  it('removes the userId from blockedUserIds when unblocking', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const currentUser = { blockedUserIds: ['u1', 'u2'] };
    const d = blockDeps({ getCurrentUser: jest.fn(() => currentUser) });
    await setBlocked('u1', false, d);
    expect(currentUser.blockedUserIds).toEqual(['u2']);
  });

  it('emits setUserBlocked and refreshes the contacts list', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const d = blockDeps();
    await setBlocked('u1', true, d);
    expect(d.emit).toHaveBeenCalledWith('setUserBlocked', { userId: 'u1', blocked: true });
    expect(d.refreshContactsList).toHaveBeenCalledTimes(1);
  });
});
