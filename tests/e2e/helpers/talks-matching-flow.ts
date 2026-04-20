import { expect, Browser, BrowserContext, Page } from '@playwright/test';
import { clearGunDatabases, injectIdbClear } from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterAction, afterSync } from './timing';
import { webAppURLStableChatroom } from './ports';

/** Count distinct talk ids across incoming clusters (one merged cluster may hold many `qa_*` keys). */
export function countIncomingTalkSlots(clusters: unknown): number {
  if (!Array.isArray(clusters)) return 0;
  let n = 0;
  for (const c of clusters) {
    const t = (c as { talkIds?: unknown })?.talkIds;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const keys = Object.keys(t as object).filter((k) => !k.startsWith('_'));
      n += keys.length > 0 ? keys.length : 1;
    } else {
      n += 1;
    }
  }
  return n;
}

/** Slack for Gun + UI when the full E2E suite has been running a while (webpack/Gun load). */
const INCOMING_ROW_POLL_MS = 20_000;
const INCOMING_ROW_FINAL_MS = 15_000;
const RESPONSE_MODAL_CONTENT_MS = 60_000;
const RESPONSE_MODAL_DETACHED_MS = 25_000;

export type IncomingTalkServerWaitOptions = {
  /** Default 90s; super-user bulk flows can use less once the server already holds clusters. */
  timeout?: number;
  /** Ms between predicate runs after the previous run finishes (Playwright default 50 is chatty for fetch-heavy checks). */
  polling?: number;
};

/**
 * Wait until the Gun server's incoming-talks API lists this title (POST /received succeeded).
 * UI can lag Gun replication; this avoids racing only on `.incoming` rows.
 *
 * Predicate is optimized for large IN lists (e.g. 20 broadcasts): no JSON.stringify per poll,
 * and talk-detail fetches run sequentially with early exit instead of fanning out dozens of
 * parallel requests every polling interval.
 */
export async function waitForIncomingTalkClusterOnServer(
  page: Page,
  titleSubstring: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  const timeout = options?.timeout ?? 90_000;
  const polling = options?.polling ?? 500;
  await page.waitForFunction(
    async (titleSub: string) => {
      const { hostname, protocol, port } = window.location;
      const webPort = Number(port);
      const gunPort =
        (hostname === 'localhost' || hostname === '127.0.0.1') &&
        Number.isFinite(webPort) &&
        webPort >= 3001
          ? webPort - 3001 + 8080
          : 8080;
      const base =
        hostname === 'localhost' || hostname === '127.0.0.1'
          ? `${protocol}//${hostname}:${gunPort}`
          : `${protocol}//${hostname}`;
      const app = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
        }
      ).__iinpublic_app?.getApp?.();
      const uid = app?.currentUser?.id;
      if (!uid) return false;
      try {
        const r = await fetch(`${base}/api/users/${encodeURIComponent(uid)}/incoming-talks`, {
          cache: 'no-store',
        });
        const clusters: unknown = r.ok ? await r.json() : [];
        if (!Array.isArray(clusters)) return false;
        const needle = titleSub.toLowerCase();
        if (!needle) return false;
        for (const c of clusters as { title?: unknown; talkIds?: unknown }[]) {
          if (String(c?.title || '').toLowerCase().includes(needle)) return true;
        }
        for (const c of clusters as { talkIds?: Record<string, unknown> }[]) {
          const t = c?.talkIds;
          if (!t || typeof t !== 'object') continue;
          const ids = Object.keys(t).filter((k) => !k.startsWith('_'));
          for (const id of ids) {
            try {
              const tr = await fetch(`${base}/api/talks/${encodeURIComponent(id)}`);
              if (!tr.ok) continue;
              const td = (await tr.json()) as { title?: unknown };
              if (String(td?.title || '').toLowerCase().includes(needle)) return true;
            } catch {
              /* ignore */
            }
          }
        }
        return false;
      } catch {
        return false;
      }
    },
    titleSubstring,
    { timeout, polling },
  );
}

/** Await server→UI incoming merge (same data as opening Talks tab; avoids racing fire-and-forget emit). */
export async function syncIncomingFromServer(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const app = (
      window as unknown as {
        __iinpublic_app?: {
          getApp: () => { syncIncomingClustersFromServer?: () => Promise<void>; uiManager?: { emit: (ev: string) => void } };
        };
      }
    ).__iinpublic_app?.getApp?.();
    if (app?.syncIncomingClustersFromServer) {
      await app.syncIncomingClustersFromServer();
      return;
    }
    app?.uiManager?.emit?.('needIncomingTalkClusters');
  });
}

