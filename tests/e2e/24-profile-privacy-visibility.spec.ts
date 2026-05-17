/**
 * Profile privacy visibility: per-viewer filtering of profile Q&A rows.
 *
 * Server rule (src/shared/profile-privacy.ts + GET /api/users/:id?viewerId=...):
 * - `public`: anyone
 * - `contacts_only`: viewer must be in owner's known-people list
 * - `private`: owner only (always hidden from non-self viewers)
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterAction, afterNav, afterSync, headless } from './helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from './helpers/ports';
import { attachE2eBrowserTabLabel } from './helpers/e2e-tab-title';

test.describe('Profile privacy visibility', () => {
  let browser: Browser;

  let contextTom: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let contextJerryContact: BrowserContext | undefined;
  let pageJerryContact: Page | undefined;
  let contextJerryNonContact: BrowserContext | undefined;
  let pageJerryNonContact: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterEach(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerryContact?.close().catch(() => {});
    await pageJerryNonContact?.close().catch(() => {});

    await contextTom?.close().catch(() => {});
    await contextJerryContact?.close().catch(() => {});
    await contextJerryNonContact?.close().catch(() => {});
  });

  test.afterAll(async () => {
    await browser?.close().catch(() => {});
    await clearGunDatabases();
  });

  async function bootstrapUser(targetBrowser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const nextContext = await targetBrowser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    const nextPage = await nextContext.newPage();
    await injectIdbClear(nextPage);
    await nextPage.goto(webAppURLStableChatroom());
    await nextPage.waitForLoadState('load');
    await ensureWindowFitsViewport(nextPage, 960, 1200);
    await afterSync();

    await nextPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await nextPage.waitForSelector('#settings-stage-name-input');
    await nextPage.fill('#settings-stage-name-input', stageName);
    await nextPage.locator('#settings-stage-name-input').blur();
    await afterNav();

    attachE2eBrowserTabLabel(nextPage, stageName);
    return { context: nextContext, page: nextPage };
  }

  async function openPeerDetail(page: Page, peerStageName: string): Promise<void> {
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();

    const detail = page.locator('#chatroom-detail-container');
    if (!(await detail.isVisible().catch(() => false))) {
      const globalRoom = page.locator('.chatroom-item[data-chatroom-id="global"]').first();
      await expect(globalRoom).toBeVisible({ timeout: 45000 });
      await globalRoom.click();
      await afterNav();
      await expect(detail).toBeVisible({ timeout: 10000 });
    }

    const member = page.locator('.chatroom-member-item').filter({ hasText: peerStageName }).first();
    await expect(member).toBeVisible({ timeout: 45000 });
    await member.click();
    await afterNav();

    await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#peer-stats-section')).toContainText('Public Profile', { timeout: 15000 });
  }

  async function getCurrentUserId(page: Page): Promise<string> {
    return (await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '')).trim();
  }

  async function waitForKnownPerson(page: Page, ownerId: string, targetId: string): Promise<void> {
    const knownPeopleUrl = `${gunBaseURL()}/api/users/${encodeURIComponent(ownerId)}/known-people`;
    await expect
      .poll(
        async () => {
          const res = await page.request.get(knownPeopleUrl);
          if (!res.ok()) return false;
          const knownPeople = await res.json();
          return Array.isArray(knownPeople) && knownPeople.some((person) => person?.userId === targetId);
        },
        { timeout: 30000 },
      )
      .toBe(true);
  }

  async function waitForProfileRows(
    page: Page,
    ownerId: string,
    viewerId: string,
    expectations: {
      visible: string[];
      hidden: string[];
    },
  ): Promise<void> {
    const userUrl = `${gunBaseURL()}/api/users/${encodeURIComponent(ownerId)}?viewerId=${encodeURIComponent(viewerId)}`;
    await expect
      .poll(
        async () => {
          const res = await page.request.get(userUrl);
          if (!res.ok()) return false;
          const user = await res.json();
          const profileText = JSON.stringify(user?.profile ?? []);
          return (
            expectations.visible.every((text) => profileText.includes(text)) &&
            expectations.hidden.every((text) => !profileText.includes(text))
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
  }

  test('hides contacts_only/private profile rows from non-owner viewers', async () => {
    const PUBLIC_Q = 'Public Q (visibility)';
    const PUBLIC_A = 'Public A (visibility)';
    const CONTACTS_Q = 'Contacts Only Q (visibility)';
    const CONTACTS_A = 'Contacts Only A (visibility)';
    const PRIVATE_Q = 'Private Q (visibility)';
    const PRIVATE_A = 'Private A (visibility)';

    // Owner: Tom sets three profile Q&A rows with distinct visibility levels.
    const tom = await bootstrapUser(browser, 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    pageTom.on('console', (m) => console.log('[Tom]:', m.text()));

    // Profile Q&A with visibility is saved via onProfileChange (Me tab no longer hosts Edit Profile UI).
    await pageTom.evaluate(
      async (rows) => {
        const app = (window as unknown as {
          __iinpublic_app?: {
            getApp: () => {
              currentUser?: { id: string };
              uiManager?: {
                onProfileChange?: (
                  userId: string,
                  updates: {
                    languages: string[];
                    profile: Array<Record<string, unknown>>;
                    interests: unknown[];
                  },
                ) => Promise<void>;
              };
            };
          };
        }).__iinpublic_app?.getApp?.();
        const user = app?.currentUser;
        if (!user?.id || !app?.uiManager?.onProfileChange) {
          throw new Error('Profile callback not ready');
        }
        const now = new Date();
        await app.uiManager.onProfileChange(user.id, {
          languages: ['en'],
          interests: [],
          profile: rows.map((row, index) => ({
            id: `profile_vis_${index}`,
            question: row.q,
            answer: row.a,
            isAuto: false,
            answeredAt: now,
            visibility: row.vis,
          })),
        });
      },
      [
        { q: PUBLIC_Q, a: PUBLIC_A, vis: 'public' },
        { q: CONTACTS_Q, a: CONTACTS_A, vis: 'contacts_only' },
        { q: PRIVATE_Q, a: PRIVATE_A, vis: 'private' },
      ],
    );
    await afterNav();
    await afterSync();

    const tomId = await getCurrentUserId(pageTom);
    expect(tomId).toBeTruthy();

    await waitForProfileRows(pageTom, tomId, tomId, {
      visible: [PUBLIC_Q, PUBLIC_A, CONTACTS_Q, CONTACTS_A, PRIVATE_Q, PRIVATE_A],
      hidden: [],
    });

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await afterSync();

    // Viewer 1: Jerry (not in Tom's known-people list)
    const jNon = await bootstrapUser(browser, 'JerryNonContact');
    contextJerryNonContact = jNon.context;
    pageJerryNonContact = jNon.page;
    pageJerryNonContact.on('console', (m) => console.log('[JerryNonContact]:', m.text()));
    await pageJerryNonContact.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await afterSync();
    const jNonContactId = await getCurrentUserId(pageJerryNonContact);
    expect(jNonContactId).toBeTruthy();

    // Viewer 2: Jerry2 (added to Tom's known-people list)
    const jContact = await bootstrapUser(browser, 'JerryContact');
    contextJerryContact = jContact.context;
    pageJerryContact = jContact.page;
    pageJerryContact.on('console', (m) => console.log('[JerryContact]:', m.text()));
    await pageJerryContact.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await afterSync();

    const jContactId = await getCurrentUserId(pageJerryContact);
    expect(jContactId).toBeTruthy();

    // Add JerryContact as a known person under Tom. This makes `contacts_only` rows visible.
    const postUrl = `${gunBaseURL()}/api/users/${encodeURIComponent(tomId)}/known-people`;
    const postRes = await pageJerryContact.request.post(postUrl, {
      data: {
        targetId: jContactId,
        label: 'friend',
      },
    });
    expect(postRes.ok()).toBeTruthy();
    await waitForKnownPerson(pageJerryContact, tomId, jContactId);
    await waitForProfileRows(pageJerryNonContact, tomId, jNonContactId, {
      visible: [PUBLIC_Q, PUBLIC_A],
      hidden: [CONTACTS_Q, CONTACTS_A, PRIVATE_Q, PRIVATE_A],
    });
    await waitForProfileRows(pageJerryContact, tomId, jContactId, {
      visible: [PUBLIC_Q, PUBLIC_A, CONTACTS_Q, CONTACTS_A],
      hidden: [PRIVATE_Q, PRIVATE_A],
    });

    // Assert for non-contact viewer: only `public` rows are visible.
    await pageTom.click('.chatroom-item[data-chatroom-id="global"]');
    await afterNav();
    await openPeerDetail(pageJerryNonContact, 'Tom');
    const statsNon = pageJerryNonContact.locator('#peer-stats-section');
    await expect(statsNon).toContainText(PUBLIC_Q);
    await expect(statsNon).toContainText(PUBLIC_A);
    await expect(statsNon).not.toContainText(CONTACTS_Q);
    await expect(statsNon).not.toContainText(CONTACTS_A);
    await expect(statsNon).not.toContainText(PRIVATE_Q);
    await expect(statsNon).not.toContainText(PRIVATE_A);

    // Assert for contact viewer: `contacts_only` rows are visible; `private` remains hidden.
    await openPeerDetail(pageJerryContact, 'Tom');
    const statsContact = pageJerryContact.locator('#peer-stats-section');
    await expect(statsContact).toContainText(PUBLIC_Q);
    await expect(statsContact).toContainText(PUBLIC_A);
    await expect(statsContact).toContainText(CONTACTS_Q);
    await expect(statsContact).toContainText(CONTACTS_A);
    await expect(statsContact).not.toContainText(PRIVATE_Q);
    await expect(statsContact).not.toContainText(PRIVATE_A);
  });
});
