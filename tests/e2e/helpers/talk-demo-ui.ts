/**
 * Browser helpers for survey / route talk demos (multi-user flows).
 */
import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { waitForGunApiReady } from './clear-database';
import { afterCreateTalkBeforeBroadcast, afterSync, E2E_ASSERT_TIMEOUT_MS } from './timing';
import {
  openIncomingTalkModal,
  openIncomingTalkModalByTalkId,
  waitForResponseModalClosed,
} from './talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from './broadcast-preamble';
import { deliverBroadcastViaRegisterApi, waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';
import { gunBaseURL, isDirectTalkDeliveryE2e } from './ports';

async function dismissBroadcastPreambleIfOpen(page: Page): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  if (!(await preamble.isVisible().catch(() => false))) return;
  const cancel = page.locator('[data-testid="broadcast-preamble-cancel"]');
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click({ timeout: 2000 }).catch(() => {});
  }
  await preamble.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

export { waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';

async function clickChatroomBroadcastButton(page: Page, opts?: { minGunPeers?: number }): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  const broadcastBtn = page.locator('#broadcast-talk-btn').or(page.locator('#status-broadcast-talk-btn')).first();

  if (!(await preamble.isVisible().catch(() => false))) {
    await expect(broadcastBtn).toBeVisible({ timeout: 10_000 });
    await broadcastBtn.click({ timeout: 8_000 }).catch(() => {
      // Audience preview can open the preamble while the click is in flight.
    });
    await afterSync();
  }

  await confirmBroadcastTagPreambleIfVisible(page, E2E_ASSERT_TIMEOUT_MS, opts);
}

/** Gun `getActiveMembers` can lag behind UI; without this, broadcast may run with 0 receivers and skip register-receivers (no HTTP). */
/** OUT row + local broadcastable state can lag createTalk; clicking Broadcast too early opens the editor and never POSTs register-receivers. */
export async function waitForBroadcastableTalkIds(page: Page, timeoutMs: number): Promise<void> {
  const { waitForPendingBroadcastTalkIds } = await import('./broadcast-preamble');
  await waitForPendingBroadcastTalkIds(page, timeoutMs);
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

/** P0/star fallback when audience-preview UI does not open in time — see broadcast-register-fallback.ts */
export { deliverBroadcastViaRegisterApi, waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';

/** Full production broadcastTalk path with audience modal auto-confirmed (P0 fallback when register-only deliver sends 0). */
async function deliverViaUiBroadcastTalk(page: Page, minSent: number): Promise<void> {
  await page.evaluate(
    async ({ min }) => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      const ui = app?.uiManager;
      if (!app?.chatroomService || !ui?.emit) throw new Error('broadcastTalk emit unavailable');
      const ack = document.querySelector('[data-testid="broadcast-bulk-ack"]');
      const genBefore = Number(ack?.getAttribute('data-broadcast-bulk-gen')) || 0;
      const orig = ui.confirmBroadcastAudience?.bind(ui);
      ui.confirmBroadcastAudience = async () => true;
      try {
        const chatroomId = app.chatroomService.getCurrentChatroomId() || ui.currentChatroom || 'global';
        const talkIds = (ui.getBroadcastableTalkIds?.() || []) as string[];
        if (!Array.isArray(talkIds) || talkIds.length === 0) {
          throw new Error('no broadcastable talk ids for UI broadcast fallback');
        }
        ui.emit('broadcastTalk', {
          chatroomId,
          members: ui.getCurrentChatroomMembers?.() || ui.currentChatroomMembers || [],
          talkIds,
        });
        const deadline = Date.now() + 12_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          const el = document.querySelector('[data-testid="broadcast-bulk-ack"]');
          const gen = Number(el?.getAttribute('data-broadcast-bulk-gen'));
          const sent = Number(el?.getAttribute('data-broadcast-talks-sent'));
          if (Number.isFinite(gen) && gen > genBefore && Number.isFinite(sent) && sent >= min) return;
        }
        throw new Error(`broadcastTalk fallback ack timeout (minSent=${min})`);
      } finally {
        if (orig) ui.confirmBroadcastAudience = orig;
      }
    },
    { min: minSent },
  );
}

