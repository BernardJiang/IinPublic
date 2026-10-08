/**
 * Experiment: how a crowd at one spot spreads down the room tree (docs/design/room-tree-routing.md).
 *
 * Capacity 3. A café owner first creates a local custom room in San Diego and sits in it. Then 16
 * users at the same spot join one by one. Every newcomer enters Global; each full room pushes its
 * OLDEST member one layer down — Global → L1 → L2 → L3 → L4 (~78 km) — and the full L4 room pushes
 * its oldest into L4's own numbered room `_part_2`, NEVER into the café (custom rooms are opt-in).
 *
 * After each join the test waits until the server's member counts match the rule's prediction, so a
 * deviation is caught at the exact step it happens. The final occupancy table is printed.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { tileIdAt } from '../../../../src/shared/room-tiles';

const CAPACITY = 3;
const USERS = 16;
const E2E_URL = `/?e2e_capacity=${CAPACITY}&e2e_fifo=true`;
const SD = { latitude: 32.7157, longitude: -117.1611 };
const T = (layer: number) => tileIdAt(layer, SD.latitude, SD.longitude);
const L4_PART_2 = `${T(4)}_part_2`;
/** Fill order of the cascade: each room holds CAPACITY, the rest spill one layer further down. */
const LADDER = ['global', T(1), T(2), T(3), T(4), L4_PART_2];

/** What the rule predicts after `n` users: newest CAPACITY in Global, then 3 per layer, rest in part_2. */
function predicted(n: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = n;
  LADDER.forEach((room, i) => {
    const here = i === LADDER.length - 1 ? left : Math.min(CAPACITY, left);
    out[room] = here;
    left -= here;
  });
  return out;
}

test.describe('Tile cascade experiment', () => {
  const contexts: BrowserContext[] = [];

  test.afterAll(async () => {
    for (const context of contexts) {
      for (const page of context.pages()) {
        await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      }
      await context.close().catch(() => {});
    }
    await clearGunForStage5Spec();
  });

  test('16 users at one spot cascade Global → L1 → L2 → L3 → L4 → L4_part_2; the café is never used', async ({ browser, request }) => {
    test.setTimeout(900_000);
    await clearGunForStage5Spec();

    const boot = async (label: string): Promise<Page> => {
      const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      await injectIdbClear(page);
      await page.addInitScript((loc) => { (window as any).__test_location = { ...loc, accuracy: 25 }; }, SD);
      await gotoWebApp(page, webBaseURL() + E2E_URL, 30_000);
      await afterLoad();
      await expect.poll(() => page.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.currentUser?.id), { timeout: 30_000 }).toBe(true);
      page.on('console', (m) => {
        const text = m.text();
        if (/🚪 (Over capacity|Too few)/.test(text)) console.log(`[${label}] ${text.replace(/moving \S+ /, 'moving ')}`);
        else if (process.env.CASCADE_DEBUG && /Leaving chatroom|Joining chatroom|joined chatroom|Sync|sync.*fail|leave|Eviction join|manual|⚠️|❌/i.test(text)) console.log(`[${label}] ${text.slice(0, 200)}`);
      });
      return page;
    };
    const roomOf = (page: Page) => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '');
    const count = async (room: string): Promise<number> => {
      const res = await request.get(`${gunBaseURL()}/api/chatrooms/${encodeURIComponent(room)}/members`, { timeout: 30_000 }).catch(() => null);
      const rows = res?.ok() ? ((await res.json()) as Array<{ userId?: string }>) : [];
      return rows.filter((row) => row.userId && row.userId !== TECHSUPPORT_ROOT_USER_ID).length;
    };

    // The café owner creates a local custom room in San Diego and stays in it.
    const owner = await boot('Café');
    await owner.evaluate(() => { void (window as any).__iinpublic_app?.getApp?.()?.uiManager?.handleCreateCustomChatroomClick?.(); });
    await afterNav();
    await owner.fill('[data-testid="custom-room-name-input"]', 'Bean There Café');
    await owner.locator('#custom-room-type').selectOption('business');
    await owner.locator('[data-testid="custom-room-submit-btn"]').click();
    await expect.poll(() => roomOf(owner), { timeout: 30_000 }).toMatch(/^place_32\.71_-117\.17_/);
    const cafe = await roomOf(owner);
    console.log(`[setup] café room ${cafe} (under ${T(4)})`);

    const users: Page[] = [];
    for (let n = 1; n <= USERS; n++) {
      users.push(await boot(`U${n}`));
      const want = predicted(n);
      if (process.env.CASCADE_DEBUG && n === 4) {
        await new Promise((r) => setTimeout(r, 15_000));
        const res = await request.get(`${gunBaseURL()}/api/chatrooms/global/members`);
        const rows = (await res.json()) as Array<{ userId: string; lastSeen?: string }>;
        const ids = await Promise.all([owner, ...users].map(async (pg, i) => `${i === 0 ? 'Café' : `U${i}`}=${(await pg.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')).slice(0, 8)}@${await roomOf(pg)}`));
        console.log('DEBUG global members', JSON.stringify(rows.map((r) => `${r.userId.slice(0, 8)} ${r.lastSeen || ''}`)));
        console.log('DEBUG pages', ids.join(' | '));
      }
      await expect.poll(async () => {
        const got: Record<string, number> = {};
        for (const room of LADDER) got[room] = await count(room);
        return got;
      }, { timeout: 90_000, intervals: [1_000, 2_000], message: `room counts after U${n} joined` }).toEqual(want);
      console.log(`[after U${n}] ${LADDER.map((room) => `${room === 'global' ? 'Global' : room.replace(/^tile_(\d)_.*?(_part_2)?$/, 'L$1$2')}=${want[room]}`).join('  ')}`);
    }

    // The café was never an eviction target: only its owner is there.
    expect(await count(cafe)).toBe(1);
    expect(await roomOf(owner)).toBe(cafe);

    // Oldest deepest: U1 in part_2, U2–4 in L4, … U14–16 in Global.
    const rooms = await Promise.all(users.map(roomOf));
    const expectedRoom = (i: number) => LADDER[Math.min(LADDER.length - 1, Math.floor((USERS - 1 - i) / CAPACITY))];
    const table = rooms.map((room, i) => `  U${String(i + 1).padStart(2)} → ${room}`).join('\n');
    console.log(`[final placement]\n${table}\n  Café → ${cafe}`);
    expect(rooms).toEqual(users.map((_, i) => expectedRoom(i)));

    // The oldest user's tree shows the full path down to L4's numbered room.
    const oldest = users[0];
    await oldest.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    if (await oldest.locator('#back-to-chatrooms').isVisible().catch(() => false)) await oldest.locator('#back-to-chatrooms').click();
    await expect(oldest.locator(`#chatroom-list .chatroom-item[data-chatroom-id="${L4_PART_2}"]`)).toHaveAttribute('data-level', '5');
    const body = await oldest.screenshot({ path: test.info().outputPath('oldest-user-tree.png'), fullPage: true });
    await test.info().attach('oldest-user-tree', { body, contentType: 'image/png' });
  });
});
