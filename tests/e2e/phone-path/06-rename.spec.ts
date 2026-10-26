/**
 * Renaming on a phone (docs/testing/journey-coverage.md, J-PROFILE-01). Alice changes her name in
 * Settings. Her TechSupport welcome then greets her by the new name, and it stays that way: the
 * welcome is rewritten under the same message id, and the message subscription used to compare
 * ids only, so the list preview went back to the old name about five seconds later (found by
 * native-app/08 and 09 on real phones, 2026-10-15). Bob, on the other phone, sees the new name
 * in the room's member list.
 */
import { test, expect, type Page } from '@playwright/test';
import { SETTINGS_SECTION, openSettingsSection } from '../helpers/settings-nav';
import {
  closeUsers,
  currentRoomId,
  memberItem,
  openCurrentRoom,
  openUser,
  resetPhonePath,
  userId,
  type JourneyUser,
} from './phone-path-helpers';

function welcomePreview(page: Page): Promise<string> {
  return page.evaluate(() => {
    const conversations = ((window as any).__iinpublic_collection?.('myConversations') ?? {});
    const support = Object.values(conversations).find((c: any) => c?.supportChannel) as any;
    return String(support?.lastMessage || '');
  });
}

test.describe('Rename on a phone', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('the welcome greets the new name and keeps it; the other phone sees the new name', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const aliceId = await userId(alice.page);
    await expect.poll(() => welcomePreview(alice!.page), { timeout: 30_000 }).toContain('Welcome to IinPublic');

    const newName = `Alice Renamed ${Date.now() % 100000}`;
    await alice.page.locator('.nav-btn[data-view="settings"]').click();
    await openSettingsSection(alice.page, SETTINGS_SECTION.profile);
    await alice.page.locator('#settings-stage-name-input').fill(newName);
    await alice.page.locator('#settings-stage-name-input').dispatchEvent('change');
    await expect.poll(() => alice!.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName), {
      timeout: 20_000,
    }).toBe(newName);

    // The welcome now uses the new name, and still does after several 5 s message polls.
    await expect.poll(() => welcomePreview(alice!.page), { timeout: 20_000 }).toContain(newName);
    await alice.page.waitForTimeout(20_000);
    expect(await welcomePreview(alice.page)).toContain(newName);

    // Bob, in the same room on the other phone, sees Alice under her new name.
    await expect.poll(async () => (await currentRoomId(alice!.page)) !== '' && (await currentRoomId(alice!.page)) === (await currentRoomId(bob!.page)),
      { timeout: 30_000, message: 'Alice and Bob are not in the same Nearby room' }).toBe(true);
    await expect.poll(async () => {
      await openCurrentRoom(bob!.page);
      return (await memberItem(bob!.page, aliceId).textContent().catch(() => '')) || '';
    }, { timeout: 60_000, intervals: [3_000] }).toContain(newName);
  });
});