/**
 * Wait until the broadcast handler finishes (it awaits register-receivers before setBroadcastBulkAck).
 * page.waitForResponse missed some fetches in multi-window runs; the ack node is updated only after POST completes.
 */
/** Navigate to Global (if needed) and deliver all pending OUT talks (P0 register API or star preamble). */
export async function broadcastFromGlobalChatroom(
  page: Page,
  opts?: { minGunPeers?: number; requirePreambleUi?: boolean },
): Promise<void> {
  const { waitForTabActive } = await import('./talks-matching-flow');
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  const inDetail = await page.locator('#chatroom-members-list').isVisible().catch(() => false);
  if (!inDetail) {
    await page.locator('.chatroom-item:has-text("Global")').first().click();
    await afterSync();
  }
  if (opts?.requirePreambleUi) {
    await clickChatroomBroadcastButton(page, { minGunPeers: opts.minGunPeers });
    return;
  }
  await clickBroadcastUntilBulkAck(page, opts);
}

export async function clickBroadcastUntilBulkAck(
  page: Page,
  opts?: { minGunPeers?: number; minSent?: number },
): Promise<void> {
  const { waitForTabActive } = await import('./talks-matching-flow');
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  const inDetail = await page.locator('#chatroom-members-list').isVisible().catch(() => false);
  if (!inDetail) {
    await page.locator('.chatroom-item:has-text("Global")').first().click();
    await afterSync();
  }
  const loc = page.locator('[data-testid="broadcast-bulk-ack"]');
  const genBefore = Number(await loc.getAttribute('data-broadcast-bulk-gen'));
  const start = Number.isFinite(genBefore) ? genBefore : 0;
  await waitForGunApiReady(E2E_ASSERT_TIMEOUT_MS).catch(() => {});
  const minPeers = opts?.minGunPeers ?? 1;
  const minSent = opts?.minSent ?? (isDirectTalkDeliveryE2e() && minPeers > 0 ? 1 : 0);
  if (isDirectTalkDeliveryE2e() && minPeers > 0) {
    await waitForChatroomMemberCountViaApi(page, minPeers, E2E_ASSERT_TIMEOUT_MS);
  }
  await waitForBroadcastableTalkIds(page, E2E_ASSERT_TIMEOUT_MS);
  if (isDirectTalkDeliveryE2e() && minPeers > 0) {
    const result = await deliverBroadcastViaRegisterApi(page, { minReceivers: minPeers }).catch(() => ({
      talksSent: 0,
      receivers: 0,
    }));
    if (result.talksSent < minSent && result.receivers >= minPeers && minSent > 0) {
      await deliverViaUiBroadcastTalk(page, minSent);
    }
  } else {
    try {
      await clickChatroomBroadcastButton(page, opts);
    } catch {
      const minRecv = opts?.minGunPeers ?? 1;
      if (isDirectTalkDeliveryE2e() && minRecv > 0) {
        await deliverBroadcastViaRegisterApi(page, { minReceivers: minRecv });
      }
    }
  }
  await expect
    .poll(
      async () => {
        const gen = Number(await loc.getAttribute('data-broadcast-bulk-gen'));
        const sent = Number(await loc.getAttribute('data-broadcast-talks-sent'));
        return Number.isFinite(gen) && gen > start && Number.isFinite(sent) && sent >= minSent;
      },
      { timeout: E2E_ASSERT_TIMEOUT_MS, intervals: [100, 200, 400] },
    )
    .toBe(true);
  await dismissBroadcastPreambleIfOpen(page);
}

export type EmitCreateTalkFromCompanyOpts = { minGunPeersExcludingSelf?: number };

