/**
 * Nearby screens (docs/design/nearby-and-place-chatrooms.md §3.7 "Map, list and headcounts"): the
 * Nearby row reads "People near you" with "N near you · M online" (my list, then the hub's count),
 * the open list offers "Show more people here", and a Nearby broadcast reports "Sent to N of M" as
 * the broadcast loop's deliveries are acknowledged. Asserted on both sides: Jerry is on Tom's list
 * and receives the Talk.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import { bootstrapUser, waitForIncomingTalkClusterOnLocalGun } from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk, goToChatrooms } from '../../helpers/broadcast-cancellation-helpers';
import { broadcastFromGlobalChatroom } from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Nearby screens', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async () => {
    browserTom = await chromium.launch({ headless, args: WEBRTC_CHROMIUM_ARGS });
    browserJerry = await chromium.launch({ headless, args: WEBRTC_CHROMIUM_ARGS });
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('People near you, N near you · M online, Show more, and Sent to N of M', async () => {
    test.setTimeout(180_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Screens');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Screens');
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    // The row: my list (Jerry, not me) and everyone the hub counts online (both of us).
    const row = pageTom.locator('.chatroom-item.current-room');
    await expect(row.locator('.chatroom-name')).toContainText('People near you');
    await expect(row.locator('[data-testid="nearby-headcount"]')).toHaveText('1 near you · 2 online', { timeout: 60_000 });
    await expect(pageTom.locator('[data-testid="room-list-total"]')).toContainText('2 online');

    // The open list: Jerry, the same counts, and "Show more people here".
    await row.click();
    await expect(pageTom.locator('.chatroom-member-item').filter({ hasText: 'Jerry Screens' })).toBeVisible({ timeout: 30_000 });
    await expect(pageTom.locator('#current-chatroom-status')).toHaveText('1 near you · 2 online');
    const showMore = pageTom.locator('[data-testid="nearby-show-more"]');
    await expect(showMore).toHaveText('Show more people here');
    await showMore.click();
    // With nobody else around, more room changes nothing: Jerry stays, nobody new appears.
    await afterSync();
    await expect(pageTom.locator('.chatroom-member-item')).toHaveCount(1);

    // A broadcast: "Sent to 1 of 1" once Jerry's phone acknowledges the Talk.
    const title = `Nearby screens ${Date.now()}`;
    await createSimpleFlowTalk(pageTom, title, 'Yes', 'No', { sendToChatroom: false });
    // The real Broadcast button: it waits for each recipient's acknowledgement (the e2e delivery
    // shortcut floods without acks, so it could never report progress).
    await broadcastFromGlobalChatroom(pageTom, { requirePreambleUi: true, minGunPeers: 1 });
    await waitForIncomingTalkClusterOnLocalGun(pageJerry, title, { timeout: 60_000, polling: 500 });
    await goToChatrooms(pageTom);
    await expect(pageTom.locator('[data-testid="nearby-broadcast-progress"]')).toHaveText('Sent to 1 of 1', { timeout: 30_000 });

    // Jerry's side matches: Tom is on his list.
    await expect(pageJerry.locator('.chatroom-item.current-room [data-testid="nearby-headcount"]')).toContainText('1 near you');
  });
});
