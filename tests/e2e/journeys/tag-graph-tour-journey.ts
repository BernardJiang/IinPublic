/**
 * The tag graph tour (owner design 2026-10-25), shared by the browser spec
 * (staged/stage3-three-user/82) and the phone path (phone-path/09). The app is a GUI over a
 * graph — places (Chatrooms), people (Contacts), Talks, and answers (Me) — and a tag, the simplest
 * Talk, touches every kind of node. One tag, ♡ Pizza, walked across every edge from Ann's side:
 *
 *   place → person → their tags → people who like Pizza → a person → our Talks → Pizza's ♡ → my
 *   answer on Me → 👥 the same people / 💬 the Talk; a person → the answers we share; Pizza typed
 *   into Contacts → the same people; my answer → 📍 where it was exchanged → the people met there →
 *   a person → where we met; ‹ back along the links. A multi-question Talk too: Cy's answer to
 *   Ann's Flow Talk → 👥 Ann, 💬 the Talk → 📍 its place. And from Ben's side: his ♡ Pizza leads
 *   back to Ann.
 *
 * Ann likes Coffee and Pizza, Ben likes Pizza (which passes Coffee above it), Cy likes both. Ann
 * and Cy send their tags to the other two; each chatbot answers from its own Like or Pass.
 */
import { expect, type Page } from '@playwright/test';
import { starterTagsFor } from '../../../src/shared/starter-tags';
import { openCurrentChatroom } from '../helpers/chatroom-nav';
import { createSimpleFlowTalk } from '../helpers/broadcast-cancellation-helpers';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../helpers/talks-matching-flow';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TAGS = starterTagsFor('en');
const COFFEE = TAGS.find((tag) => tag.id === 'coffee' && tag.group.id === 'food')!.text;
const PIZZA = TAGS.find((tag) => tag.id === 'pizza')!.text;

const app = (page: Page) => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id as string);
const starterChip = (page: Page, keyword: string) =>
  page.locator('#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"]').filter({ hasText: keyword });
const people = (page: Page) => page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])');
const peopleIds = (page: Page) => people(page).evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.contactUserId || ''));

/** Shows the starter tags (the harness turns them off) and likes these, top-down. */
async function likeStarterTags(page: Page, keywords: string[]): Promise<void> {
  await page.evaluate(() => ((window as any).__iinpublic_collection_edit?.('settings', { remove: ['iinpublic_starter_contacts_disabled'] }), localStorage.removeItem('iinpublic_starter_contacts_disabled')));
  await page.locator('.nav-btn[data-view="talks"]').click();
  await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.());
  for (const keyword of keywords) {
    await starterChip(page, keyword).first().click();
    await expect(page.locator('#talks-list .talk-tag-chip[data-role="copied"]').filter({ hasText: keyword })).toHaveCount(1, { timeout: 10_000 });
  }
}

/** A tab, after stepping out of a chat or a person page (a match can open a chat by itself). */
async function goTo(page: Page, view: string): Promise<void> {
  for (const back of ['#back-from-conversation', '#back-from-peer-detail']) {
    const button = page.locator(back);
    if (await button.isVisible().catch(() => false)) await button.click();
  }
  await page.locator(`.nav-btn[data-view="${view}"]`).click();
}

async function openPersonFromList(page: Page, peerId: string): Promise<void> {
  await people(page).and(page.locator(`[data-contact-user-id="${peerId}"]`)).locator('.contact-item-meta').first().click();
  await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
}
const stageNameOf = (page: Page) => page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName || ''));