/** Create through the app path but keep it in OUT only; useful when a spec validates stats, not delivery. */
export async function createTalkFromCompanyPage(page: Page, talkPayload: unknown): Promise<string> {
  const json = JSON.stringify(talkPayload, (_k, v) => (v instanceof Date ? (v as Date).toISOString() : v));
  const title = String((talkPayload as { title?: unknown })?.title || '');
  if (!title) throw new Error('createTalkFromCompanyPage requires a title');
  await page.evaluate((payloadJson: string) => {
    const app = (window as unknown as { __iinpublic_app?: { getApp: () => { uiManager: { emit: (ev: string, data: unknown) => void } } } })
      .__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.emit) throw new Error('App or uiManager.emit not available');
    app.uiManager.emit('createTalk', { ...JSON.parse(payloadJson), sendToChatroom: false });
  }, json);
  return waitForOutgoingTalkRow(page, title);
}

export async function createTalksFromCompanyPage(
  page: Page,
  talkPayloads: unknown[],
): Promise<Array<{ title: string; talkId: string; talkData: any }>> {
  const json = JSON.stringify(talkPayloads, (_k, v) => (v instanceof Date ? (v as Date).toISOString() : v));
  const titles = talkPayloads.map((payload) => String((payload as { title?: unknown })?.title || ''));
  if (titles.some((title) => !title)) throw new Error('createTalksFromCompanyPage requires every payload to have a title');
  await page.evaluate((payloadsJson: string) => {
    const app = (window as unknown as { __iinpublic_app?: { getApp: () => { uiManager: { emit: (ev: string, data: unknown) => void } } } })
      .__iinpublic_app?.getApp?.();
    if (!app?.uiManager?.emit) throw new Error('App or uiManager.emit not available');
    for (const payload of JSON.parse(payloadsJson)) {
      app.uiManager.emit('createTalk', { ...payload, sendToChatroom: false });
    }
  }, json);
  await page.click('.nav-btn[data-view="talks"]');
  await expect(page.locator('.nav-btn[data-view="talks"].active')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        page.evaluate((expectedTitles) => {
          const raw = localStorage.getItem('myTalks');
          const myTalks = raw ? JSON.parse(raw) : {};
          const createdTitles = new Set(
            Object.values(myTalks)
              .filter((talk: any) => talk?.role === 'created')
              .map((talk: any) => String(talk?.title || '')),
          );
          return expectedTitles.filter((title) => !createdTitles.has(title)).join(',');
        }, titles),
      { timeout: 20_000, intervals: [200, 500, 1000] },
    )
    .toBe('');
  return page.evaluate((expectedTitles) => {
    const raw = localStorage.getItem('myTalks');
    const myTalks = raw ? JSON.parse(raw) : {};
    return expectedTitles.map((title) => {
      const entry = Object.entries(myTalks).find(([, talk]: [string, any]) =>
        talk?.role === 'created' && talk?.title === title,
      );
      if (!entry) throw new Error(`No created talk in myTalks for "${title}"`);
      const [talkId, talk] = entry as [string, any];
      const talkData = talk?.fullTalk;
      if (!talkData) throw new Error(`No local fullTalk for "${title}"`);
      return { title, talkId, talkData };
    });
  }, titles);
}

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
}

/** Submit talk editor, wait for modal close + OUT row (required before broadcast in P0 parallel runs). */
export async function submitTalkEditorAndWaitForOut(
  page: Page,
  titleSubstring: string,
  timeoutMs = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  await page.click('#talk-editor-form button[type="submit"]');
  await page.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: timeoutMs });
  await waitForOutgoingTalkRow(page, titleSubstring, timeoutMs);
  await afterCreateTalkBeforeBroadcast();
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

async function currentUserIdentity(page: Page): Promise<{ id: string; name: string }> {
  return page.evaluate(() => {
    const currentUser = (
      window as unknown as {
        __iinpublic_app?: {
          getApp: () => { currentUser?: { id?: string; stageName?: string } };
        };
      }
    ).__iinpublic_app?.getApp?.()?.currentUser;
    return {
      id: String(currentUser?.id || ''),
      name: String(currentUser?.stageName || 'Someone'),
    };
  });
}

