/**
 * Find similar people with the built-in starter tags (OPEN-87).
 *
 * Six new users stand at the same point (one blurred region) with room capacity C = 3, so each
 * one's Nearby group holds three of the five others. The intro tour is skipped (`skip_tour=1`).
 * Each user sees all 60 starter tags and decides every one: taps a pseudo-random 30 to like them
 * (a tap passes the unanswered tags above it) and passes the rest. Each broadcasts their likes to
 * their Nearby group; because every receiver has decided all 60 tags, the receiver's chatbot
 * answers every broadcast tag (Like → match, Pass → pass). The match feedback comes back to the
 * sender, and each receiver keeps the sender's tags, so on both sides Contacts sorted by
 * "Most tags in common" shows the true overlap. The spec checks every count against the picks and
 * prints who is most similar to whom.
 *
 * Headed runs stay open on that Contacts list for 3 minutes at the end (STARTER_SIMILAR_HOLD_MS).
 * Picks are seeded (STARTER_SIMILAR_SEED) so a run can be repeated.
 *
 * Companion doc: tests/e2e/staged/stage5-multi-user/starter-tags-similar-people.md
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { openCollapsedFilters } from '../../helpers/filter-bar';
import { starterTagsFor } from '../../../../src/shared/starter-tags';

/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

const NUM_USERS = Math.min(6, Number(process.env.STARTER_SIMILAR_USERS) || 6);
const CAPACITY = 3;
const LIKES_PER_USER = Number(process.env.STARTER_SIMILAR_LIKES) || 30;
const STARTER_TAGS = starterTagsFor('en');
const SEED = Number.parseInt(process.env.STARTER_SIMILAR_SEED || '', 10) || 20261025;
const HOLD_MS = process.env.STARTER_SIMILAR_HOLD_MS !== undefined
  ? Number(process.env.STARTER_SIMILAR_HOLD_MS) || 0
  : headless ? 0 : 180_000;
const NAMES = ['Ann', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'].slice(0, NUM_USERS);

// ─── Test data (not app logic) ──────────────────────────────────────────────────

/** mulberry32: a small seeded PRNG, so the picks repeat for a given seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The list indexes one user likes: a seeded shuffle of 0…59, first 30, in list order. */
function pickLikes(userIndex: number): number[] {
  const random = prng(SEED + userIndex * 7_919);
  const order = STARTER_TAGS.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.slice(0, LIKES_PER_USER).sort((a, b) => a - b);
}

const NUM_USERS_RANGE = Array.from({ length: NUM_USERS }, (_, index) => index);
const LIKES = Array.from({ length: NUM_USERS }, (_, index) => pickLikes(index));
const overlap = (a: number, b: number): number => {
  const mine = new Set(LIKES[a]);
  return LIKES[b]!.filter((index) => mine.has(index)).length;
};

// ─── Page helpers ───────────────────────────────────────────────────────────────

const app = (page: Page, fn: string) => page.evaluate((name) => (window as any).__iinpublic_app?.getApp?.()?.[name], fn);

const unansweredStarterChips = (page: Page) =>
  page.locator('#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"]');

/** Each starter keyword's myTalks role: 'copied' (liked), 'ignored' (passed) or '' (undecided). */
const starterRoles = (page: Page) => page.evaluate((keywords) => {
  const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
  const byKeyword = new Map<string, string>();
  for (const entry of Object.values<any>(talks)) {
    const keyword = entry?.fullTalk?.questions?.[0]?.text;
    if (keyword && entry?.fullTalk?.type === 'tag') byKeyword.set(keyword, String(entry.role || ''));
  }
  return keywords.map((keyword) => byKeyword.get(keyword) || '');
}, STARTER_TAGS.map((tag) => tag.text));

const groupMembers = (page: Page) => page.locator('[data-testid="nearby-person-row"]');
const memberNames = async (page: Page): Promise<string[]> =>
  groupMembers(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-stage-name') || ''));

/** Contacts sorted by "Most tags in common": each row's peer id and shared-tag count, top first. */
async function sharedTagRows(page: Page): Promise<Array<{ peerId: string; shared: number }>> {
  await page.locator('.nav-btn[data-view="contacts"]').click();
  const sort = page.locator('#contacts-sort-order');
  if (!(await sort.isVisible())) await openCollapsedFilters(page, 'contacts-filter-toggle');
  // Re-select to re-render with the latest exchanges.
  const other = await sort.evaluate((select: HTMLSelectElement) =>
    Array.from(select.options).map((option) => option.value).find((value) => value !== 'shared-tags') || '');
  await sort.selectOption(other);
  await sort.selectOption('shared-tags');
  return page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])').evaluateAll((rows) =>
    rows.map((row) => ({
      peerId: (row as HTMLElement).dataset.contactUserId || '',
      shared: Number((row.querySelector('[data-testid="contact-shared-tags"]') as HTMLElement | null)?.dataset.sharedTags ?? 0),
    })));
}

