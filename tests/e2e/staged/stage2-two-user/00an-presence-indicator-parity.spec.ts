/**
 * Presence indicator parity: the Contacts tab and a chatroom's member list render the same
 * online/away dot (.presence-indicator, ui-manager.ts `setConversationOnlineStatus` /
 * `patchPresenceIndicators`) for an ordinary peer — not just the TechSupport-specific one.
 *
 * Flow:
 *  1. Tom and Jerry both join Global — Jerry is a real chatroom member.
 *  2. Tom's member-list row for Jerry starts with a presence indicator in the "away" state
 *     (no real presence signal has arrived yet).
 *  3. Tom and Jerry match on a talk — Jerry now also appears as a Contacts-tab row.
 *  4. Simulating a presence refresh (setConversationOnlineStatus) with Jerry's id present
 *     flips Jerry's dot to "online" in BOTH the chatroom member list (live DOM patch, no
 *     re-render needed) and the Contacts list (rendered fresh from the same online set).
 *  5. A peer NOT in the online set stays "away" in Contacts.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterNav } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { createTagTalkViaEditor, broadcastFromGlobalChatroom } from '../../helpers/talk-demo-ui';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { makeTagTalk } from '../../talks-matching/lib/four-types-talks';

test.describe.configure({ timeout: 120_000 });

test.describe('Presence indicator parity: Contacts tab vs chatroom member list', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserJerry = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('same online/away dot renders for an ordinary peer in both lists', async () => {
    const runId = Date.now();
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    const jerryId = await pageJerry.evaluate(() => String((window as any).__iinpublic_app.getApp().currentUser.id));

    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // --- Chatroom member list: Jerry's row has a presence dot, default "away" ---
    const jerryMember = pageTom.locator(`.chatroom-member-item[data-user-id="${jerryId}"]`);
    await expect(jerryMember).toBeVisible({ timeout: 15_000 });
    const memberIndicator = jerryMember.locator('.presence-indicator');
    await expect(memberIndicator).toHaveCount(1);
    await expect(memberIndicator).toHaveClass(/away/);
    await expect(memberIndicator).not.toHaveClass(/online/);

    // --- Match so Jerry also appears as a Contacts-tab row ---
    const tag = makeTagTalk(runId);
    await createTagTalkViaEditor(pageTom, { title: tag.title });
    await broadcastFromGlobalChatroom(pageTom);
    await afterSync();
    await openIncomingTalkModal(pageJerry, tag.title);
    // Tag-type response dialog is a checkbox + Submit, not the choice-radio grid flow/survey/
    // route use (talk-response-dialog.ts).
    await pageJerry.locator('#tag-match-checkbox').check();
    await pageJerry.locator('#tag-submit-response').click();
    await waitForResponseModalClosed(pageJerry);
    await waitForStatusBarMatchCountAtLeast(pageTom, 1);
    await afterSync();

    // --- Simulate a presence refresh with Jerry online ---
    await pageTom.evaluate((otherId) => {
      (window as any).__iinpublic_app.getApp().uiManager.setConversationOnlineStatus(new Set([otherId]));
    }, jerryId);

    // Chatroom member list: live DOM patch, no re-render/re-navigation needed.
    await expect(memberIndicator).toHaveClass(/online/);
    await expect(memberIndicator).not.toHaveClass(/away/);

    // Contacts list: rendered fresh from the same online set.
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageTom, 'contacts');
    await afterNav();
    const jerryContact = pageTom.locator(`.contact-item[data-contact-user-id="${jerryId}"]`);
    await expect(jerryContact).toBeVisible({ timeout: 15_000 });
    const contactIndicator = jerryContact.locator('.presence-indicator');
    await expect(contactIndicator).toHaveCount(1);
    await expect(contactIndicator).toHaveClass(/online/);
    await expect(contactIndicator).not.toHaveClass(/away/);

    // A peer not in the online set stays "away" — the default isn't stuck permanently on.
    await pageTom.evaluate(() => {
      (window as any).__iinpublic_app.getApp().uiManager.setConversationOnlineStatus(new Set());
    });
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(pageTom, 'chatrooms');
    await afterNav();
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageTom, 'contacts');
    await afterNav();
    const jerryContactAgain = pageTom.locator(`.contact-item[data-contact-user-id="${jerryId}"] .presence-indicator`);
    await expect(jerryContactAgain).toHaveClass(/away/);
    await expect(jerryContactAgain).not.toHaveClass(/online/);
  });
});
