/**
 * 97 — OPEN-108 slice 6: the signed exchange chain proven by two browsers, and the tamper report.
 *
 * Tom offers a tag Talk to Jerry over the graph link (a signed, hash-linked pair-log entry);
 * Jerry answers through the real responder path. Both sides' `__iinpublic_graph_status()` then
 * prove the exchange: `chain.ok === true` on each device, and Tom's link to Jerry carries her
 * signed acknowledgement (`lastAck`). Then one of TOM's OWN chained events (the Talk version
 * event `local/ev/<talkId>`) is tampered in the worker's IndexedDB, the page is reloaded, and
 * the restarted core must report `chain.chainBreaks === 1` with the tampered event's
 * `firstBadSeq` (reason `sig`) — reported, never repaired.
 *
 * Harness seams (quiesce-then-tamper, IDB write instead of a Gun put, plain reload as the
 * restart) are documented in the companion 97-signed-exchange-chain.md.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, afterLoad, afterSync, reloadAppReady } from '../../helpers/timing';
import { bootstrapUser, ensureMeshNeighbors } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { newGraphTalkId, expectGraphEvent, expectGraphAnswerHistory } from '../../helpers/device-graph';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `graph.status` as the page exposes it (graph-host.ts GraphHostStatus). */
type GraphStatus = {
  userId?: string;
  links: Array<{
    peerUserId: string; open: boolean; sentUpTo: number; appliedUpTo: number;
    theirRead?: number; lastAck?: { n: number; when: number; skewMs: number };
  }>;
  chain?: { ok: boolean; checked: number; chainBreaks: number; firstBadSeq?: number; reason?: string };
};

const graphStatus = (page: Page): Promise<GraphStatus | null> =>
  page.evaluate(() => (window as any).__iinpublic_graph_status?.() ?? null);

/** The device id embedded in a graph event id (`<when,13>-<deviceId,32 hex>-<counter,base36>`). */
const deviceIdOf = (eventId: string): string => eventId.split('-')[1] || '';

/**
 * Rewrite one field of one stored event in the worker's IndexedDB (`gun-idb`/`nodes`), bypassing
 * every app-layer write path. Radisk persists the whole graph as JSON radix trees (one record per
 * file, leaf `{':': value, '>': state}` at key `<soul>\x1b<field>`); the worker's Gun reloads from
 * here on restart, so the edit is exactly what a "local event was rewritten under me" check reads.
 * Returns the tampered event's seq (its expected `firstBadSeq`) and the before/after values.
 */
async function tamperEventField(
  page: Page,
  soul: string,
  field: string,
): Promise<{ seq: number; device: string; before: unknown; after: unknown }> {
  return page.evaluate(async ({ soul, field }) => {
    const ESC = String.fromCharCode(27);
    const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
      const request = indexedDB.open('gun-idb', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const idbGet = (store: IDBObjectStore, key: IDBValidKey): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    // Collect every stored leaf of the target soul: full radisk key → { file, tree, leaf }.
    const leavesOf = (tree: any, soulPrefix: string): Array<{ leaf: any; key: string }> => {
      const found: Array<{ leaf: any; key: string }> = [];
      const walk = (node: any, path: string): void => {
        if (!node || typeof node !== 'object') return;
        for (const [fragment, child] of Object.entries(node)) {
          if (fragment === '' || fragment === '_') continue;
          const next = path + fragment;
          if (!soulPrefix.startsWith(next) && !next.startsWith(soulPrefix)) continue;
          const branch: any = child;
          if (!branch || typeof branch !== 'object') continue;
          if (Object.prototype.hasOwnProperty.call(branch, '') && next.startsWith(soulPrefix)) {
            const leaf = branch[''];
            if (leaf && typeof leaf === 'object' && ':' in leaf) found.push({ leaf, key: next });
          }
          walk(branch, next);
        }
      };
      walk(tree, '');
      return found;
    };

    const db = await openDb();
    try {
      const scanTx = db.transaction('nodes', 'readonly');
      const store = scanTx.objectStore('nodes');
      const files = (await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })).map(String);

      const soulPrefix = `${soul}${ESC}`;
      let hit: { file: string; tree: any; leaves: Array<{ leaf: any; key: string }> } | null = null;
      for (const file of files) {
        const raw = await idbGet(store, file);
        let tree: any = raw;
        if (typeof raw === 'string') {
          try { tree = JSON.parse(raw); } catch { continue; }
        }
        if (!tree || typeof tree !== 'object') continue;
        const leaves = leavesOf(tree, soulPrefix);
        if (leaves.length) { hit = { file, tree, leaves }; break; }
      }
      if (!hit) throw new Error(`tamper: no stored leaves under ${soulPrefix} (files: ${files.join(', ') || 'none'})`);

      const at = (suffix: string) => hit!.leaves.find(({ key }) => key === `${soulPrefix}${suffix}`)?.leaf?.[':'];
      const seq = at('seq');
      const device = String(at('device') ?? '');
      if (typeof seq !== 'number') throw new Error(`tamper: ${soul} has no chained seq (not my chained event?)`);
      const target = hit.leaves.find(({ key }) => key === `${soulPrefix}${field}`)?.leaf;
      if (!target) throw new Error(`tamper: ${soul} has no stored field ${field}`);
      const before = target[':'];
      const after = `HACKED ${String(before)}`;
      target[':'] = after;

      await new Promise<void>((resolve, reject) => {
        const writeTx = db.transaction('nodes', 'readwrite');
        writeTx.objectStore('nodes').put(JSON.stringify(hit!.tree), hit!.file);
        writeTx.oncomplete = () => resolve();
        writeTx.onerror = () => reject(writeTx.error);
        writeTx.onabort = () => reject(writeTx.error);
      });
      return { seq, device, before, after };
    } finally {
      db.close();
    }
  }, { soul, field });
}

