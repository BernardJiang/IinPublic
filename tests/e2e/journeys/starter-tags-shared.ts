/**
 * Starter-tag test data and page helpers shared by the browser spec
 * (staged/stage5-multi-user/starter-tags-similar-people) and the real-phone spec
 * (native-app/43-android-starter-tags-phones). Test data only, no app logic.
 */
import { expect, type Page } from '@playwright/test';
import { openCollapsedFilters } from '../helpers/filter-bar';
import { starterTagsFor } from '../../../src/shared/starter-tags';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const STARTER_TAGS = starterTagsFor('en');
export const DEFAULT_STARTER_SEED = 20261025;

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

/** The list indexes one user likes: a seeded shuffle of 0…59, the first `count`, in list order. */
export function pickLikes(seed: number, userIndex: number, count: number): number[] {
  const random = prng(seed + userIndex * 7_919);
  const order = STARTER_TAGS.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.slice(0, count).sort((a, b) => a - b);
}

/** Liked tags in common between two users' picks. */
export function overlapOf(likes: number[][], a: number, b: number): number {
  const mine = new Set(likes[a]);
  return likes[b]!.filter((index) => mine.has(index)).length;
}

// A chip liked or passed a moment ago keeps `data-decided` until the list redraws (redraws are gathered).
export const unansweredStarterChips = (page: Page) =>
  page.locator('#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"]:not([data-decided])');

/** Each starter keyword's myTalks role: 'copied' (liked), 'ignored' (passed) or '' (undecided). */
export const starterRoles = (page: Page) => page.evaluate((keywords) => {
  const talks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
  const byKeyword = new Map<string, string>();
  for (const entry of Object.values<any>(talks)) {
    const keyword = entry?.fullTalk?.questions?.[0]?.text;
    if (keyword && entry?.fullTalk?.type === 'tag') byKeyword.set(keyword, String(entry.role || ''));
  }
  return keywords.map((keyword) => byKeyword.get(keyword) || '');
}, STARTER_TAGS.map((tag) => tag.text));

/** Back to the Contacts list from a person page or the relationship dialog (headed runs can be clicked). */
export async function backToContactsList(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const close = page.locator('#close-contact-relationship-modal');
  if (await close.isVisible()) await close.click();
  const back = page.locator('#back-from-peer-detail');
  if (await back.isVisible()) await back.click();
  await page.locator('.nav-btn[data-view="contacts"]').click();
}

export type SharedTagRow = { peerId: string; shared: number; rank: number; alike: number };

/** Contacts sorted by "Most tags in common": each row's peer id and shared-tag count, top first. */
export async function sharedTagRows(page: Page): Promise<SharedTagRow[]> {
  await backToContactsList(page);
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
      // OPEN-113: the same chip states how alike we are and the rank.
      rank: Number((row.querySelector('[data-testid="contact-shared-tags"]') as HTMLElement | null)?.dataset.similarityRank ?? 0),
      alike: Number((row.querySelector('[data-testid="contact-shared-tags"]') as HTMLElement | null)?.dataset.similarity ?? 0),
    })));
}

/**
 * Decide every starter tag as picked: tap the liked ones top-down (each tap also passes the
 * unanswered tags above it), then pass the rest with Delete. Returns the roles afterwards.
 */
export async function decideStarterTags(page: Page, likes: number[], pollTimeoutMs = 15_000): Promise<string[]> {
  for (const tagIndex of likes) {
    const keyword = STARTER_TAGS[tagIndex]!.text;
    // The keyword as a whole word: a plain substring also matched another tag ("Pop" is in "K-pop").
    const whole = new RegExp(`(?<![\\w-])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    await unansweredStarterChips(page).filter({ hasText: whole }).first().click();
    await expect.poll(async () => (await starterRoles(page))[tagIndex], { timeout: pollTimeoutMs }).toBe('copied');
  }
  // Pass the rest with Delete, finding the row and pressing the key in one step: on phones the
  // list re-renders each time another person's like arrives, so a row found by one call is often
  // detached by the next (PH-1, 2026-11-16).
  while ((await unansweredStarterChips(page).count()) > 0) {
    const passed = await page.evaluate(() => {
      const chip = document.querySelector<HTMLElement>('#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"]:not([data-decided])');
      if (!chip) return '';
      chip.focus();
      chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      return chip.dataset.talkId || '';
    });
    if (passed) {
      await expect.poll(() => page.evaluate((id) =>
        !document.querySelector(`#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"][data-talk-id="${id}"]`), passed),
      { timeout: pollTimeoutMs }).toBe(true);
    }
  }
  return starterRoles(page);
}

/** Save each user's Nearby map + list, Contacts, Talks and Me as PNGs in `dir` (pass or fail). */
export async function captureStarterTabs(pages: Array<Page | undefined>, names: string[], dir: string | undefined, log: (line: string) => void): Promise<void> {
  if (!dir) return;
  const clickById = (page: Page, id: string) => page.evaluate((target) => (document.getElementById(target) as HTMLElement | null)?.click(), id);
  for (const [index, page] of pages.entries()) {
    if (!page || page.isClosed()) continue;
    const shot = async (name: string) => {
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: `${dir}/${names[index]}-${name}.png` });
    };
    try {
      await page.keyboard.press('Escape');
      await page.locator('.nav-btn[data-view="chatrooms"]').click();
      await clickById(page, 'chatroom-map-view-btn');
      await page.waitForTimeout(3_000);
      await shot('1-nearby-map');
      await clickById(page, 'chatroom-list-view-btn');
      await shot('2-nearby-list');
      await sharedTagRows(page);
      await shot('3-contacts-top');
      await openCollapsedFilters(page, 'contacts-filter-toggle');
      await shot('3-contacts-filters-open');
      await page.locator('[data-testid="contacts-filter-toggle"]').click().catch(() => {});
      await page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])').first()
        .evaluate((row) => row.scrollIntoView({ block: 'start' })).catch(() => {});
      await shot('3-contacts-people');
      await page.locator('.nav-btn[data-view="talks"]').click();
      await shot('4-talks');
      await page.locator('.nav-btn[data-view="me"]').click();
      await shot('5-me');
    } catch (error) {
      log(`screenshots for ${names[index]} stopped: ${String(error).slice(0, 200)}`);
    }
  }
  log(`screenshots in ${dir}`);
}
