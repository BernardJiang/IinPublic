/**
 * OPEN-29 — a client holding a STALE recovery-anchor cache catches up to the relay's newer
 * record, a live client learns a record published while it runs, and a client already holding a
 * NEWER record never rolls back to the relay's older one.
 *
 * Unit/integration tests cover sign/verify/rollback and the routes; this spec drives the real
 * browser boot path end to end (the live Gun subscription plus the 5 s HTTP relay poll in
 * `app.ts`, which is the only path an embedded native node has) against a real server.
 *
 * Records are signed in this Node test process with the real recovery key from `.env.local`
 * (`TECHSUPPORT_RECOVERY_SEA_PAIR_JSON`); the spec skips without it. Only records stamped "now"
 * are posted to the relay — older/future records live only in an injected browser cache — so the
 * relay's durable store stays monotonic across reruns. Posted records carry no revocations, so
 * they never change which keys any other spec trusts.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import { loadRealTechSupportRecoveryPair } from '../../../../src/test/support/techsupport-real-pair';
import { signRecoveryAnchor, type RecoveryAnchorRecord } from '../../../../src/shared/techsupport-recovery';

const RECOVERY_PAIR = loadRealTechSupportRecoveryPair();
const CACHE_KEY = 'iinpublic_techsupport_recovery_anchor_v1';
const HOUR_MS = 60 * 60 * 1000;

async function postRecord(record: RecoveryAnchorRecord): Promise<{ status: number; body: any }> {
  const res = await fetch(`${gunBaseURL()}/api/support/recovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function bootWithCache(browser: Browser, cached: RecoveryAnchorRecord | null): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await injectIdbClear(page);
  if (cached) {
    // Seed only on the first document, so a reload keeps whatever the app reconciled.
    await context.addInitScript(({ key, value }) => {
      if (!sessionStorage.getItem('__e2e_recovery_seeded')) {
        sessionStorage.setItem('__e2e_recovery_seeded', '1');
        localStorage.setItem(key, value);
      }
    }, { key: CACHE_KEY, value: JSON.stringify(cached) });
  }
  await gotoWebApp(page, webBaseURL());
  return { context, page };
}

async function cachedIssuedAt(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw).issuedAt as string) : null;
  }, CACHE_KEY);
}

test.describe('OPEN-29 recovery anchor: cross-client stale-cache catch-up (real browser + relay)', () => {
  test.skip(!RECOVERY_PAIR, 'Set TECHSUPPORT_RECOVERY_SEA_PAIR_JSON in .env.local to run this recovery-anchor spec.');

  let browser: Browser;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('stale cache catches up, live client learns a new record, newer cache never rolls back', async () => {
    test.setTimeout(120_000);
    const pair = RECOVERY_PAIR!;
    const now = Date.now();
    const stale = await signRecoveryAnchor(
      { reason: 'e2e OPEN-29: stale cached record', issuedAt: new Date(now - HOUR_MS).toISOString() },
      pair,
    );
    const published = await signRecoveryAnchor({ reason: 'e2e OPEN-29: relay record', issuedAt: new Date(now).toISOString() }, pair);
    const future = await signRecoveryAnchor(
      { reason: 'e2e OPEN-29: newer cached record', issuedAt: new Date(now + HOUR_MS).toISOString() },
      pair,
    );

    const posted = await postRecord(published);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.stored).toBe(true);

    // A client whose cache predates the relay's record (an installation that missed the incident)
    // replaces it with the relay's newer record on boot.
    const staleClient = await bootWithCache(browser, stale);
    contexts.push(staleClient.context);
    await expect.poll(() => cachedIssuedAt(staleClient.page), { timeout: 30_000 }).toBe(published.issuedAt);

    // A client that already knows a NEWER record keeps it: the relay's older record is a
    // rollback and must be dropped, even after several relay-poll ticks and a reload.
    const newerClient = await bootWithCache(browser, future);
    contexts.push(newerClient.context);
    await newerClient.page.waitForTimeout(12_000);
    expect(await cachedIssuedAt(newerClient.page)).toBe(future.issuedAt);
    await newerClient.page.reload();
    await newerClient.page.waitForTimeout(6_000);
    expect(await cachedIssuedAt(newerClient.page)).toBe(future.issuedAt);

    // A running client learns a record published after it booted (live subscription or the
    // relay poll, whichever lands first).
    const live = await signRecoveryAnchor(
      { reason: 'e2e OPEN-29: published while running', issuedAt: new Date(Date.now()).toISOString() },
      pair,
    );
    const postedLive = await postRecord(live);
    expect(postedLive.status, JSON.stringify(postedLive.body)).toBe(200);
    await expect.poll(() => cachedIssuedAt(staleClient.page), { timeout: 30_000 }).toBe(live.issuedAt);

    // The relay itself refuses to be rolled back to the earlier record.
    const rollback = await postRecord(published);
    expect(rollback.status).toBe(409);
  });
});
