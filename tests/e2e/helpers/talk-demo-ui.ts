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
  waitForTabActive,
} from './talks-matching-flow';
import { selectTalkEditorType } from './talk-editor-e2e';
import { confirmBroadcastTagPreambleIfVisible } from './broadcast-preamble';
import { deliverBroadcastViaAppPath, waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';
import { gunBaseURL, isDirectTalkDeliveryE2e, isMeshTalkDeliveryE2e } from './ports';

async function dismissBroadcastPreambleIfOpen(page: Page): Promise<void> {
  const preamble = page.locator('[data-testid="broadcast-preamble-modal"]');
  if (!(await preamble.isVisible().catch(() => false))) return;
  const cancel = page.locator('[data-testid="broadcast-preamble-cancel"]');
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click({ timeout: 2000 }).catch(() => {});
  }
  await preamble.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    document.querySelector('[data-testid="broadcast-preamble-modal"]')?.remove();
  });
}

// (waitForChatroomMemberCountViaApi is re-exported once at the bottom of this file.)

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

/** Gun `getActiveMembers` can lag behind UI; without this, broadcast may run with 0 receivers. */
/** OUT row + local broadcastable state can lag createTalk; clicking Broadcast too early opens the editor. */
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

/** Direct/legacy fallback when audience-preview UI does not open in time — see broadcast-register-fallback.ts */
export { deliverBroadcastViaAppPath, deliverBroadcastViaRegisterApi, waitForChatroomMemberCountViaApi } from './broadcast-register-fallback';

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
 * Wait until the broadcast handler finishes. The ack node is updated only after direct offers
 * or legacy registration complete.
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
  // E2E_PERF_LOG=1 prints per-step durations — used to hunt silently-exhausted
  // budgets in the broadcast path (speed plan §4.4).
  const perf = process.env.E2E_PERF_LOG === '1';
  let stepStart = Date.now();
  const perfMark = (name: string) => {
    if (!perf) return;
    console.log(`[PERF broadcast] ${name}: ${((Date.now() - stepStart) / 1000).toFixed(1)}s`);
    stepStart = Date.now();
  };
  const { waitForTabActive } = await import('./talks-matching-flow');
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  // A single synchronous isVisible() read right after the tab click can catch a transient
  // render gap (the detail view briefly unmounts/remounts on tab-switch) even when the caller
  // already navigated into a non-Global room and is genuinely still there — misfiring this
  // fallback silently reroutes the caller into Global instead, corrupting every delivery/accept
  // check that follows for a room-scoped test. Poll briefly for the detail view to (re)settle
  // before concluding "not in a room" and falling back.
  const inDetail = await page
    .locator('#chatroom-members-list')
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!inDetail) {
    await page.locator('.chatroom-item:has-text("Global")').first().click();
    await afterSync();
  }
  perfMark('nav-to-room');
  const loc = page.locator('[data-testid="broadcast-bulk-ack"]');
  const genBefore = Number(await loc.getAttribute('data-broadcast-bulk-gen'));
  const start = Number.isFinite(genBefore) ? genBefore : 0;
  await waitForGunApiReady(E2E_ASSERT_TIMEOUT_MS).catch(() => {});
  perfMark('gun-api-ready');
  const requestedMinSent = opts?.minSent;
  const minPeers = opts?.minGunPeers ?? (requestedMinSent === 0 ? 0 : 1);
  const minSent = requestedMinSent ?? (isDirectTalkDeliveryE2e() && minPeers > 0 ? 1 : 0);
  if (isDirectTalkDeliveryE2e() && minPeers > 0) {
    await waitForChatroomMemberCountViaApi(page, minPeers, E2E_ASSERT_TIMEOUT_MS);
  }
  perfMark('member-count');
  await waitForBroadcastableTalkIds(page, E2E_ASSERT_TIMEOUT_MS);
  perfMark('broadcastable-ids');
  if (isDirectTalkDeliveryE2e() && minPeers > 0) {
    const result = await deliverBroadcastViaAppPath(page, { minReceivers: minPeers }).catch(() => ({
      talksSent: 0,
      receivers: 0,
    }));
    perfMark(`deliver-app-path (sent=${result.talksSent})`);
    if (result.talksSent >= minSent) {
      await dismissBroadcastPreambleIfOpen(page);
      return;
    }
    const hasBroadcastable = await page.evaluate(() => {
      const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
      const ids = app?.uiManager?.getBroadcastableTalkIds?.() as string[] | undefined;
      return Array.isArray(ids) && ids.length > 0;
    });
    if (hasBroadcastable && minSent > 0) {
      await deliverViaUiBroadcastTalk(page, minSent);
      await dismissBroadcastPreambleIfOpen(page);
      return;
    }
  } else {
    try {
      await clickChatroomBroadcastButton(page, opts);
    } catch {
      if (isDirectTalkDeliveryE2e() && minPeers > 0) {
        await deliverBroadcastViaAppPath(page, { minReceivers: minPeers });
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
      { timeout: Math.max(E2E_ASSERT_TIMEOUT_MS, 30_000), intervals: [100, 200, 400, 800] },
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
  options: { timeoutMs?: number } = {},
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
      { timeout: options.timeoutMs ?? 20_000, intervals: [200, 500, 1000] },
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

/** Same shape `createTalksFromCompanyPage` already returns — lets UI-driven creation slot into
 *  existing call sites that read `{ title, talkId, talkData }` afterward. */
export async function readCreatedTalkFromMyTalks(
  page: Page,
  title: string,
): Promise<{ title: string; talkId: string; talkData: any }> {
  return page.evaluate((expectedTitle) => {
    const raw = localStorage.getItem('myTalks');
    const myTalks = raw ? JSON.parse(raw) : {};
    const entry = Object.entries(myTalks).find(
      ([, talk]: [string, any]) => talk?.role === 'created' && talk?.title === expectedTitle,
    );
    if (!entry) throw new Error(`No created talk in myTalks for "${expectedTitle}"`);
    const [talkId, talk] = entry as [string, any];
    const talkData = talk?.fullTalk;
    if (!talkData) throw new Error(`No local fullTalk for "${expectedTitle}"`);
    return { title: expectedTitle, talkId, talkData };
  }, title);
}

/**
 * Fills question index `qIndex` (already present in the DOM, e.g. via `#add-question-btn`) as a
 * Pair-tag declaration — docs/TODO.md §LL follow-up, `Question.reciprocalTagContext` — the
 * per-question mechanism that replaced the removed root-level `#talk-tag`/`#talk-preference-set`
 * fields. Checks `.question-reciprocal-tag` and sets the one meaningful answer to
 * `counterpartWord` (the word this talk's own Pair-tag question accepts), chaining to
 * `matchNext` (`'noticed'` if terminal, else `q_${n}`). The 2nd ("Not interested"/ignore) answer
 * row is hidden once the checkbox is checked (`applyTagKindVisibilityToQuestion`,
 * talk-editor-form-helpers.ts) — neither `.fill()` nor `.selectOption()` can reach a hidden row,
 * so it's set directly via the DOM, same fallback `createFlowOrSurveyTalkViaEditor` below uses.
 */
export async function fillPairTagQuestion(
  page: Page,
  qIndex: number,
  ownWord: string,
  counterpartWord: string,
  matchNext: string,
): Promise<void> {
  const q = page.locator(`.question-item[data-question-index="${qIndex}"]`);
  await q.locator('.question-text').fill(ownWord);
  await q.locator('.question-reciprocal-tag').setChecked(true, { force: true });
  await q.locator('.answer-item[data-answer-index="0"] .answer-text').fill(counterpartWord);
  await q.locator('.answer-item[data-answer-index="0"] .answer-next').selectOption(matchNext);
  await q.locator('.answer-item[data-answer-index="1"]').evaluate((item) => {
    const textInput = item.querySelector('.answer-text') as HTMLInputElement | null;
    if (textInput) {
      textInput.value = 'Not interested';
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const nextSelect = item.querySelector('.answer-next') as HTMLSelectElement | null;
    if (nextSelect) {
      nextSelect.value = 'ignore';
      nextSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

export type UiTalkAnswerSpec = {
  text: string;
  /** 'match' -> Noticed (match), 'ignore' -> Ignore (filter out), 'next' -> chain to the
   *  immediately-following question (linear chains only; not a general branch target). */
  outcome: 'match' | 'ignore' | 'next';
  /** Checks this answer's own "My answer" radio — the author's self-declared pick for this
   *  question, saved to the flattened §KK preference store at creation and shown on the Me
   *  tab. Omitted/false leaves the editor's own default (the Ignore row starts pre-checked). */
  self?: boolean;
};

export type UiTalkQuestionSpec = {
  text: string;
  answers: UiTalkAnswerSpec[];
  answerSelectionMode?: 'single' | 'multiple';
  /** docs/TODO.md §LL follow-up: checks the editor's per-question `.question-reciprocal-tag`
   *  checkbox — only meaningful (matching engine side) with exactly one non-`ignore` answer,
   *  which an ordinary single-`match`/`next` + one `ignore` question (the usual 2-answer shape)
   *  already satisfies; no special answer count needed. */
  reciprocalTagContext?: boolean;
};

export type CreateFlowOrSurveyTalkViaEditorOpts = {
  title: string;
  type: 'flow' | 'survey';
  questions: UiTalkQuestionSpec[];
  expiresOption?: '' | '1d' | '1w' | '1M' | '1y';
  locationRadiusMiles?: '' | '10' | '100' | '1000';
  isAdult?: boolean;
  /** Real file-input upload (`#talk-attachment-input`) — drives the same
   *  `publishMediaFileToIpfs` path a real user's file picker selection triggers (app.ts). */
  attachment?: { name: string; mimeType: string; buffer: Buffer };
  /** Passed through to the submit-and-wait-for-OUT-row step; raise it for a test that creates
   *  several talks back to back in one page and has seen the default budget run tight. */
  timeoutMs?: number;
};

/**
 * Builds a flow or survey talk through the real Talk Editor form (`.question-item`/`.answer-item`
 * DOM, `talk-editor-form-helpers.ts`) instead of a script-supplied payload — every e2e talk should
 * be created this way. Question/answer ids end up exactly `q_${index}`/`a_${qIndex}_${aIndex}`
 * (`processTalkForm`, ui-manager.ts), fully deterministic from array position, so callers that
 * need to answer by id afterward can compute them without reading back `talkData`.
 */
export async function createFlowOrSurveyTalkViaEditor(
  page: Page,
  opts: CreateFlowOrSurveyTalkViaEditorOpts,
): Promise<{ title: string; talkId: string; talkData: any }> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  // A transient toast (e.g. "Talk saved...", an incoming-talk notification) can momentarily
  // intercept this click in a busy/heavily-seeded session — Playwright's own retry already
  // handles it once the toast fades; `timeoutMs` just widens the retry budget for a caller
  // that knows its page is unusually noisy.
  await page.click('#create-talk-btn', { timeout: opts.timeoutMs });
  await page.waitForSelector('#talk-editor-form');

  await page.fill('#talk-title', opts.title);
  await selectTalkEditorType(page, opts.type);

  // One question is pre-seeded; add the rest up front so `.answer-next`'s "Go to Question N"
  // options are already correct (they're recomputed from the live total question count) by the
  // time answer values are picked below.
  for (let i = 1; i < opts.questions.length; i++) {
    await page.click('#add-question-btn');
  }

  for (let qIndex = 0; qIndex < opts.questions.length; qIndex++) {
    const qSpec = opts.questions[qIndex];
    const qItem = page.locator(`.question-item[data-question-index="${qIndex}"]`);
    await qItem.locator('.question-text').fill(qSpec.text);
    if (qSpec.answerSelectionMode === 'multiple') {
      await qItem.locator('.answer-selection-mode').selectOption('multiple');
    }
    if (qSpec.reciprocalTagContext) {
      await qItem.locator('.question-reciprocal-tag').setChecked(true, { force: true });
    }
    for (let aIndex = 2; aIndex < qSpec.answers.length; aIndex++) {
      await qItem.locator('.btn-add-answer').click();
    }
    // `.answer-next`'s own option list only offers 'noticed' (match) on the LAST question (or
    // any 'multiple'-mode question, always treated as terminal) — `updateAllAnswerDropdowns`,
    // talk-editor-form-helpers.ts. Every earlier question must chain forward instead.
    const isLastQuestion = qSpec.answerSelectionMode === 'multiple' || qIndex === opts.questions.length - 1;
    for (let aIndex = 0; aIndex < qSpec.answers.length; aIndex++) {
      const aSpec = qSpec.answers[aIndex];
      const aItem = qItem.locator(`.answer-item[data-answer-index="${aIndex}"]`);
      const answerTextInput = aItem.locator('.answer-text');
      const nextValue =
        aSpec.outcome === 'ignore' ? 'ignore' : isLastQuestion ? 'noticed' : `q_${qIndex + 1}`;
      // docs/TODO.md §LL.2 follow-up: a Simple/Pair tag question hides every answer row beyond
      // the first (talk-editor-form-helpers.ts's applyTagKindVisibilityToQuestion) — neither
      // .fill() nor .selectOption() can reach a hidden row, so set both directly via the DOM.
      if (await answerTextInput.isVisible()) {
        await answerTextInput.fill(aSpec.text);
        await aItem.locator('.answer-next').selectOption(nextValue);
      } else {
        await aItem.evaluate((item: HTMLElement, args: { text: string; next: string }) => {
          const textInput = item.querySelector('.answer-text') as HTMLInputElement | null;
          if (textInput) {
            textInput.value = args.text;
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const nextSelect = item.querySelector('.answer-next') as HTMLSelectElement | null;
          if (nextSelect) {
            nextSelect.value = args.next;
            nextSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { text: aSpec.text, next: nextValue });
      }
    }
    // Second pass, after every `.answer-next` is settled: selecting "Noticed (match)" for an
    // answer auto-checks that SAME answer's own self-answer radio as a convenience default
    // (addAnswerToQuestion's own change listener, talk-editor-form-helpers.ts) — with more than
    // one 'match' answer on a question, whichever was selected last wins that radio group. Any
    // answer this spec explicitly marks `self` must be (re-)checked after all of those defaults
    // have already fired, or a later sibling's own auto-check silently steals it.
    for (let aIndex = 0; aIndex < qSpec.answers.length; aIndex++) {
      const aSpec = qSpec.answers[aIndex];
      if (aSpec.self) {
        await qItem.locator(`.answer-item[data-answer-index="${aIndex}"] .self-answer-radio`).check();
      }
    }
  }

  if (opts.expiresOption) await page.selectOption('#talk-expires', opts.expiresOption);
  if (opts.locationRadiusMiles) await page.selectOption('#talk-location-radius', opts.locationRadiusMiles);
  if (opts.isAdult) await page.locator('#talk-is-adult').setChecked(true, { force: true });
  if (opts.attachment) {
    await page.locator('#talk-attachment-input').setInputFiles({
      name: opts.attachment.name,
      mimeType: opts.attachment.mimeType,
      buffer: opts.attachment.buffer,
    });
  }
  // Delivery stays explicit (broadcast step owned by the caller), matching the script-supplied
  // helpers this replaces (`sendToChatroom: false`).
  await page.locator('#talk-send-to-chatroom').setChecked(false, { force: true });

  await submitTalkEditorAndWaitForOut(page, opts.title, opts.timeoutMs);
  return readCreatedTalkFromMyTalks(page, opts.title);
}

export type CreateTagTalkViaEditorOpts = {
  title: string;
  /** Whether the author's own self-answer is "match" (checked, default) or "ignore" (unchecked). */
  likesTag?: boolean;
  timeoutMs?: number;
};

/** Builds a tag talk through the real Talk Editor. The real editor hardcodes both the single
 *  question's text (= the title) and its two answer ids (`a_0_match`/`a_0_ignore`) regardless of
 *  author input — `processTalkForm`'s tag branch, ui-manager.ts — so there's nothing else to fill. */
export async function createTagTalkViaEditor(
  page: Page,
  opts: CreateTagTalkViaEditorOpts,
): Promise<{ title: string; talkId: string; talkData: any }> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  // A transient toast (e.g. "Talk saved...", an incoming-talk notification) can momentarily
  // intercept this click in a busy/heavily-seeded session — Playwright's own retry already
  // handles it once the toast fades; `timeoutMs` just widens the retry budget for a caller
  // that knows its page is unusually noisy.
  await page.click('#create-talk-btn', { timeout: opts.timeoutMs });
  await page.waitForSelector('#talk-editor-form');

  await page.fill('#talk-title', opts.title);
  await selectTalkEditorType(page, 'tag');
  const wantChecked = opts.likesTag !== false;
  await page.locator('#tag-like-checkbox').setChecked(wantChecked, { force: true });
  // `#talk-send-to-chatroom` is CSS `display:none` for the tag type (updateFormForType,
  // talk-editor-dialog.ts) — no bounding box, so even a forced Playwright click can't reach it.
  // `processTalkForm` still reads its `.checked` property at submit time regardless of
  // visibility, so set it directly.
  await page.evaluate(() => {
    const el = document.getElementById('talk-send-to-chatroom') as HTMLInputElement | null;
    if (el) el.checked = false;
  });

  await submitTalkEditorAndWaitForOut(page, opts.title, opts.timeoutMs);
  return readCreatedTalkFromMyTalks(page, opts.title);
}

/** Converts a script-authored `Talk.questions` array (author-typed semantic ids like `bg_mc`)
 *  into the shape `createFlowOrSurveyTalkViaEditor` needs, and a positional id map so tests that
 *  used to reference the original ids can translate them to the real UI-generated ones
 *  (`a_${qIndex}_${aIndex}`) after switching that talk's creation over to the real editor. */
export function talkQuestionsToUiSpec(questions: any[]): UiTalkQuestionSpec[] {
  return questions.map((q: any) => ({
    text: String(q.text || ''),
    answerSelectionMode: q.answerSelectionMode,
    answers: (q.answers || []).map((a: any) => ({
      text: String(a.text || ''),
      outcome: a.isIgnore ? 'ignore' : a.nextQuestionId ? ('next' as const) : ('match' as const),
    })),
  }));
}

export function buildPositionalAnswerIdMap(originalQuestions: any[]): Record<string, string> {
  const map: Record<string, string> = {};
  originalQuestions.forEach((q: any, qIdx: number) => {
    (q.answers || []).forEach((a: any, aIdx: number) => {
      map[String(a.id)] = `a_${qIdx}_${aIdx}`;
    });
  });
  return map;
}

export type UiRouteAnswerSpec =
  | { text: string; outcome: 'match' | 'ignore' }
  | { text: string; child: UiRouteNodeSpec };

export type UiRouteNodeSpec = {
  text: string;
  answers: UiRouteAnswerSpec[];
  /** docs/TODO.md §LL follow-up: checks the editor's per-question `.route-question-reciprocal-
   *  tag` checkbox — only meaningful (matching engine side) with exactly one non-`ignore`
   *  answer, i.e. a single `{child}` or `{outcome:'match'}` answer alongside the seeded
   *  `{outcome:'ignore'}` default; no special answer count needed. */
  reciprocalTagContext?: boolean;
};

export type CreateRouteTalkViaEditorOpts = {
  title: string;
  root: UiRouteNodeSpec;
  matchThreshold?: number;
  expiresOption?: '' | '1d' | '1w' | '1M' | '1y';
  locationRadiusMiles?: '' | '10' | '100' | '1000';
  timeoutMs?: number;
};

/**
 * Builds an arbitrary route (DAG) talk through the real Talk Editor's tree UI
 * (`.route-question-text`/`.route-answer-text`/`.route-add-answer-btn`/`.route-add-child-btn`,
 * ui-manager.ts's `renderRouteEditor`), recursively — one call site for every route-shaped e2e
 * talk instead of a script-supplied payload. Answer ids are discovered by DOM diff after each
 * "add child" click rather than predicted from the app's internal question-count counter, so
 * this stays correct even if that internal numbering ever changes.
 *
 * A freshly-opened route editor seeds every question with exactly 2 answers, ids
 * `${qid}_match`/`${qid}_ignore` — matching `node.answers[0]`/`node.answers[1]`. A 3rd+ answer
 * (via "+ Add Answer") gets id `${qid}_a${index}` (`renderRouteEditor`'s add-answer handler).
 */
export async function createRouteTalkViaEditor(
  page: Page,
  opts: CreateRouteTalkViaEditorOpts,
): Promise<{ title: string; talkId: string; talkData: any }> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  // A transient toast (e.g. "Talk saved...", an incoming-talk notification) can momentarily
  // intercept this click in a busy/heavily-seeded session — Playwright's own retry already
  // handles it once the toast fades; `timeoutMs` just widens the retry budget for a caller
  // that knows its page is unusually noisy.
  await page.click('#create-talk-btn', { timeout: opts.timeoutMs });
  await page.waitForSelector('#talk-editor-form');

  await page.fill('#talk-title', opts.title);
  await selectTalkEditorType(page, 'route');
  await expect(page.locator('#route-editor')).toBeVisible();

  const addChildAndGetId = async (qid: string, aid: string): Promise<string> => {
    const before = await page
      .locator('.route-question-text')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-qid')));
    await page.locator(`.route-add-child-btn[data-qid="${qid}"][data-aid="${aid}"]`).click();
    await page.waitForFunction(
      (prevCount) => document.querySelectorAll('.route-question-text').length > prevCount,
      before.length,
    );
    const after = await page
      .locator('.route-question-text')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-qid')));
    const newId = after.find((id) => !before.includes(id));
    if (!newId) throw new Error(`route add-child for ${qid}/${aid} did not produce a new question`);
    return newId;
  };

  const fillNode = async (qid: string, node: UiRouteNodeSpec): Promise<void> => {
    await page.locator(`.route-question-text[data-qid="${qid}"]`).fill(node.text);
    if (node.reciprocalTagContext) {
      await page.locator(`.route-question-reciprocal-tag[data-qid="${qid}"]`).setChecked(true, { force: true });
    }
    for (let i = 2; i < node.answers.length; i++) {
      await page.locator(`.route-add-answer-btn[data-qid="${qid}"]`).click();
    }
    for (let i = 0; i < node.answers.length; i++) {
      // The seeded root's first two answers keep the editor's original `a_0_*` naming (from
      // before per-question child ids existed); every other node — and the root's own 3rd+
      // answer, added via "+ Add Answer" same as any other node — uses `${qid}_*`.
      const aid =
        qid === 'q_0' && i === 0
          ? 'a_0_match'
          : qid === 'q_0' && i === 1
            ? 'a_0_ignore'
            : i === 0
              ? `${qid}_match`
              : i === 1
                ? `${qid}_ignore`
                : `${qid}_a${i}`;
      const spec = node.answers[i]!;
      await page.locator(`.route-answer-text[data-qid="${qid}"][data-aid="${aid}"]`).fill(spec.text);
      if ('child' in spec) {
        const childId = await addChildAndGetId(qid, aid);
        await fillNode(childId, spec.child);
      }
    }
  };
  await fillNode('q_0', opts.root);

  if (opts.matchThreshold != null) await page.fill('#talk-match-threshold', String(opts.matchThreshold));
  if (opts.expiresOption) await page.selectOption('#talk-expires', opts.expiresOption);
  if (opts.locationRadiusMiles) await page.selectOption('#talk-location-radius', opts.locationRadiusMiles);
  await page.locator('#talk-send-to-chatroom').setChecked(false, { force: true });

  await submitTalkEditorAndWaitForOut(page, opts.title, opts.timeoutMs);
  return readCreatedTalkFromMyTalks(page, opts.title);
}

/** Converts a script-authored route `Talk.questions` array (`nextQuestionId` chain, author-typed
 *  ids) into the `UiRouteNodeSpec` tree `createRouteTalkViaEditor` needs — reuses an existing
 *  shared payload's wording instead of re-typing it, while creation itself still goes through
 *  the real editor. */
export function talkRouteQuestionsToUiSpec(questions: any[], qid: string = questions[0]?.id ?? 'q_0'): UiRouteNodeSpec {
  const byId = new Map(questions.map((q: any) => [q.id, q]));
  const q = byId.get(qid);
  if (!q) throw new Error(`talkRouteQuestionsToUiSpec: question "${qid}" not found`);
  return {
    text: String(q.text || ''),
    answers: (q.answers || []).map((a: any) => {
      if (a.nextQuestionId) {
        return { text: String(a.text || ''), child: talkRouteQuestionsToUiSpec(questions, a.nextQuestionId) };
      }
      return { text: String(a.text || ''), outcome: a.isIgnore ? 'ignore' : 'match' };
    }),
  };
}

/** DFS pre-order over a route talk's `questions` (root first, then each answer's `nextQuestionId`
 *  chain before moving to the next answer) — the same order `createRouteTalkViaEditor`'s
 *  recursive `fillNode` visits, so a script-authored tree and its real-editor-created equivalent
 *  line up index-for-index even though the editor assigns its own ids. */
function flattenRouteQuestionsDfs(
  questions: any[],
  rootId: string = questions[0]?.id ?? 'q_0',
): Array<{ questionId: string; answerIds: string[] }> {
  const byId = new Map(questions.map((q: any) => [q.id, q]));
  const out: Array<{ questionId: string; answerIds: string[] }> = [];
  const visit = (qid: string): void => {
    const q = byId.get(qid);
    if (!q) return;
    out.push({ questionId: qid, answerIds: (q.answers || []).map((a: any) => String(a.id)) });
    for (const a of q.answers || []) {
      if (a.nextQuestionId) visit(a.nextQuestionId);
    }
  };
  visit(rootId);
  return out;
}

/** Maps a script-authored route talk's semantic answer ids (`a_role_rec`, ...) to the real
 *  UI-generated ids (`q_2_match`, ...) of the equivalent talk built via `createRouteTalkViaEditor`
 *  from `talkRouteQuestionsToUiSpec(originalQuestions)` — lets existing scenario/answer-id tables
 *  keep referencing the original wording's ids after switching that talk's creation to the editor. */
export function buildRouteAnswerIdMap(originalQuestions: any[], createdQuestions: any[]): Record<string, string> {
  const original = flattenRouteQuestionsDfs(originalQuestions);
  const created = flattenRouteQuestionsDfs(createdQuestions);
  const map: Record<string, string> = {};
  original.forEach((node, i) => {
    const createdNode = created[i];
    if (!createdNode) return;
    node.answerIds.forEach((aid, j) => {
      const createdAid = createdNode.answerIds[j];
      if (createdAid) map[aid] = createdAid;
    });
  });
  return map;
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
 * Seed a TalkLedger outcome entry directly into the browser's localStorage.
 *
 * Replaces the now-deleted POST /api/stats/talks/:id/record server endpoint.
 * Stats are local-only since P0 Step 7; this helper writes the authoritative
 * `talkLedger` localStorage key so that:
 *   - app.ts `needTalkStats` shows the correct "Responses: N" count in the UI
 *   - summarize() / buildAllLocalTalkResponses() produce correct output
 *
 * @param page         Browser page where the app is running (authorId is read from the app)
 * @param talkId       The talk's ID
 * @param responderId  Synthetic responder ID (e.g. 'stats-jerry')
 * @param ledgerOutcome 'matched' | 'ignored' | 'other' (TalkLedger outcome, not TalkResponse outcome)
 */
export async function seedTalkLedgerOutcome(
  page: Page,
  talkId: string,
  responderId: string,
  ledgerOutcome: 'matched' | 'ignored' | 'other' = 'other',
): Promise<void> {
  await page.evaluate(
    ({ talkId, responderId, ledgerOutcome }) => {
      const authorId: string =
        (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? 'unknown-author';
      const key = `${responderId}::${talkId}::${authorId}`;
      const now = new Date().toISOString();
      const raw = localStorage.getItem('talkLedger');
      const doc: any = raw
        ? JSON.parse(raw)
        : { version: 1, outcomes: {}, exchanged: {}, edges: {}, retracted: {} };
      doc.outcomes[key] = {
        responderId,
        talkId,
        authorId,
        identityKey: `${talkId}::${authorId}`,
        outcome: ledgerOutcome,
        version: 1,
        responseId: `seed::${key}`,
        respondedAt: now,
        updatedAt: now,
      };
      localStorage.setItem('talkLedger', JSON.stringify(doc));
    },
    { talkId, responderId, ledgerOutcome },
  );
}

/**
 * Seed a LocalTalkExchange record directly into the browser's localStorage.
 *
 * This populates the `localTalkExchanges` key which drives:
 *   - The contextual stats strip (#talks-stats-strip, #contacts-stats-strip, etc.)
 *   - Survey stats dialog (showSurveyStatsDialog)
 *   - displayStatisticsDashboard (unified creator dashboard)
 *
 * Direction is always 'sent' (author side) so buildAllLocalTalkResponses picks it up.
 */
export async function seedLocalTalkExchange(
  page: Page,
  talkId: string,
  opts: {
    responderId?: string;
    outcome?: 'match' | 'mismatch' | 'ignore';
    talkType?: string;
    answers?: Array<{ questionId: string; answerId: string; answerText?: string }>;
    region?: string;
  } = {},
): Promise<void> {
  await page.evaluate(
    ({ talkId, opts }) => {
      const responderId = opts.responderId || `seed-responder-${Math.random().toString(36).slice(2, 7)}`;
      const key = `${responderId}::${talkId}`;
      const now = new Date().toISOString();
      const raw = localStorage.getItem('localTalkExchanges');
      const store: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      store[key] = {
        peerId: responderId,
        peerName: responderId,
        talkId,
        title: `Seeded talk ${talkId}`,
        type: opts.talkType || 'survey',
        outcome: opts.outcome || 'mismatch',
        direction: 'sent',
        date: now,
        respondedAt: now,
        answers: opts.answers || [],
        responseId: `seed::${key}::${Date.now()}`,
        version: 1,
        language: 'en',
        region: opts.region || 'unknown',
      };
      localStorage.setItem('localTalkExchanges', JSON.stringify(store));
    },
    { talkId, opts },
  );
}

/**
 * @deprecated The server-side stats record endpoint was removed in P0 Step 7.
 *   Use seedTalkLedgerOutcome() to seed local ledger state instead.
 *   Kept for reference during migration.
 */
export async function recordTalkStatsByAnswerIds(
  page: Page,
  talkId: string,
  talkData: any,
  responderId: string,
  answerIds: string[],
  outcome: 'match' | 'ignore' | 'other' = 'other',
): Promise<void> {
  // Map TalkResponse outcome to TalkLedger outcome and delegate to local seeding.
  const ledgerOutcome = outcome === 'match' ? 'matched' : outcome === 'ignore' ? 'ignored' : 'other';
  await seedTalkLedgerOutcome(page, talkId, responderId, ledgerOutcome as 'matched' | 'ignored' | 'other');
}

/**
 * Fast UI-side completion: bypass repeated modal clicks while still using UIManager.completeTalk,
 * so local "Answers" state and the app's pair-direct submission path both run.
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
  if (isMeshTalkDeliveryE2e()) return;
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
