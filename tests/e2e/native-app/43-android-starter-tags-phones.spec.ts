/**
 * Starter tags on real phones (OPEN-87, OPEN-112): the browser spec
 * staged/stage5-multi-user/starter-tags-similar-people on 2–6 Android phones, without its
 * test-only broadcast. Each phone is a new user who decides all 60 starter tags (a seeded 30
 * liked, the rest passed); likes go out as they are made (OPEN-112) to everyone on the phone's
 * Nearby list, and the receivers' chatbots answer them. With every phone on every other's list,
 * each Contacts list sorted by "Most tags in common" must show the exact overlap with every other
 * phone, ordered, with the top row "#1 most alike". Then each phone marks its most similar person
 * a Friend and messages them, and the message arrives. Clears every phone's app data.
 *
 *   E2E_REAL_ANDROID_STARTER_TAGS=1 NATIVE_APP_ANDROID_SERIALS=<a>,<b>,<c>,<d> \
 *     npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/43-android-starter-tags-phones.spec.ts
 *
 * Companion doc: 43-android-starter-tags-phones.md
 */
import { test, expect, type Page } from '@playwright/test';
import * as os from 'os';
import { bootstrapNativeWindow } from './helpers/native-app';
import {
  closeAndroidUser, collectAndroidDiagnostics, isAndroidDeviceReady, launchAndroidUserViaAdb, resetAndroidAppData, type AndroidUser,
} from './helpers/native-app-android';
import { waitForPeerDmSent } from '../helpers/conversation-e2e';
import {
  DEFAULT_STARTER_SEED, STARTER_TAGS, backToContactsList, captureStarterTabs, decideStarterTags, overlapOf, pickLikes, sharedTagRows,
  type SharedTagRow,
} from '../journeys/starter-tags-shared';

/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

