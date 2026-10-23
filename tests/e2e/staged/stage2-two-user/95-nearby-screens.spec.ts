/**
 * Nearby screens (docs/design/nearby-and-place-chatrooms.md §3.7 "Map, list and headcounts"): the
 * Nearby v3 renders people and chatroom folders in one file-browser list. The compact Nearby
 * directory keeps the aggregate headcount while each nearby person is directly visible without
 * opening that directory. Collection controls and broadcast progress do not clutter the list.
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

  test('nearby people and chatroom folders share one clean list', async () => {
    test.setTimeout(180_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Screens');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Screens');
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    // The row: my list (Jerry, not me) and everyone the hub counts online (both of us).
    const row = pageTom.locator('.chatroom-item.current-room');
    await expect(row.locator('.chatroom-name')).toContainText('Nearby');
    await expect(row.locator('.chatroom-icon')).toHaveText('📁');
    await expect(row.locator('[data-testid="nearby-headcount"]')).toHaveText('1 near you · 2 online', { timeout: 60_000 });
    await expect(pageTom.locator('[data-testid="room-list-total"]')).toContainText('2 online');
    await expect(pageTom.locator('[data-testid="nearby-person-row"]').filter({ hasText: 'Jerry Screens' })).toBeVisible();
    await expect(pageTom.locator('[data-testid="match-collection-toggle"]')).toHaveCount(0);
    await expect(pageTom.locator('#status-bar-text')).not.toContainText('Nearby');
    await expect(pageTom.locator('#status-bar-text')).not.toContainText('📍');

    // The open list: Jerry, the same counts, and the group bar (§3.7 "Meeting new people in groups").
    await row.click();
    await expect(pageTom.locator('.chatroom-member-item').filter({ hasText: 'Jerry Screens' })).toBeVisible({ timeout: 30_000 });
    await expect(pageTom.locator('#current-chatroom-status')).toHaveText('1 near you · 2 online');
    await expect(pageTom.locator('[data-testid="nearby-group-title"]')).toHaveText('Group 1 · the people nearest you');
    await expect(pageTom.locator('[data-testid="nearby-meet-new-people"]')).toHaveText('Meet new people');
    // Cancelling the confirmation changes nothing: Jerry stays.
    await pageTom.locator('[data-testid="nearby-meet-new-people"]').click();
    await pageTom.locator('[data-testid="nearby-meet-cancel"]').click();
    await afterSync();
    await expect(pageTom.locator('.chatroom-member-item')).toHaveCount(1);
    await expect(pageTom.locator('[data-testid="nearby-group-title"]')).toHaveText('Group 1 · the people nearest you');

    // A broadcast still delivers; its progress is intentionally not another control/status card
    // in the file-browser list.
    const title = `Nearby screens ${Date.now()}`;
    await createSimpleFlowTalk(pageTom, title, 'Yes', 'No', { sendToChatroom: false });
    // The real Broadcast button: it waits for each recipient's acknowledgement (the e2e delivery
    // shortcut floods without acks, so it could never report progress).
    await broadcastFromGlobalChatroom(pageTom, { requirePreambleUi: true, minGunPeers: 1 });
    await waitForIncomingTalkClusterOnLocalGun(pageJerry, title, { timeout: 60_000, polling: 500 });
    await goToChatrooms(pageTom);
    await expect(pageTom.locator('[data-testid="nearby-broadcast-progress"]')).toHaveCount(0);
    await expect(pageTom.locator('[data-testid="nearby-person-row"]').filter({ hasText: 'Jerry Screens' })).toBeVisible();

    // Jerry's side matches: Tom is on his list.
    await expect(pageJerry.locator('.chatroom-item.current-room [data-testid="nearby-headcount"]')).toContainText('1 near you');
  });
});
