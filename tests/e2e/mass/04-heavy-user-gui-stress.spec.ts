import * as fs from 'fs';
import * as path from 'path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { headless, afterSync, E2E_ASSERT_TIMEOUT_MS } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import {
  NUM_TALKS_PER_TYPE, NUM_ANSWERS, NUM_CONTACTS, RELATIONSHIP_LABELS,
  seedLocalData, seedContactsAsUsers,
} from '../helpers/heavy-user-seed';

export { NUM_TALKS_PER_TYPE, NUM_ANSWERS, NUM_CONTACTS };

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;
if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function captureScreenshot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

type ViewName = 'talks' | 'me' | 'contacts' | 'chatrooms' | 'settings';

async function browserNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

function warnIfSlow(view: string, ms: number, limit: number): void {
  if (ms > limit) console.warn(`[SLOW] ${view} took ${ms.toFixed(0)}ms (limit ${limit}ms)`);
}

async function pauseAfterTabSwitch(page: Page, view: ViewName): Promise<void> {
  const pauseEnabled =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.E2E_PAUSE_ON_TAB_SWITCH === '1';
  if (!pauseEnabled) return;

  console.log(`[pause] Switched to ${view}. Press Space in the browser window to continue...`);
  await page.evaluate(({ activeView }) => new Promise<void>((resolve) => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('keydown', onKeyDown, true);
      resolve();
    };

    window.addEventListener('keydown', onKeyDown, true);
    console.log(`[pause] Waiting on Space for tab: ${activeView}`);
  }), { activeView: view });
}

