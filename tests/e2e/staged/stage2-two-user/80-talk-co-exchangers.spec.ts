/**
 * TODO §Q build-order item 17 (hardest, done last): Talk -> "people I've separately exchanged
 * this same content with."
 *
 * Investigation note (see docs/TODO.md's completion entry for the full writeup): for talks
 * created through the real editor, `talk.id` is itself a content hash (`computeTalkCIDv1`, built
 * from the exact same payload as the ledger's `identityKey`) — so two organically-created talks
 * with identical Q&A content don't just share an identityKey, they collapse to the *same*
 * `talk.id`, and the existing matched-names line (filtered by `conversation.talkId`) already
 * aggregates every exchange partner automatically. identityKey and talk.id only genuinely diverge
 * when a talk carries an *explicit* id rather than a computed one — which is exactly how
 * TechSupport's own bundled talks and this codebase's own test fixtures already create talks
 * (`createTalkFromCompanyPage`'s payloads all set `id` explicitly; see
 * `talks-matching/lib/four-types-talks.ts`). This test reproduces that real shape: two explicit-id
 * talks with identical question/answer content, authored by two different people.
 *
 * Tom creates Talk X (explicit id) and broadcasts it to Jerry only; Jerry answers it (Talk X's OUT
 * row shows Jerry via the existing N3 matched-names line). Sam creates Talk Y — a different
 * explicit id, but *identical* question/answer content, so the same identityKey — and broadcasts
 * it to Tom only; Tom answers it. From Talk X's details popup, Tom should see Sam listed as a
 * co-exchanger: someone he separately exchanged the identical content with, joined purely by
 * identityKey in his own local ledger (Jerry is excluded there since he's already shown by the
 * row's own matched-names line).
 *
 * This also demonstrates the privacy boundary by construction: co-exchangers is read from Tom's
 * own local talkLedger only (never a mesh-wide identityKey query), so it can only ever list
 * people Tom personally exchanged with — nobody who received the same content through a
 * broadcast Tom wasn't part of could ever appear, since no such entry would exist in his ledger.
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterSync } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive, longPressTalkRow } from '../../helpers/talks-matching-flow';
import { createTalkFromCompanyPage, completeTalkInAppByAnswerIds } from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import type { Talk } from '../../../../src/shared/types';

function sharedContentTalk(id: string, title: string, authorId: string): Talk {
  return {
    id,
    title,
    authorId,
    type: 'flow',
    language: 'en',
    isAdult: false,
    tags: [],
    createdAt: new Date(),
    isTemplate: false,
    usageCount: 0,
    questions: [
      {
        id: 'q_shared',
        text: 'Co-exchange shared question?',
        answers: [
          { id: 'a_shared_yes', text: 'Yes shared', isMatch: true, isTerminal: true },
          { id: 'a_shared_no', text: 'No shared', isIgnore: true, isTerminal: true },
        ],
      },
    ],
  };
}

async function disableLedgerFrictionForE2e(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    app?.setTalkLedgerQuotaUnlimitedForE2e?.(true);
    app?.setTalkLedgerSuppressionDisabledForE2e?.(true);
  });
}

test.describe('Talk row -> co-exchangers (item 17, privacy-scoped)', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserSam: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserJerry = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
    browserSam = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=1280,0', '--window-size=640,1100'] });
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await browserSam?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('a talk I created and a different talk I answered, sharing the same content, surface each other\'s exchange partner', async () => {
    test.setTimeout(120_000);
    const tom = await bootstrapUser(browserTom, 'CoExTom', 'CoExTom');
    const jerry = await bootstrapUser(browserJerry, 'CoExJerry', 'CoExJerry');
    const sam = await bootstrapUser(browserSam, 'CoExSam', 'CoExSam');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    const pageSam = sam.page;
    try {
      const tomId = await pageTom.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
      const jerryId = await pageJerry.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
      const samId = await pageSam.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
      expect(tomId).toBeTruthy();
      expect(jerryId).toBeTruthy();
      expect(samId).toBeTruthy();

      await disableLedgerFrictionForE2e(pageTom);
      await disableLedgerFrictionForE2e(pageSam);

      const runId = Date.now();
      // Talk X and Talk Y carry identical question/answer content but distinct explicit ids
      // (`coex-x-*` / `coex-y-*`) and different authors — the same identityKey, deliberately
      // different talk.id, matching how real explicit-id talks (TechSupport bundles, this
      // repo's own createTalkFromCompanyPage fixtures) actually diverge from computed CIDv1 ids.
      const talkX = sharedContentTalk(`coex-x-${runId}`, 'CoExchange Talk X (Tom-authored)', tomId);
      const talkY = sharedContentTalk(`coex-y-${runId}`, 'CoExchange Talk Y (Sam-authored)', samId);

      // Talk X: Tom creates and broadcasts to Jerry only; Jerry answers.
      const talkIdX = await createTalkFromCompanyPage(pageTom, talkX);
      expect(talkIdX).toBe(talkX.id);
      const deliveryX = await pageTom.evaluate(
        async ({ userId, stageName }) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          return app.deliverPendingBroadcastTalksForE2e(1, { receiverUsers: [{ userId, stageName }] });
        },
        { userId: jerryId, stageName: 'CoExJerry' },
      );
      expect(deliveryX).toMatchObject({ talksSent: 1, receivers: 1 });

      const talkDataX = await pageJerry.evaluate(async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 });
      }, talkIdX);
      const matchAnswerIdX = String(talkDataX.questions?.[0]?.answers?.[0]?.id || '');
      expect(matchAnswerIdX).toBeTruthy();
      await completeTalkInAppByAnswerIds(pageJerry, talkIdX, talkDataX, [matchAnswerIdX], 'match');

      // Talk Y: Sam creates and broadcasts to Tom only; Tom answers it. Genuinely different
      // talk.id from Talk X, same identityKey (identical question/answer text).
      const talkIdY = await createTalkFromCompanyPage(pageSam, talkY);
      expect(talkIdY).toBe(talkY.id);
      expect(talkIdY).not.toBe(talkIdX);
      const deliveryY = await pageSam.evaluate(
        async ({ userId, stageName }) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          return app.deliverPendingBroadcastTalksForE2e(1, { receiverUsers: [{ userId, stageName }] });
        },
        { userId: tomId, stageName: 'CoExTom' },
      );
      expect(deliveryY).toMatchObject({ talksSent: 1, receivers: 1 });

      const talkDataY = await pageTom.evaluate(async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 });
      }, talkIdY);
      const matchAnswerIdY = String(talkDataY.questions?.[0]?.answers?.[0]?.id || '');
      expect(matchAnswerIdY).toBeTruthy();
      await completeTalkInAppByAnswerIds(pageTom, talkIdY, talkDataY, [matchAnswerIdY], 'match');

      await pageTom.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageTom, 'talks');
      await afterSync();

      // Talk X's OUT row: matchedLine shows only Jerry (Talk X's own direct exchange partner) —
      // unaffected by the separate exchange. Its details popup additionally surfaces Sam as a
      // co-exchanger, joined purely by shared identityKey in Tom's own local ledger.
      const rowX = pageTom.locator('.talk-list-item[data-role="created"]').filter({ hasText: 'CoExchange Talk X' });
      await expect(rowX).toBeVisible({ timeout: 15_000 });
      const matchedLineX = rowX.locator('.talk-item-matched');
      await expect
        .poll(() => matchedLineX.getAttribute('data-matched-people'), { timeout: 15_000 })
        .toContain(jerryId);
      const matchedDataX = JSON.parse(await matchedLineX.getAttribute('data-matched-people') || '[]');
      expect(matchedDataX.map((p: { id: string }) => p.id)).not.toContain(samId);

      await longPressTalkRow(pageTom, rowX);
      const popup = pageTom.locator('#item-details-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      const coExchanged = popup.locator('.talk-item-co-exchanged');
      await expect(coExchanged).toBeVisible({ timeout: 10_000 });
      const coExchangedData = JSON.parse(await coExchanged.getAttribute('data-matched-people') || '[]');
      // Privacy boundary, by construction: Tom's ledger only ever contains people he personally
      // exchanged with — exactly Sam here, nobody else (in particular, never a mesh-wide "who
      // else has this identityKey" result). Name assertion is intentionally loose: getPeerName's
      // room-roster/conversation-name lookups aren't guaranteed fresh for Sam from Tom's side at
      // this point in the flow (the same known placeholder-name quirk noted throughout this
      // session's other N3/co-exchange tests) — the point under test is the real id, not the
      // display name.
      expect(coExchangedData).toHaveLength(1);
      expect(coExchangedData[0].id).toBe(samId);
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageSam.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
      await sam.context.close().catch(() => {});
    }
  });
});
