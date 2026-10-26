/**
 * Starter interest tags (OPEN-87, docs/design/actionable-first-run-starter-talks.md): ordinary
 * incoming tags with no sender, answered with one tap, then matched between people by ordinary
 * Talk exchange.
 *
 * 1. One tap: liking the third starter tag passes the two above it (scrolled past) — they fly left
 *    and up, the liked one right and down. Nothing is sent and no Contact appears; the Like is
 *    copied into My Talks as the user's own Talk (no starter author or marker, same identity key).
 *    A divider splits Incoming from Outgoing. The toolbar is grayed out until a long-press selects
 *    a row; ✕ then passes it. Tapping the liked tag in Outgoing passes it (a regretted Like).
 * 2. Matching: Alice and Bob both like the first starter tag; Carol likes the second, which passes the
 *    first above it. Bob broadcasts: Alice's chatbot answers his copy from her own Like and they
 *    match; Carol's chatbot passes it from her pass, and nothing matches for her.
 * 3. The graph, from Alice's side: Contacts 🏷️ → type the shared tag → Bob → Bob's tags, that one
 *    marked shared → the same people; his 💬 → our Talks; ♡ in common → my answers on Me.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { starterTagsFor } from '../../../../src/shared/starter-tags';
import { talkToolbarAction } from '../../helpers/talk-row-actions';

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
  await chipFor(page, keyword).click();
  await expect.poll(() => myTalkRole(page, keyword), { timeout: 10_000 }).toBe('copied');
}

const myTalkRole = (page: Page, en: string) => page.evaluate((keyword) => {
  const talks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
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

    await chipFor(page, third!.text).click();
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
      const talks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
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

    // Incoming and Outgoing are split by a divider; the Like now sits in Outgoing.
    await expect(page.locator('[data-testid="talks-direction-divider"]')).toHaveCount(1);
    const likedOut = page.locator('.talk-tag-chip[data-role="copied"]').filter({ hasText: third!.text });
    await expect(likedOut).toHaveCount(1);
    // The toolbar is grayed out until a long-press selects a row; ✕ then passes the selected tag.
    for (const action of ['pass', 'like', 'pin']) await expect(page.locator(`#talks-tap-${action}-btn`)).toBeDisabled();
    const fourth = STARTER_TAGS[3]!;
    await talkToolbarAction(page, chipFor(page, fourth.text), 'pass');
    await expect.poll(() => myTalkRole(page, fourth.text), { timeout: 10_000 }).toBe('ignored');
    // A regretted Like: a tap on the liked tag in Outgoing passes it.
    await likedOut.click();
    await expect.poll(() => myTalkRole(page, third!.text), { timeout: 10_000 }).toBe('ignored');
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
    // Bob sends his own Talks (his copy of the shared tag) the way Broadcast does.
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

    // Travel the graph from Alice's side (graph-focus.ts): Contacts 🏷️ → type the tag → Bob → his
    // tags → that tag → the same people; his 💬 → our Talks; ♡ in common → my answers on Me.
    const a = alice.page;
    await a.locator('.nav-btn[data-view="contacts"]').click();
    await a.locator('[data-testid="contacts-tag-directory-btn"]').click();
    const topic = a.locator('[data-testid="contacts-filter-topic"]');
    await expect(topic).toBeFocused();
    await topic.fill(shared.text.toLowerCase());
    await expect(a.locator('[data-testid="contacts-focus-chip"]')).toContainText(shared.text);
    const people = a.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])');
    await expect(people).toHaveCount(1);
    await expect(people.first()).toContainText('Bob Tags');
    await people.first().locator('.contact-item-meta').first().click();
    await expect(a.locator('#peer-detail-overlay')).toBeVisible();
    const bobsShared = a.locator('[data-testid="peer-tags-section"] [data-tag-key]').filter({ hasText: shared.text });
    await expect(bobsShared).toHaveAttribute('data-shared', 'true');
    await bobsShared.click();
    await expect(a.locator('[data-testid="contacts-focus-chip"]')).toContainText(shared.text);
    await expect(people).toHaveCount(1);

    await people.first().locator('.contact-item-meta').first().click();
    await a.locator('[data-testid="peer-talks-link"]').click();
    await expect(a.locator('[data-testid="talks-focus-chip"]')).toContainText('Bob Tags');
    await expect(a.locator('#talks-list .talk-tag-chip')).toHaveCount(1);
    await expect(a.locator('#talks-list .talk-tag-chip')).toContainText(shared.text);

    await a.locator('.nav-btn[data-view="contacts"]').click();
    await people.first().locator('.contact-item-meta').first().click();
    await a.locator('[data-testid="peer-shared-tags-link"]').click();
    await expect(a.locator('[data-testid="me-focus-chip"]')).toContainText('Bob Tags');
    await expect(a.locator('#answers-list .answer-talk-item:visible')).toHaveCount(1);
    await expect(a.locator('#answers-list .answer-talk-item:visible')).toHaveAttribute('data-topic', shared.text);
  });
});
