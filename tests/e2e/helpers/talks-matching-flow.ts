import { expect, type APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import {clearGunDatabases, injectIdbClear, maybeClearGunDatabases, gotoWebApp} from './clear-database';
import { ensureWindowFitsViewport } from './browser-window';
import { attachE2eBrowserTabLabel } from './e2e-tab-title';
import { attachFilteredConsoleLog } from './e2e-console';
import { afterLoad, afterNav, afterSync, E2E_ASSERT_TIMEOUT_MS } from './timing';
import { gunBaseURL, isDirectTalkDeliveryE2e, webAppURLStableChatroom } from './ports';
import {
  TECHSUPPORT_HEADSHOT,
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../src/shared/techsupport';
import { expectCurrentUserIsOrdinaryUser } from './techsupport-contract';

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
const INCOMING_ROW_POLL_MS = E2E_ASSERT_TIMEOUT_MS;
const INCOMING_ROW_FINAL_MS = E2E_ASSERT_TIMEOUT_MS;
const RESPONSE_MODAL_CONTENT_MS = E2E_ASSERT_TIMEOUT_MS;
const RESPONSE_MODAL_DETACHED_MS = E2E_ASSERT_TIMEOUT_MS;

export type IncomingTalkServerWaitOptions = {
  /** Default 90s; super-user bulk flows can use less once the server already holds clusters. */
  timeout?: number;
  /** Ms between predicate runs after the previous run finishes (Playwright default 50 is chatty for fetch-heavy checks). */
  polling?: number;
};

const noCacheHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } as const;

export async function ensureTechSupportStage0Baseline(): Promise<void> {
  const base = gunBaseURL();
  const res = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      headshot: TECHSUPPORT_HEADSHOT,
      profile: [],
      languages: ['en'],
      interests: [],
      networkRole: TECHSUPPORT_NETWORK_ROLE,
      talkFilters: {
        allowedLanguages: ['en'],
        minDistanceMiles: 0,
        maxDistanceMiles: 50,
        requireGoodGrammar: true,
        blockDirtyWords: true,
        allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (!/already|reserved|exists/i.test(text)) {
      throw new Error(`TechSupport seed failed: ${res.status} ${text}`);
    }
  }
  const join = await fetch(`${base}/api/chatrooms/global/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
    }),
  });
  if (!join.ok) throw new Error(`TechSupport global join failed: ${join.status} ${await join.text()}`);
}

export async function expectTechSupportGreetingReceived(page: Page, stageName?: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ techSupportId, name }) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((conversation: any) => {
              const message = String(conversation?.lastMessage || '');
              return (
                conversation?.supportChannel === true &&
                conversation?.otherUserId === techSupportId &&
                message.includes('Welcome to IinPublic') &&
                (!name || message.includes(name))
              );
            });
          },
          { techSupportId: TECHSUPPORT_ROOT_USER_ID, name: stageName || '' },
        ),
      { timeout: E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(true);
}

async function fetchIncomingClustersForUser(
  request: APIRequestContext,
  uid: string,
): Promise<unknown[] | null> {
  const r = await request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(uid)}/incoming-talks`, {
    headers: noCacheHeaders,
  });
  if (!r.ok()) return null;
  const clusters: unknown = await r.json();
  return Array.isArray(clusters) ? clusters : null;
}

function clusterListMatchesTitleSubstring(clusters: unknown[], needleLower: string): boolean {
  if (!needleLower) return false;
  for (const c of clusters as { title?: unknown }[]) {
    if (String(c?.title || '').toLowerCase().includes(needleLower)) return true;
  }
  return false;
}

async function clusterListMatchesTitleViaTalkFetches(
  request: APIRequestContext,
  clusters: unknown[],
  needleLower: string,
): Promise<boolean> {
  if (!needleLower) return false;
  const base = gunBaseURL();
  for (const c of clusters as { talkIds?: Record<string, unknown> }[]) {
    const t = c?.talkIds;
    if (!t || typeof t !== 'object') continue;
    const ids = Object.keys(t).filter((k) => !k.startsWith('_'));
    for (const id of ids) {
      const tr = await request.get(`${base}/api/talks/${encodeURIComponent(id)}`, { headers: noCacheHeaders });
      if (!tr.ok()) continue;
      const td = (await tr.json()) as { title?: unknown };
      if (String(td?.title || '').toLowerCase().includes(needleLower)) return true;
    }
  }
  return false;
}

async function incomingClustersIncludeTitleSubstring(
  request: APIRequestContext,
  uid: string,
  titleSubstring: string,
): Promise<boolean> {
  const clusters = await fetchIncomingClustersForUser(request, uid);
  if (!clusters) return false;
  const needle = titleSubstring.toLowerCase();
  if (clusterListMatchesTitleSubstring(clusters, needle)) return true;
  return clusterListMatchesTitleViaTalkFetches(request, clusters, needle);
}

/**
 * Legacy star-mode wait until the server incoming-talks API lists this title.
 * Pair-direct E2E must use the local Gun wait path below instead.
 *
 * Polls from the Playwright process (not `page.waitForFunction`) so requests hit {@link gunBaseURL}
 * and are not blocked by the web app's Helmet CSP (`connect-src 'self'` only allows the webpack origin).
 *
 * Predicate is optimized for large IN lists (e.g. 20 broadcasts): talk-detail fetches run sequentially
 * with early exit instead of fanning out parallel requests every interval.
 */
/** Pair-direct: wait until the receiver's local Gun IN index contains a cluster matching title. */
export async function waitForIncomingTalkClusterOnLocalGun(
  page: Page,
  titleSubstring: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  const timeout = options?.timeout ?? E2E_ASSERT_TIMEOUT_MS;
  const polling = options?.polling ?? 100;
  await expect
    .poll(
      async () => {
        return page.evaluate(async (n) => {
          const app = (
            window as unknown as {
              __iinpublic_app?: {
                getApp: () => {
                  isDirectTalkDeliveryEnabled?: () => boolean;
                  syncIncomingClustersFromServer?: () => Promise<void>;
                  getLocalIncomingClustersForE2e?: () => Promise<unknown[]>;
                };
              };
            }
          ).__iinpublic_app?.getApp?.();
          if (!app?.isDirectTalkDeliveryEnabled?.()) return 'p0-disabled';
          await app.syncIncomingClustersFromServer?.();
          const list = (await app.getLocalIncomingClustersForE2e?.()) ?? [];
          const hay = JSON.stringify(list);
          return hay.toLowerCase().includes(String(n).toLowerCase()) ? 'ok' : `clusters=${list.length}`;
        }, titleSubstring);
      },
      { timeout, intervals: [polling] },
    )
    .toBe('ok');
}

/** Pair-direct by default, star only when explicitly disabled: wait for an incoming cluster by title. */
export async function waitForIncomingTalkCluster(
  page: Page,
  titleSubstring: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  if (isDirectTalkDeliveryE2e()) {
    await waitForIncomingTalkClusterOnLocalGun(page, titleSubstring, options);
    return;
  }
  await waitForIncomingTalkClusterOnServer(page, titleSubstring, options);
}

export async function localIncomingClustersIncludeTitle(page: Page, titleSubstring: string): Promise<boolean> {
  const needle = titleSubstring.toLowerCase();
  return page.evaluate(async (n) => {
    const app = (
      window as unknown as {
        __iinpublic_app?: { getApp: () => { getLocalIncomingClustersForE2e?: () => Promise<unknown[]> } };
      }
    ).__iinpublic_app?.getApp?.();
    const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
    const hay = JSON.stringify(clusters).toLowerCase();
    return hay.includes(n);
  }, needle);
}

/** Poll incoming cluster titles for a user (local Gun in pair-direct, server API in star mode). */
export async function getIncomingClusterTitlesForUser(
  page: Page,
  userId: string,
): Promise<string[]> {
  if (isDirectTalkDeliveryE2e()) {
    return page.evaluate(async () => {
      const app = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { getLocalIncomingClustersForE2e?: () => Promise<{ title?: string }[]> } };
        }
      ).__iinpublic_app?.getApp?.();
      const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
      return clusters.map((c) => String(c?.title || ''));
    });
  }
  const r = await page.context().request.get(
    `${gunBaseURL()}/api/users/${encodeURIComponent(userId)}/incoming-talks`,
    { headers: noCacheHeaders },
  );
  if (!r.ok()) return [];
  const clusters = (await r.json()) as Array<{ title?: string }>;
  return Array.isArray(clusters) ? clusters.map((c) => String(c?.title || '')) : [];
}

