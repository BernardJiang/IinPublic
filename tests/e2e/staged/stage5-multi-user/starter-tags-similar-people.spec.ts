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
import { waitForPeerDmSent } from '../../helpers/conversation-e2e';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { webAppURLStableChatroom } from '../../helpers/ports';
import {
  DEFAULT_STARTER_SEED, STARTER_TAGS, backToContactsList, captureStarterTabs, decideStarterTags, overlapOf, pickLikes,
  sharedTagRows, unansweredStarterChips,
} from '../../journeys/starter-tags-shared';

/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

const NUM_USERS = Math.min(6, Number(process.env.STARTER_SIMILAR_USERS) || 6);
const CAPACITY = 3;
const LIKES_PER_USER = Number(process.env.STARTER_SIMILAR_LIKES) || 30;
const SEED = Number.parseInt(process.env.STARTER_SIMILAR_SEED || '', 10) || DEFAULT_STARTER_SEED;
const HOLD_MS = process.env.STARTER_SIMILAR_HOLD_MS !== undefined
  ? Number(process.env.STARTER_SIMILAR_HOLD_MS) || 0
  : headless ? 0 : 180_000;
const NAMES = ['Ann', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'].slice(0, NUM_USERS);

// ─── Test data (not app logic): tests/e2e/journeys/starter-tags-shared.ts ─────────

const NUM_USERS_RANGE = Array.from({ length: NUM_USERS }, (_, index) => index);
const LIKES = Array.from({ length: NUM_USERS }, (_, index) => pickLikes(SEED, index, LIKES_PER_USER));
const overlap = (a: number, b: number): number => overlapOf(LIKES, a, b);

const app = (page: Page, fn: string) => page.evaluate((name) => (window as any).__iinpublic_app?.getApp?.()?.[name], fn);

const groupMembers = (page: Page) => page.locator('[data-testid="nearby-person-row"]');
const memberNames = async (page: Page): Promise<string[]> =>
  groupMembers(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-stage-name') || ''));

/** STARTER_SIMILAR_SHOTS_DIR: each user's Nearby map + list, Contacts, Talks and Me, pass or fail. */
const captureAllTabs = (pages: Page[]) =>
  captureStarterTabs(pages, NAMES, process.env.STARTER_SIMILAR_SHOTS_DIR, (line) => console.log(`[starter-similar] ${line}`));

test.describe('Find similar people with starter tags', () => {
  test.describe.configure({ retries: 0 });
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage5Spec();
  });

  test.afterAll(async () => {
    await captureAllTabs(pages);
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage5Spec();
  });

  test('six users decide all 60 starter tags, broadcast to their Nearby group, find who is most similar, befriend and message them', async () => {
    test.setTimeout(1_200_000 + HOLD_MS);
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
      // A busy device core, as under test:all load (run 6, 2026-11-18): each answer and outcome
      // waits this long in the core's serial queue. Off unless asked for.
      const slowMs = Number(process.env.E2E_CORE_SERIAL_DELAY_MS || 0);
      if (slowMs > 0) await user.page.evaluate((ms) => (window as any).__iinpublic_app?.getApp?.()?.coreRequest?.({ name: 'test.slowSerialQueue', ms }), slowMs);
    }
    const indexById = new Map(users.map((user) => [user.id, user.index]));
    const indexByName = new Map(users.map((user) => [user.stageName, user.index]));
    for (const user of users) {
      await expect(user.page.locator('#walkthrough-modal')).toHaveCount(0);
    }

    // ── 2. Each sees all 60 starter tags and decides every one ───────────────
    await Promise.all(users.map(async ({ page, index }) => {
      // The harness turns starter seeds off for ordinary specs; these new users opt back in.
      await page.evaluate(() => ((window as any).__iinpublic_collection_edit?.('settings', { remove: ['iinpublic_starter_contacts_disabled'] }), localStorage.removeItem('iinpublic_starter_contacts_disabled')));
      await page.locator('.nav-btn[data-view="talks"]').click();
      await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList?.());
      await expect(unansweredStarterChips(page)).toHaveCount(STARTER_TAGS.length, { timeout: 30_000 });

      // Like the picks top-down (each tap passes the unanswered tags above it), pass the rest.
      const roles = await decideStarterTags(page, LIKES[index]!);
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
    // joins someone's group receives their active Talks without a new broadcast. Likes are
    // exchanged as they are made (OPEN-112), so someone who was on a list only while the likes were
    // being made got the ones made by then: a person on either one's list now shows the true
    // overlap, anyone else at most that, and everyone knows at least their own group.
    // It takes minutes: a phone admits 24 new Talks a minute from non-contacts (§3.7 "Balance",
    // `incomingTalksPerMinute`) and each user receives up to 5 × 30; offers over that limit go
    // unanswered and the sender's outbox offers them again later.
    // Each user's current Nearby list (user ids), read live while polling.
    const nearbyIds = (page: Page): Promise<string[]> => page.evaluate(() =>
      ((window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.entries?.() ?? []).map((entry: any) => String(entry?.card?.userId || '')));
    const linked = async (index: number, peerIndex: number): Promise<boolean> => {
      const [mine, theirs] = await Promise.all([nearbyIds(users[index]!.page), nearbyIds(users[peerIndex]!.page)]);
      return mine.includes(users[peerIndex]!.id) || theirs.includes(users[index]!.id);
    };
    const results = await Promise.all(users.map(async ({ page, index }) => {
      const expected = new Map<string, number>();
      let rows: Array<{ peerId: string; shared: number }> = [];
      try {
        await expect.poll(async () => {
          rows = (await sharedTagRows(page)).filter((row) => indexById.has(row.peerId));
          expected.clear();
          for (const row of rows) expected.set(row.peerId, overlap(index, indexById.get(row.peerId)!));
          if (rows.length < Math.min(CAPACITY, NUM_USERS - 1)) return false;
          for (const row of rows) {
            const want = expected.get(row.peerId)!;
            const ok = (await linked(index, indexById.get(row.peerId)!)) ? row.shared === want : row.shared <= want;
            if (!ok) return false;
          }
          return true;
        }, { timeout: 600_000, intervals: [5_000] }).toBe(true);
      } catch (error) {
        const state = await page.evaluate(() => {
          const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
          const clusters = (ui?.incomingTalkClusters || []).map((cluster: any) =>
            `${cluster.title}:${Object.keys(cluster.senders || {}).filter((id) => id !== 'iinpublic-starter-interests').map((id) => id.slice(0, 6)).join('+')}`);
          const exchanges = Object.values<any>(((window as any).__iinpublic_exchanges?.() ?? {}));
          return {
            chatbot: localStorage.getItem('chatbotEnabled'),
            clusters: clusters.filter((line: string) => !line.endsWith(':')).slice(0, 8),
            clusterCount: clusters.length,
            exchanges: exchanges.length,
            outcomes: exchanges.slice(0, 5).map((row) => `${row.peerName}:${row.title}:${row.outcome}`),
          };
        });
        // Which common tags are missing with each short person, and where each one stands here.
        for (const row of rows.filter((r) => r.shared !== expected.get(r.peerId))) {
          const peerIndex = indexById.get(row.peerId)!;
          const common = LIKES[index]!.filter((tagIndex) => LIKES[peerIndex]!.includes(tagIndex)).map((tagIndex) => STARTER_TAGS[tagIndex]!.text);
          const where = await page.evaluate(async ([peerId, keywords]) => {
            const doc = (await (window as any).__iinpublic_exchanges?.()) ?? {};
            const mine = (window as any).__iinpublic_collection?.('myTalks') ?? {};
            const rowsIn = (window as any).__iinpublic_app?.getApp?.()?.uiManager?.incomingTalkClusters ?? [];
            return (keywords as string[]).map((keyword) => {
              const own = Object.entries<any>(mine).find(([, entry]) => entry?.fullTalk?.type === 'tag' && entry?.fullTalk?.questions?.[0]?.text === keyword);
              const id = own?.[0] ?? '';
              const dirs = Object.keys(doc).filter((key) => key.startsWith(`${peerId}::${id}::`)).map((key) => key.split('::')[2]);
              const waiting = rowsIn.some((cluster: any) => cluster?.identityKey === id && Object.keys(cluster?.senders ?? {}).includes(peerId));
              return dirs.length ? '' : `${keyword}(role=${own?.[1]?.role ?? '-'},disabled=${own?.[1]?.disabled},waitingFromThem=${waiting})`;
            }).filter(Boolean);
          }, [row.peerId, common] as const);
          console.log(`[${NAMES[index]} missing with ${NAMES[peerIndex]}] ${where.join(' ')}`);
          // Why the chatbot leaves their tags unanswered, and what counts as shared with them.
          const why = await page.evaluate(async ([peerId, keywords]) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const doc = (await (window as any).__iinpublic_exchanges?.()) ?? {};
            const rowsIn = app?.uiManager?.incomingTalkClusters ?? [];
            const decisions: string[] = [];
            for (const cluster of rowsIn) {
              const sender = cluster?.senders?.[peerId as string];
              if (!sender?.lastTalkId) continue;
              const body = await app?.coreRequest?.({ name: 'graph.talkBody', talkId: sender.lastTalkId }).catch(() => null);
              const decision = body ? await app?.chatbotReplyDecision?.(sender.lastTalkId, { ...body, authorId: peerId }, peerId).catch((error: unknown) => ({ error: String(error) })) : 'no body';
              decisions.push(`${cluster.title}:${JSON.stringify(decision && { act: decision.act, reason: decision.reason, answers: decision.answers?.length, error: decision.error })}`);
              if (decisions.length >= 4) break;
            }
            const counted = Object.entries<any>(doc).filter(([key]) => key.startsWith(`${peerId}::`))
              .map(([key, value]) => `${value?.title}/${key.split('::')[2]}/${value?.outcome ?? (value?.answers ?? []).map((a: any) => a?.isMatch ? 'm' : a?.answerId).join(',')}`);
            const extra = counted.filter((entry) => !(keywords as string[]).some((keyword) => entry.includes(keyword)));
            // Is each missing tag still owed to them from here, and are they on my list?
            const mine = (window as any).__iinpublic_collection?.('myTalks') ?? {};
            const owedIds = new Set<string>(app?.__e2eUnsentFor?.(peerId) ?? []);
            const onMyList = (app?.nearbyV3?.service?.entries?.() ?? []).some((entry: any) => entry?.card?.userId === peerId);
            const owed = (keywords as string[]).filter((keyword) => {
              const id = Object.keys(mine).find((key) => mine[key]?.fullTalk?.type === 'tag' && mine[key]?.fullTalk?.questions?.[0]?.text === keyword);
              return id && owedIds.has(id);
            });
            return { decisions, matchCount: counted.length, extra, onMyList, owedCount: owedIds.size, owedMissing: owed };
          }, [row.peerId, common] as const);
          console.log(`[${NAMES[index]} why with ${NAMES[peerIndex]}] ${JSON.stringify(why)}`);
          // The other side of each missing tag: which way they recorded it, and what each core
          // holds as the outcome of the other's answer (a one-sided record means one answer lost).
          const missingTags = where.map((entry: string) => entry.split('(')[0]!);
          const sideOf = (side: Page, otherId: string) => side.evaluate(async ([other, keywords]) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const doc = (await (window as any).__iinpublic_exchanges?.()) ?? {};
            const mine = (window as any).__iinpublic_collection?.('myTalks') ?? {};
            return Promise.all((keywords as string[]).map(async (keyword) => {
              const id = Object.keys(mine).find((key) => mine[key]?.fullTalk?.type === 'tag' && mine[key]?.fullTalk?.questions?.[0]?.text === keyword) ?? '';
              const dirs = Object.keys(doc).filter((key) => key.startsWith(`${other}::${id}::`)).map((key) => key.split('::')[2]);
              const outcome = id ? await app?.coreRequest?.({ name: 'graph.outcome', talkId: id, responderId: other }).catch((e: unknown) => String(e)) : 'no talk';
              // Did I mark it sent to them (which version), and is their copy in my Incoming?
              const state = await app?.getExchangesForE2e?.([]).catch(() => null);
              const mineState = id ? state?.talks?.[id] : undefined;
              const sent = mineState ? `${mineState.sent?.[other as string] ? (mineState.sent[other as string] === mineState.versionId ? 'current' : 'old') : 'no'}` : 'no-state';
              const incoming = ((app?.uiManager?.incomingTalkClusters ?? []) as any[])
                .filter((cluster) => String(cluster?.title || '').includes(keyword as string))
                .map((cluster) => cluster?.senders?.[other as string] ? `in(${cluster.senders[other as string].answered ? 'answered' : 'open'})` : 'in(not-from-them)');
              return `${keyword}: dirs=${dirs.join('+') || '-'} sent=${sent} incoming=${incoming.join(',') || '-'} outcome=${JSON.stringify(outcome)?.slice(0, 60)}`;
            }));
          }, [otherId, missingTags] as const);
          console.log(`[${NAMES[index]} side with ${NAMES[peerIndex]}] ${(await sideOf(page, row.peerId)).join(' | ')}`);
          console.log(`[${NAMES[peerIndex]} side with ${NAMES[index]}] ${(await sideOf(users[peerIndex]!.page, users[index]!.id)).join(' | ')}`);
        }
        console.log(`[${NAMES[index]} feedback] expected ${JSON.stringify([...expected].map(([id, n]) => `${NAMES[indexById.get(id)!]}=${n}`))} rows ${JSON.stringify(rows.map((row) => `${NAMES[indexById.get(row.peerId)!] ?? row.peerId}=${row.shared}`))} state ${JSON.stringify(state)}`);
        throw error;
      }
      const known = rows.filter((row) => expected.has(row.peerId));
      // Sorted by most tags in common, and the top is the most similar person this user knows.
      const counts = known.map((row) => row.shared);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      // The top is at least the most anyone on either one's list now shares (who drifted away may
      // show fewer, see above).
      const linkedWants: number[] = [];
      for (const row of known) if (await linked(index, indexById.get(row.peerId)!)) linkedWants.push(expected.get(row.peerId)!);
      expect(known[0]!.shared).toBeGreaterThanOrEqual(Math.max(0, ...linkedWants));
      // Live statistics (OPEN-113): the top row (most tags in common) is "#1 most alike".
      expect(rows[0]!.rank, `${NAMES[index]}: the top of "Most tags in common" ranks #1`).toBe(1);
      expect(rows[0]!.alike).toBeGreaterThan(0);
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

    // ── 6. Each opens their most similar person, marks them a Friend, and messages them ─
    const MESSAGE = 'we share lots of interests.';
    const picks = new Map(results.map(({ index, known }) => [index, known[0]!.peerId]));
    await Promise.all(users.map(async ({ page, index }) => {
      const peerId = picks.get(index)!;
      await sharedTagRows(page);
      // The row (not the name, which opens the chat) opens the person page.
      await page.locator(`.contact-item[data-contact-user-id="${peerId}"] .contact-item-meta`).first().click();
      await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
      await page.locator('#contact-edit-relationship-btn').click();
      await expect(page.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10_000 });
      await page.locator('.contact-relationship-label-checkbox[value="friend"]').check();
      await page.locator('#contact-relationship-save-btn').click();
      await expect(page.locator('#contact-relationship-modal')).toBeHidden({ timeout: 10_000 });
      await page.locator('#peer-dm-input').fill(MESSAGE);
      await page.locator('#peer-dm-send-btn').click();
      await waitForPeerDmSent(page, 60_000);
      console.log(`[${NAMES[index]}] marked ${NAMES[indexById.get(peerId)!]} a Friend and sent "${MESSAGE}"`);
      // Back on Contacts, the person now reads as a Friend.
      await backToContactsList(page);
      await expect(page.locator(`.contact-item[data-contact-user-id="${peerId}"] .contact-item-meta`).first())
        .toContainText('Friend', { timeout: 10_000 });
    }));
    // Each message arrives: the receiver's conversation with the sender shows it.
    await Promise.all(users.map(async ({ index, id }) => {
      const receiver = users[indexById.get(picks.get(index)!)!]!;
      await expect.poll(() => receiver.page.evaluate(({ senderId, text }) =>
        Object.values<any>(((window as any).__iinpublic_collection?.('myConversations') ?? {}))
          .some((conversation) => conversation?.otherUserId === senderId && String(conversation?.lastMessage || '').includes(text)),
      { senderId: id, text: MESSAGE }), {
        timeout: 90_000,
        message: `${NAMES[receiver.index]} receives ${NAMES[index]}'s message`,
      }).toBe(true);
    }));

    // ── 7. Me: liked tags only, and each one leads to the people who like it too ─
    await Promise.all(users.map(async ({ page, index }) => {
      const knownPeers = new Set(results.find((result) => result.index === index)!.known.map((row) => row.peerId));
      await page.locator('.nav-btn[data-view="me"]').click();
      const visibleTags = page.locator('#answers-list .answer-talk-item[data-tag-state]:visible');
      // Passed tags are hidden by default: the 30 liked ones show, each with ♡.
      await expect(page.locator('#answers-list .answer-talk-item[data-tag-state="checked"]:visible')).toHaveCount(LIKES_PER_USER, { timeout: 20_000 });
      await expect(page.locator('#answers-list .answer-talk-item[data-tag-state="unchecked"]:visible')).toHaveCount(0);
      expect(await visibleTags.locator('[data-testid="answer-tag-mark"]').allTextContents()).toEqual(Array(LIKES_PER_USER).fill('♡'));
      // The liked tag shared with the most people I know: its row lists exactly them.
      const best = LIKES[index]!
        .map((tagIndex) => ({ tagIndex, likers: users.filter((other) => knownPeers.has(other.id) && LIKES[other.index]!.includes(tagIndex)) }))
        .sort((a, b) => b.likers.length - a.likers.length)[0]!;
      expect(best.likers.length, `${NAMES[index]} knows someone who likes one of their tags`).toBeGreaterThan(0);
      const keyword = STARTER_TAGS[best.tagIndex]!.text;
      const row = page.locator(`#answers-list .answer-talk-item[data-tag-state="checked"][data-topic="${keyword}"]`);
      // Exchanges keep arriving after the counts above were taken, so the row may know one more
      // person than then: what it shows must match what it lists, and all of them like the tag.
      // Me draws its rows from the exchange view, which can trail Contacts by a redraw (4 of 5 at
      // first, test:all 2026-11-17): wait for it to reach everyone Contacts already showed.
      const peopleCount = async () => Number(((await row.locator('[data-testid="answer-people"]').textContent()) || '').replace(/\D/g, ''));
      await expect.poll(peopleCount, { timeout: 30_000, message: `${NAMES[index]}'s Me row for ${STARTER_TAGS[best.tagIndex]!.text} counts everyone who likes it` })
        .toBeGreaterThanOrEqual(best.likers.length);
      const shown = await peopleCount();
      await row.locator('[data-testid="answer-people"]').click();
      await expect(page.locator('[data-testid="contacts-focus-chip"]')).toContainText(keyword, { timeout: 10_000 });
      const listed = await page.locator('.contact-item[data-contact-user-id]:not([data-support-contact="true"])')
        .evaluateAll((rows) => rows.map((element) => (element as HTMLElement).dataset.contactUserId || ''));
      expect(listed).toHaveLength(shown);
      for (const peerId of listed) expect(LIKES[indexById.get(peerId)!]!.includes(best.tagIndex), `${NAMES[indexById.get(peerId)!]} likes ${keyword}`).toBe(true);
      for (const known of best.likers) expect(listed).toContain(known.id);
      console.log(`[${NAMES[index]}] Me → ♡ ${keyword} → ${listed.map((id) => NAMES[indexById.get(id)!]).join(', ')}`);
      await page.locator('[data-testid="contacts-focus-clear"]').click();
      // 💬 on the same Me row: Talks, narrowed to that tag, which looks the same there (♡, 👥).
      await page.locator('.nav-btn[data-view="me"]').click();
      await row.locator('[data-testid="answer-talks"]').click();
      await expect(page.locator('[data-testid="talks-focus-chip"]')).toContainText(keyword, { timeout: 10_000 });
      const talkChips = page.locator('#talks-list .talk-tag-chip');
      await expect(talkChips).toHaveCount(1);
      await expect(talkChips.first().locator('[data-testid="answer-tag-mark"]')).toHaveText('♡');
      await expect(talkChips.first().locator('[data-testid="answer-people"]')).toContainText(String(shown));
      await page.locator('[data-testid="talks-focus-clear"]').click();
      // Back to all contacts for the hold.
      await page.locator('.nav-btn[data-view="contacts"]').click();
    }));

    if (HOLD_MS > 0) {
      console.log(`[starter-similar] holding ${Math.round(HOLD_MS / 1000)} s on Contacts for inspection`);
      await pages[0]!.waitForTimeout(HOLD_MS);
    }
  });
});
