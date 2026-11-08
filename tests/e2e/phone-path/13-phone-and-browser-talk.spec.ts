/**
 * A phone and a browser exchange Talks over their graph link, both ways (J-TALK-06). Alice is on
 * phone A (her core in the phone node); Web is a plain browser on the hub (its core in the web
 * worker). Each offers a Talk to the other right after they meet, and it must reach the other's
 * incoming list.
 *
 * Found by native-app/12 on every phone (2026-11-08): the phone met the browser before it could
 * find the browser's keys, so its link stayed closed, and the offer — reported as made — waited for
 * a link that never opened. Phone↔phone (phone-path/02, /12) and browser↔browser (stage2/97) did
 * not show it.
 */
import { test, expect, type Page } from '@playwright/test';
import { closeUsers, currentRoomId, openUser, resetPhonePath, userId, type JourneyUser } from './phone-path-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The author offers a new Talk to the other over their graph link; resolves once it is listed there. */
async function offerAndExpectArrival(author: Page, authorId: string, responder: Page, responderId: string, subject: string): Promise<void> {
  const tid = `phone-browser-${subject}-${Date.now()}`;
  const title = `Talk about ${subject} ${tid}`;
  await author.evaluate(({ tid, authorId, title, subject }) => {
    const talkDef = { id: tid, authorId, title, type: 'flow', questions: [{ id: 'q1', text: `Do you like ${subject}?`, answers: [
      { id: 'a-match', text: 'Yes', isMatch: true }, { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true }] }] };
    const myTalks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
    myTalks[tid] = { role: 'created', fullTalk: talkDef };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));
  }, { tid, authorId, title, subject });
  await author.evaluate(async ({ tid, to }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const entry = ((window as any).__iinpublic_collection?.('myTalks') ?? {})[tid];
    await app.offerTalkForE2e(entry.fullTalk, [to]);
  }, { tid, to: responderId });
  await expect.poll(() => responder.evaluate(async (t: string) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    return (((await app.getLocalIncomingClustersForE2e?.()) ?? []) as any[]).some((r) => r.title === t);
  }, title), { timeout: 60_000, message: `${subject}: the Talk never reached the other side` }).toBe(true);
}

test.describe('Phone and browser exchange Talks over their graph link', () => {
  let phone: JourneyUser | undefined;
  let web: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(phone, web);
    phone = web = undefined;
  });

  test('a Talk offered right after they meet arrives, phone → browser and browser → phone', async ({ browser }) => {
    test.setTimeout(300_000);
    phone = await openUser(browser, 'Alice', 'phoneA');
    web = await openUser(browser, 'Web', 'hub');
    const [phoneId, webId] = [await userId(phone.page), await userId(web.page)];
    await expect.poll(async () => (await currentRoomId(phone!.page)) !== '' && (await currentRoomId(phone!.page)) === (await currentRoomId(web!.page)),
      { timeout: 60_000, message: 'the phone and the browser are not in the same Nearby room' }).toBe(true);
    await offerAndExpectArrival(phone.page, phoneId, web.page, webId, 'dogs');
    await offerAndExpectArrival(web.page, webId, phone.page, phoneId, 'cats');
  });
});