export async function incomingClustersIncludeTitleForUser(
  page: Page,
  userId: string,
  titleSubstring: string,
): Promise<boolean> {
  if (isDirectTalkDeliveryE2e()) {
    return localIncomingClustersIncludeTitle(page, titleSubstring);
  }
  return incomingClustersIncludeTitleSubstring(page.context().request, userId, titleSubstring);
}

export async function waitForIncomingTalkClusterOnServer(
  page: Page,
  titleSubstring: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  if (isDirectTalkDeliveryE2e()) {
    await waitForIncomingTalkClusterOnLocalGun(page, titleSubstring, options);
    return;
  }
  const timeout = options?.timeout ?? E2E_ASSERT_TIMEOUT_MS;
  const polling = options?.polling ?? 100;
  const uid = await page.evaluate(() =>
    String(
      (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
        }
      ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    ),
  );
  if (!uid) throw new Error('waitForIncomingTalkClusterOnServer: no currentUser.id (not logged in?)');
  const request = page.context().request;
  await expect
    .poll(() => incomingClustersIncludeTitleSubstring(request, uid, titleSubstring), {
      timeout,
      intervals: [polling],
    })
    .toBe(true);
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

export async function pinStableE2eLocation(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
    if (!app?.currentUser?.id) return;
    const location = {
      latitude: 32.7157,
      longitude: -117.1611,
      accuracy: 10,
      timestamp: new Date(),
    };
    app.currentLocation = location;
    app.uiManager?.setCurrentLocation?.(location);
    if (app.userService?.updateUserLocation) {
      await app.userService.updateUserLocation(app.currentUser.id, location);
    }
  });
}

