/**
 * Several people near each other, written once against TestActor (docs/testing/
 * android-core-test-plan.md, conversion step 3): staged/stage4/07 runs it with four browsers and
 * native-app/30 with three or four real phones. Every step is checked on the receiving side.
 *
 *   J-NEARBY-01  everyone has every other person on their own Nearby list (§3.7: personal lists,
 *                no shared room roster);
 *   J-NEARBY-02  each person's Talk reaches the next person in a ring;
 *   J-NEARBY-03  a Talk sent while the receiver is in the background is there when they come
 *                back, and the author's durable outbox clears on the receiver's ACK (only for
 *                actors with background/foreground hooks);
 *   J-NEARBY-04  three people send Talks at the same moment and each receives the other two;
 *   J-NEARBY-05  one goes offline, the other two keep answering each other, and a Talk sent to the
 *                offline person while they were away arrives once they are back (author outbox
 *                retry, not an injection). staged/stage3/81 and native-app/13 run 04–05.
 */
import { expect, type Page } from '@playwright/test';
import { completeTalksInAppByAnswerIds, findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';
import type { TestActor } from '../helpers/test-actor';
import { nearbyListIds } from '../native-app/helpers/native-app';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type NearbyParticipant = { actor: TestActor; userId: string; stageName: string };

type CreatedTalk = { title: string; talkId: string; talkData: any };

/** How many of the other participants are on each participant's Nearby list. */
export function othersOnEachList(people: NearbyParticipant[]): Promise<number[]> {
  return Promise.all(people.map(async (person) => {
    const ids = new Set(await nearbyListIds(person.actor.page));
    return people.filter((other) => other.userId !== person.userId && ids.has(other.userId)).length;
  }));
}

export async function waitForIncomingTalk(page: Page, label: string, title: string, timeoutMs = 120_000): Promise<string> {
  let talkId = '';
  await expect.poll(async () => {
    try {
      talkId = await findIncomingTalkIdByTitle(page, title);
      return true;
    } catch {
      return false;
    }
  }, { timeout: timeoutMs, intervals: [1_000, 2_000, 3_000], message: `${label} should receive ${title}` }).toBe(true);
  return talkId;
}

/**
 * Exercise the app's ordinary createTalk handler without depending on synthetic pointer events.
 * Several OEM WebViews stall in CDP's scroll-before-click phase even when the same element is
 * already reported visible; that is an automation limitation, not part of this transport proof.
 */
export async function createTagTalk(actor: TestActor, title: string): Promise<CreatedTalk> {
  await actor.page.evaluate(({ expectedTitle }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.emit) throw new Error('createTalk event unavailable');
    app.uiManager.emit('createTalk', {
      title: expectedTitle,
      type: 'tag',
      language: 'en',
      isAdult: false,
      tags: [],
      questions: [{
        id: 'q_1',
        text: expectedTitle,
        answers: [
          { id: 'a_0_match', text: expectedTitle, isMatch: true, isTerminal: true },
          { id: 'a_0_ignore', text: 'Not interested', isIgnore: true, isTerminal: true },
        ],
      }],
      selfAnswers: [{ questionId: 'q_1', answerId: 'a_0_match' }],
      createdAt: new Date().toISOString(),
      isTemplate: false,
      usageCount: 0,
      sendToChatroom: false,
    });
  }, { expectedTitle: title });

  let created: CreatedTalk | null = null;
  await expect.poll(async () => {
    created = await actor.page.evaluate((expectedTitle) => {
      const raw = localStorage.getItem('myTalks');
      const talks = raw ? JSON.parse(raw) : {};
      const entry = Object.entries(talks).find(([, value]: [string, any]) =>
        value?.role === 'created' && value?.title === expectedTitle && value?.fullTalk);
      if (!entry) return null;
      const [talkId, value] = entry as [string, any];
      return { title: expectedTitle, talkId, talkData: value.fullTalk };
    }, title);
    return created !== null;
  }, { timeout: 90_000, intervals: [500, 1_000, 2_000], message: `${actor.id} should create ${title}` }).toBe(true);
  return created!;
}

