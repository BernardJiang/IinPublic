/**
 * Starter interest tags (OPEN-87, docs/design/actionable-first-run-starter-talks.md): ordinary
 * incoming tags with no sender, answered with one tap, then matched between people by ordinary
 * Talk exchange.
 *
 * 1. One tap: liking the third starter tag passes the two above it (scrolled past) — they fly left
 *    and up, the liked one right and down. Nothing is sent and no Contact appears; the Like is
 *    copied into My Talks as the user's own Talk (no starter author or marker, same identity key).
 * 2. Matching: Alice and Bob both like the first starter tag; Carol likes the second, which passes the
 *    first above it. Bob broadcasts: Alice's chatbot answers his copy from her own Like and they
 *    match; Carol's chatbot passes it from her pass, and nothing matches for her.
 * 3. The graph, from Alice's side: Contacts → 🏷️ Tags → the shared tag (in her tags) → Bob → Bob's
 *    tags, that one marked shared → back to its tag page.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { starterTagsFor } from '../../../../src/shared/starter-tags';

const STARTER_TAGS = starterTagsFor('en');

/* eslint-disable @typescript-eslint/no-explicit-any */

const starterChips = (page: Page) => page.locator('.talk-tag-chip[data-role="incoming"][data-starter-tag="true"]');
const chipFor = (page: Page, en: string) => starterChips(page).filter({ hasText: en });

/** The harness turns starter seeds off for ordinary specs; a fresh identity opts back in here. */
async function showStarterTags(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem('iinpublic_starter_contacts_disabled'));
  await page.locator('.nav-btn[data-view="talks"]').click();
  await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.());
  await expect(starterChips(page)).toHaveCount(STARTER_TAGS.length, { timeout: 20_000 });
}

async function like(page: Page, keyword: string): Promise<void> {
  await chipFor(page, keyword).locator('.talk-tag-in-like').click();
  await expect.poll(() => myTalkRole(page, keyword), { timeout: 10_000 }).toBe('copied');
}

const myTalkRole = (page: Page, en: string) => page.evaluate((keyword) => {
  const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
  const entry = Object.values(talks).find((talk: any) => talk?.fullTalk?.questions?.[0]?.text === keyword) as any;
  return entry?.role || '';
}, en);