test.describe('Signed exchange chain + tamper report (OPEN-108 slice 6)', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100', ...WEBRTC_CHROMIUM_ARGS] });
    browserJerry = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100', ...WEBRTC_CHROMIUM_ARGS] });
  });

  test.afterAll(async () => {
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('each side proves the other\'s signed entry and ack; a tampered event is reported after restart', async () => {
    test.setTimeout(240_000);

    // ── 1. Bootstrap Tom and Jerry in the same stable chatroom ──────────────
    const [tom, jerry] = await Promise.all([
      bootstrapUser(browserTom, 'ChainTom', 'ChainTom'),
      bootstrapUser(browserJerry, 'ChainJerry', 'ChainJerry'),
    ]);
    contextTom = tom.context;
    contextJerry = jerry.context;
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    await afterLoad();

    const idOf = (p: Page) => p.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    const [tomId, jerryId] = await Promise.all([idOf(pageTom), idOf(pageJerry)]);
    expect(tomId && jerryId).toBeTruthy();

    // ── 2. Connect the mesh so the graph link opens between them ────────────
    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId] },
    ]);
    for (const [label, page, peerId] of [['Tom', pageTom, jerryId], ['Jerry', pageJerry, tomId]] as const) {
      await expect
        .poll(async () => (await graphStatus(page))?.links.some((l) => l.peerUserId === peerId && l.open) ?? false,
          { timeout: 30_000, message: `${label}: graph link to ${peerId.slice(0, 8)} never opened` })
        .toBe(true);
    }
    await afterSync();

    // ── 3. Tom authors a tag Talk and offers it to Jerry over the graph link ─
    const TALK_ID = await newGraphTalkId(pageTom);
    const TALK_TITLE = 'chain-e2e tag';
    const tomEpub = await pageTom.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.epub ?? '');
    expect(tomEpub).toBeTruthy();
    const talkDef = {
      id: TALK_ID,
      authorId: tomId,
      title: TALK_TITLE,
      type: 'tag',
      authorEpub: tomEpub,
      questions: [{
        id: 'q1',
        text: 'Signed exchange chain check?',
        answers: [
          { id: 'a-match', text: 'Proven', isMatch: true },
          { id: 'a-ignore', text: 'Skip', isMatch: false, isIgnore: true },
        ],
      }],
    };
    await pageTom.evaluate(async ({ def, to }) => {
      const app = (window as any).__iinpublic_app.getApp();
      app.peerMeshService?.cacheTalkBody?.(def.id, def);
      const myTalks = ((window as any).__iinpublic_collection?.('myTalks') ?? {});
      myTalks[def.id] = { role: 'created', title: def.title, fullTalk: def };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
      await app.offerTalkForE2e(def, [to]);
    }, { def: talkDef, to: jerryId });
    await afterAction();

    // Jerry's core applies Tom's signed offer entry: the Talk arrives over the graph link.
    await expectGraphEvent(pageJerry, 'Jerry', 'talk', tomId);

    // ── 4. Jerry answers MATCH through the real responder path (graph.answer) ─
    await pageJerry.evaluate(async ({ def, authorName }) => {
      const app = (window as any).__iinpublic_app.getApp();
      app.peerMeshService?.cacheTalkBody?.(def.id, def);
      await app.submitTalkResponsePairDirect({
        talkId: def.id,
        talkData: { ...def, authorName },
        answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Proven', mode: 'manual', isMatch: true }],
        isChatbotResponse: false,
        authorId: def.authorId,
        authorName,
        isAutoResponse: false,
      });
    }, { def: talkDef, authorName: 'ChainTom' });
    await afterAction();

    // Tom's core applies Jerry's signed answer entry; Jerry's answer is durable in her graph.
    await expectGraphEvent(pageTom, 'Tom', 'answer', jerryId);
    await expectGraphAnswerHistory(pageJerry, 'Jerry', tomId);

    // ── 5. Each side proves the other's signed entry and acknowledgement ─────
    // Tom: my own chain verifies, and Jerry's signed ack of my log entries is in.
    await expect
      .poll(async () => {
        const status = await graphStatus(pageTom);
        const link = status?.links.find((l) => l.peerUserId === jerryId);
        return { chainOk: status?.chain?.ok, ack: link?.lastAck?.n };
      }, { timeout: 60_000, message: 'Tom: chain not ok or no signed ack from Jerry yet' })
      .toMatchObject({ chainOk: true, ack: expect.any(Number) });
    const tomStatus = await graphStatus(pageTom);
    expect(tomStatus?.chain?.ok, 'Tom: event chain verifies').toBe(true);
    const tomLink = tomStatus?.links.find((l) => l.peerUserId === jerryId);
    expect(tomLink?.open, 'Tom: graph link to Jerry open').toBe(true);
    expect(typeof tomLink?.lastAck?.n, `Tom: Jerry's signed acknowledgement (lastAck) missing: ${JSON.stringify(tomLink)}`)
      .toBe('number');
    expect(tomLink!.lastAck!.n).toBeGreaterThanOrEqual(0);
    expect(typeof tomLink!.lastAck!.skewMs).toBe('number');

    // Jerry: her own chain verifies as well.
    await expect
      .poll(async () => (await graphStatus(pageJerry))?.chain?.ok,
        { timeout: 30_000, message: 'Jerry: chain not ok' })
      .toBe(true);

    // ── 6. Quiesce both pages, then tamper with TOM's OWN Talk version event ─
    // manualCleanup stops the mesh and every poll timer, so the worker's radisk flushes its
    // final batch and schedules nothing more — nothing can rewrite the original value over
    // the tampered record before the reload kills the worker.
    await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup()).catch(() => {});
    await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup()).catch(() => {});
    await pageTom.waitForTimeout(1_000);

    const eventSoul = `local/ev/${TALK_ID}`;
    const tampered = await tamperEventField(pageTom, eventSoul, 'title');
    expect(tampered.device, 'tampered event is one Tom\'s own device chained').toBe(deviceIdOf(TALK_ID));
    expect(String(tampered.before)).toBe(TALK_TITLE);
    expect(String(tampered.after)).toContain('HACKED');

    // ── 7. Restart (reload: worker + Gun boot from the tampered IndexedDB) ───
    await reloadAppReady(pageTom);

    // ── 8. The restarted core reports the tampered event, never repairs it ───
    await expect
      .poll(async () => (await graphStatus(pageTom))?.chain ?? null,
        { timeout: 60_000, message: 'Tom after restart: chain never reported a break' })
      .toMatchObject({ ok: false, chainBreaks: 1, firstBadSeq: tampered.seq, reason: 'sig' });

    // Reported, never repaired: the tampered value is still what is stored.
    const storedTitle = await pageTom.evaluate(async () => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open('gun-idb', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<string>((resolve, reject) => {
          const request = db.transaction('nodes', 'readonly').objectStore('nodes').getAll();
          request.onsuccess = () => {
            const text = JSON.stringify(request.result ?? []);
            const match = text.includes('HACKED') ? 'HACKED present' : 'HACKED missing';
            resolve(match);
          };
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    expect(storedTitle).toBe('HACKED present');
  });
});