test.describe('Find similar people with starter tags', () => {
  test.describe.configure({ retries: 0 });
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage5Spec();
  });

  test.afterAll(async () => {
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage5Spec();
  });

  test('six users decide all 60 starter tags, broadcast to their Nearby group, and find who is most similar', async () => {
    test.setTimeout(600_000 + HOLD_MS);
    console.log(`[starter-similar] seed=${SEED} users=${NUM_USERS} capacity=${CAPACITY} likes=${LIKES_PER_USER}/${STARTER_TAGS.length}`);

    // ── 1. Six new users at the same point, C = 3, tour skipped ──────────────
    const url = `${webAppURLStableChatroom().replace('e2e_capacity=50', `e2e_capacity=${CAPACITY}`)}&skip_tour=1`;
    browsers.push(...await Promise.all(NAMES.map((_, index) => chromium.launch({
      headless,
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        // Side by side in one row: bootstrapUser sizes each window's content to 640 × 1000.
        `--window-position=${index * 640},0`,
        '--window-size=640,1100',
        '--force-device-scale-factor=1',
      ],
    }))));
    const users = await Promise.all(NAMES.map(async (name, index) => {
      const { context, page } = await bootstrapUser(browsers[index]!, name, `${name} Starter`, 30_000, url);
      contexts.push(context);
      pages[index] = page;
      return { page, index, stageName: `${name} Starter`, id: '' };
    }));
    for (const user of users) {
      user.id = String((await app(user.page, 'currentUser'))?.id || '');
      await user.page.evaluate(() => {
        const instance = (window as any).__iinpublic_app?.getApp?.();
        instance?.setTalkLedgerQuotaUnlimitedForE2e?.(true);
        instance?.setTalkLedgerSuppressionDisabledForE2e?.(true);
        instance?.uiManager?.setNotificationsSuppressedForE2e?.(true);
      });
    }
    const indexById = new Map(users.map((user) => [user.id, user.index]));
    const indexByName = new Map(users.map((user) => [user.stageName, user.index]));
    for (const user of users) {
      await expect(user.page.locator('#walkthrough-modal')).toHaveCount(0);
    }

    // ── 2. Each sees all 60 starter tags and decides every one ───────────────
    await Promise.all(users.map(async ({ page, index }) => {
      // The harness turns starter seeds off for ordinary specs; these new users opt back in.
      await page.evaluate(() => localStorage.removeItem('iinpublic_starter_contacts_disabled'));
      await page.locator('.nav-btn[data-view="talks"]').click();
      await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.());
      await expect(unansweredStarterChips(page)).toHaveCount(STARTER_TAGS.length, { timeout: 30_000 });

      // Like the picks top-down: each tap also passes the unanswered tags above it.
      for (const tagIndex of LIKES[index]!) {
        const keyword = STARTER_TAGS[tagIndex]!.text;
        await unansweredStarterChips(page).filter({ hasText: keyword }).first().click();
        await expect.poll(async () => (await starterRoles(page))[tagIndex], { timeout: 15_000 }).toBe('copied');
      }
      // Pass the tags below the last pick.
      for (;;) {
        const chip = unansweredStarterChips(page).first();
        if ((await unansweredStarterChips(page).count()) === 0) break;
        await chip.focus();
        await page.keyboard.press('Delete');
        await page.waitForTimeout(150);
      }
      const roles = await starterRoles(page);
      const liked = new Set(LIKES[index]);
      expect(roles.map((role, tagIndex) => role === (liked.has(tagIndex) ? 'copied' : 'ignored')).every(Boolean),
        `${NAMES[index]} decided all 60 tags as picked: ${JSON.stringify(roles)}`).toBe(true);
      console.log(`[${NAMES[index]}] liked ${LIKES[index]!.map((i) => STARTER_TAGS[i]!.text).join(', ')}`);
    }));

    // ── 3. Each broadcasts their likes to their Nearby group (3 of the 5 others) ─
    await Promise.all(users.map(({ page }) => page.locator('.nav-btn[data-view="chatrooms"]').click()));
    await Promise.all(users.map(({ page }) => expect(groupMembers(page)).toHaveCount(Math.min(CAPACITY, NUM_USERS - 1), { timeout: 120_000 })));
    await Promise.all(users.map(async ({ page, index }) => {
      const group = (await memberNames(page)).map((name) => indexByName.get(name)!).filter((i) => i !== undefined);
      // With delivery acks, like the 📣 Broadcast button: a Talk lost between browsers is sent again.
      const sent = await page.evaluate(() => (window as any).__iinpublic_app.getApp().deliverPendingBroadcastTalksForE2e(1, {
        skipAudiencePreview: true,
      }));
      console.log(`[${NAMES[index]} broadcast] to ${group.map((i) => NAMES[i]).join(', ')} → ${JSON.stringify(sent)}`);
      expect(sent.talksSent).toBeGreaterThanOrEqual(LIKES_PER_USER);
      expect(sent.receivers).toBe(Math.min(CAPACITY, NUM_USERS - 1));
    }));

    // ── 4. Each collects the feedback: Contacts show the true overlap ────────
    // i knows j once either one's Talks reached the other: as receiver i keeps j's 30 tags, as
    // sender i gets j's chatbot matches, and either way the shared count is |likes(i) ∩ likes(j)|.
    // Who that is cannot be predicted: at C = 3 the Nearby group keeps changing, and a person who
    // joins someone's group receives their active Talks without a new broadcast. So every person
    // listed must show the true overlap, and everyone knows at least their own group.
    const results = await Promise.all(users.map(async ({ page, index }) => {
      const expected = new Map<string, number>();
      let rows: Array<{ peerId: string; shared: number }> = [];
      try {
        await expect.poll(async () => {
          rows = (await sharedTagRows(page)).filter((row) => indexById.has(row.peerId));
          expected.clear();
          for (const row of rows) expected.set(row.peerId, overlap(index, indexById.get(row.peerId)!));
          return rows.length >= Math.min(CAPACITY, NUM_USERS - 1) && rows.every((row) => row.shared === expected.get(row.peerId));
        }, { timeout: 180_000, intervals: [2_000] }).toBe(true);
      } catch (error) {
        const state = await page.evaluate(() => {
          const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
          const clusters = (ui?.incomingTalkClusters || []).map((cluster: any) =>
            `${cluster.title}:${Object.keys(cluster.senders || {}).filter((id) => id !== 'iinpublic-starter-interests').map((id) => id.slice(0, 6)).join('+')}`);
          const exchanges = Object.values<any>(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}'));
          return {
            chatbot: localStorage.getItem('chatbotEnabled'),
            clusters: clusters.filter((line: string) => !line.endsWith(':')).slice(0, 8),
            clusterCount: clusters.length,
            exchanges: exchanges.length,
            outcomes: exchanges.slice(0, 5).map((row) => `${row.peerName}:${row.title}:${row.outcome}`),
          };
        });
        console.log(`[${NAMES[index]} feedback] expected ${JSON.stringify([...expected].map(([id, n]) => `${NAMES[indexById.get(id)!]}=${n}`))} rows ${JSON.stringify(rows.map((row) => `${NAMES[indexById.get(row.peerId)!] ?? row.peerId}=${row.shared}`))} state ${JSON.stringify(state)}`);
        throw error;
      }
      const known = rows.filter((row) => expected.has(row.peerId));
      // Sorted by most tags in common, and the top is the most similar person this user knows.
      const counts = known.map((row) => row.shared);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(known[0]!.shared).toBe(Math.max(...expected.values()));
      // The chatbot answered every tag people sent: liked ones matched, passed ones passed again,
      // so none waits in Incoming.
      await page.locator('.nav-btn[data-view="talks"]').click();
      await expect.poll(() => page.evaluate((keywords) =>
        Array.from(document.querySelectorAll<HTMLElement>('#talks-list .talk-tag-chip[data-role="incoming"]'))
          .filter((chip) => keywords.some((keyword) => (chip.textContent || '').includes(keyword))).length,
      STARTER_TAGS.map((tag) => tag.text)), { timeout: 60_000, message: `${NAMES[index]} has unanswered tags from people` }).toBe(0);
      await page.locator('.nav-btn[data-view="contacts"]').click();
      return { index, known };
    }));

    // ── 5. Who is most similar to whom ───────────────────────────────────────
    console.log('[starter-similar] true overlap (liked tags in common, of 30):');
    console.log(`      ${NAMES.map((name) => name.padStart(4)).join('')}`);
    for (let i = 0; i < NUM_USERS; i++) {
      console.log(`${NAMES[i]!.padEnd(6)}${NAMES.map((_, j) => (i === j ? '-' : String(overlap(i, j))).padStart(4)).join('')}`);
    }
    for (const { index, known } of results.sort((a, b) => a.index - b.index)) {
      const list = known.map((row) => `${NAMES[indexById.get(row.peerId)!]} ${row.shared}`).join(', ');
      const best = Math.max(...NUM_USERS_RANGE.filter((j) => j !== index).map((j) => overlap(index, j)));
      const bestAll = NUM_USERS_RANGE.filter((j) => j !== index && overlap(index, j) === best).map((j) => NAMES[j]).join('/');
      console.log(`[${NAMES[index]}] Contacts by tags in common: ${list} · most similar overall: ${bestAll} (${best})`);
    }

    if (HOLD_MS > 0) {
      console.log(`[starter-similar] holding ${Math.round(HOLD_MS / 1000)} s on Contacts for inspection`);
      await pages[0]!.waitForTimeout(HOLD_MS);
    }
  });
});