test.describe('Starter interest tags (OPEN-87)', () => {
  test.describe.configure({ retries: 0 });
  const browsers: Browser[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage2Spec();
  });

  test('one tap likes a tag and passes the ones scrolled past; the Like becomes my own Talk', async () => {
    test.setTimeout(180_000);
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
    browsers.push(browser);
    const { page } = await bootstrapUser(browser, 'Una', 'Una Starter');
    await showStarterTags(page);
    const [first, second, third] = STARTER_TAGS;

    await chipFor(page, third!.text).locator('.talk-tag-in-like').click();
    // The motion: the two above fly left/up, the tapped one right/down (fixed-position copies).
    await expect(page.locator('.talk-tag-fly-ghost.talk-tag-fly-pass')).toHaveCount(2);
    await expect(page.locator('.talk-tag-fly-ghost.talk-tag-fly-like')).toContainText(third!.text);

    await expect.poll(() => myTalkRole(page, third!.text), { timeout: 10_000 }).toBe('copied');
    expect(await myTalkRole(page, first!.text)).toBe('ignored');
    expect(await myTalkRole(page, second!.text)).toBe('ignored');
    // Tags below the liked one are untouched.
    expect(await myTalkRole(page, STARTER_TAGS[3]!.text)).toBe('');

    const adopted = await page.evaluate((keyword) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const [id, entry] = Object.entries(talks).find(([, talk]: [string, any]) => talk?.fullTalk?.questions?.[0]?.text === keyword) as [string, any];
      return {
        id,
        contentId: entry.fullTalk.id,
        authorId: entry.fullTalk.authorId,
        starter: entry.fullTalk.starterContactId ?? null,
        me: app?.currentUser?.id,
        contacts: app?.uiManager?.getMyConversations ? Object.values(app.uiManager.getMyConversations()).filter((c: any) => !c?.supportChannel).length : -1,
      };
    }, third!.text);
    expect(adopted.authorId).toBe(adopted.me);
    expect(adopted.starter).toBeNull();
    expect(adopted.contentId).toBe(adopted.id);
    expect(adopted.contacts).toBe(0);
  });

  test('people who liked the same starter tag match through ordinary Talk exchange', async () => {
    test.setTimeout(300_000);
    const launch = async () => {
      const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
      browsers.push(browser);
      return browser;
    };
    const [alice, bob, carol] = await Promise.all([
      launch().then((b) => bootstrapUser(b, 'Alice', 'Alice Tags')),
      launch().then((b) => bootstrapUser(b, 'Bob', 'Bob Tags')),
      launch().then((b) => bootstrapUser(b, 'Carol', 'Carol Tags')),
    ]);
    // The first tag (Alice and Bob) and the second (Carol), so liking the first passes nothing.
    const [shared, carols] = STARTER_TAGS as [typeof STARTER_TAGS[number], typeof STARTER_TAGS[number]];
    for (const user of [alice, bob, carol]) await showStarterTags(user.page);
    await like(alice.page, shared.text);
    await like(bob.page, shared.text);
    await like(carol.page, carols.text);

    const ids = await Promise.all([alice, bob, carol].map((user) =>
      user.page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id as string)));
    const [aliceId, , carolId] = ids;
    // Bob sends his own Talks (the Hiking copy) the way Broadcast does.
    const sent = await bob.page.evaluate(async (receiverUsers) =>
      (window as any).__iinpublic_app.getApp().deliverPendingBroadcastTalksForE2e(0, {
        skipAudiencePreview: true, skipDeliveryAcks: true, receiverUsers,
      }), [{ userId: aliceId, stageName: 'Alice Tags' }, { userId: carolId, stageName: 'Carol Tags' }]);
    expect(sent.talksSent).toBeGreaterThanOrEqual(1);

    const matches = (page: Page) => page.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.getTotalMatches?.() ?? -1);
    // Alice's chatbot answers Bob's copy from her own Like: a match on both sides.
    await expect.poll(() => matches(alice.page), { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => matches(bob.page), { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
    // Carol liked the second tag, which passed the first above it: Bob's copy reaches her and her
    // chatbot passes it from that answer, so nothing matches for her.
    await expect.poll(() => carol.page.evaluate((keyword) => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      return (ui?.incomingTalkClusters || []).some((cluster: any) => String(cluster?.title || '').includes(keyword));
    }, shared.text), { timeout: 90_000 }).toBe(true);
    await carol.page.waitForTimeout(5_000);
    expect(await matches(carol.page)).toBe(0);

    // Travel the graph from Alice's side: Contacts → 🏷️ Tags → the shared tag → Bob → his tags → it.
    const a = alice.page;
    await a.locator('.nav-btn[data-view="contacts"]').click();
    await a.locator('[data-testid="contacts-tag-directory-btn"]').click();
    await a.locator('[data-testid="tag-directory-search"]').fill(shared.text.slice(0, 3).toLowerCase());
    const sharedChip = a.locator('[data-testid="tag-directory-list"] [data-tag-key]').filter({ hasText: shared.text });
    await expect(sharedChip).toHaveCount(1);
    await expect(sharedChip).toHaveAttribute('data-shared', 'true');
    await sharedChip.click();
    await expect(a.locator('[data-testid="tag-page-mine"]')).toHaveText('In your tags');
    const bobRow = a.locator('[data-testid="tag-page-person"]').filter({ hasText: 'Bob Tags' });
    await expect(bobRow).toHaveCount(1);
    await bobRow.click();
    await expect(a.locator('#peer-detail-overlay')).toBeVisible();
    const bobsShared = a.locator('[data-testid="peer-tags-section"] [data-tag-key]').filter({ hasText: shared.text });
    await expect(bobsShared).toHaveAttribute('data-shared', 'true');
    await bobsShared.click();
    await expect(a.locator('#tag-page-modal-title')).toContainText(shared.text);
  });
});
