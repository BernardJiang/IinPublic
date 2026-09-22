/**
 * Wire audit — does a talk exchange put talk CONTENT on the relay/server?
 *
 * Two browsers run the real flow (talk created through the app's own talk service, broadcast
 * through `announceTalkToRoom`, received over the mesh, answered through
 * `submitTalkResponsePairDirect`). Unique marker strings sit in the talk title, question text and
 * answer text. Every WebSocket frame and HTTP request/response each browser exchanges with the
 * hub is recorded, then scanned for the markers.
 *
 * The result is written to the test output as a report (`wire-report` attachment + console) so a
 * reader can see exactly WHICH channel carried WHICH marker.
 *
 * See companion 09-talk-content-not-on-hub-wire.md for a plain-English description.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage3Spec } from '../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync } from '../helpers/timing';
import { bootstrapUser, ensureMeshNeighbors, finalCleanupPages } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../helpers/ports';

const MESH_E2E_TIMEOUT_MS = 30_000;
const RUN = Date.now().toString(36).toUpperCase();
const MARKERS = {
  title: `ZQTITLE${RUN}`,
  question: `ZQQUESTION${RUN}`,
  answerYes: `ZQANSWERYES${RUN}`,
  answerNo: `ZQANSWERNO${RUN}`,
} as const;

type WireEvent = {
  who: string;
  channel: 'gun-ws-out' | 'gun-ws-in' | 'http-request' | 'http-response';
  where: string;
  size: number;
  markers: string[];
  /** Short excerpt around the first marker, so a leak can be located. */
  excerpt?: string;
  /** Gun records (souls) in the frame that carry a marker — which data type leaked. */
  souls?: string[];
};

/** Gun frames are JSON (or arrays of JSON): return the soul of every put-node containing a marker. */
function soulsCarryingMarkers(payload: string): string[] {
  const out = new Set<string>();
  try {
    const parsed = JSON.parse(payload);
    for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
      for (const [soul, node] of Object.entries((msg?.put ?? {}) as Record<string, unknown>)) {
        const text = JSON.stringify(node);
        if (Object.values(MARKERS).some((marker) => text.includes(marker))) out.add(soul);
      }
    }
  } catch {
    /* not JSON */
  }
  return [...out];
}

function scan(who: string, channel: WireEvent['channel'], where: string, payload: string): WireEvent {
  const markers = Object.values(MARKERS).filter((marker) => payload.includes(marker));
  const first = markers[0] ? payload.indexOf(markers[0]) : -1;
  return {
    who,
    channel,
    where,
    size: payload.length,
    markers,
    ...(first >= 0 ? { excerpt: payload.slice(Math.max(0, first - 60), first + 100), souls: soulsCarryingMarkers(payload) } : {}),
  };
}

function attachWireTap(who: string, page: Page, sink: WireEvent[]): void {
  page.on('websocket', (ws) => {
    const url = ws.url();
    if (!/\/gun(\?|$)/.test(url)) return;
    ws.on('framesent', (frame) => sink.push(scan(who, 'gun-ws-out', url, String(frame.payload))));
    ws.on('framereceived', (frame) => sink.push(scan(who, 'gun-ws-in', url, String(frame.payload))));
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!/\/api\//.test(url)) return;
    sink.push(scan(who, 'http-request', `${request.method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`, request.postData() || ''));
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!/\/api\//.test(url)) return;
    void response
      .text()
      .then((body) => sink.push(scan(who, 'http-response', `${response.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`, body)))
      .catch(() => { /* body unavailable (redirect, aborted) */ });
  });
}

/** bootstrapUser opens its own context+page; hook the page's listeners in before it navigates. */
function tappedBrowser(browser: Browser, who: string, sink: WireEvent[]): Browser {
  return {
    newContext: async (options: Parameters<Browser['newContext']>[0]) => {
      const context = await browser.newContext(options);
      context.on('page', (page) => attachWireTap(who, page, sink));
      return context;
    },
  } as unknown as Browser;
}

