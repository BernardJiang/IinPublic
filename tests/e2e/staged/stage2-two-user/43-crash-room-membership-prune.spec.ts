import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { afterSync, headless } from '../../helpers/timing';
import { gunBaseURL } from '../../helpers/ports';
import { bootstrapOnPage, launchPersistentUser } from '../../helpers/crash-recovery';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Room membership cleanup after OS-level browser crash', () => {
  let browserA: Browser;
  let contextA: BrowserContext | undefined;
  let pageA: Page | undefined;
  let contextB: BrowserContext | undefined;
  let userDataDirB: string;

  test.beforeAll(async () => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1000'] });
    userDataDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpub-room-crashB-'));
  });

  test.afterAll(async () => {
    await pageA?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    try { fs.rmSync(userDataDirB, { recursive: true, force: true }); } catch { /* ignore */ }
    await clearGunForStage2Spec();
  });

  test('SIGKILLed member is removed from visible Global headcount after membership TTL expiry', async () => {
    const globalHeadcount = (page: Page) =>
      page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    const readGlobalHeadcount = async (page: Page) => {
      const text = await globalHeadcount(page).textContent();
      return Number(text?.match(/\d+/)?.[0] || '0');
    };

    const alice = await bootstrapUser(browserA, 'CrashRoom-A', 'Crash Room Alice');
    contextA = alice.context;
    pageA = alice.page;

    const b = await launchPersistentUser(userDataDirB, 660);
    contextB = b.context;
    const pageB = b.page;
    const bobId = await bootstrapOnPage(pageB, 'Crash Room Bob');
    expect(bobId).toBeTruthy();

    const initialHeadcount = await expect
      .poll(() => readGlobalHeadcount(pageA!), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3)
      .then(() => readGlobalHeadcount(pageA!));

    let bClosed = false;
    contextB.on('close', () => { bClosed = true; });
    b.kill();
    await expect
      .poll(() => bClosed, { timeout: 15_000, message: 'Bob browser context should close after SIGKILL' })
      .toBe(true);
    contextB = undefined;

    // Fast-forward Bob's server-visible room-membership heartbeat past the TTL.
    const expiredIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const touchRes = await fetch(`${gunBaseURL()}/api/chatrooms/global/members/${encodeURIComponent(bobId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageName: 'Crash Room Bob', lastSeen: expiredIso }),
    });
    expect(touchRes.ok).toBe(true);

    await expect
      .poll(
        async () => {
          const membersRes = await fetch(`${gunBaseURL()}/api/chatrooms/global/members`, {
            headers: { 'Cache-Control': 'no-cache' },
          });
          if (!membersRes.ok) return ['__members_request_failed__'];
          const rows = (await membersRes.json()) as Array<{ userId?: string }>;
          return rows.map((row) => row.userId).filter(Boolean).sort();
        },
        { timeout: 20_000, intervals: [500, 1000, 1500], message: 'crashed Bob should be pruned from /members' },
      )
      .not.toContain(bobId);

    await afterSync();
    await expect(globalHeadcount(pageA)).toContainText(String(initialHeadcount - 1), { timeout: 20_000 });
  });
});
