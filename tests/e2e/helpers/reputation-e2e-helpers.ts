import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { afterAction, afterSync } from './timing';
import { gunBaseURL, isDirectTalkDeliveryE2e } from './ports';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from './talk-demo-ui';
import { openIncomingTalkModal, waitForResponseModalClosed, waitForTabActive } from './talks-matching-flow';
import { dismissNotificationOverlays, waitForPeerHistoryTitle } from './durable-ui';
import { ensureNoBlockBetween } from './blocking-e2e-helpers';

export async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id ?? '');
}

export async function getReputation(page: Page, userId: string, viewerId: string): Promise<any> {
  const reputation = await page.evaluate(
    async ({ uid, vid }) => {
      const app = (window as unknown as {
        __iinpublic_app?: { getApp: () => { getBackendApiBase?: () => string; userService?: { getUser: (id: string) => Promise<any> } } };
      }).__iinpublic_app?.getApp?.();

      const base = app?.getBackendApiBase?.();
      if (base) {
        for (let i = 0; i < 5; i += 1) {
          const ac = new AbortController();
          const timeoutId = window.setTimeout(() => ac.abort(), 4_000);
          try {
            const res = await fetch(
              `${base}/api/users/${encodeURIComponent(uid)}?viewerId=${encodeURIComponent(vid)}`,
              { headers: { 'Cache-Control': 'no-cache' }, signal: ac.signal },
            );
            if (!res.ok) continue;
            const user = await res.json();
            if (user?.reputation) return user.reputation;
          } catch {
            // retry
          } finally {
            window.clearTimeout(timeoutId);
          }
        }
      }

      const userService = app?.userService;
      if (!userService?.getUser) return null;
      const user = await userService.getUser(uid);
      return user?.reputation ?? null;
    },
    { uid: userId, vid: viewerId },
  );
  if (!reputation) throw new Error(`getReputation failed for userId=${userId}`);
  return reputation;
}

export async function enterGlobalChatroom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('.chatroom-item:has-text("Global")');
  await page.waitForSelector('.chatroom-member-item', { timeout: 15000 });
  await afterSync();
}

export async function createMatchTalk(page: Page, title: string): Promise<void> {
  await dismissNotificationOverlays(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(`Would you like to get coffee together? (${title})`);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, I would.');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No, thanks.');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await submitTalkEditorAndWaitForOut(page, title);
}

export async function createAdultTalk(page: Page, title: string): Promise<void> {
  await dismissNotificationOverlays(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Adult question: interested?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.check('#talk-is-adult');
  await submitTalkEditorAndWaitForOut(page, title);
}

export async function serverVouchAgeVerified(
  page: Page,
  targetUserId: string,
  votes = 1,
): Promise<void> {
  const url = `${gunBaseURL()}/api/users/${encodeURIComponent(targetUserId)}/age-verify`;
  for (let i = 0; i < votes; i += 1) {
    const res = await page.request.post(url);
    expect(res.ok(), `age-verify failed (${res.status()})`).toBeTruthy();
  }
}

async function saveKnownPersonForE2e(page: Page, targetId: string): Promise<void> {
  await page.evaluate((id) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const ui = app?.uiManager;
    if (!ui?.saveKnownPerson) throw new Error('uiManager.saveKnownPerson unavailable');
    return ui.saveKnownPerson(id, { label: 'friend' });
  }, targetId);
}

export async function establishContactsTomJerry(pageTom: Page, pageJerry: Page, title: string): Promise<void> {
  await enterGlobalChatroom(pageTom);
  await enterGlobalChatroom(pageJerry);
  const tomId = await getCurrentUserId(pageTom);
  const jerryId = await getCurrentUserId(pageJerry);
  await ensureNoBlockBetween(pageTom, tomId, pageJerry, jerryId);

  await createMatchTalk(pageTom, title);
  try {
    await clickBroadcastUntilBulkAck(pageTom);
  } catch (error) {
    if (!isDirectTalkDeliveryE2e()) throw error;
    await saveKnownPersonForE2e(pageTom, jerryId);
    await saveKnownPersonForE2e(pageJerry, tomId);
    await afterSync();
    return;
  }
  await afterAction();
  await waitForTabActive(pageTom, 'chatrooms');

  await openIncomingTalkModal(pageJerry, title);
  await pageJerry.locator('input.choice-radio[data-answer-text="Yes, I would."][data-mode="manual"]').first().click();
  await waitForResponseModalClosed(pageJerry);
  await afterSync();

  await waitForPeerHistoryTitle(pageTom, tomId, jerryId, title);
}
