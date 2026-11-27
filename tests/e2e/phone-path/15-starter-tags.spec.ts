/**
 * Starter tags on the phone route (docs/testing/journey-coverage.md, J-TAGS-01): two people on two
 * phones each decide all 60 starter tags (30 liked, by a fixed seed); each one's Contacts then lists
 * the other with exactly the number of liked tags they have in common. Checked on both sides.
 * The browser version is stage5/starter-tags-similar-people, the real-phone one native-app/43;
 * both use tests/e2e/journeys/starter-tags-shared.ts, as this does (OPEN-121).
 */
import { expect, test } from '@playwright/test';
import {
  DEFAULT_STARTER_SEED, STARTER_TAGS, decideStarterTags, overlapOf, pickLikes, sharedTagRows, type SharedTagRow,
} from '../journeys/starter-tags-shared';
import { closeUsers, openUser, resetPhonePath, userId, type JourneyUser } from './phone-path-helpers';

const LIKES_PER_USER = 30;
const LIKES = [0, 1].map((index) => pickLikes(DEFAULT_STARTER_SEED, index, LIKES_PER_USER));
const SHARED = overlapOf(LIKES, 0, 1);

test.describe('Starter tags across two phones', () => {
  let ann: JourneyUser | undefined;
  let ben: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(ann, ben);
    ann = ben = undefined;
  });

  test('J-TAGS-01: each Contacts list shows the other with the true tags in common', async ({ browser }) => {
    test.setTimeout(480_000);
    ann = await openUser(browser, 'Ann', 'phoneA');
    ben = await openUser(browser, 'Ben', 'phoneB');
    const users = [ann, ben];
    const ids = await Promise.all(users.map((user) => userId(user.page)));

    await Promise.all(users.map(async (user, index) => {
      // The harness turns starter seeds off for ordinary specs; these new users opt back in.
      await user.page.evaluate(() => ((window as any).__iinpublic_collection_edit?.('settings', { remove: ['iinpublic_starter_contacts_disabled'] }), localStorage.removeItem('iinpublic_starter_contacts_disabled')));
      await user.page.locator('.nav-btn[data-view="talks"]').click();
      await user.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.());
      await expect(user.page.locator('#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"]'))
        .toHaveCount(STARTER_TAGS.length, { timeout: 60_000 });
      const roles = await decideStarterTags(user.page, LIKES[index]!, 30_000);
      const liked = new Set(LIKES[index]);
      expect(roles.every((role, tagIndex) => role === (liked.has(tagIndex) ? 'copied' : 'ignored')),
        `${user.label} decided all 60 tags as picked`).toBe(true);
    }));
    const decidedAt = Date.now();

    await Promise.all(users.map(async (user, index) => {
      const other = ids[1 - index]!;
      let row: SharedTagRow | undefined;
      await expect.poll(async () => {
        row = (await sharedTagRows(user.page).catch(() => [] as SharedTagRow[])).find((r) => r.peerId === other);
        return row?.shared ?? 0;
      }, { timeout: 180_000, intervals: [2_000], message: `${user.label}'s Contacts: tags in common with the other phone` })
        .toBe(SHARED);
      expect(row!.rank).toBe(1);
    }));
    test.info().annotations.push({
      type: 'timing',
      description: `${SHARED} tags in common; both Contacts settled ${Math.round((Date.now() - decidedAt) / 1000)} s after deciding`,
    });
  });
});
