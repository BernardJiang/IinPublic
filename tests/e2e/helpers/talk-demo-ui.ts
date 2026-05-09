/**
 * Browser helpers for survey / route talk demos (multi-user flows).
 */
import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { afterCreateTalkBeforeBroadcast, afterSync } from './timing';
import { openIncomingTalkModal, openIncomingTalkModalByTalkId, waitForResponseModalClosed } from './talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from './broadcast-preamble';

async function clickChatroomBroadcastButton(page: Page): Promise<void> {
  const statusBtn = page.locator('#status-broadcast-talk-btn');
  const roomBtn = page.locator('#broadcast-talk-btn');
  if (await statusBtn.isVisible().catch(() => false)) {
    await statusBtn.click();
  } else {
    await expect(roomBtn).toBeVisible({ timeout: 20_000 });
    await roomBtn.click();
  }
  await afterSync();
  await confirmBroadcastTagPreambleIfVisible(page);
}

/** Gun `getActiveMembers` can lag behind UI; without this, broadcast may run with 0 receivers and skip register-receivers (no HTTP). */
/** OUT row + local broadcastable state can lag createTalk; clicking Broadcast too early opens the editor and never POSTs register-receivers. */
export async function waitForBroadcastableTalkIds(page: Page, timeoutMs: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const n = await page.evaluate(() => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
          const ids = app?.uiManager?.getBroadcastableTalkIds?.() as string[] | undefined;
          return Array.isArray(ids) ? ids.length : 0;
        });
        return n >= 1 ? 'ok' : String(n);
      },
      { timeout: timeoutMs, intervals: [300, 600, 1200] },
    )
    .toBe('ok');
}

export async function waitForDistinctGunPeersExcludingSelf(
  page: Page,
  minPeers: number,
  timeoutMs: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const count = await page.evaluate(async () => {
          const app = (
            window as unknown as { __iinpublic_app?: { getApp: () => any } }
          ).__iinpublic_app?.getApp?.();
          const svc = app?.chatroomService;
          if (!svc?.getActiveMembers || !svc.getCurrentChatroomId) return -1;
          const me = String(app?.currentUser?.id || '').trim();
          const room = String(svc.getCurrentChatroomId() || '').trim();
          if (!me || !room) return -1;
          const ids: string[] = await svc.getActiveMembers(room);
          const peers = new Set((ids || []).filter((id: string) => id && id !== me));
          return peers.size;
        });
        return count >= minPeers ? 'ok' : String(count);
      },
      { timeout: timeoutMs, intervals: [400, 800, 1200, 2000] },
    )
    .toBe('ok');
}

/**
 * Wait until the broadcast handler finishes (it awaits register-receivers before setBroadcastBulkAck).
 * page.waitForResponse missed some fetches in multi-window runs; the ack node is updated only after POST completes.
 */
export async function clickBroadcastUntilBulkAck(page: Page): Promise<void> {
  const loc = page.locator('[data-testid="broadcast-bulk-ack"]');
  const genBefore = Number(await loc.getAttribute('data-broadcast-bulk-gen'));
  const start = Number.isFinite(genBefore) ? genBefore : 0;
  await clickChatroomBroadcastButton(page);
  await expect
    .poll(
      async () => {
        const gen = Number(await loc.getAttribute('data-broadcast-bulk-gen'));
        const sent = Number(await loc.getAttribute('data-broadcast-talks-sent'));
        return Number.isFinite(gen) && gen > start && Number.isFinite(sent) && sent >= 1;
      },
      { timeout: 300_000, intervals: [200, 500, 1000, 2000] },
    )
    .toBe(true);
}

export type EmitCreateTalkFromCompanyOpts = { minGunPeersExcludingSelf?: number };

