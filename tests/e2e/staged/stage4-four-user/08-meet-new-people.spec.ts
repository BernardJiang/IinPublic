/**
 * Meeting new people in groups (docs/design/nearby-and-place-chatrooms.md §3.7): with C = 2, Adam's
 * group 1 holds two of the three other people. "Meet new people" swaps the whole group for the next
 * one — only the person he was not grouped with — and that person gets Adam's active Talk without
 * a new broadcast. Past the last group the bar says he has met everyone; "Back to group 1" returns.
 * Room members carry the hub's online dot (§3.7 "Contacts online").
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { createTagTalk, waitForIncomingTalk } from '../../journeys/nearby-ring-journey';
import type { TestActor } from '../../helpers/test-actor';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES = ['Adam', 'Eve', 'Bob', 'Alice'] as const;

const groupMembers = (page: Page) => page.locator('#chatroom-members-list .chatroom-member-item');
const memberNames = async (page: Page): Promise<string[]> =>
  (await groupMembers(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-stage-name') || ''))).sort();

test.describe('Meet new people: swap the whole group for the next one (§3.7)', () => {
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
  });

  test.afterAll(async () => {
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage4Spec();
  });

  test('group 1 → group 2 (the person not met yet, who gets my Talk) → met everyone → back to group 1', async () => {
    test.setTimeout(420_000);
    // C = 2: each person's group holds two of the three others.
    const url = webAppURLStableChatroom().replace('e2e_capacity=50', 'e2e_capacity=2');
    browsers.push(...await Promise.all(NAMES.map(() => chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] }))));
    for (const [index, name] of NAMES.entries()) {
      const { context, page } = await bootstrapUser(browsers[index], name, `${name} G`, 30_000, url);
      contexts.push(context);
      pages.push(page);
    }
    const [adam, ...others] = pages;
    const othersByName = new Map(others.map((page, i) => [`${NAMES[i + 1]} G`, page]));

    // Group 1: Adam opens Nearby and sees two people.
    await adam.locator('.chatroom-item.current-room').click();
    await expect(groupMembers(adam)).toHaveCount(2, { timeout: 90_000 });
    await expect(adam.locator('[data-testid="nearby-group-title"]')).toHaveText('Group 1 · the people nearest you');
    const group1 = await memberNames(adam);
    const notMet = [...othersByName.keys()].filter((name) => !group1.includes(name));
    expect(notMet).toHaveLength(1);

    // Online dots come from the hub's card heartbeats (refreshed at start and every minute).
    await expect(adam.locator('#chatroom-members-list .presence-indicator.online')).toHaveCount(2, { timeout: 75_000 });

    // Adam's active Talk reaches his group.
    const adamActor: TestActor = { id: 'Adam', runtime: 'browser', page: adam };
    const talk = await createTagTalk(adamActor, `meet-new-people-${Date.now()}`);
    const sent = await adam.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1));
    expect(sent?.talksSent ?? 0).toBeGreaterThan(0);
    for (const name of group1) {
      expect(await waitForIncomingTalk(othersByName.get(name)!, name, talk.title)).toBe(talk.talkId);
    }

    // Meet new people: confirm, then group 2 is only the person Adam had not been grouped with.
    await adam.locator('[data-testid="nearby-meet-new-people"]').click();
    await expect(adam.locator('[data-testid="nearby-meet-confirm"]')).toContainText('Swap these 2 people for the next people near you.');
    await adam.locator('[data-testid="nearby-meet-confirm-action"]').click();
    await expect(adam.locator('[data-testid="nearby-group-title"]')).toHaveText('Group 2 · the next people near you', { timeout: 30_000 });
    await expect.poll(() => memberNames(adam), { timeout: 90_000 }).toEqual(notMet);
    // The new person gets Adam's active Talk without another broadcast (same as entering a Place).
    expect(await waitForIncomingTalk(othersByName.get(notMet[0]!)!, notMet[0]!, talk.title)).toBe(talk.talkId);

    // Past the last group: nobody is left, and the bar says so.
    await adam.locator('[data-testid="nearby-meet-new-people"]').click();
    await adam.locator('[data-testid="nearby-meet-confirm-action"]').click();
    await expect(adam.locator('[data-testid="nearby-group-title"]')).toHaveText('Group 3 · the next people near you', { timeout: 30_000 });
    await expect(adam.locator('[data-testid="nearby-group-note"]')).toHaveText("You've met everyone here for now.", { timeout: 90_000 });
    await expect(groupMembers(adam)).toHaveCount(0);

    // Back to group 1: the first two again.
    await adam.locator('[data-testid="nearby-back-to-first-group"]').click();
    await expect(adam.locator('[data-testid="nearby-group-title"]')).toHaveText('Group 1 · the people nearest you', { timeout: 30_000 });
    await expect.poll(() => memberNames(adam), { timeout: 90_000 }).toEqual(group1);
  });
});