export async function bootstrapUser(
  browser: Browser,
  label: string,
  stageName: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('console', (m) => console.log(`[${label}]:`, m.text()));
  // Clear the Web Worker's IndexedDB so each user starts with a fresh local Gun graph.
  await injectIdbClear(page);
  await page.goto(webAppURLStableChatroom());
  await page.waitForLoadState('load');
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();
  await page.click('.nav-btn[data-view="me"]');
  await afterNav();
  await page.waitForSelector('#edit-stagename-btn');
  await page.click('#edit-stagename-btn');
  await afterAction();
  await page.fill('#new-stage-name', stageName);
  await page.click('#edit-stagename-form button[type="submit"]');
  await afterNav();
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  return { context, page };
}

export async function waitForTabActive(
  page: Page,
  view: 'chatrooms' | 'talks' | 'contacts' | 'answers' | 'me',
): Promise<void> {
  await expect(page.locator(`.nav-btn[data-view="${view}"].active`)).toBeVisible({ timeout: 10000 });
}

export async function waitForResponseModalClosed(page: Page): Promise<void> {
  await page.waitForSelector('#talk-response-modal', { state: 'detached', timeout: RESPONSE_MODAL_DETACHED_MS });
}

/** POST /received + IN list: wait until GET incoming-talks includes this talk id for the page user. */
export async function waitForIncomingTalkIdOnServer(
  page: Page,
  talkId: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  const tid = String(talkId || '').trim();
  if (!tid) throw new Error('waitForIncomingTalkIdOnServer: empty talkId');
  const timeout = options?.timeout ?? 90_000;
  const polling = options?.polling ?? 500;
  await page.waitForFunction(
    async (id: string) => {
      const { hostname, protocol, port } = window.location;
      const webPort = Number(port);
      const gunPort =
        (hostname === 'localhost' || hostname === '127.0.0.1') &&
        Number.isFinite(webPort) &&
        webPort >= 3001
          ? webPort - 3001 + 8080
          : 8080;
      const base =
        hostname === 'localhost' || hostname === '127.0.0.1'
          ? `${protocol}//${hostname}:${gunPort}`
          : `${protocol}//${hostname}`;
      const app = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
        }
      ).__iinpublic_app?.getApp?.();
      const uid = app?.currentUser?.id;
      if (!uid) return false;
      const clusterHasTalk = (c: { latestTalkId?: unknown; talkIds?: unknown }): boolean => {
        if (String(c?.latestTalkId || '') === id) return true;
        const t = c?.talkIds;
        if (t && typeof t === 'object' && !Array.isArray(t) && id in (t as object)) return true;
        return false;
      };
      try {
        const r = await fetch(`${base}/api/users/${encodeURIComponent(uid)}/incoming-talks`, {
          cache: 'no-store',
        });
        const clusters: unknown = r.ok ? await r.json() : [];
        if (!Array.isArray(clusters)) return false;
        return (clusters as { latestTalkId?: unknown; talkIds?: unknown }[]).some(clusterHasTalk);
      } catch {
        return false;
      }
    },
    tid,
    { timeout, polling },
  );
}

/**
 * Open IN row by stable talk id (content-hash `qa_*` or UUID).
 * Optional `titleSubstring` matches the IN row title when `data-talk-id` / `data-identity-key` are empty in DOM.
 */
export async function openIncomingTalkModalByTalkId(
  page: Page,
  talkId: string,
  titleSubstring?: string,
): Promise<void> {
  const tid = String(talkId || '').trim();
  if (!tid) throw new Error('openIncomingTalkModalByTalkId: empty talkId');
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await waitForIncomingTalkIdOnServer(page, tid);
  await syncIncomingFromServer(page);
  await afterSync();
  const rowByAttrs = page.locator(
    `.talk-list-item[data-role="incoming"][data-talk-id="${tid}"], .talk-list-item[data-role="incoming"][data-identity-key="${tid}"]`,
  );
  const rowByTitle =
    titleSubstring && titleSubstring.trim().length > 0
      ? page.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: titleSubstring })
      : null;
  const row = rowByTitle ? rowByAttrs.or(rowByTitle) : rowByAttrs;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await afterSync();
    try {
      await expect(row.first()).toBeVisible({ timeout: INCOMING_ROW_POLL_MS });
      break;
    } catch {
      await syncIncomingFromServer(page);
      await page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(page, 'chatrooms');
      await afterSync();
      await page.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(page, 'talks');
      await afterSync();
    }
  }
  await expect(row.first()).toBeVisible({ timeout: INCOMING_ROW_FINAL_MS });
  await row.first().locator('button.view-talk-btn').click();
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: RESPONSE_MODAL_CONTENT_MS });
}

