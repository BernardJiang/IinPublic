/**
 * 74 — Answering multiple tag talks each records the right outcome (regression).
 *
 * Adam broadcasts three DISTINCT tag talks. Bob opens each response dialog, checks Match, and
 * submits. Before the fix, the tag dialog read its checkbox via a fixed-id
 * document.getElementById, so a second stacked modal read the first modal's unchecked box and
 * recorded a Match as a mismatch. This asserts dialogs don't stack and all three record match.
 *
 * See companion 74-multi-tag-match.md for a plain-English description.
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterLoad, afterSync, afterAction } from '../../helpers/timing';
import { bootstrapUser, ensureMeshNeighbors } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../../helpers/ports';

const E2E_TIMEOUT_MS = 30_000;

test.describe('Multiple tag talks each record the right outcome', () => {
  const browsers: Browser[] = [];
  let contextAdam: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(240_000);
    await maybeClearGunDatabases();
    const mk = (x: number) => ({
      headless: !!process.env.CI,
      args: [`--window-position=${x},40`, '--window-size=640,1200', '--force-device-scale-factor=1', ...WEBRTC_CHROMIUM_ARGS],
    });
    const [adam, bob] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(680))]);
    browsers.push(adam, bob);
  });

  test.afterAll(async () => {
    await Promise.all([contextAdam, contextBob].map((c) => c?.close().catch(() => {})));
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    await maybeClearGunDatabases();
  });

  test('Bob matches three distinct tag talks; none flip to mismatch', async () => {
    test.setTimeout(240_000);
    void webAppURLStableChatroom();
    const [adamResult, bobResult] = await Promise.all([
      bootstrapUser(browsers[0], 'Adam', 'Adam'),
      bootstrapUser(browsers[1], 'Bob', 'Bob'),
    ]);
    contextAdam = adamResult.context;
    contextBob = bobResult.context;
    pageAdam = adamResult.page;
    pageBob = bobResult.page;
    await afterLoad();

    const idOf = (p: Page) => p.evaluate(() =>
      String((window as any).__iinpublic_app.getApp().currentUser?.id || ''));
    const [adamId, bobId] = await Promise.all([idOf(pageAdam), idOf(pageBob)]);
    await afterSync();
    await ensureMeshNeighbors([
      { label: 'Adam', page: pageAdam, otherIds: [bobId] },
      { label: 'Bob', page: pageBob, otherIds: [adamId] },
    ]);

    const adamEpub = await pageAdam.evaluate(() =>
      String((window as any).__iinpublic_app.getApp().gunService.getStoredPair()?.epub || ''));
    const stamp = Date.now();
    const talks = ['Dogs', 'Cats', 'Birds'].map((topic, i) => ({
      id: `tag-${topic.toLowerCase()}-${stamp}-${i}`,
      type: 'tag',
      title: topic,
      authorId: adamId,
      authorName: 'Adam',
      authorEpub: adamEpub,
      questions: [{ id: 'q1', text: `Do you like ${topic.toLowerCase()}?`, answers: [
        { id: 'a-match', text: 'Yes', isMatch: true },
        { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true }] }],
    }));

    // Adam caches + broadcasts all three distinct tag talks.
    await pageAdam.evaluate(async ({ defs }) => {
      const a = (window as any).__iinpublic_app.getApp();
      const mt = JSON.parse(localStorage.getItem('myTalks') || '{}');
      for (const def of defs) {
        a.peerMeshService.cacheTalkBody(def.id, def);
        mt[def.id] = { role: 'created', fullTalk: def };
        await a.peerMeshService.broadcastTalk(def, { roomBroadcast: true });
      }
      localStorage.setItem('myTalks', JSON.stringify(mt));
    }, { defs: talks });
    await afterAction();

    // Bob caches the bodies so the response dialog can render them.
    await pageBob.evaluate(({ defs }) => {
      const a = (window as any).__iinpublic_app.getApp();
      for (const def of defs) a.peerMeshService.cacheTalkBody(def.id, def);
    }, { defs: talks });

    const openDialog = (talk: any) => pageBob!.evaluate((t) => {
      (window as any).__iinpublic_app.getApp().uiManager.showTalkResponseDialog(t, { skipAutoAnswer: true });
    }, talk);

    // Stacking guard: opening a second dialog while one is open leaves exactly one modal.
    await openDialog(talks[0]);
    await expect(pageBob.locator('#talk-response-modal')).toHaveCount(1);
    await openDialog(talks[1]);
    await expect(pageBob.locator('#talk-response-modal')).toHaveCount(1);
    await expect(pageBob.locator('#talk-response-modal')).toContainText('cats');

    // Answer all three: check Match, submit. Each must record independently.
    for (const talk of talks) {
      await openDialog(talk);
      await expect(pageBob.locator('#tag-match-checkbox')).toBeVisible({ timeout: E2E_TIMEOUT_MS });
      await pageBob.check('#tag-match-checkbox');
      await pageBob.click('#tag-submit-response');
      await expect(pageBob.locator('#talk-response-modal')).toHaveCount(0, { timeout: E2E_TIMEOUT_MS });
      await afterAction();
    }

    // Bob's local exchanges: all three talks recorded as match, none as mismatch.
    const outcomes = await pageBob.evaluate(({ ids }) => {
      const ex = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
      return ids.map((id: string) => {
        const entry = Object.entries(ex).find(([k]) => k.endsWith(`::${id}`));
        return (entry?.[1] as any)?.outcome ?? 'none';
      });
    }, { ids: talks.map((t) => t.id) });
    expect(outcomes, 'all three tag talks must record as match').toEqual(['match', 'match', 'match']);

    // Adam sees three matched exchanges with Bob (one per talk).
    await expect
      .poll(() => pageAdam!.evaluate(({ pid }) => {
        const ex = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        return Object.entries(ex).filter(([k, v]: [string, any]) =>
          k.startsWith(`${pid}::`) && v?.outcome === 'match').length;
      }, { pid: bobId }), { timeout: E2E_TIMEOUT_MS, message: 'Adam should see three matched tag exchanges' })
      .toBe(3);
  });
});
