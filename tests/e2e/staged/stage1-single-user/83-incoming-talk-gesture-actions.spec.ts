/**
 * The same gestures on every row (owner design 2026-11-21): swipe left or the row's ✕ = Pass;
 * swipe right or down (or a tap) = Like, which opens a Flow/Survey/Route to answer and likes a tag;
 * 📋 still keeps a Talk in My Talks. A finger swipe on a phone works (rows are `touch-action:
 * pan-y`). Also: content-level Pass across new tag senders, and Like↔Pass (✕ = undo on my own
 * row) across Talks and Me.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import {
  bootstrapUser,
  dragTalkRow,
  touchSwipeTalkRow,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  disposeE2eSessionList,
  launchBrowserGrid,
  shutdownBrowserGrid,
} from '../../helpers/many-browsers';
import { computeTalkIdFromTalkData } from '../../../../src/shared/cid';
import { dismissNotificationOverlays } from '../../helpers/durable-ui';

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

  test('Flow, Survey and Route: right or down opens to answer, left or ✕ passes, 📋 keeps', async () => {
    const user = await bootstrapUser(browsers[0]!, 'GestureUser', 'GestureUser');
    sessions.push(user);
    const page = user.page;
    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    const types: Array<Exclude<TalkType, 'tag'>> = ['flow', 'survey', 'route'];
    const actions = ['retain', 'open-right', 'open-down', 'ignore-left', 'pass-x'] as const;
    const deliveries: SeedDelivery[] = [];
    let sequence = 1;
    // Newest seeded rows render first. Exercise them in reverse seed order so every real mouse
    // drag starts comfortably above the fixed bottom navigation on phone-sized viewports.
    for (const type of [...types].reverse()) {
      for (const action of actions) {
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

    await expect(page.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(types.length * actions.length);
    await expect(page.locator('.talk-add-to-my-talks-btn')).toHaveCount(0);
    const role = (talkId: string) => page.evaluate((id) => {
      const talks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
      return talks[id]?.role || '';
    }, talkId);
    const delivery = (type: string, action: string) => deliveries.find((d) => d.talk.title === `${type} ${action}`)!;
    const modal = page.locator('#talk-response-modal');

    for (const type of types) {
      const retain = delivery(type, 'retain');
      await incomingRow(page, retain.talk.title).locator('[data-testid="talk-copy-toggle"]').click();
      await expect.poll(() => role(retain.talk.id)).toBe('copied');
      await expect(incomingRow(page, retain.talk.title)).toBeVisible();

      for (const direction of ['right', 'down'] as const) {
        const open = delivery(type, `open-${direction}`);
        await dragTalkRow(page, incomingRow(page, open.talk.title), direction);
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(open.talk.title);
        await modal.locator('[data-testid="close-response-btn"]').click();
        await expect(modal).toHaveCount(0);
        await expect(incomingRow(page, open.talk.title)).toBeVisible();
      }

      const ignoreLeft = delivery(type, 'ignore-left');
      await dragTalkRow(page, incomingRow(page, ignoreLeft.talk.title), 'left');
      await expect(incomingRow(page, ignoreLeft.talk.title)).toHaveCount(0);
      await expect.poll(() => role(ignoreLeft.talk.id)).toBe('ignored');

      const passX = delivery(type, 'pass-x');
      await incomingRow(page, passX.talk.title).locator('[data-testid="talk-row-pass"]').click();
      await expect(incomingRow(page, passX.talk.title)).toHaveCount(0);
      await expect.poll(() => role(passX.talk.id)).toBe('ignored');
    }

    await page.locator('#talks-filter-completion').selectOption('ignored', { force: true });
    await expect(page.locator('.talk-list-item[data-role="ignored"]')).toHaveCount(types.length * 2);
    await expect(page.locator('.talk-restore-ignored-btn')).toHaveCount(types.length * 2);
  });

  test('a finger swipe on a phone: left passes a tag, right likes one', async () => {
    const user = await bootstrapUser(browsers[0]!, 'TouchUser', 'TouchUser', undefined, undefined, undefined, true);
    sessions.push(user);
    const page = user.page;
    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    const passTag = makeTalk('33333333-3333-4333-8333-333333333301', 'tag', 'Finger pass tag', 'fay');
    const likeTag = makeTalk('33333333-3333-4333-8333-333333333302', 'tag', 'Finger like tag', 'gus');
    await showOnlyIncoming(page, [
      { talk: passTag, identityKey: 'finger-pass', senderId: 'fay', senderName: 'Fay', receivedAt: '2026-10-01T12:00:00.000Z' },
      { talk: likeTag, identityKey: 'finger-like', senderId: 'gus', senderName: 'Gus', receivedAt: '2026-10-01T12:01:00.000Z' },
    ]);
    const role = (talkId: string) => page.evaluate((id) => {
      const talks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
      return talks[id]?.role || '';
    }, talkId);
    // Before rows were touch-action: pan-y, the browser took the sideways finger move as a pan
    // and cancelled the gesture (pointercancel): nothing happened.
    await touchSwipeTalkRow(page, incomingRow(page, passTag.title), 'left');
    await expect.poll(() => role(passTag.id)).toBe('ignored');
    // The "passed" toast sits over the list for a moment; a person would wait it out.
    await dismissNotificationOverlays(page);
    await touchSwipeTalkRow(page, incomingRow(page, likeTag.title), 'right');
    await expect.poll(() => role(likeTag.id)).toBe('copied');
  });

  test('Tag Pass persists across senders and direct Like↔Pass updates Talks plus Me', async () => {
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
    // The chip itself is the control (tap likes, swipe left passes) with one ✕ and no other button.
    await expect(incomingRow(page, ignoredFirst.title)).toHaveAttribute('role', 'button');
    await expect(incomingRow(page, ignoredFirst.title).locator('button')).toHaveCount(1);
    await expect(incomingRow(page, ignoredFirst.title).locator('[data-testid="talk-row-pass"]')).toHaveCount(1);
    await dragTalkRow(page, incomingRow(page, ignoredFirst.title), 'left');
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
    await ignoredRow.click();
    await page.locator('#talks-filter-completion').selectOption('unanswered', { force: true });
    await expect(page.locator('.talk-list-item[data-role="copied"]').filter({ hasText: ignoredAgain.title })).toBeVisible();

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
    await incomingRow(page, accepted.title).click();

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
    // A regretted Like: a tap keeps the liked tag; its ✕ (undo) passes it.
    await acceptedOut.locator('.talk-tag-text').click();
    await expect(acceptedOut).toBeVisible();
    await acceptedOut.locator('[data-testid="talk-row-pass"]').click();
    await expect(acceptedOut).toHaveCount(0);

    await page.click('.nav-btn[data-view="me"]');
    await waitForTabActive(page, 'me');
    await expect(page.locator('.answer-talk-item').filter({ hasText: accepted.title })).toHaveCount(0);

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await page.locator('#talks-filter-completion').selectOption('ignored', { force: true });
    const passedAccepted = page.locator('.talk-list-item[data-role="ignored"]').filter({ hasText: accepted.title });
    await passedAccepted.click();
    await page.locator('#talks-filter-completion').selectOption('unanswered', { force: true });
    await expect(acceptedOut).toBeVisible();
  });
});
