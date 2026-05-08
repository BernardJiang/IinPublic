/**
 * TODO gap coverage:
 * - talk deletion by creator mid-broadcast
 * - broadcast cancellation/abortion (skip remaining in-flight batches)
 * - talk matching still works after switching chatrooms
 */
import { chromium, Browser, Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterAction, afterNav, afterSync, headless } from './helpers/timing';
import { gunBaseURL } from './helpers/ports';
import {
  bootstrapUser,
  openIncomingTalkModal,
  waitForIncomingTalkClusterOnServer,
  waitForResponseModalClosed,
} from './helpers/talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';
import { waitForStatusBarMatchCountAtLeast } from './helpers/durable-ui';

const noCacheHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } as const;

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

async function incomingClustersIncludeTitleSubstring(
  request: APIRequestContext,
  uid: string,
  needleSubstring: string,
): Promise<boolean> {
  const r = await request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(uid)}/incoming-talks`, {
    headers: noCacheHeaders,
  });
  if (!r.ok()) return false;
  const clusters: any = await r.json();
  const needle = needleSubstring.toLowerCase();

  // Fast path: cluster may already include title.
  if (Array.isArray(clusters)) {
    for (const c of clusters) {
      if (String(c?.title || '').toLowerCase().includes(needle)) return true;
    }
  }

  // Robust path: fetch talk titles from talkIds when title isn't present on the cluster object.
  if (Array.isArray(clusters)) {
    for (const c of clusters) {
      const talkIds = c?.talkIds;
      if (!talkIds || typeof talkIds !== 'object' || Array.isArray(talkIds)) continue;
      const ids = Object.keys(talkIds).filter((k) => !k.startsWith('_'));
      for (const id of ids) {
        const tr = await request.get(`${gunBaseURL()}/api/talks/${encodeURIComponent(id)}`, { headers: noCacheHeaders });
        if (!tr.ok()) continue;
        const td = await tr.json();
        if (String(td?.title || '').toLowerCase().includes(needle)) return true;
      }
    }
  }

  return false;
}

async function createSimpleFlowTalk(page: Page, title: string, matchAnswer = 'Yes', ignoreAnswer = 'No'): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  // helper relies on stable IN/out row; modest sync after nav.
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');

  const q = page.locator('.question-item').first();
  // Ensure each created talk has a unique content hash by varying question text too.
  // (In this codebase, content-hash talk IDs may ignore the talk title.)
  await q.locator('.question-text').fill(`Want a partner? ${title}`);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill(matchAnswer);
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill(ignoreAnswer);
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

async function goToChatrooms(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await afterSync();
}

async function waitForBroadcastBulkAckMinSent(
  page: Page,
  expected: { receivers: number; minSent: number },
  timeout = 120_000,
): Promise<void> {
  const loc = page.locator('[data-testid="broadcast-bulk-ack"]');
  await expect
    .poll(
      async () => {
        const sentStr = await loc.getAttribute('data-broadcast-talks-sent');
        const recvStr = await loc.getAttribute('data-broadcast-receivers');
        const sent = sentStr ? Number(sentStr) : 0;
        const recv = recvStr ? Number(recvStr) : 0;
        return recv === expected.receivers && sent >= expected.minSent;
      },
      { timeout, intervals: [200, 400, 800], message: 'waiting for broadcast completion attributes' },
    )
    .toBe(true);
}

test.describe('Broadcast cancellation + chatroom boundary matching', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';

  test.beforeAll(async () => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunDatabases();
  });

  test('talk deletion by creator mid-broadcast cancels remaining talk delivery', async () => {
    const talkTitles = Array.from({ length: 6 }, (_, i) => `Deletion Cancel Talk ${i + 1}`);
    const tomStage = 'Tom DelCancel';
    const jerryStage = 'Jerry DelCancel';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);

    let pageTom = tom.page;
    let pageJerry = jerry.page;

    try {
      const talkIds: string[] = [];
      for (const t of talkTitles) {
        await createSimpleFlowTalk(pageTom, t);
        const tid = await pageTom.evaluate((title) => {
          const raw = localStorage.getItem('myTalks');
          const myTalks = raw ? (JSON.parse(raw) as Record<string, any>) : {};
          return Object.entries(myTalks).find(([, v]) => v?.title === title)?.[0] ?? '';
        }, t);
        expect(tid).toBeTruthy();
        talkIds.push(tid);
      }

      await goToChatrooms(pageTom);

      const talkIdToDelete = talkIds[5];
      let registerCount = 0;
      let resolveReadyToDelete: (() => void) | null = null;
      const readyToDelete = new Promise<void>((resolve) => {
        resolveReadyToDelete = resolve;
      });

      await pageTom.route('**/api/talks/*/register-receivers-for-broadcast', async (route) => {
        registerCount += 1;
        // Only delay dispatch of the 5th request so batch-1 stays in-flight while we delete talk 6.
        if (registerCount === 5) {
          resolveReadyToDelete?.();
          await new Promise((r) => setTimeout(r, 10_000));
        }
        await route.continue();
      });

      // Start broadcast.
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await afterAction();

      // Delete talk 6 while batch-1 register requests are still delayed.
      await readyToDelete;
      await afterAction();

      await pageTom.click('.nav-btn[data-view="me"]');
      await afterNav();
      await pageTom.click('#view-my-talks-btn');
      await afterAction();

      await pageTom.locator(`#my-talks-modal .delete-talk-btn[data-talk-id="${talkIdToDelete}"]`).click();
      await afterAction();
      await pageTom.click('#close-my-talks-modal');
      await afterAction();
      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await afterSync();

      // Batch semantics: REGISTER_BATCH=5. We only need to ensure the broadcast completed
      // and that talk 6 was skipped; earlier register requests may still fail transiently.
      await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 1 });

      // At least one talk from the first batch should exist (sanity check).
      await waitForIncomingTalkClusterOnServer(pageJerry, talkTitles[4], { timeout: 60_000, polling: 500 });

      // Talk 6 must NOT appear in Jerry's incoming list.
      const jerryId = await getCurrentUserId(pageJerry);
      await expect
        .poll(
          async () =>
            incomingClustersIncludeTitleSubstring(
              pageJerry.context().request,
              jerryId,
              talkTitles[5],
            ),
          { timeout: 35_000, intervals: [500], message: 'talk 6 should be cancelled mid-broadcast' },
        )
        .toBe(false);
    } finally {
      await pageTom
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await pageJerry
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await tom.context?.close().catch(() => {});
      await jerry.context?.close().catch(() => {});
    }
  });

  test('broadcast cancellation/abortion skips remaining batches when creator clears all talks mid-flight', async () => {
    const talkTitles = Array.from({ length: 10 }, (_, i) => `Broadcast Abort Talk ${i + 1}`);
    const tomStage = 'Tom Abort';
    const jerryStage = 'Jerry Abort';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      const talkIds: string[] = [];
      for (const t of talkTitles) {
        await createSimpleFlowTalk(pageTom, t);
        const tid = await pageTom.evaluate((title) => {
          const raw = localStorage.getItem('myTalks');
          const myTalks = raw ? (JSON.parse(raw) as Record<string, any>) : {};
          return Object.entries(myTalks).find(([, v]) => v?.title === title)?.[0] ?? '';
        }, t);
        expect(tid).toBeTruthy();
        talkIds.push(tid);
      }

      await goToChatrooms(pageTom);

      let registerCount = 0;
      let resolveReadyToClear: (() => void) | null = null;
      const readyToClear = new Promise<void>((resolve) => {
        resolveReadyToClear = resolve;
      });

      await pageTom.route('**/api/talks/*/register-receivers-for-broadcast', async (route) => {
        registerCount += 1;
        if (registerCount === 5) {
          resolveReadyToClear?.();
          await new Promise((r) => setTimeout(r, 10_000));
        }
        await route.continue();
      });

      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await afterAction();

      await readyToClear;
      await afterAction();

      // Clear all talks while Phase 1 batch-1 register requests are delayed.
      await pageTom.click('.nav-btn[data-view="me"]');
      await afterNav();
      await pageTom.click('#view-my-talks-btn');
      await afterAction();

      pageTom.once('dialog', (d) => d.accept());
      await pageTom.click('#clear-all-talks-btn');
      await afterAction();
      await pageTom.click('#close-my-talks-modal');
      await afterAction();
      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await afterSync();

      await waitForBroadcastBulkAckMinSent(pageTom, { receivers: 1, minSent: 1 });

      // Sanity: talk 5 (last in batch-1) should arrive.
      await waitForIncomingTalkClusterOnServer(pageJerry, talkTitles[4], { timeout: 60_000, polling: 500 });

      const jerryId = await getCurrentUserId(pageJerry);
      for (const title of [talkTitles[5], talkTitles[9]]) {
        await expect
          .poll(
            async () => incomingClustersIncludeTitleSubstring(pageJerry.context().request, jerryId, title),
            { timeout: 35_000, intervals: [500], message: `should not receive ${title}` },
          )
          .toBe(false);
      }
    } finally {
      await pageTom
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await pageJerry
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await tom.context?.close().catch(() => {});
      await jerry.context?.close().catch(() => {});
    }
  });

  test('talk matching still works across chatroom boundaries (answer after switching rooms)', async () => {
    const talkTitle = `Boundary Match Talk ${Date.now()}`;
    const tomStage = 'Tom Boundary';
    const jerryStage = 'Jerry Boundary';

    const tom = await bootstrapUser(browserTom, 'Tom', tomStage);
    const jerry = await bootstrapUser(browserJerry, 'Jerry', jerryStage);
    const pageTom = tom.page;
    const pageJerry = jerry.page;

    try {
      await createSimpleFlowTalk(pageTom, talkTitle, MATCH_ANSWER, IGNORE_ANSWER);

      await goToChatrooms(pageTom);

      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await afterAction();
      await afterSync();

      await waitForIncomingTalkClusterOnServer(pageJerry, talkTitle, { timeout: 60_000, polling: 500 });

      // Switch Jerry to a different chatroom before answering.
      await pageJerry.click('.nav-btn[data-view="chatrooms"]');
      await afterNav();
      await pageJerry.locator(`.chatroom-item[data-chatroom-id="north-america"]`).click();
      await afterSync();

      // Open and answer the incoming talk.
      await openIncomingTalkModal(pageJerry, talkTitle);
      await pageJerry
        .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
        .first()
        .click();

      await waitForStatusBarMatchCountAtLeast(pageJerry, 1, 60_000);
      await waitForResponseModalClosed(pageJerry);
      await afterSync();

      // Conversation should be created and visible in the Me tab regardless of chatroom switching.
      await pageJerry.click('.nav-btn[data-view="me"]');
      await afterNav();
      const convItem = pageJerry.locator('.conversation-list-item').filter({ hasText: tomStage }).first();
      await expect(convItem).toBeVisible({ timeout: 15_000 });
    } finally {
      await pageTom
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await pageJerry
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await tom.context?.close().catch(() => {});
      await jerry.context?.close().catch(() => {});
    }
  });
});