export async function bootstrapUser(
  browser: Browser,
  label: string,
  stageName: string,
  // Heavy specs that bring up many simultaneous browser contexts in one worker (mass/,
  // staged/stage5 capacity, find-similar) starve later cold bootstraps past the 10s default
  // (see timing.ts waitForAppReady doc) — those callers pass a larger budget here.
  appReadyTimeoutMs?: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  attachFilteredConsoleLog(page, label);
  // Clear the Web Worker's IndexedDB so each user starts with a fresh local Gun graph.
  await injectIdbClear(page);
  await gotoWebApp(page, webAppURLStableChatroom(), appReadyTimeoutMs);
  await ensureWindowFitsViewport(page, 640, 1000);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await page.waitForSelector('#settings-stage-name-input', { timeout: appReadyTimeoutMs ?? E2E_ASSERT_TIMEOUT_MS });
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: appReadyTimeoutMs ?? E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  // Rename barrier: peers resolve this user's name through the hub's public user record
  // (getPublicUser prefers the HTTP fast path). Anything captured downstream — broadcast
  // exchange ledgers, match conversations, contact rows/detail — inherits whatever the
  // server serves at capture time, so don't proceed until the rename has landed there.
  // Without this, specs raced the propagation and intermittently froze the generated
  // User<random> name into records that never re-resolve.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          const base = app?.getBackendApiBase?.();
          const id = app?.currentUser?.id;
          if (!base || !id) return '';
          try {
            const res = await fetch(`${base}/api/users/${encodeURIComponent(id)}`, { cache: 'no-store' });
            return res.ok ? String(((await res.json()) as { stageName?: string }).stageName || '') : '';
          } catch {
            return '';
          }
        }),
      { timeout: appReadyTimeoutMs ?? E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  await expectCurrentUserIsOrdinaryUser(page, stageName);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await pinStableE2eLocation(page);
  await expectTechSupportGreetingReceived(page);
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

export async function waitForTabActive(
  page: Page,
  view: 'chatrooms' | 'talks' | 'contacts' | 'answers' | 'me' | 'settings',
): Promise<void> {
  const active = page.locator(`.nav-btn[data-view="${view}"].active`);
  if (!(await active.isVisible().catch(() => false))) {
    await page.locator(`.nav-btn[data-view="${view}"]`).click();
    await afterNav();
  }
  await expect(active).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
}

export async function waitForResponseModalClosed(page: Page): Promise<void> {
  await page.waitForSelector('#talk-response-modal', { state: 'detached', timeout: RESPONSE_MODAL_DETACHED_MS });
}

/** POST /received + IN list: wait until incoming index includes this talk id for the page user. */
export async function waitForIncomingTalkId(
  page: Page,
  talkId: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  if (isDirectTalkDeliveryE2e()) {
    await waitForIncomingTalkIdOnLocalGun(page, talkId, options);
    return;
  }
  await waitForIncomingTalkIdOnServer(page, talkId, options);
}

async function waitForIncomingTalkIdOnLocalGun(
  page: Page,
  talkId: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  const tid = String(talkId || '').trim();
  if (!tid) throw new Error('waitForIncomingTalkIdOnLocalGun: empty talkId');
  const timeout = options?.timeout ?? E2E_ASSERT_TIMEOUT_MS;
  const polling = options?.polling ?? 100;
  const clusterHasTalk = (c: { latestTalkId?: unknown; talkIds?: unknown }): boolean => {
    const latest = String(c?.latestTalkId || '');
    if (latest === tid || latest.startsWith(`${tid}__`)) return true;
    const t = c?.talkIds;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const keys = Object.keys(t as Record<string, unknown>);
      if (keys.some((k) => k === tid || k.startsWith(`${tid}__`))) return true;
    }
    return false;
  };
  await expect
    .poll(async () => {
      const clusters = await page.evaluate(async () => {
        const app = (
          window as unknown as {
            __iinpublic_app?: { getApp: () => { getLocalIncomingClustersForE2e?: () => Promise<unknown[]> } };
          }
        ).__iinpublic_app?.getApp?.();
        return (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
      });
      return Array.isArray(clusters) && clusters.some((c) => clusterHasTalk(c as { latestTalkId?: unknown; talkIds?: unknown }));
    }, { timeout, intervals: [polling] })
    .toBe(true);
}

/** @deprecated Prefer {@link waitForIncomingTalkId} — star mode only. */
export async function waitForIncomingTalkIdOnServer(
  page: Page,
  talkId: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  const tid = String(talkId || '').trim();
  if (!tid) throw new Error('waitForIncomingTalkIdOnServer: empty talkId');
  const timeout = options?.timeout ?? E2E_ASSERT_TIMEOUT_MS;
  const polling = options?.polling ?? 100;
  const uid = await page.evaluate(() =>
    String(
      (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
        }
      ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    ),
  );
  if (!uid) throw new Error('waitForIncomingTalkIdOnServer: no currentUser.id (not logged in?)');
  const request = page.context().request;
  const clusterHasTalk = (c: { latestTalkId?: unknown; talkIds?: unknown }): boolean => {
    const latest = String(c?.latestTalkId || '');
    if (latest === tid || latest.startsWith(`${tid}__`)) return true;
    const t = c?.talkIds;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const keys = Object.keys(t as Record<string, unknown>);
      if (keys.some((k) => k === tid || k.startsWith(`${tid}__`))) return true;
    }
    return false;
  };
  await expect
    .poll(async () => {
      const clusters = await fetchIncomingClustersForUser(request, uid);
      if (!clusters) return false;
      return clusters.some((c) => clusterHasTalk(c as { latestTalkId?: unknown; talkIds?: unknown }));
    }, { timeout, intervals: [polling] })
    .toBe(true);
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
  await waitForIncomingTalkId(page, tid);
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
  const modal = page.locator('#talk-response-modal .modal-content');
  const openDeadline = Date.now() + RESPONSE_MODAL_CONTENT_MS;
  while (Date.now() < openDeadline) {
    const clicked = await page.evaluate((title) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.talk-list-item[data-role="incoming"]'));
      const current = rows.find((candidate) => candidate.textContent?.includes(title));
      const button = current?.querySelector<HTMLButtonElement>('button.view-talk-btn');
      if (!button) return false;
      // The talks-list delegation listens on MOUSEDOWN (not click) — see ui-manager.
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      return true;
    }, titleSubstring);
    if (clicked) {
      try {
        await modal.waitFor({ state: 'visible', timeout: RESPONSE_MODAL_CONTENT_MS });
        return;
      } catch {
        // The incoming list refreshed between lookup and handler completion.
      }
    }
    await syncIncomingFromServer(page);
    await page.waitForTimeout(200);
  }
  await expect(modal).toBeVisible({ timeout: 1_000 });
}

