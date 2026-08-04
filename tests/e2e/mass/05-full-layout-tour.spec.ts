/**
 * Full-layout screenshot tour: walks every reachable layout of the app — every tab, every
 * popup/dialog/overlay reachable from a data-heavy user — capturing one full-page screenshot
 * per state. Not a correctness test (no behavioral assertions beyond "the thing opened"); its
 * job is to produce a complete, current screenshot set + manifest for docs/gui-layout-review
 * PDFs. Excludes hardware-dependent flows (camera capture, real device pairing) since those
 * aren't reachable headlessly and aren't "layouts" in the reviewed sense.
 *
 * Run with E2E_SCREENSHOT_DIR set, e.g.:
 *   E2E_SCREENSHOT_DIR=/tmp/tour-shots npx playwright test tests/e2e/mass/05-full-layout-tour.spec.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { headless, afterSync, afterAction } from '../helpers/timing';
import { bootstrapUser, waitForTabActive, longPressTalkRow, openIncomingTalkModal } from '../helpers/talks-matching-flow';
import { createTalksFromCompanyPage, broadcastFromGlobalChatroom } from '../helpers/talk-demo-ui';
import { selectTalkEditorType } from '../helpers/talk-editor-e2e';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { makeTagTalk, makeFlowTalk, makeSurveyTalk, makeRouteTalk } from '../talks-matching/lib/four-types-talks';
import { NUM_CONTACTS, RELATIONSHIP_LABELS, seedLocalData, seedContactsAsUsers } from '../helpers/heavy-user-seed';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../src/shared/techsupport';

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR
  || '/private/tmp/claude-501/-Users-hongyujiang-IinPublic/a5595cad-1624-446a-8073-3572797821c4/scratchpad/tour-shots-full';
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

type Manifest = { file: string; section: string; caption: string }[];
const manifest: Manifest = [];
let shotIndex = 0;

async function shot(page: Page, section: string, slug: string, caption: string): Promise<void> {
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, '0')}-${slug}.png`;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, file), fullPage: true });
  manifest.push({ file, section, caption });
}

test.describe('M5 full-layout screenshot tour', () => {
  test('walks every reachable layout and captures a screenshot of each', async () => {
    test.setTimeout(600_000);
    await clearGunForStage1Spec();

    const browser: Browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--disable-dev-shm-usage'] });
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let senderContext: BrowserContext | undefined;
    let senderPage: Page | undefined;

    try {
      // --- Bootstrap the heavy user + seed 500 contacts / 500 talks (125x4) / 500 answers ---
      const boot = await bootstrapUser(browser, 'HeavyStress', 'Stress Tester', 60_000);
      context = boot.context;
      page = boot.page;

      await page.evaluate(() => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (!app?.currentUser?.id) throw new Error('User not bootstrapped');
        app.setTalkLedgerQuotaUnlimitedForE2e(true);
      });
      const userId = await page.evaluate(() => String((window as any).__iinpublic_app.getApp().currentUser.id));

      console.log('[seed] 500 talks + 500 answers + 500 contacts');
      await seedLocalData(page, userId);
      await seedContactsAsUsers(page, userId);
      await page.reload();
      await expect
        .poll(() => page!.locator('#contacts-list .contact-item').count(), { timeout: 20_000, intervals: [1000] })
        .toBeGreaterThanOrEqual(Math.min(NUM_CONTACTS, 10))
        .catch(() => {});
      await afterSync();

      // --- Bring up a second lightweight browser to deliver 4 REAL incoming talks (one per
      // type) so the Talks tab shows genuine IN rows and the response-dialog family, not just
      // the heavy user's own 500 OUT talks. ---
      const senderBrowser = await chromium.launch({ headless, args: WEBRTC_CHROMIUM_ARGS });
      const senderBoot = await bootstrapUser(senderBrowser, 'TourSender', 'Tour Sender', 60_000);
      senderContext = senderBoot.context;
      senderPage = senderBoot.page;
      const runId = Date.now();
      await createTalksFromCompanyPage(senderPage, [
        makeTagTalk(runId), makeFlowTalk(runId), makeSurveyTalk(runId), makeRouteTalk(runId),
      ]);
      await broadcastFromGlobalChatroom(senderPage);
      await afterSync();

      // ================= Chatrooms =================
      await page.locator('.nav-btn[data-view="chatrooms"]').click();
      await waitForTabActive(page, 'chatrooms');
      await afterSync();
      await shot(page, 'Chatrooms', 'chatrooms-list', 'Room list — Global plus the regional hierarchy, default view on login.');

      const expandIcon = page.locator('.chatroom-expand-icon').first();
      if (await expandIcon.count().then((c) => c > 0)) {
        await expandIcon.click();
        await afterAction();
        await shot(page, 'Chatrooms', 'chatrooms-hierarchy-expanded', 'Region node expanded in place — children render inline, no separate screen.');
      }

      await page.locator('.chatroom-item:has-text("Global")').first().click();
      await afterSync();
      // Give the sender's join time to propagate over Gun before the room-detail shot —
      // otherwise the member list can still show just the heavy user + TechSupport.
      const senderMember = page.locator('.chatroom-member-item').filter({ hasText: 'Tour Sender' }).first();
      await expect(senderMember).toBeVisible({ timeout: 20_000 }).catch(() => {});
      await shot(page, 'Chatrooms', 'chatrooms-room-detail', 'Room detail — member list for Global, including the heavy user, TechSupport, and the tour sender.');

      if (await senderMember.count().then((c) => c > 0)) {
        await senderMember.click();
        await afterSync();
        await shot(page, 'Chatrooms', 'chatrooms-member-dm', 'Tapping a chatroom member opens the DM conversation directly, with the shared ⟨User⟩ layout underneath.');
        await page.click('#back-from-conversation');
        await afterAction();
        await shot(page, 'Chatrooms', 'chatrooms-member-peer-detail', 'Backing out of the DM lands on the shared peer-detail (⟨User⟩) layout.');
        await page.click('#back-from-peer-detail');
        await afterAction();
      }
      await page.click('#back-to-chatrooms');
      await afterAction();

      // ================= Talks =================
      await page.locator('.nav-btn[data-view="talks"]').click();
      await waitForTabActive(page, 'talks');
      await expect.poll(() => page!.locator('.talk-list-item').count(), { timeout: 15_000 }).toBeGreaterThan(0);
      await shot(page, 'Talks', 'talks-list', 'Merged IN/OUT talks list — 500 outgoing talks (this user authored) plus incoming rows once delivered.');

      // Progressive rendering fills the list in chunks over time (R2) — flow/survey/route
      // rows sort after all 125 tag rows in creation order, so they may not exist in the DOM
      // yet. Wait for the full 500 before selecting a row by type below.
      await expect
        .poll(() => page!.locator('.talk-list-item[data-role="created"]').count(), { timeout: 60_000, intervals: [500] })
        .toBeGreaterThanOrEqual(500);

      // Talk editor — one screenshot per type, reusing the same open dialog.
      await page.click('#create-talk-btn');
      await expect(page.locator('#talk-editor-modal')).toBeVisible({ timeout: 10_000 });
      for (const type of ['tag', 'flow', 'survey', 'route'] as const) {
        await selectTalkEditorType(page, type);
        await afterAction();
        await shot(page, 'Talks', `talks-editor-${type}`, `Talk editor — ${type} type question/branching UI.`);
      }
      await page.click('#cancel-talk-btn');
      await afterAction();

      // OUT talk details popup (long-press) — tag rows are intentionally excluded: they're
      // a simpler single-line checkbox chip with no separate details popup (37-compact-talk-
      // rows-out.spec.ts), already fully shown in the talks-list screenshot above.
      //
      // The merged list can re-render from scratch mid-tour (Gun sync activity from the
      // still-propagating 500 seeded contacts), which transiently resets the DOM to just
      // renderListProgressively's first chunk until the deferred remainder re-appends —
      // a fresh row query can race that and get a null bounding box. Retry a few times.
      // longPressTalkRow uses the row's boundingBox() as viewport-relative mouse
      // coordinates — with 500 rows the target is almost always scrolled out of the
      // current viewport, so scroll it into view first or the gesture lands on nothing.
      const longPressTalkRowWithRetry = async (rowLocator: Locator, attempts = 5): Promise<boolean> => {
        for (let i = 0; i < attempts; i++) {
          if (await rowLocator.count().then((c) => c === 0)) {
            await page!.waitForTimeout(500);
            continue;
          }
          try {
            const target = rowLocator.first();
            await target.scrollIntoViewIfNeeded();
            await page!.waitForTimeout(100);
            await longPressTalkRow(page!, target);
            return true;
          } catch {
            await page!.waitForTimeout(500);
          }
        }
        return false;
      };

      for (const type of ['flow', 'survey', 'route'] as const) {
        const row = page.locator(`.talk-list-item[data-role="created"][data-talk-type="${type}"]`);
        const opened = await longPressTalkRowWithRetry(row);
        if (!opened) {
          console.warn(`[tour] skipping OUT details shot for ${type}: row never stabilized`);
          continue;
        }
        const popup = page.locator('#item-details-popup');
        await expect(popup).toBeVisible({ timeout: 10_000 });
        await shot(page, 'Talks', `talks-out-details-${type}`, `Outgoing talk details popup (long-press) — ${type} type metadata.`);
        await popup.locator('#close-item-details-popup').click();
        await afterAction();
      }

      // IN talk response dialog — one per type, delivered for real by the sender above.
      const incomingTitles: Record<string, string> = {
        tag: `E2E FourTypes Tag ${runId}`,
        flow: `E2E FourTypes Flow ${runId}`,
        survey: `E2E FourTypes Survey ${runId}`,
        route: `E2E FourTypes Route ${runId}`,
      };
      for (const [type, title] of Object.entries(incomingTitles)) {
        try {
          await openIncomingTalkModal(page, title, { timeout: 60_000 });
          await shot(page, 'Talks', `talks-in-response-${type}`, `Incoming talk response dialog — ${type} type.`);
          const closeBtn = page.locator('[data-testid="close-response-btn"]');
          if (await closeBtn.count().then((c) => c > 0)) {
            await closeBtn.click();
          } else {
            // Tag-type response dialog has no dismiss affordance (submit-only by design —
            // talk-response-dialog.ts) — remove the modal directly rather than submitting an
            // unintended answer just to unblock the tour.
            await page.evaluate(() => document.getElementById('talk-response-modal')?.remove());
          }
          await afterAction();
        } catch (error) {
          console.warn(`[tour] skipping IN response shot for ${type}: ${(error as Error).message}`);
        }
      }

      // ================= Contacts =================
      await page.locator('.nav-btn[data-view="contacts"]').click();
      await waitForTabActive(page, 'contacts');
      await expect.poll(() => page!.locator('#contacts-list .contact-item').count(), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(Math.min(NUM_CONTACTS, 10));
      await shot(page, 'Contacts', 'contacts-list', `Contact list — ${NUM_CONTACTS} contacts across ${RELATIONSHIP_LABELS.length} relationship labels, merged stats line, icon broadcast button.`);

      const filterToggle = page.locator('[data-testid="contacts-filter-toggle"]');
      if (await filterToggle.count().then((c) => c > 0)) {
        await filterToggle.click();
        await afterAction();
        await shot(page, 'Contacts', 'contacts-filters-expanded', 'Filters/sort disclosure expanded.');
        const sortSelect = page.locator('#contacts-sort-order');
        if (await sortSelect.count().then((c) => c > 0)) {
          await sortSelect.selectOption('relationship');
          await afterAction();
          await shot(page, 'Contacts', 'contacts-sorted-by-relationship', 'Contacts sorted by relationship label.');
        }
      }

      const ordinaryContact = page.locator('.contact-item:not([data-support-contact="true"])').first();
      await ordinaryContact.click();
      await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
      await shot(page, 'Contacts', 'contacts-peer-detail', 'Row tap opens the shared peer-detail (⟨User⟩) layout directly — relationship, stats, talk history.');

      const relBtn = page.locator('#contact-edit-relationship-btn');
      if (await relBtn.count().then((c) => c > 0)) {
        await relBtn.click();
        await expect(page.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10_000 });
        await shot(page, 'Contacts', 'contacts-relationship-modal', 'Relationship edit modal — nickname, label, rating, notes.');
        const closeRel = page.locator('#close-contact-relationship-modal, #contact-relationship-close-btn');
        if (await closeRel.count().then((c) => c > 0)) await closeRel.first().click();
        await afterAction();
      }
      await page.click('#back-from-peer-detail');
      await afterAction();

      const namedContact = page.locator('.contact-item:not([data-support-contact="true"])').first();
      await namedContact.locator('.contact-item-name').click();
      await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
      await shot(page, 'Contacts', 'contacts-dm-conversation', 'Tapping the underlined name opens the DM conversation directly.');
      await page.click('#back-from-conversation');
      await afterAction();
      const backFromPeer = page.locator('#back-from-peer-detail');
      if (await backFromPeer.isVisible().catch(() => false)) await backFromPeer.click();
      await afterAction();

      const supportRow = page.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
      if (await supportRow.count().then((c) => c > 0)) {
        await supportRow.click();
        await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
        await shot(page, 'Contacts', 'contacts-techsupport-peer-detail', 'TechSupport’s pinned contact row — same peer-detail layout, mute-aware.');
        const supportRelBtn = page.locator('#contact-edit-relationship-btn');
        if (await supportRelBtn.count().then((c) => c > 0)) {
          await supportRelBtn.click();
          await expect(page.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10_000 });
          await shot(page, 'Contacts', 'contacts-techsupport-support-controls', 'TechSupport’s relationship dialog is mute-only — no Block button rendered at all.');
          const closeSupportRel = page.locator('#close-contact-relationship-modal, #contact-relationship-close-btn');
          if (await closeSupportRel.count().then((c) => c > 0)) await closeSupportRel.first().click();
          await afterAction();
        }
        await page.click('#back-from-peer-detail');
        await afterAction();
      }

      const broadcastBtn = page.locator('#contacts-broadcast-group-btn');
      if (await broadcastBtn.count().then((c) => c > 0)) {
        await broadcastBtn.click();
        const groupModal = page.locator('#broadcast-group-modal');
        if (await groupModal.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await shot(page, 'Contacts', 'contacts-broadcast-group-modal', 'Broadcast-to-group modal — pick a relationship group and a talk to send.');
          await page.locator('[data-testid="broadcast-group-cancel"]').click();
          await afterAction();
        }
      }

      // ================= Me =================
      await page.locator('.nav-btn[data-view="me"]').click();
      await waitForTabActive(page, 'me');
      await expect.poll(() => page!.locator('#answers-content .answer-talk-item').count(), { timeout: 15_000 }).toBeGreaterThan(0);
      await shot(page, 'Me', 'me-answers-list', 'Answered questions merged by spec-defined question identity — one row per question regardless of which talk asked it.');

      const answerRow = page.locator('#answers-content .answer-talk-item').first();
      await answerRow.click();
      await expect(page.locator('#item-details-popup')).toBeVisible({ timeout: 10_000 });
      await shot(page, 'Me', 'me-answer-details-popup', 'Answer details popup — per-variant breakdown: talk, outcome, language, mode.');
      await page.locator('#close-item-details-popup').click();
      await afterAction();

      const answersSearch = page.locator('#answers-search-input');
      if (await answersSearch.count().then((c) => c > 0)) {
        await answersSearch.fill('Answer 4');
        await afterAction();
        await shot(page, 'Me', 'me-search-filtered', 'Answers filtered by search.');
        await answersSearch.fill('');
        await afterAction();
      }

      const prefsBtn = page.locator('#view-preferences-btn');
      if (await prefsBtn.count().then((c) => c > 0)) {
        await prefsBtn.click();
        await expect(page.locator('#preferences-modal')).toBeVisible({ timeout: 10_000 });
        await shot(page, 'Me', 'me-preferences-modal', 'Preferences modal — auto-answer mode controls.');
        const closePrefs = page.locator('#close-preferences-modal');
        if (await closePrefs.count().then((c) => c > 0)) await closePrefs.click();
        await afterAction();
      }

      // ================= Settings =================
      await page.locator('.nav-btn[data-view="settings"]').click();
      await waitForTabActive(page, 'settings');
      await expect(page.locator('#settings-jump-menu')).toBeVisible({ timeout: 15_000 });
      await shot(page, 'Settings', 'settings-jump-menu', 'One flat jump menu over all settings sections — every section still renders open below it.');

      const filtersJump = page.locator('.settings-jump-menu-item[data-target="settings-section-content-filters"]');
      if (await filtersJump.count().then((c) => c > 0)) {
        await filtersJump.click();
        await afterAction();
        await shot(page, 'Settings', 'settings-jumped-content-filters', 'Jump menu scrolls to and flashes a section — Content Filters here.');
      }

      const linkedDevicesBtn = page.locator('#settings-linked-devices-btn');
      if (await linkedDevicesBtn.count().then((c) => c > 0)) {
        await linkedDevicesBtn.click();
        const overlay = page.locator('#linked-devices-overlay');
        if (await overlay.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await shot(page, 'Settings', 'settings-linked-devices', 'Linked devices overlay.');
          await page.locator('#linked-devices-close').click();
          await afterAction();
        }
      }

      const eraseBtn = page.locator('#settings-erase-device-btn');
      if (await eraseBtn.count().then((c) => c > 0)) {
        await eraseBtn.click();
        const eraseModal = page.locator('#erase-device-modal');
        if (await eraseModal.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await shot(page, 'Settings', 'settings-erase-device', 'Erase-device confirmation — type-to-confirm guard, cancelled here (not actually erased).');
          // IMPORTANT: cancel only — never click the actual erase button in this tour.
          await page.locator('#erase-cancel-btn').click();
          await afterAction();
        }
      }

      fs.writeFileSync(path.join(SCREENSHOT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
      console.log(`[tour] captured ${manifest.length} screenshots -> ${SCREENSHOT_DIR}`);
    } finally {
      await senderPage?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await senderContext?.close().catch(() => {});
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      await context?.close().catch(() => {});
      await browser.close().catch(() => {});
      await clearGunForStage1Spec();
    }
  });
});