/** Open an incoming talk via the View button (more reliable than row click for Gun-synced rows). */
export async function openIncomingTalkModal(page: Page, titleSubstring: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await waitForIncomingTalkClusterOnServer(page, titleSubstring);
  await syncIncomingFromServer(page);
  await afterSync();
  const row = page.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: titleSubstring });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await afterSync();
    try {
      await expect(row.first()).toBeVisible({ timeout: INCOMING_ROW_POLL_MS });
      break;
    } catch {
      await syncIncomingFromServer(page);
      await page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(page, 'chatrooms');
      await afterSync();
      await page.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(page, 'talks');
      await afterSync();
    }
  }
  await expect(row.first()).toBeVisible({ timeout: INCOMING_ROW_FINAL_MS });
  await row.first().locator('button.view-talk-btn').click();
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: RESPONSE_MODAL_CONTENT_MS });
}

/**
 * Open the response dialog with saved auto-answers applied (flattened prefs / chatbot path).
 * Normal {@link openIncomingTalkModal} skips auto so browsing IN rows does not instantly complete a match.
 */
export async function openIncomingTalkModalWithAutoAnswers(
  page: Page,
  titleSubstring: string,
): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await waitForIncomingTalkClusterOnServer(page, titleSubstring);
  await syncIncomingFromServer(page);
  await afterSync();
  const row = page.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: titleSubstring });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await afterSync();
    try {
      await expect(row.first()).toBeVisible({ timeout: INCOMING_ROW_POLL_MS });
      break;
    } catch {
      await syncIncomingFromServer(page);
      await page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(page, 'chatrooms');
      await afterSync();
      await page.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(page, 'talks');
      await afterSync();
    }
  }
  await expect(row.first()).toBeVisible({ timeout: INCOMING_ROW_FINAL_MS });
  const talkId = await row.first().getAttribute('data-talk-id');
  if (!talkId) {
    throw new Error(`openIncomingTalkModalWithAutoAnswers: missing data-talk-id for "${titleSubstring}"`);
  }
  await page.evaluate(async (id: string) => {
    const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
    if (typeof app?.openTalkResponseDialogWithAuto === 'function') {
      await app.openTalkResponseDialogWithAuto(id);
      return;
    }
    if (!app?.talkService?.getTalkWithRetry || !app?.uiManager?.showTalkResponseDialog) {
      throw new Error('App not ready (openTalkResponseDialogWithAuto or talkService/uiManager)');
    }
    const talk = await app.talkService.getTalkWithRetry(id);
    if (!talk) throw new Error(`Could not load talk: ${id}`);
    app.uiManager.showTalkResponseDialog(talk, { skipAutoAnswer: false });
  }, talkId);
  await page.waitForSelector('#talk-response-modal .modal-content', { timeout: RESPONSE_MODAL_CONTENT_MS });
}

/** Close pages/contexts, manualCleanup, clear Gun — use in beforeEach for multi-user talks suites. */
export async function resetTalksMatchingSession(
  pages: { tom?: Page; jerry?: Page; bob?: Page },
  contexts: { tom?: BrowserContext; jerry?: BrowserContext; bob?: BrowserContext },
): Promise<void> {
  const closePage = async (p?: Page) => {
    if (!p) return;
    try {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
    } catch {}
    await p.close().catch(() => {});
  };
  await closePage(pages.tom);
  await closePage(pages.jerry);
  await closePage(pages.bob);
  await contexts.tom?.close().catch(() => {});
  await contexts.jerry?.close().catch(() => {});
  await contexts.bob?.close().catch(() => {});
  await clearGunDatabases();
}

export async function finalCleanupPages(
  pages: { tom?: Page; jerry?: Page; bob?: Page },
  contexts: { tom?: BrowserContext; jerry?: BrowserContext; bob?: BrowserContext },
): Promise<void> {
  const cleanup = async (p?: Page) => {
    if (!p) return;
    try {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    } catch {}
  };
  await cleanup(pages.tom);
  await cleanup(pages.jerry);
  await cleanup(pages.bob);
  await pages.tom?.close();
  await pages.jerry?.close();
  await pages.bob?.close();
  await contexts.tom?.close();
  await contexts.jerry?.close();
  await contexts.bob?.close();
}
