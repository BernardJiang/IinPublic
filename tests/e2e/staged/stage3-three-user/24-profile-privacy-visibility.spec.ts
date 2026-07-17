/**
 * Profile privacy visibility: per-viewer filtering of profile Q&A rows.
 *
 * Server rule (src/shared/profile-privacy.ts + GET /api/users/:id?viewerId=...):
 * - `public`: anyone
 * - `contacts_only`: viewer must be in owner's known-people list
 * - `private`: owner only (always hidden from non-self viewers)
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear } from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterAction, afterNav, afterSync, headless } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Profile privacy visibility', () => {
  let browser: Browser;

  let contextTom: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let contextJerryContact: BrowserContext | undefined;
  let pageJerryContact: Page | undefined;
  let contextJerryNonContact: BrowserContext | undefined;
  let pageJerryNonContact: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
    browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
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
    await maybeClearGunDatabases();
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

  async function waitForProfileCallbackReady(page: Page): Promise<void> {
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = (window as unknown as { __iinpublic_app?: { getApp: () => unknown } }).__iinpublic_app?.getApp?.() as
              | { currentUser?: { id?: string }; uiManager?: { onProfileChange?: unknown } }
              | undefined;
            return !!(app?.currentUser?.id && app?.uiManager?.onProfileChange);
          }),
        { timeout: 90_000, intervals: [400, 800, 1200] },
      )
      .toBe(true);
  }

  /** Viewers default to GPS home (San Diego); switch into Global detail before member lookup. */
  async function ensureGlobalRoomDetail(page: Page): Promise<void> {
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();

    const backBtn = page.locator('#back-to-chatrooms');
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await afterNav();
    }

    const globalRoom = page.locator('.chatroom-item[data-chatroom-id="global"]').first();
    await expect(globalRoom).toBeVisible({ timeout: 60_000 });
    await globalRoom.click();
    await afterNav();
    await expect(page.locator('#chatroom-detail-container')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await page.locator('#status-bar-text').innerText()).includes('Global'), {
        timeout: 90_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(true);
  }

  async function openPeerDetail(page: Page, peerUserId: string, _peerStageName: string): Promise<void> {
    await ensureGlobalRoomDetail(page);

    const member = page.locator(`.chatroom-member-item[data-user-id="${peerUserId}"]`);
    await expect(member).toBeVisible({ timeout: 90_000 });
    await member.click();
    await afterNav();

    // Rule N2a: dismiss the auto-opened DM conversation to inspect the User layout.
    await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await page.click('#back-from-conversation');
    await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#peer-stats-section')).toContainText('Public Profile', { timeout: 60_000 });
  }

  async function waitForPeerStatsProfile(
    page: Page,
    expectations: { visible: string[]; hidden: string[] },
  ): Promise<void> {
    const stats = page.locator('#peer-stats-section');
    await expect
      .poll(
        async () => {
          const text = await stats.innerText();
          return (
            expectations.visible.every((snippet) => text.includes(snippet)) &&
            expectations.hidden.every((snippet) => !text.includes(snippet))
          );
        },
        { timeout: 60_000, intervals: [400, 800, 1200] },
      )
      .toBe(true);
  }

  async function getCurrentUserId(page: Page): Promise<string> {
    return (await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '')).trim();
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
        { timeout: 120_000, intervals: [500, 1000, 2000, 4000] },
      )
      .toBe(true);
  }

  async function postKnownPersonUntilProfileVisible(
    page: Page,
    ownerId: string,
    targetId: string,
    expectations: {
      visible: string[];
      hidden: string[];
    },
  ): Promise<void> {
    const postUrl = `${gunBaseURL()}/api/users/${encodeURIComponent(ownerId)}/known-people`;
    const userUrl = `${gunBaseURL()}/api/users/${encodeURIComponent(ownerId)}?viewerId=${encodeURIComponent(targetId)}`;

    await expect
      .poll(
        async () => {
          const postRes = await page.request.post(postUrl, {
            data: {
              targetId,
              label: 'friend',
            },
          });
          if (!postRes.ok()) return false;

          // Delay to allow server-side write + Gun replication to propagate before the GET check.
          // Parallel workers with multiple Gun servers need longer propagation windows.
          await new Promise((r) => setTimeout(r, 3000));

          const userRes = await page.request.get(userUrl);
          if (!userRes.ok()) return false;
          const user = await userRes.json();
          const profileText = JSON.stringify(user?.profile ?? []);
          return (
            expectations.visible.every((text) => profileText.includes(text)) &&
            expectations.hidden.every((text) => !profileText.includes(text))
          );
        },
        { timeout: 120_000, intervals: [2000, 4000, 8000] },
      )
      .toBe(true);
  }

  test('hides contacts_only/private profile rows from non-owner viewers', async () => {
    test.setTimeout(480_000);
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
    attachFilteredConsoleLog(pageTom, 'Tom');

    await waitForProfileCallbackReady(pageTom);

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

    await ensureGlobalRoomDetail(pageTom);

    // Viewer 1: Jerry (not in Tom's known-people list)
    const jNon = await bootstrapUser(browser, 'JerryNonContact');
    contextJerryNonContact = jNon.context;
    pageJerryNonContact = jNon.page;
    attachFilteredConsoleLog(pageJerryNonContact, 'JerryNonContact');
    await ensureGlobalRoomDetail(pageJerryNonContact);
    const jNonContactId = await getCurrentUserId(pageJerryNonContact);
    expect(jNonContactId).toBeTruthy();

    // Viewer 2: Jerry2 (added to Tom's known-people list)
    const jContact = await bootstrapUser(browser, 'JerryContact');
    contextJerryContact = jContact.context;
    pageJerryContact = jContact.page;
    attachFilteredConsoleLog(pageJerryContact, 'JerryContact');
    await ensureGlobalRoomDetail(pageJerryContact);

    const jContactId = await getCurrentUserId(pageJerryContact);
    expect(jContactId).toBeTruthy();

    // Add JerryContact as a known person under Tom. This makes `contacts_only` rows visible.
    await waitForProfileRows(pageJerryNonContact, tomId, jNonContactId, {
      visible: [PUBLIC_Q, PUBLIC_A],
      hidden: [CONTACTS_Q, CONTACTS_A, PRIVATE_Q, PRIVATE_A],
    });
    await postKnownPersonUntilProfileVisible(pageTom, tomId, jContactId, {
      visible: [PUBLIC_Q, PUBLIC_A, CONTACTS_Q, CONTACTS_A],
      hidden: [PRIVATE_Q, PRIVATE_A],
    });

    await expect(pageTom.locator(`.chatroom-member-item[data-user-id="${jNonContactId}"]`)).toBeVisible({
      timeout: 90_000,
    });
    await expect(pageTom.locator(`.chatroom-member-item[data-user-id="${jContactId}"]`)).toBeVisible({
      timeout: 90_000,
    });

    // Assert for non-contact viewer: only `public` rows are visible.
    await openPeerDetail(pageJerryNonContact, tomId, 'Tom');
    await waitForPeerStatsProfile(pageJerryNonContact, {
      visible: [PUBLIC_Q, PUBLIC_A],
      hidden: [CONTACTS_Q, CONTACTS_A, PRIVATE_Q, PRIVATE_A],
    });

    // Contact-only rows are not published on the public graph. They will be shared by
    // an encrypted pair-profile protocol; until then the public reader fails closed.
    await openPeerDetail(pageJerryContact, tomId, 'Tom');
    await waitForPeerStatsProfile(pageJerryContact, {
      visible: [PUBLIC_Q, PUBLIC_A],
      hidden: [CONTACTS_Q, CONTACTS_A, PRIVATE_Q, PRIVATE_A],
    });
  });
});