test.describe('M4 heavy-user GUI stress', () => {
  test('keeps every tab responsive with an already data-heavy user', async () => {
    test.setTimeout(600_000);
    await clearGunForStage1Spec();

    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--disable-dev-shm-usage'] });
    let context: BrowserContext | undefined;
    let page: Page | undefined;

    try {
      const boot = await bootstrapUser(browser, 'HeavyStress', 'Stress Tester', 60_000);
      context = boot.context;
      page = boot.page;

      // Enable unlimited talk ledger
      await page.evaluate(() => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (!app?.currentUser?.id) throw new Error('User not bootstrapped');
        app.setTalkLedgerQuotaUnlimitedForE2e(true);
      });

      const userId = await page.evaluate(() =>
        String((window as any).__iinpublic_app.getApp().currentUser.id));

      // Seed data — localStorage is instant, Gun contacts via HTTP takes ~4-10s  
      console.log(`[seed] ${NUM_TALKS_PER_TYPE * 4} talks + ${NUM_ANSWERS} answers + ${NUM_CONTACTS} contacts`);
      await seedLocalData(page, userId);

      const contactSeedStart = Date.now();
      await seedContactsAsUsers(page, userId);
      console.log(`[seed] Contacts seeded in ${((Date.now() - contactSeedStart) / 1000).toFixed(1)}s`);

      // Visit contacts tab to warm up Gun subscription for knownPeople. Seed is async via HTTP so
      // poll until at least some visible. Gun propagation of 500 writes can take a while in-memory mode.
      // Use reload to force the app to re-read knownPeople from Gun on cold start.
      await page.reload();

      console.log(`[contacts-warmup] reloading so adoptSessionUser picks up freshly seeded contacts`);
      const contactsTarget = Math.min(NUM_CONTACTS, 10); // at-least-a-few sanity check vs hard 500
      try {
        await expect.poll(
          () => page!.locator('#contacts-list .contact-item').count(),
          { timeout: 20_000, intervals: [1000] },
        ).toBeGreaterThanOrEqual(contactsTarget);
      } catch {
        // Gun propagation might not finish in time — still log what we have and continue measuring.
        const got = await page!.locator('#contacts-list .contact-item').count();
        console.warn(`[contacts-warmup] only ${got}/${NUM_CONTACTS} rendered yet (Gun async prop)`);
      }
      const warmContacts = await page!.locator('#contacts-list .contact-item').count();
      console.log(`[warmup] contacts=${warmContacts}/${NUM_CONTACTS}`);
      await afterSync();

      const talksTotal = NUM_TALKS_PER_TYPE * 4;

      // --- Talks tab ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="talks"]').click();
        await expect(page.locator('.nav-btn[data-view="talks"].active')).toBeVisible({ timeout: 15_000 });
        await pauseAfterTabSwitch(page, 'talks');
        const shellMs = (await browserNow(page)) - t0;

        // TODO §R2: hard time-to-first-row bound — renderListProgressively's first chunk
        // (25 OUT + 25 IN) renders synchronously, independent of talksTotal, so it should
        // land well inside a fraction of a second even with 500 talks seeded.
        await expect.poll(() => page!.locator('.talk-list-item').count(), { timeout: 500 })
          .toBeGreaterThan(0);
        const firstRowMs = (await browserNow(page)) - t0;

        await expect.poll(() => page!.locator('.talk-list-item').count(), { timeout: E2E_ASSERT_TIMEOUT_MS })
          .toBeGreaterThanOrEqual(talksTotal);
        const contentMs = (await browserNow(page)) - t0;
        const talkCount = await page.locator('.talk-list-item').count();
        warnIfSlow('talks shell', shellMs, 500);
        warnIfSlow('talks render', contentMs, 5000);
        console.log(`[talks] shell=${shellMs.toFixed(0)}ms firstRow=${firstRowMs.toFixed(0)}ms render=${contentMs.toFixed(0)}ms items=${talkCount}`);
        await captureScreenshot(page, '01-talks');

        // Scroll test
        const scrollEl = page.locator('#main-view-container');
        if (await scrollEl.count().then((c) => c > 0)) {
          await scrollEl.evaluate((el) => el?.scrollBy?.({ top: 2000 }));
        }
        await page.waitForTimeout(3000);
      }

      // --- Me tab ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="me"]').click();
        await expect(page.locator('.nav-btn[data-view="me"].active')).toBeVisible({ timeout: 15_000 });
        await pauseAfterTabSwitch(page, 'me');
        const shellMs = (await browserNow(page)) - t0;
        let firstRowMs = shellMs;
        if (NUM_ANSWERS > 0) {
          // TODO §R3: same hard first-row bound as Talks (R2) — a forward-looking perf
          // budget, not proof of a specific fixed regression (Me tab never had a blocking
          // pre-render chain either).
          await expect.poll(() => page!.locator('#answers-content .answer-talk-item').count(), { timeout: 500 })
            .toBeGreaterThan(0);
          firstRowMs = (await browserNow(page)) - t0;
          await expect.poll(() => page!.locator('#answers-content .answer-talk-item').count(), { timeout: E2E_ASSERT_TIMEOUT_MS })
            .toBeGreaterThanOrEqual(NUM_ANSWERS);
        } else {
          await expect(page.locator('#answers-content')).toBeVisible();
        }
        const contentMs = (await browserNow(page)) - t0;
        const answerCount = await page.locator('#answers-content .answer-talk-item').count();
        warnIfSlow('me shell', shellMs, 500);
        warnIfSlow('me render', contentMs, 5000);
        console.log(`[me]    shell=${shellMs.toFixed(0)}ms firstRow=${firstRowMs.toFixed(0)}ms render=${contentMs.toFixed(0)}ms items=${answerCount}`);
        await captureScreenshot(page, '02-me');

        await page.waitForTimeout(3000);
      }

      // --- Contacts tab (re-measure after visits) ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="contacts"]').click();
        await expect(page.locator('.nav-btn[data-view="contacts"].active')).toBeVisible({ timeout: 15_000 });
        await pauseAfterTabSwitch(page, 'contacts');
        const shellMs = (await browserNow(page)) - t0;

        // TODO §R1: hard time-to-first-row bound, not just an advisory warn — this is the
        // actual regression the requirement exists to prevent. renderListProgressively's
        // first chunk renders synchronously, independent of beforeRender's prefetch chain
        // (mesh exchange sync + location prefetch — the latter races a 2000ms timeout on
        // its own, `prefetchPeerLocations` in ui-manager.ts) and independent of
        // NUM_CONTACTS, so the first row should appear in comfortably under 500ms even
        // with 500 contacts seeded. Confirmed empirically: without this fix, first-row
        // time in this exact scenario lands at ~1950ms (dominated by the location-prefetch
        // race), so 500ms cleanly separates fixed from broken rather than sitting on top
        // of that race's own timeout.
        const FIRST_ROW_BOUND_MS = 500;
        await expect.poll(() => page!.locator('#contacts-list .contact-item').count(), { timeout: FIRST_ROW_BOUND_MS })
          .toBeGreaterThan(0);
        const firstRowMs = (await browserNow(page)) - t0;

        // Full-500 fill still has to actually complete — was previously only snapshotted
        // once and warned-on, never enforced.
        await expect.poll(() => page!.locator('#contacts-list .contact-item').count(), { timeout: E2E_ASSERT_TIMEOUT_MS })
          .toBeGreaterThanOrEqual(NUM_CONTACTS);
        const contactCount = await page.locator('#contacts-list .contact-item').count();
        const contentMs = (await browserNow(page)) - t0;
        warnIfSlow('contacts shell', shellMs, 500);
        warnIfSlow('contacts render', contentMs, 10_000);
        console.log(`[contacts] shell=${shellMs.toFixed(0)}ms firstRow=${firstRowMs.toFixed(0)}ms render=${contentMs.toFixed(0)}ms items=${contactCount}`);

        // Verify all label groups visible
        const labelsFound: boolean[] = [];
        for (const label of RELATIONSHIP_LABELS) {
          try {
            await expect(page.locator('#contacts-list').getByText(new RegExp(label[0].toUpperCase() + label.slice(1), 'i')).first())
              .toBeVisible({ timeout: 5_000 });
            labelsFound.push(true);
          } catch {
            labelsFound.push(false);
          }
        }
        console.log(`[labels]  visible=${labelsFound.filter(Boolean).length}/${RELATIONSHIP_LABELS.length}`);
        await captureScreenshot(page, '03-contacts');
      }

      // --- Chatrooms tab (sanity) ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="chatrooms"]').click();
        await expect(page.locator('.chatroom-item').filter({ hasText: 'Global' }).first()).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
        await pauseAfterTabSwitch(page, 'chatrooms');
        console.log(`[chatrooms] ok, render=${((await browserNow(page)) - t0).toFixed(0)}ms`);
        await captureScreenshot(page, '04-chatrooms');
      }

      // --- Settings tab (sanity) ---
      {
        const t0 = await browserNow(page);
        await page.locator('.nav-btn[data-view="settings"]').click();
        await expect(page.locator('#settings-content')).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
        await pauseAfterTabSwitch(page, 'settings');
        console.log(`[settings]  ok, render=${((await browserNow(page)) - t0).toFixed(0)}ms`);
        await captureScreenshot(page, '05-settings');
      }

    } finally {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await context?.close().catch(() => {});
      await browser.close().catch(() => {});
      await clearGunForStage1Spec();
    }
  });
});