/** Same create path as the Create Talk button; then wait and click Broadcast so receivers reliably see the talk. */
export async function emitCreateTalkFromCompanyPage(
  page: Page,
  talkPayload: unknown,
  opts?: EmitCreateTalkFromCompanyOpts,
): Promise<void> {
  const json = JSON.stringify(talkPayload, (_k, v) => (v instanceof Date ? (v as Date).toISOString() : v));
  await page.evaluate((payloadJson: string) => {
    const app = (window as unknown as { __iinpublic_app?: { getApp: () => { uiManager: { emit: (ev: string, data: unknown) => void } } } })
      .__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.emit) throw new Error('App or uiManager.emit not available');
    app.uiManager.emit('createTalk', JSON.parse(payloadJson));
  }, json);
  await afterSync();
  await afterSync();
  await afterCreateTalkBeforeBroadcast();
  await waitForBroadcastableTalkIds(page, 120_000);
  const minPeers = opts?.minGunPeersExcludingSelf ?? 1;
  await waitForDistinctGunPeersExcludingSelf(page, minPeers, 240_000);
  await clickBroadcastUntilBulkAck(page);
  await afterSync();
  await afterSync();
  // In multi-browser e2e, some late-joining peers can miss the first fanout window.
  // A second idempotent broadcast pass makes delivery deterministic without changing behavior.
  await clickBroadcastUntilBulkAck(page);
  await afterSync();
}

export async function waitForOutgoingTalkRow(page: Page, titleSubstring: string, timeoutMs = 120_000): Promise<string> {
  await page.click('.nav-btn[data-view="talks"]');
  await expect(page.locator('.nav-btn[data-view="talks"].active')).toBeVisible({ timeout: 15_000 });
  await afterSync();
  const row = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: titleSubstring });
  await expect(row.first()).toBeVisible({ timeout: timeoutMs });
  const tid = await row.first().getAttribute('data-talk-id');
  if (!tid) throw new Error(`No data-talk-id on created row for "${titleSubstring}"`);
  return tid;
}

/** Answer each survey question in order using manual radios (`data-answer-id` from talk JSON). */
export async function answerSurveyByAnswerIds(
  page: Page,
  titleSubstring: string,
  answerIds: string[],
  talkId?: string,
): Promise<void> {
  if (talkId) {
    await openIncomingTalkModalByTalkId(page, talkId, titleSubstring).catch(async () => {
      await openIncomingTalkModal(page, titleSubstring);
    });
  } else {
    await openIncomingTalkModal(page, titleSubstring);
  }
  for (const aid of answerIds) {
    await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 90_000 });
    const radio = page.locator(`input.choice-radio[data-answer-id="${aid}"][data-mode="manual"]`).first();
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.click();
    await afterSync();
  }
  await waitForResponseModalClosed(page);
}

/** One radio pick per route step (manual). */
export async function answerRouteByAnswerIds(
  page: Page,
  titleSubstring: string,
  answerIds: string[],
  talkId?: string,
): Promise<void> {
  if (talkId) {
    await openIncomingTalkModalByTalkId(page, talkId, titleSubstring).catch(async () => {
      await openIncomingTalkModal(page, titleSubstring);
    });
  } else {
    await openIncomingTalkModal(page, titleSubstring);
  }
  for (const aid of answerIds) {
    await page.waitForSelector('#talk-response-modal .modal-content', { timeout: 90_000 });
    const radio = page.locator(`input.choice-radio[data-answer-id="${aid}"][data-mode="manual"]`).first();
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.click();
    await afterSync();
  }
  await waitForResponseModalClosed(page);
}

export async function expectTalkResponsesLine(
  page: Page,
  titleSubstring: string,
  expectedResponses: number,
): Promise<void> {
  const needle = `Responses: ${expectedResponses}`;
  await expect
    .poll(
      async () => {
        await page.click('.nav-btn[data-view="talks"]');
        await page.waitForSelector('.nav-btn[data-view="talks"].active', { timeout: 15_000 }).catch(() => {});
        await afterSync();
        const row = page.locator('.talk-list-item[data-role="created"]').filter({ hasText: titleSubstring });
        const stats = await row.first().locator('.talk-item-stats').textContent().catch(() => '');
        return stats ?? '';
      },
      { timeout: 240_000 },
    )
    .toContain(needle);
}