/** Open an incoming talk via the View button (more reliable than row click for Gun-synced rows). */
export async function openIncomingTalkModal(
  page: Page,
  titleSubstring: string,
  options?: IncomingTalkServerWaitOptions,
): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await waitForIncomingTalkCluster(page, titleSubstring, options);
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
  // The incoming list re-renders on every Gun sync tick, so a Playwright click can spend
  // its whole actionTimeout in "element is not stable / detached" retries under load
  // (observed in 00l-chatroom-talks-ui-regressions on the 8-worker light shard). Trigger
  // the CURRENT button via the DOM instead. IMPORTANT: the talks-list delegation listens
  // on MOUSEDOWN (see ui-manager displayTalksList: "use mousedown so we run before any
  // re-render can replace the DOM") — `button.click()` fires only a `click` event and is
  // a no-op there, so dispatch a real mousedown. Then wait the FULL modal budget: opening
  // the dialog fetches the talk from the server and can take many seconds under load, so
  // re-triggering on a short poll would keep restarting that load.
  const viewModal = page.locator('#talk-response-modal .modal-content');
  for (let attempt = 0; attempt < 3; attempt++) {
    const clicked = await page.evaluate((title) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.talk-list-item[data-role="incoming"]'));
      const current = rows.find((candidate) => candidate.textContent?.includes(title));
      const button = current?.querySelector<HTMLButtonElement>('button.view-talk-btn');
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      return true;
    }, titleSubstring);
    if (!clicked) {
      // Row list mid-render — let it settle and look again.
      await page.waitForTimeout(200);
      continue;
    }
    try {
      await viewModal.waitFor({ state: 'visible', timeout: RESPONSE_MODAL_CONTENT_MS });
      return;
    } catch {
      // Click was swallowed by a re-render or the load stalled — one more attempt.
    }
  }
  await expect(viewModal).toBeVisible({ timeout: 1_000 });
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
  await waitForIncomingTalkCluster(page, titleSubstring);
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