export async function tagGraphTourJourney(ann: Page, ben: Page, cy: Page): Promise<void> {
  const [annId, benId, cyId] = await Promise.all([ann, ben, cy].map(app));
  const [annName, benName, cyName] = await Promise.all([ann, ben, cy].map(stageNameOf));
  // Toasts ("Match!", "🤖 answered…") would sit over the links this tour taps.
  await Promise.all([ann, ben, cy].map((page) => page.evaluate(() =>
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.setNotificationsSuppressedForE2e?.(true))));

  await likeStarterTags(ann, [COFFEE, PIZZA]);
  await likeStarterTags(ben, [PIZZA]);
  await likeStarterTags(cy, [COFFEE, PIZZA]);

  // Ann and Cy send their tags (the Broadcast path); each chatbot answers from its Like or Pass.
  const send = (page: Page, to: Array<{ userId: string; stageName: string }>) => page.evaluate(async (receiverUsers) =>
    (window as any).__iinpublic_app.getApp().deliverPendingBroadcastTalksForE2e(0, { skipAudiencePreview: true, receiverUsers }), to);
  expect((await send(ann, [{ userId: benId, stageName: benName }, { userId: cyId, stageName: cyName }])).talksSent).toBe(2);
  expect((await send(cy, [{ userId: annId, stageName: annName }, { userId: benId, stageName: benName }])).talksSent).toBe(2);

  const a = ann;
  // Pizza: Ben and Cy like it; Coffee: only Cy (Ben passed it). Wait until Ann's Me shows that.
  // An open Me tab updates its 👥 as exchanges arrive (once each burst settles).
  await a.locator('.nav-btn[data-view="me"]').click();
  const pizzaRow = a.locator(`#answers-list .answer-talk-item[data-topic="${PIZZA}"]`);
  const peopleCount = (page: Page, keyword: string) =>
    page.locator(`#answers-list .answer-talk-item[data-topic="${keyword}"] [data-testid="answer-people"]`).textContent().catch(() => '');
  await expect.poll(() => peopleCount(a, PIZZA), { timeout: 90_000, intervals: [2_000] }).toContain('2');
  await expect.poll(() => peopleCount(a, COFFEE), { timeout: 60_000, intervals: [2_000] }).toContain('1');

  // ── Place → person: Ben in Ann's Nearby list opens his page ─────────────
  await a.locator('.nav-btn[data-view="chatrooms"]').click();
  // Ben's row in Nearby (as a person row or a room member row): cards can take a minute to swap.
  await openCurrentChatroom(a);
  const benRow = a.locator(`[data-testid="nearby-person-row"][data-user-id="${benId}"]:visible, .chatroom-member-item[data-user-id="${benId}"]:visible`).first();
  await expect(benRow).toBeVisible({ timeout: 90_000 });
  await benRow.click();
  const backFromChat = a.locator('#back-from-conversation');
  if (await backFromChat.isVisible().catch(() => false)) await backFromChat.click();
  await expect(a.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });

  // ── Person → his tags → people who like Pizza ───────────────────────────
  const benPizza = a.locator('[data-testid="peer-tags-section"] [data-tag-key]').filter({ hasText: PIZZA });
  await expect(benPizza).toHaveAttribute('data-shared', 'true', { timeout: 30_000 });
  await benPizza.click();
  await expect(a.locator('[data-testid="contacts-focus-chip"]')).toContainText(`♡ ${PIZZA}`);
  await expect.poll(async () => (await peopleIds(a)).sort(), { timeout: 15_000 }).toEqual([benId, cyId].sort());

  // ── A person → our Talks → Pizza on Talks, with the same face as on Me ──
  await openPersonFromList(a, cyId);
  await a.locator('[data-testid="peer-talks-link"]').click();
  await expect(a.locator('[data-testid="talks-focus-chip"]')).toContainText(cyName);
  const talkPizza = a.locator('#talks-list .talk-tag-chip[data-role="copied"]').filter({ hasText: PIZZA });
  await expect(talkPizza).toHaveCount(1);
  await expect(talkPizza.locator('[data-testid="answer-tag-mark"]')).toHaveText('♡');
  await expect(talkPizza.locator('[data-testid="answer-people"]')).toContainText('2');

  // ── Talk → my answer: Pizza's ♡ opens it on Me ──────────────────────────
  await talkPizza.locator('[data-testid="answer-tag-mark"]').click();
  await expect(a.locator('[data-testid="me-focus-chip"]')).toContainText(PIZZA);
  await expect(a.locator('#answers-list .answer-talk-item:visible')).toHaveCount(1);
  await expect(a.locator('#answers-list .answer-talk-item:visible')).toHaveAttribute('data-topic', PIZZA);

  // ── Answer → 👥 the same people, and 💬 its Talk ─────────────────────────
  await pizzaRow.locator('[data-testid="answer-people"]').click();
  await expect(a.locator('[data-testid="contacts-focus-chip"]')).toContainText(`♡ ${PIZZA}`);
  await expect.poll(async () => (await peopleIds(a)).sort(), { timeout: 15_000 }).toEqual([benId, cyId].sort());
  await a.locator('.nav-btn[data-view="me"]').click();
  await pizzaRow.locator('[data-testid="answer-talks"]').click();
  await expect(a.locator('[data-testid="talks-focus-chip"]')).toContainText(PIZZA);
  await expect(a.locator('#talks-list .talk-tag-chip')).toHaveCount(1);

  // ── A person → the answers we share: Cy likes both of Ann's tags ────────
  await a.locator('.nav-btn[data-view="contacts"]').click();
  await openPersonFromList(a, cyId);
  await a.locator('[data-testid="peer-shared-tags-link"]').click();
  await expect(a.locator('[data-testid="me-focus-chip"]')).toContainText(cyName);
  const shared = await a.locator('#answers-list .answer-talk-item:visible')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.topic || '').sort());
  expect(shared).toEqual([COFFEE, PIZZA].sort());

  // ── Typed into Contacts: the same list as tapped ────────────────────────
  await a.locator('.nav-btn[data-view="contacts"]').click();
  await a.locator('[data-testid="contacts-tag-directory-btn"]').click();
  await a.locator('[data-testid="contacts-filter-topic"]').fill(COFFEE.toLowerCase());
  await expect(people(a)).toHaveCount(1);
  await expect.poll(() => peopleIds(a), { timeout: 15_000 }).toEqual([cyId]);

  // ── Answer → place → people met there → a person → where we met; then back ─
  const active = (view: string) => a.locator(`.nav-btn[data-view="${view}"]`);
  const back = a.locator('[data-testid="graph-back-btn"]');
  await a.locator('.nav-btn[data-view="me"]').click();
  await expect(back).toBeHidden();
  await pizzaRow.locator('[data-testid="answer-place"]').click();
  await expect(active('chatrooms')).toHaveClass(/\bactive\b/);
  await a.locator('[data-testid="place-graph-links"] [data-testid="place-people"]').click();
  await expect(a.locator('[data-testid="contacts-focus-chip"]')).toContainText('📍');
  await expect.poll(async () => (await peopleIds(a)).sort(), { timeout: 15_000 }).toEqual([benId, cyId].sort());
  await openPersonFromList(a, benId);
  await expect(a.locator('[data-testid="peer-met-in"] [data-testid="answer-place"]')).toContainText('📍');
  // The person page's own ‹ closes it; then the AppBar's ‹ steps back along the links: to the
  // place, then to my answer on Me.
  await a.locator('#back-from-peer-detail').click();
  await back.click();
  await expect(active('chatrooms')).toHaveClass(/\bactive\b/);
  await expect(a.locator('[data-testid="place-graph-links"] [data-testid="place-talks"]')).toBeVisible();
  await back.click();
  await expect(active('me')).toHaveClass(/\bactive\b/);
  await expect(pizzaRow).toBeVisible();
  await expect(back).toBeHidden();

  // ── A multi-question Talk: Ann asks, Cy answers; Cy's answer leads to Ann, the Talk, the place ─
  const flowTitle = `Tour flow ${Date.now()}`;
  const yes = 'Yes, count me in';
  await goTo(a, 'talks');
  await createSimpleFlowTalk(a, flowTitle, yes, 'Not this time', { sendToChatroom: false });
  await send(ann, [{ userId: cyId, stageName: cyName }]);
  const c = cy;
  await openIncomingTalkModal(c, flowTitle);
  await c.locator(`input.choice-radio[data-answer-text="${yes}"][data-mode="manual"]`).first().click();
  await waitForResponseModalClosed(c);
  await c.locator('.nav-btn[data-view="me"]').click();
  const cyAnswer = c.locator('#answers-list .answer-talk-item').filter({ hasText: yes });
  await expect.poll(() => cyAnswer.locator('[data-testid="answer-people"]').textContent().catch(() => ''), { timeout: 60_000 }).toContain('1');
  await cyAnswer.locator('[data-testid="answer-people"]').click();
  await expect.poll(() => peopleIds(c), { timeout: 15_000 }).toEqual([annId]);
  await c.locator('.nav-btn[data-view="me"]').click();
  await cyAnswer.locator('[data-testid="answer-talks"]').click();
  await expect(c.locator('[data-testid="talks-focus-chip"]')).toBeVisible();
  const flowCard = c.locator('#talks-list .talk-list-item').filter({ hasText: flowTitle });
  await expect(flowCard).toHaveCount(1);
  await flowCard.locator('[data-testid="answer-place"]').click();
  await expect(c.locator('.nav-btn[data-view="chatrooms"]')).toHaveClass(/\bactive\b/);
  // Ann's side: her Talk counts Cy's answer.
  await goTo(a, 'talks');
  await expect(a.locator('#talks-list .talk-list-item').filter({ hasText: flowTitle }).locator('[data-testid="talk-view-responses-button"]'))
    .toContainText('1', { timeout: 60_000 });

  // ── The other side: Ben's ♡ Pizza leads back to Ann (and Cy) ────────────
  const b = ben;
  await b.locator('.nav-btn[data-view="me"]').click();
  const benPizzaRow = b.locator(`#answers-list .answer-talk-item[data-topic="${PIZZA}"]`);
  await expect.poll(() => peopleCount(b, PIZZA), { timeout: 60_000, intervals: [2_000] }).toContain('2');
  await benPizzaRow.locator('[data-testid="answer-people"]').click();
  await expect.poll(async () => (await peopleIds(b)).sort(), { timeout: 15_000 }).toEqual([annId, cyId].sort());
  // Ben passed Coffee: hidden on Me, and nobody is listed for it on his side.
  await expect(b.locator(`#answers-list .answer-talk-item[data-topic="${COFFEE}"]:visible`)).toHaveCount(0);
}