function answersForIds(
  talkData: any,
  answerIds: string[],
  mode: 'manual' | 'auto' = 'manual',
): Array<{ questionId: string; answerId: string; answerText: string; isChecked: boolean; mode: 'manual' | 'auto' }> {
  return answerIds.map((answerId) => {
    const question = (talkData?.questions || []).find((q: any) =>
      (q?.answers || []).some((a: any) => String(a?.id) === answerId),
    );
    const answer = question?.answers?.find((a: any) => String(a?.id) === answerId);
    if (!question || !answer) {
      throw new Error(`Answer id "${answerId}" not found in talk "${talkData?.title || talkData?.id || 'unknown'}"`);
    }
    return {
      questionId: String(question.id),
      answerId,
      answerText: String(answer.text ?? ''),
      isChecked: answer.isMatch === true,
      mode,
    };
  });
}

/** Gun graph nodes may only expose `questionsJson`; tests need a `questions` array. */
export function normalizeTalkQuestions(talkData: unknown): any {
  if (!talkData || typeof talkData !== 'object') return talkData;
  const t = talkData as { questions?: unknown; questionsJson?: string };
  if (Array.isArray(t.questions) && t.questions.length > 0) return talkData;
  if (typeof t.questionsJson === 'string' && t.questionsJson.trim()) {
    try {
      const questions = JSON.parse(t.questionsJson);
      if (Array.isArray(questions) && questions.length > 0) {
        return { ...t, questions };
      }
    } catch {
      /* ignore */
    }
  }
  return talkData;
}

export async function fetchTalkData(page: Page, talkId: string): Promise<any> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await page.context().request.get(`${gunBaseURL()}/api/talks/${encodeURIComponent(talkId)}`, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (res.status() === 202) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    if (!res.ok()) throw new Error(`GET /api/talks/${talkId} failed: ${res.status()}`);
    return normalizeTalkQuestions(await res.json());
  }
  throw new Error(`GET /api/talks/${talkId} timed out (still pending)`);
}

export async function findIncomingTalkIdByTitle(page: Page, titleSubstring: string): Promise<string> {
  const responder = await currentUserIdentity(page);
  if (!responder.id) throw new Error('findIncomingTalkIdByTitle: not logged in');
  const needle = titleSubstring.toLowerCase();
  if (isDirectTalkDeliveryE2e()) {
    const talkId = await page.evaluate(async (n) => {
      const app = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { getLocalIncomingClustersForE2e?: () => Promise<unknown[]> } };
        }
      ).__iinpublic_app?.getApp?.();
      const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
      for (const c of clusters as Array<{ title?: string; talkIds?: Record<string, unknown>; latestTalkId?: string }>) {
        if (String(c.title || '').toLowerCase().includes(n)) {
          const latest = String(c.latestTalkId || '').trim();
          if (latest) return latest.split('__')[0] || latest;
        }
        const talkIds = c.talkIds;
        if (talkIds && typeof talkIds === 'object') {
          for (const id of Object.keys(talkIds).filter((k) => !k.startsWith('_'))) {
            return id;
          }
        }
      }
      return '';
    }, needle);
    if (talkId) return talkId;
    throw new Error(`findIncomingTalkIdByTitle: no talk matching "${titleSubstring}"`);
  }
  const res = await page.context().request.get(
    `${gunBaseURL()}/api/users/${encodeURIComponent(responder.id)}/incoming-talks`,
    { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
  );
  if (!res.ok()) throw new Error(`incoming-talks failed: ${res.status()}`);
  const clusters = (await res.json()) as unknown[];
  for (const c of clusters) {
    const cluster = c as { title?: string; talkIds?: Record<string, unknown>; latestTalkId?: string };
    if (String(cluster.title || '').toLowerCase().includes(needle)) {
      const latest = String(cluster.latestTalkId || '').trim();
      if (latest) return latest.split('__')[0] || latest;
    }
    const talkIds = cluster.talkIds;
    if (talkIds && typeof talkIds === 'object') {
      for (const id of Object.keys(talkIds).filter((k) => !k.startsWith('_'))) {
        const talkData = await fetchTalkData(page, id);
        if (String(talkData?.title || '').toLowerCase().includes(needle)) return id;
      }
    }
  }
  throw new Error(`findIncomingTalkIdByTitle: no talk matching "${titleSubstring}"`);
}

/**
 * Fast path for stats/demo specs: wait until broadcast delivery has registered,
 * then POST the same response payload the UI submits after a modal is completed.
 */