/**
 * Actively establish ≥1 connected mesh neighbor on every page, re-warming while waiting.
 *
 * A single warm pass followed by a passive `expect.poll` flakes under parallel load
 * (PW_WORKERS≥4): a 10s WebRTC connect timeout plus a transport reset/re-offer cycle
 * can exceed a 15–30s passive window when many Chromium instances contend for CPU.
 * Re-issuing `warmMeshConnectionToPeer` keeps posting fresh offers (each warm call
 * internally retries joinRoom up to 4×) until the link lands or the deadline expires.
 */
export async function ensureMeshNeighbors(
  peers: ReadonlyArray<{ label: string; page: Page; otherIds: string[] }>,
  timeoutMs = 90_000,
): Promise<void> {
  const connectedCount = (page: Page) =>
    page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
    });
  const warm = (page: Page, otherIds: string[]) =>
    page.evaluate(async (ids: string[]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      if (!app?.warmMeshConnectionToPeer) return;
      for (const id of ids) {
        await app.warmMeshConnectionToPeer(id).catch(() => { /* best-effort */ });
      }
    }, otherIds);

  const deadline = Date.now() + timeoutMs;
  // First pass in parallel — the common case connects here.
  await Promise.all(peers.map(({ page, otherIds }) => warm(page, otherIds).catch(() => {})));
  for (;;) {
    const counts = await Promise.all(
      peers.map(({ page }) => connectedCount(page).catch(() => 0)),
    );
    const pending = peers.filter((_, i) => counts[i] <= 0);
    if (pending.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `ensureMeshNeighbors: no connected mesh neighbors after ${timeoutMs}ms: ` +
        pending.map((p) => p.label).join(', '),
      );
    }
    await Promise.all(pending.map(({ page, otherIds }) => warm(page, otherIds).catch(() => {})));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Close pages/contexts, manualCleanup, clear Gun — use in beforeEach for multi-user talks suites.
 * docs/TODO.md §K4: callers should pass their own stage's `clearGunForStageNSpec` (this helper
 * is shared across stage2/stage3/isolated specs with different user counts, so there's no single
 * correct stage to default to here) — `maybeClearGunDatabases` stays as the fallback only for a
 * caller that genuinely doesn't care about loading a stage snapshot.
 */
export async function resetTalksMatchingSession(
  pages: { tom?: Page; jerry?: Page; bob?: Page },
  contexts: { tom?: BrowserContext; jerry?: BrowserContext; bob?: BrowserContext },
  clearFn: () => Promise<void> = maybeClearGunDatabases,
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
  await clearFn();
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