/** J-NEARBY-01: every participant has all the others on their own list. */
export async function everyoneListsEveryone(people: NearbyParticipant[], timeoutMs = 120_000): Promise<void> {
  await expect.poll(() => othersOnEachList(people), {
    timeout: timeoutMs,
    intervals: [1_000, 2_000, 3_000],
    message: `every participant should have the other ${people.length - 1} on their Nearby list`,
  }).toEqual(people.map(() => people.length - 1));
}

/**
 * J-NEARBY-02: one Talk per participant, each received by the next one — every participant proves
 * both the author and the receiver paths without a redundant N×N burst. Returns per-Talk latency.
 */
export async function ringTalkJourney(people: NearbyParticipant[], runId: string): Promise<number[]> {
  const deliveryMs: number[] = [];
  for (let index = 0; index < people.length; index += 1) {
    const author = people[index];
    const receiver = people[(index + 1) % people.length];
    const talk = await createTagTalk(author.actor, `${runId}-${index + 1}`);
    const startedAt = Date.now();
    const sent = await author.actor.page.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1),
    );
    expect(sent?.talksSent ?? 0).toBeGreaterThan(0);
    expect(await waitForIncomingTalk(receiver.actor.page, receiver.actor.id, talk.talkData.title)).toBe(talk.talkId);
    deliveryMs.push(Date.now() - startedAt);
    console.log(`[nearby-ring] Talk ${index + 1}: ${author.actor.id} -> ${receiver.actor.id} in ${deliveryMs.at(-1)} ms`);
  }
  return deliveryMs;
}

/**
 * J-NEARBY-03: the receiver goes to the background, a Talk is sent straight to them, and it is
 * there once they are back; the author's durable outbox entry clears on the receiver's ACK.
 * Returns the delivery latency including the background interval.
 */
export async function backgroundDeliveryJourney(
  author: NearbyParticipant,
  receiver: NearbyParticipant,
  runId: string,
  roomId: string,
): Promise<number> {
  if (!receiver.actor.background || !receiver.actor.foreground) {
    throw new Error(`${receiver.actor.id} has no background/foreground hooks`);
  }
  const talk = await createTagTalk(author.actor, `${runId}-background`);
  await receiver.actor.background();
  const startedAt = Date.now();
  const sent = await author.actor.page.evaluate(async ({ receiverId, receiverName, talkId, talkData }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    return app?.deliverTalkToReceiversOverMesh?.(
      talkId,
      talkData,
      [{ userId: receiverId, stageName: receiverName }],
      [receiverId],
    );
  }, { receiverId: receiver.userId, receiverName: receiver.stageName, talkId: talk.talkId, talkData: talk.talkData });
  expect(sent).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await receiver.actor.foreground();
  await expect.poll(
    () => receiver.actor.page.evaluate(() => Boolean((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id)),
    { timeout: 30_000 },
  ).toBe(true);
  expect(await waitForIncomingTalk(receiver.actor.page, receiver.actor.id, talk.talkData.title)).toBe(talk.talkId);
  const elapsed = Date.now() - startedAt;
  await expect.poll(() => author.actor.page.evaluate(async ({ targetRoomId, targetUserId, targetTalkId }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const outbox = app?.peerMeshService?.directTalkOutbox;
    if (!outbox?.list) return -1;
    const entries = await outbox.list(targetRoomId);
    return entries.filter((entry: any) => entry.recipientUserId === targetUserId && entry.talkId === targetTalkId).length;
  }, { targetRoomId: roomId, targetUserId: receiver.userId, targetTalkId: talk.talkId }), {
    timeout: 30_000,
    message: 'author durable outbox should clear after the receiver ACK',
  }).toBe(0);
  expect(await receiver.actor.page.evaluate(
    () => String((window as any).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.() || ''),
  )).toBe(roomId);
  return elapsed;
}

async function sendTalkTo(author: NearbyParticipant, receiver: NearbyParticipant, talk: CreatedTalk): Promise<void> {
  const sent = await author.actor.page.evaluate(async ({ userId, stageName, talkId, talkData }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    return app?.deliverTalkToReceiversOverMesh?.(talkId, talkData, [{ userId, stageName }], [userId]);
  }, { userId: receiver.userId, stageName: receiver.stageName, talkId: talk.talkId, talkData: talk.talkData });
  expect(sent).toBe(true);
}

/**
 * J-NEARBY-04 and J-NEARBY-05 for exactly three participants; `offline` is the one whose actor
 * has a `setOffline` hook. The caller restores the network in its cleanup if this throws.
 */
export async function offlineResyncJourney(people: NearbyParticipant[], offline: NearbyParticipant, runId: string): Promise<void> {
  expect(people).toHaveLength(3);
  if (!offline.actor.setOffline) throw new Error(`${offline.actor.id} has no setOffline hook`);
  const [first, second] = people.filter((person) => person !== offline);

  // J-NEARBY-04: everyone authors and sends in the same Promise.all, not one after another.
  const talks = new Map<NearbyParticipant, CreatedTalk>();
  await Promise.all(people.map(async (person) => {
    const talk = await createTagTalk(person.actor, `${runId}-${person.actor.id}`);
    talks.set(person, talk);
    const sent = await person.actor.page.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.deliverPendingBroadcastTalksForE2e?.(1),
    );
    expect(sent?.talksSent ?? 0).toBeGreaterThan(0);
  }));
  await Promise.all(people.flatMap((receiver) => people.filter((author) => author !== receiver).map(async (author) => {
    const talk = talks.get(author)!;
    expect(await waitForIncomingTalk(receiver.actor.page, receiver.actor.id, talk.title)).toBe(talk.talkId);
  })));

  // J-NEARBY-05: the Talk is created and sent only after the person is offline, so seeing it later
  // proves catch-up rather than an earlier send that happened to arrive late.
  await offline.actor.setOffline(true);
  const missed = await createTagTalk(first.actor, `${runId}-offline-${first.actor.id}`);
  await sendTalkTo(first, offline, missed);

  // The other two continue without them: each answers the other's Talk and they match.
  const firstTalk = talks.get(first)!;
  const secondTalk = talks.get(second)!;
  await completeTalksInAppByAnswerIds(first.actor.page, [{
    talkId: secondTalk.talkId, talkData: secondTalk.talkData, answerIds: ['a_0_match'], outcome: 'match',
  }]);
  await completeTalksInAppByAnswerIds(second.actor.page, [{
    talkId: firstTalk.talkId, talkData: firstTalk.talkData, answerIds: ['a_0_match'], outcome: 'match',
  }]);

  await offline.actor.setOffline(false);
  // Found in the returning person's own local incoming clusters, then answered from there.
  const resyncedId = await waitForIncomingTalk(offline.actor.page, offline.actor.id, missed.title, 120_000);
  expect(resyncedId).toBe(missed.talkId);
  await completeTalksInAppByAnswerIds(offline.actor.page, [{
    talkId: resyncedId, talkData: missed.talkData, answerIds: ['a_0_match'], outcome: 'match',
  }]);
}