test.describe('Wire audit — talk content vs the hub', () => {
  let browserTom: Browser | undefined;
  let browserJerry: Browser | undefined;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeEach(async () => {
    await clearGunForStage3Spec();
    const launch = (x: number) =>
      chromium.launch({
        headless: !!process.env.CI,
        args: [`--window-position=${x},40`, '--window-size=640,1200', '--force-device-scale-factor=1', ...WEBRTC_CHROMIUM_ARGS],
      });
    [browserTom, browserJerry] = await Promise.all([launch(0), launch(640)]);
  });

  test.afterEach(async () => {
    await finalCleanupPages({ tom: pageTom, jerry: pageJerry }, { tom: contextTom, jerry: contextJerry });
    await Promise.all([browserTom?.close().catch(() => {}), browserJerry?.close().catch(() => {})]);
    await clearGunForStage3Spec();
  });

  test('records where each talk marker travels', async ({ e2eWorkerSlot: _slot }, testInfo) => {
    test.setTimeout(180_000);
    void webAppURLStableChatroom();
    const events: WireEvent[] = [];

    const [tom, jerry] = await Promise.all([
      bootstrapUser(tappedBrowser(browserTom!, 'Tom', events), 'Tom', 'Tom Audit'),
      bootstrapUser(tappedBrowser(browserJerry!, 'Jerry', events), 'Jerry', 'Jerry Audit'),
    ]);
    contextTom = tom.context;
    contextJerry = jerry.context;
    pageTom = tom.page;
    pageJerry = jerry.page;
    await afterLoad();

    for (const [label, page] of [['Tom', pageTom], ['Jerry', pageJerry]] as const) {
      await expect
        .poll(() => page.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.()), {
          timeout: MESH_E2E_TIMEOUT_MS,
          message: `${label}: mesh delivery not enabled`,
        })
        .toBe(true);
    }
    const idOf = (page: Page) => page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    const tomId = await idOf(pageTom);
    const jerryId = await idOf(pageJerry);
    expect(tomId && jerryId).toBeTruthy();
    await afterSync();
    await afterSync();
    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId] },
    ]);

    // Everything above is setup; only what happens from here on is the talk exchange.
    const exchangeStartedAt = events.length;

    // Tom creates the talk through the app's real talk service (the authoritative commit path),
    // then announces it to the room exactly as the UI's broadcast button does.
    const talk = await pageTom.evaluate(
      async ({ markers, authorId }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const created = await app.talkService.createTalk({
          title: markers.title,
          authorId,
          type: 'tag',
          questions: [
            {
              id: 'q1',
              text: markers.question,
              answers: [
                { id: 'a-match', text: markers.answerYes, isMatch: true },
                { id: 'a-ignore', text: markers.answerNo, isMatch: false, isIgnore: true },
              ],
            },
          ],
        });
        await app.announceTalkToRoom(created.id, created);
        return created;
      },
      { markers: MARKERS, authorId: tomId },
    );

    await expect
      .poll(
        () =>
          pageJerry!.evaluate(
            ({ talkId }) => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              return (app?.meshAnnounceDiagnostics?.received ?? []).some((r: { talkId: string }) => r.talkId === talkId);
            },
            { talkId: talk.id },
          ),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [200, 400, 800], message: 'Jerry never received the mesh announce' },
      )
      .toBe(true);
    await afterSync();

    // Jerry answers (MATCH) through the same direct-response path the UI uses.
    await pageJerry.evaluate(
      async ({ talkDef, authorId }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        app.peerMeshService?.cacheTalkBody?.(talkDef.id, talkDef);
        await app.submitTalkResponsePairDirect({
          talkId: talkDef.id,
          talkData: { ...talkDef, authorId, authorName: 'Tom Audit' },
          answers: [{ questionId: 'q1', answerId: 'a-match', answerText: talkDef.questions[0].answers[0].text, mode: 'manual', isMatch: true }],
          isChatbotResponse: false,
          authorId,
          authorName: 'Tom Audit',
          isAutoResponse: false,
        });
      },
      { talkDef: talk, authorId: tomId },
    );

    // Let Gun replication, the mailbox and every ack settle before scanning.
    await afterSync();
    await afterSync();
    await afterSync();

    const exchange = events.slice(exchangeStartedAt);
    const leaks = exchange.filter((event) => event.markers.length > 0);
    const byChannel = (channel: WireEvent['channel']) => leaks.filter((e) => e.channel === channel);
    const report = {
      markers: MARKERS,
      framesRecordedDuringExchange: exchange.length,
      leaksFound: leaks.length,
      leaks: leaks.map(({ who, channel, where, size, markers, excerpt, souls }) => ({ who, channel, where, size, markers, excerpt, souls })),
      // Distinct Gun records whose plaintext crossed the hub, generalised (ids -> <id>) for readability.
      soulsOnTheWire: [...new Set(leaks.flatMap((l) => l.souls ?? []).map((soul) => decodeURIComponent(soul).replace(/[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/g, '<pub>').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').replace(/(?<=\/)(?:qa_|[a-z0-9]{20,})[A-Za-z0-9_-]*/g, '<key>')))],
      envelopesWithoutPlaintext: exchange.filter((e) => e.channel === 'http-request' && /mailbox|relay|p2p/i.test(e.where) && e.markers.length === 0).map((e) => `${e.who}: ${e.where}`),
    };
    await testInfo.attach('wire-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log('\n=== WIRE AUDIT ===');
    console.log(`frames/requests recorded during the exchange: ${exchange.length}`);
    console.log(`plaintext marker hits: gun-ws-out=${byChannel('gun-ws-out').length} gun-ws-in=${byChannel('gun-ws-in').length} http-request=${byChannel('http-request').length} http-response=${byChannel('http-response').length}`);
    console.log(`  Gun records whose plaintext crossed the hub:\n    - ${report.soulsOnTheWire.join('\n    - ')}`);
    for (const leak of leaks.slice(0, 4)) {
      console.log(`  LEAK ${leak.who} ${leak.channel} ${leak.where} markers=[${leak.markers.map((m) => m.replace(RUN, '')).join(',')}] size=${leak.size}\n       …${(leak.excerpt || '').replace(/\s+/g, ' ')}…`);
    }
    if (report.envelopesWithoutPlaintext.length > 0) {
      console.log(`  ciphertext-only server calls: ${[...new Set(report.envelopesWithoutPlaintext)].join(' | ')}`);
    }
    console.log('=== END WIRE AUDIT ===\n');

    // Expected behaviour: talk content travels over the mesh (WebRTC) and, at most, as ciphertext through
    // the server — never as plaintext on the relay's Gun wire. KNOWN DEFECT (see the .md): talk records
    // are written to the Gun graph, which syncs to the hub. `test.fail` keeps this a guard: once the
    // defect is fixed this starts "passing unexpectedly" and the marker below must be removed.
    test.fail(true, 'Known: plaintext talk records (talks / receivedTalks / incomingTalkClusters) replicate through the hub Gun wire');
    expect(leaks, 'plaintext talk content reached the hub').toEqual([]);
  });
});