const RUN = process.env.E2E_REAL_ANDROID_STARTER_TAGS === '1';
const SERIALS = String(process.env.NATIVE_APP_ANDROID_SERIALS || '').split(',').map((serial) => serial.trim()).filter(Boolean).slice(0, 6);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const SEED = Number.parseInt(process.env.STARTER_SIMILAR_SEED || '', 10) || DEFAULT_STARTER_SEED;
// 10 by default: a phone sends one person at most TALK_SEND_DAILY (10) Talks a day, and the test
// switch that lifts it works only against a test hub (allowTestOverrides), not on a phone. With 30
// likes, each pair stopped at 6–9 of 12–15 shared (2026-11-17, Ann had sent exactly 10 to each).
const LIKES_PER_USER = Number(process.env.STARTER_SIMILAR_LIKES) || 10;
const SETTLE_MS = Number(process.env.STARTER_PHONES_SETTLE_MS) || 900_000;
const MESSAGE_STEP = process.env.STARTER_PHONES_MESSAGE !== '0';
const SHOTS_DIR = process.env.STARTER_SIMILAR_SHOTS_DIR;
const NAMES = ['Ann', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'].slice(0, SERIALS.length);
const LIKES = NAMES.map((_, index) => pickLikes(SEED, index, LIKES_PER_USER));
const overlap = (a: number, b: number) => overlapOf(LIKES, a, b);

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

const log = (line: string) => console.log(`[starter-phones] ${line}`);
const nearbyIds = (page: Page): Promise<string[]> => page.evaluate(() =>
  ((window as any).__iinpublic_app?.getApp?.()?.nearbyV3?.service?.entries?.() ?? []).map((entry: any) => String(entry?.card?.userId || '')));

test.describe('Real phones: starter tags find the most similar person', () => {
  test.describe.configure({ retries: 0 });
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_STARTER_TAGS=1 to run the physical-device starter-tags spec.');
  test.skip(SERIALS.length < 2, 'NATIVE_APP_ANDROID_SERIALS needs at least two phones.');

  const users: AndroidUser[] = [];
  const pages: Page[] = [];

  test.afterAll(async () => {
    await captureStarterTabs(pages, NAMES, SHOTS_DIR, log);
    for (const user of users) await closeAndroidUser(user);
    if (process.env.STARTER_PHONES_KEEP_DATA !== '1') {
      await Promise.all(SERIALS.map((serial) => resetAndroidAppData(serial).catch(() => {})));
    }
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  test(`${SERIALS.length} phones decide all 60 starter tags and find who is most similar`, async ({}, testInfo) => {
    test.setTimeout(600_000 + SETTLE_MS + (MESSAGE_STEP ? 300_000 : 0));
    log(`seed=${SEED} phones=${SERIALS.join(',')} likes=${LIKES_PER_USER}/${STARTER_TAGS.length}`);
    for (const serial of SERIALS) test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);

    // ── 1. A new user on each phone, all pinned to the same point ─────────────
    await Promise.all(SERIALS.map((serial) => resetAndroidAppData(serial)));
    const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
    const ids = await Promise.all(SERIALS.map(async (serial, index) => {
      const user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      users[index] = user;
      pages[index] = user.window;
      const id = await bootstrapNativeWindow(user.window, `${NAMES[index]} Starter`, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000 });
      await user.window.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.setNotificationsSuppressedForE2e?.(true));
      return id;
    }));
    const indexById = new Map(ids.map((id, index) => [id, index]));
    const name = (id: string) => NAMES[indexById.get(id) ?? -1] ?? id.slice(0, 6);
    const t0 = Date.now();

    // ── 2. Everyone on everyone's Nearby list (release capacity: room for all) ─
    await Promise.all(pages.map(async (page, index) => {
      await expect.poll(async () => {
        const list = await nearbyIds(page);
        return ids.filter((id, j) => j !== index && list.includes(id)).length;
      }, { timeout: 300_000, intervals: [5_000], message: `${NAMES[index]} sees every other phone on Nearby` }).toBe(SERIALS.length - 1);
    }));
    log(`all phones on each other's Nearby lists after ${Math.round((Date.now() - t0) / 1000)} s`);

    // ── 3. Each phone decides all 60 starter tags as picked ───────────────────
    await Promise.all(pages.map(async (page, index) => {
      await page.locator('.nav-btn[data-view="talks"]').evaluate((element) => (element as HTMLElement).click());
      await expect(page.locator('#talks-list .talk-tag-chip[data-role="incoming"][data-starter-tag="true"]'))
        .toHaveCount(STARTER_TAGS.length, { timeout: 60_000 });
      const started = Date.now();
      const roles = await decideStarterTags(page, LIKES[index]!, 30_000);
      const liked = new Set(LIKES[index]);
      expect(roles.map((role, tagIndex) => role === (liked.has(tagIndex) ? 'copied' : 'ignored')).every(Boolean),
        `${NAMES[index]} decided all 60 tags as picked: ${JSON.stringify(roles)}`).toBe(true);
      log(`${NAMES[index]} (${SERIALS[index]}) decided 60 tags in ${Math.round((Date.now() - started) / 1000)} s`);
    }));
    const decidedAt = Date.now();

    // ── 4. Contacts show the exact overlap with every other phone ─────────────
    const rowsByUser: SharedTagRow[][] = [];
    const settled: number[] = [];
    await Promise.all(pages.map(async (page, index) => {
      let rows: SharedTagRow[] = [];
      try {
        await expect.poll(async () => {
          rows = (await sharedTagRows(page)).filter((row) => indexById.has(row.peerId));
          return rows.length === SERIALS.length - 1 && rows.every((row) => row.shared === overlap(index, indexById.get(row.peerId)!));
        }, { timeout: SETTLE_MS, intervals: [10_000] }).toBe(true);
      } catch (error) {
        const want = ids.filter((_, j) => j !== index).map((id) => `${name(id)}=${overlap(index, indexById.get(id)!)}`);
        log(`${NAMES[index]} short: want ${want.join(' ')} · shows ${rows.map((row) => `${name(row.peerId)}=${row.shared}`).join(' ')}`);
        throw error;
      }
      settled[index] = Math.round((Date.now() - decidedAt) / 1000);
      rowsByUser[index] = rows;
      const counts = rows.map((row) => row.shared);
      expect(counts, `${NAMES[index]}: sorted by most tags in common`).toEqual([...counts].sort((a, b) => b - a));
      expect(rows[0]!.rank, `${NAMES[index]}: the top of "Most tags in common" ranks #1`).toBe(1);
      expect(rows[0]!.alike).toBeGreaterThan(0);
    }));

    log(`true overlap (liked tags in common, of ${LIKES_PER_USER}):`);
    log(`      ${NAMES.map((n) => n.padStart(4)).join('')}`);
    for (let i = 0; i < NAMES.length; i++) {
      log(`${NAMES[i]!.padEnd(6)}${NAMES.map((_, j) => (i === j ? '-' : String(overlap(i, j))).padStart(4)).join('')}`);
    }
    for (const [index, rows] of rowsByUser.entries()) {
      log(`${NAMES[index]} Contacts by tags in common: ${rows.map((row) => `${name(row.peerId)} ${row.shared}`).join(', ')} · settled ${settled[index]} s after deciding`);
    }

    // ── 5. Each marks their most similar person a Friend and messages them ────
    if (MESSAGE_STEP) {
      const MESSAGE = 'we share lots of interests.';
      const picks = rowsByUser.map((rows) => rows[0]!.peerId);
      await Promise.all(pages.map(async (page, index) => {
        const peerId = picks[index]!;
        await sharedTagRows(page);
        await page.locator(`.contact-item[data-contact-user-id="${peerId}"] .contact-item-meta`).first().click();
        await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 30_000 });
        await page.locator('#contact-edit-relationship-btn').click();
        await expect(page.locator('#contact-relationship-modal')).toBeVisible({ timeout: 15_000 });
        await page.locator('.contact-relationship-label-checkbox[value="friend"]').check();
        await page.locator('#contact-relationship-save-btn').click();
        await expect(page.locator('#contact-relationship-modal')).toBeHidden({ timeout: 15_000 });
        await page.locator('#peer-dm-input').fill(MESSAGE);
        await page.locator('#peer-dm-send-btn').click();
        await waitForPeerDmSent(page, 90_000);
        log(`${NAMES[index]} marked ${name(peerId)} a Friend and sent "${MESSAGE}"`);
        await backToContactsList(page);
        await expect(page.locator(`.contact-item[data-contact-user-id="${peerId}"] .contact-item-meta`).first())
          .toContainText('Friend', { timeout: 15_000 });
      }));
      await Promise.all(pages.map(async (_, index) => {
        const receiver = indexById.get(picks[index]!)!;
        await expect.poll(() => pages[receiver]!.evaluate(({ senderId, text }) =>
          Object.values<any>(((window as any).__iinpublic_collection?.('myConversations') ?? {}))
            .some((conversation) => conversation?.otherUserId === senderId && String(conversation?.lastMessage || '').includes(text)),
        { senderId: ids[index]!, text: MESSAGE }), {
          timeout: 180_000, intervals: [5_000], message: `${NAMES[receiver]} receives ${NAMES[index]}'s message`,
        }).toBe(true);
      }));
      log('every message arrived');
    }

    await testInfo.attach('starter-phones.json', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({
        seed: SEED, serials: SERIALS, settledSeconds: settled,
        overlap: NAMES.map((_, i) => NAMES.map((__, j) => (i === j ? null : overlap(i, j)))),
        contacts: rowsByUser.map((rows) => rows.map((row) => ({ peer: name(row.peerId), shared: row.shared, rank: row.rank }))),
      }, null, 2)),
    });
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const serial of SERIALS) {
      const diagnostics = await collectAndroidDiagnostics(serial).catch(() => null);
      if (diagnostics) await testInfo.attach(`android-${serial}.json`, { body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json' });
    }
  });
});