/**
 * J-NEARBY-06 (§3.7 "Meeting new people in groups"): when everyone around fits in one group,
 * "Meet new people" finds nobody past it and says so; "Back to group 1" brings everyone back.
 * J-NEARBY-07: the hub reports every participant online, asked through this person's own node
 * (a phone forwards it to the hub).
 */
export async function groupRoundTripJourney(person: NearbyParticipant, others: NearbyParticipant[]): Promise<void> {
  const page = person.actor.page;
  const listIds = () => nearbyListIds(page).then((ids) => ids.filter((id) => others.some((other) => other.userId === id)).sort());
  const everyone = others.map((other) => other.userId).sort();
  await expect.poll(listIds, { timeout: 120_000, message: `${person.actor.id} should list everyone first` }).toEqual(everyone);

  const online = await page.evaluate(async (ids) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const response = await fetch(`${app.getBackendApiBase()}/api/nearby/v3/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ids }),
    });
    return response.ok ? ((await response.json()) as { online?: string[] }).online ?? [] : [`HTTP ${response.status}`];
  }, everyone);
  expect([...online].sort()).toEqual(everyone);

  const groupInfo = () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service.groupInfo());
  expect(await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service.meetNewPeople())).toBe(true);
  await expect.poll(groupInfo, { timeout: 120_000, message: `${person.actor.id} should find nobody past group 1` })
    .toEqual({ group: 2, exhausted: true });
  expect(await listIds()).toEqual([]);

  await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service.backToFirstGroup());
  await expect.poll(groupInfo, { timeout: 30_000 }).toEqual({ group: 1, exhausted: false });
  await expect.poll(listIds, { timeout: 120_000, message: `${person.actor.id} should list everyone again` }).toEqual(everyone);
}
