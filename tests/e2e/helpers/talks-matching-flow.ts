import { expect, Browser, BrowserContext, Page } from '@playwright/test';
import { clearGunDatabases, injectIdbClear } from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { afterLoad, afterNav, afterAction, afterSync } from './timing';
import { webBaseURL } from './ports';

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

/**
 * Wait until the Gun server's incoming-talks API lists this title (POST /received succeeded).
 * UI can lag Gun replication; this avoids racing only on `.incoming` rows.
 */
export async function waitForIncomingTalkClusterOnServer(page: Page, titleSubstring: string): Promise<void> {
  await page.waitForFunction(
    (titleSub: string) => {
      const { hostname, protocol } = window.location;
      const base =
        hostname === 'localhost' || hostname === '127.0.0.1'
          ? `${protocol}//${hostname}:8080`
          : `${protocol}//${hostname}`;
      const app = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
        }
      ).__iinpublic_app?.getApp?.();
      const uid = app?.currentUser?.id;
      if (!uid) return false;
      return fetch(`${base}/api/users/${encodeURIComponent(uid)}/incoming-talks`)
        .then((r) => (r.ok ? r.json() : []))
        .then((clusters: unknown) => {
          if (!Array.isArray(clusters)) return false;
          const needle = titleSub.toLowerCase();
          if (!needle) return false;
          for (const c of clusters as any[]) {
            const title = String(c?.title || '').toLowerCase();
            if (title.includes(needle)) return true;
          }
          try {
            if (clusters.some((c: any) => JSON.stringify(c).toLowerCase().includes(needle))) return true;
          } catch {
            /* ignore */
          }
          const talkFetches = (clusters as any[]).flatMap((c) => {
            const t = c?.talkIds;
            if (!t || typeof t !== 'object') return [];
            return Object.keys(t)
              .filter((k) => !k.startsWith('_'))
              .map((id) =>
                fetch(`${base}/api/talks/${encodeURIComponent(id)}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .catch(() => null),
              );
          });
          if (talkFetches.length === 0) return false;
          return Promise.all(talkFetches).then((talks) =>
            talks.some((td: any) => String(td?.title || '').toLowerCase().includes(needle)),
          );
        })
        .catch(() => false);
    },
    titleSubstring,
    { timeout: 90_000, polling: 400 },
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
  await page.goto(webBaseURL());
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