export async function submitTalkResponseByAnswerIds(
  page: Page,
  talkId: string,
  talkData: any,
  answerIds: string[],
): Promise<void> {
  const responder = await currentUserIdentity(page);
  if (!responder.id) throw new Error('submitTalkResponseByAnswerIds: page has no current user id');
  const res = await page.context().request.post(`${gunBaseURL()}/api/talks/${encodeURIComponent(talkId)}/response`, {
    data: {
      talkId,
      responderId: responder.id,
      responderName: responder.name,
      answers: answersForIds(talkData, answerIds),
      talkData,
      isAuto: false,
      isChatbotResponse: false,
    },
  });
  if (!res.ok()) {
    throw new Error(`POST /api/talks/${talkId}/response failed: ${res.status()} ${await res.text()}`);
  }
}

export async function recordTalkStatsByAnswerIds(
  page: Page,
  talkId: string,
  talkData: any,
  responderId: string,
  answerIds: string[],
  outcome: 'match' | 'ignore' | 'other' = 'other',
): Promise<void> {
  const answers = answersForIds(talkData, answerIds);
  const res = await page.context().request.post(`${gunBaseURL()}/api/stats/talks/${encodeURIComponent(talkId)}/record`, {
    data: {
      responderId,
      talkType: talkData?.type || 'flow',
      answers,
      outcome,
    },
  });
  if (!res.ok()) {
    throw new Error(`POST /api/stats/talks/${talkId}/record failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Fast UI-side completion: bypass repeated modal clicks while still using UIManager.completeTalk,
 * so local "Answers" state and the app's server submission path both run.
 */
export async function completeTalkInAppByAnswerIds(
  page: Page,
  talkId: string,
  talkData: any,
  answerIds: string[],
  outcome: 'match' | 'mismatch',
  mode: 'manual' | 'auto' = 'manual',
): Promise<void> {
  const answers = answersForIds(talkData, answerIds, mode);
  await page.evaluate(
    ({ talk, completedAnswers, completedOutcome }) => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      const completeTalk = app?.uiManager?.completeTalk;
      if (typeof completeTalk !== 'function') {
        throw new Error('UIManager.completeTalk is not available');
      }
      completeTalk.call(app.uiManager, talk, completedAnswers, completedOutcome);
    },
    { talk: talkData, completedAnswers: answers, completedOutcome: outcome },
  );
  await page.evaluate(async () => {
    const completion = (window as any).__iinpublic_lastTalkCompletion;
    if (completion && typeof completion.then === 'function') {
      await Promise.race([
        completion,
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  });
  const summaryTalkId = String(talkData?.id || talkId);
  const readSummaryTotal = async () => {
    const res = await page.context().request.get(
      `${gunBaseURL()}/api/stats/talks/${encodeURIComponent(summaryTalkId)}/summary`,
      { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
    );
    if (!res.ok()) return 0;
    const summary = (await res.json()) as { total?: number };
    return Number(summary.total ?? 0);
  };

  const totalAfterAppPath = await expect
    .poll(readSummaryTotal, { timeout: 5000, intervals: [250, 500, 1000] })
    .toBeGreaterThanOrEqual(1)
    .then(() => true)
    .catch(() => false);
  if (!totalAfterAppPath) {
    await submitTalkResponseByAnswerIds(page, summaryTalkId, talkData, answerIds);
  }

  await expect
    .poll(readSummaryTotal, { timeout: 10_000, intervals: [300, 600, 1000] })
    .toBeGreaterThanOrEqual(1);
}

export async function completeTalksInAppByAnswerIds(
  page: Page,
  completions: Array<{ talkId: string; talkData: any; answerIds: string[]; outcome: 'match' | 'mismatch'; mode?: 'manual' | 'auto' }>,
): Promise<void> {
  for (const { talkId, talkData, answerIds, outcome, mode } of completions) {
    await completeTalkInAppByAnswerIds(page, talkId, talkData, answerIds, outcome, mode ?? 'manual');
  }
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
      { timeout: 30_000 },
    )
    .toContain(needle);
}
