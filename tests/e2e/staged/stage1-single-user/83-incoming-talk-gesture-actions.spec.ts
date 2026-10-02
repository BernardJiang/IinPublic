/**
 * Incoming talk actions are intentionally button-free:
 *   down = retain in My Talks; either horizontal direction = Ignore this content.
 * Long-press remains the details gesture. This spec exercises those real pointer gestures for
 * Flow, Survey, and Route, then verifies content-level Ignore across new tag senders and Restore
 * from the dedicated Ignored list. It also covers the tag checkbox lifecycle across Talks and Me
 * so deleting the accepted tag cannot leave stale answer history behind.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import {
  bootstrapUser,
  dragTalkRow,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  disposeE2eSessionList,
  launchBrowserGrid,
  shutdownBrowserGrid,
} from '../../helpers/many-browsers';
import { computeTalkIdFromTalkData } from '../../../../src/shared/cid';

type TalkType = 'flow' | 'survey' | 'route' | 'tag';
type SeedTalk = {
  id: string;
  title: string;
  type: TalkType;
  authorId: string;
  authorName: string;
  questions: Array<{
    id: string;
    text: string;
    answers: Array<{ id: string; text: string; isMatch?: boolean; isIgnore?: boolean }>;
  }>;
};

type SeedDelivery = {
  talk: SeedTalk;
  identityKey: string;
  senderId: string;
  senderName: string;
  receivedAt: string;
};

function makeTalk(seed: string, type: TalkType, title: string, senderId: string): SeedTalk {
  const talk = {
    id: '',
    title,
    type,
    authorId: senderId,
    authorName: senderId,
    questions: [{
      id: `${seed}-q1`,
      text: title,
      answers: [
        { id: 'yes', text: 'Yes', isMatch: true },
        { id: 'no', text: 'No', isIgnore: true },
      ],
    }],
  };
  talk.id = computeTalkIdFromTalkData(talk);
  return talk;
}

async function showOnlyIncoming(page: Page, deliveries: SeedDelivery[]): Promise<void> {
  await page.evaluate(async (seedDeliveries) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const ui = app?.uiManager;
    for (const { talk, senderId, senderName } of seedDeliveries) {
      await app?.seedIncomingTalkForE2e?.({ talkData: talk, senderId, senderName });
    }
    const wantedIds = new Set(seedDeliveries.map(({ talk }) => talk.id));
    const byIdentity = new Map<string, any>();
    for (const cluster of app?.e2eSeededIncomingClusters || []) {
      if (!wantedIds.has(String(cluster?.latestTalkId || ''))) continue;
      byIdentity.set(String(cluster?.identityKey || cluster?.latestTalkId || ''), cluster);
    }
    ui?.setIncomingTalkClusters?.(Array.from(byIdentity.values()));
    ui?.displayTalksList?.();
  }, deliveries);
}

function incomingRow(page: Page, title: string) {
  return page.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: title });
}

test.describe('Incoming talk gesture actions', () => {
  test.setTimeout(120_000);

  let browsers: Browser[] = [];
  const sessions: Array<{ context: BrowserContext; page: Page }> = [];

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browsers = await launchBrowserGrid(1);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunForStage1Spec();
  });

  test('Flow, Survey, and Route support retain plus Ignore in both swipe directions without Add buttons', async () => {
    const user = await bootstrapUser(browsers[0]!, 'GestureUser', 'GestureUser');
    sessions.push(user);
    const page = user.page;
    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    const types: Array<Exclude<TalkType, 'tag'>> = ['flow', 'survey', 'route'];
    const deliveries: SeedDelivery[] = [];
    let sequence = 1;
    // Newest seeded rows render first. Exercise them in reverse seed order so every real mouse
    // drag starts comfortably above the fixed bottom navigation on phone-sized viewports.
    for (const type of [...types].reverse()) {
      for (const action of ['retain', 'ignore-right', 'ignore-left'] as const) {
        const suffix = String(sequence++).padStart(2, '0');
        const seed = `gesture-${suffix}`;
        deliveries.push({
          talk: makeTalk(seed, type, `${type} ${action}`, `sender-${type}-${action}`),
          identityKey: `identity-${type}-${action}`,
          senderId: `sender-${type}-${action}`,
          senderName: `${type} sender`,
          receivedAt: `2026-10-01T10:${suffix}:00.000Z`,
        });
      }
    }
    await showOnlyIncoming(page, deliveries);

    await expect(page.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(9);
    await expect(page.locator('.talk-add-to-my-talks-btn')).toHaveCount(0);

    for (const type of types) {
      const retain = deliveries.find((delivery) => delivery.talk.title === `${type} retain`)!;
      await dragTalkRow(page, incomingRow(page, retain.talk.title), 'down');
      await expect.poll(() => page.evaluate((talkId) => {
        const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        return talks[talkId]?.role || '';
      }, retain.talk.id)).toBe('copied');
      await expect(incomingRow(page, retain.talk.title)).toBeVisible();

      const ignoreRight = deliveries.find((delivery) => delivery.talk.title === `${type} ignore-right`)!;
      await dragTalkRow(page, incomingRow(page, ignoreRight.talk.title), 'right');
      await expect(incomingRow(page, ignoreRight.talk.title)).toHaveCount(0);

      const ignoreLeft = deliveries.find((delivery) => delivery.talk.title === `${type} ignore-left`)!;
      await dragTalkRow(page, incomingRow(page, ignoreLeft.talk.title), 'left');
      await expect(incomingRow(page, ignoreLeft.talk.title)).toHaveCount(0);
      await expect.poll(() => page.evaluate((talkId) => {
        const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        return talks[talkId]?.role || '';
      }, ignoreLeft.talk.id)).toBe('ignored');
    }

    await page.locator('#talks-filter-completion').selectOption('ignored', { force: true });
    await expect(page.locator('.talk-list-item[data-role="ignored"]')).toHaveCount(6);
    await expect(page.locator('.talk-restore-ignored-btn')).toHaveCount(6);
  });

  test('same tag stays ignored across senders, Restore re-enables it, and checkbox removal clears Talks plus Me', async () => {
    const user = await bootstrapUser(browsers[0]!, 'TagGestureUser', 'TagGestureUser');
    sessions.push(user);
    const page = user.page;
    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    const ignoredFirst = makeTalk(
      '22222222-2222-4222-8222-222222222201', 'tag', 'Same ignored tag', 'alice',
    );
    await showOnlyIncoming(page, [{
      talk: ignoredFirst,
      identityKey: 'same-ignored-tag',
      senderId: 'alice',
      senderName: 'Alice',
      receivedAt: '2026-10-01T11:00:00.000Z',
    }]);
    const initialCheckbox = incomingRow(page, ignoredFirst.title).locator('.talk-tag-in-checkbox');
    await expect(initialCheckbox).not.toBeChecked();
    await dragTalkRow(page, incomingRow(page, ignoredFirst.title), 'right');
    await expect(incomingRow(page, ignoredFirst.title)).toHaveCount(0);

    const ignoredAgain = makeTalk(
      '22222222-2222-4222-8222-222222222202', 'tag', 'Same ignored tag', 'bob',
    );
    await showOnlyIncoming(page, [{
      talk: ignoredAgain,
      identityKey: 'same-ignored-tag',
      senderId: 'bob',
      senderName: 'Bob',
      receivedAt: '2026-10-01T11:05:00.000Z',
    }]);
    await expect(incomingRow(page, ignoredAgain.title)).toHaveCount(0);

    await page.locator('#talks-filter-completion').selectOption('ignored', { force: true });
    const ignoredRow = page.locator('.talk-list-item[data-role="ignored"]').filter({ hasText: ignoredAgain.title });
    await expect(ignoredRow).toBeVisible();
    await ignoredRow.locator('.talk-restore-ignored-btn').click();
    await page.locator('#talks-filter-completion').selectOption('unanswered', { force: true });
    await expect(incomingRow(page, ignoredAgain.title)).toBeVisible();

    const ignoredLeftFirst = makeTalk(
      '22222222-2222-4222-8222-222222222203', 'tag', 'Left ignored tag', 'carol',
    );
    await showOnlyIncoming(page, [{
      talk: ignoredLeftFirst,
      identityKey: 'left-ignored-tag',
      senderId: 'carol',
      senderName: 'Carol',
      receivedAt: '2026-10-01T11:10:00.000Z',
    }]);
    await dragTalkRow(page, incomingRow(page, ignoredLeftFirst.title), 'left');
    await expect(incomingRow(page, ignoredLeftFirst.title)).toHaveCount(0);

    const ignoredLeftAgain = makeTalk(
      '22222222-2222-4222-8222-222222222204', 'tag', 'Left ignored tag', 'dave',
    );
    await showOnlyIncoming(page, [{
      talk: ignoredLeftAgain,
      identityKey: 'left-ignored-tag',
      senderId: 'dave',
      senderName: 'Dave',
      receivedAt: '2026-10-01T11:15:00.000Z',
    }]);
    await expect(incomingRow(page, ignoredLeftAgain.title)).toHaveCount(0);

    const accepted = makeTalk(
      '22222222-2222-4222-8222-222222222205', 'tag', 'Accepted then removed tag', 'erin',
    );
    await showOnlyIncoming(page, [{
      talk: accepted,
      identityKey: 'accepted-then-removed-tag',
      senderId: 'erin',
      senderName: 'Erin',
      receivedAt: '2026-10-01T11:20:00.000Z',
    }]);
    await incomingRow(page, accepted.title).locator('.talk-tag-in-checkbox').click();

    const acceptedOut = page.locator(
      `.talk-list-item[data-role="copied"][data-talk-id="${accepted.id}"]`,
    );
    await expect(incomingRow(page, accepted.title)).toHaveCount(0);
    await expect(acceptedOut).toBeVisible();

    await page.click('.nav-btn[data-view="me"]');
    await waitForTabActive(page, 'me');
    await expect(page.locator('.answer-talk-item').filter({ hasText: accepted.title })).toBeVisible();

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await acceptedOut.locator('.talk-tag-out-checkbox').click();
    await expect(acceptedOut).toHaveCount(0);

    await page.click('.nav-btn[data-view="me"]');
    await waitForTabActive(page, 'me');
    await expect(page.locator('.answer-talk-item').filter({ hasText: accepted.title })).toHaveCount(0);
  });
});
