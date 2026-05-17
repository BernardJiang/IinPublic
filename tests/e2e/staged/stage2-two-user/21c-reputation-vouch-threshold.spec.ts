import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync, headless } from '../../helpers/timing';
import { gunBaseURL } from '../../helpers/ports';
import {
  bootstrapUser,
  resetTalksMatchingSession,
  finalCleanupPages,
  waitForIncomingTalkClusterOnServer,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  createAdultTalk,
  enterGlobalChatroom,
  getCurrentUserId,
  serverVouchAgeVerified,
} from '../../helpers/reputation-e2e-helpers';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';

test.describe('Reputation system — vouch threshold', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await maybeClearGunDatabases();
  });

  test('vouch votes accumulate to threshold (delivery flips at 3)', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await afterSync();
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await afterSync();

    await enterGlobalChatroom(pageTom!);
    await enterGlobalChatroom(pageJerry!);

    const jerryUserId = await getCurrentUserId(pageJerry!);

    for (let i = 1; i <= 3; i += 1) {
      await serverVouchAgeVerified(pageTom!, jerryUserId);
      await afterSync();

      const adultTitle = `E2E Adult Vote Step ${i} (${Date.now()})`;
      await createAdultTalk(pageTom!, adultTitle);

      await pageTom!.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom!);
      await afterAction();
      await waitForTabActive(pageTom!, 'chatrooms');

      const delivered = async (): Promise<boolean> => {
        const res = await pageTom!.request.get(
          `${gunBaseURL()}/api/users/${encodeURIComponent(jerryUserId)}/incoming-talks`,
          { timeout: 30_000 },
        );
        if (!res.ok()) return false;
        const clusters = (await res.json()) as unknown[];
        const base = gunBaseURL();
        for (const c of clusters as Array<{ title?: unknown; talkIds?: unknown }>) {
          if (String(c?.title || '').includes(adultTitle)) return true;
          const t = c?.talkIds;
          if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
          const ids = Object.keys(t as Record<string, unknown>).filter((k) => !k.startsWith('_'));
          for (const id of ids) {
            const tr = await pageTom!.request.get(`${base}/api/talks/${encodeURIComponent(id)}`);
            if (!tr.ok()) continue;
            const td = (await tr.json()) as { title?: unknown };
            if (String(td?.title || '').includes(adultTitle)) return true;
          }
        }
        return false;
      };

      if (i < 3) {
        await expect
          .poll(delivered, { timeout: 10_000, intervals: [500] })
          .toBe(false);
      } else {
        await waitForIncomingTalkClusterOnServer(pageJerry!, adultTitle);
      }
    }
  });
});
