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
const PROBE = `PUBLIC_WIRE_PROBE_${RUN}`;
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
  /** Souls in private namespaces this frame wrote or asked for (OPEN-91 P2: must be none). */
  privateSouls?: string[];
  probe?: boolean;
};

/** Namespaces that never leave the device (src/core/sharing-policy.ts). */
const PRIVATE_NAMESPACES = ['local', 'pairs', 'deliveryJournal', 'device-local', 'nodes', 'edges'];

/** The Gun messages in a frame: one message, or a batch — an array of messages or of their JSON. */
function gunMessages(payload: string): any[] {
  const parsed = JSON.parse(payload);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((msg) => {
    if (typeof msg !== 'string') return [msg];
    try {
      return gunMessages(msg);
    } catch {
      return [];
    }
  });
}

/** Every soul a Gun frame writes (`put`) or asks for (`get`) in a private namespace. */
function privateSoulsIn(payload: string): string[] {
  const out = new Set<string>();
  try {
    for (const msg of gunMessages(payload)) {
      const souls = [...Object.keys((msg?.put ?? {}) as Record<string, unknown>), ...(typeof msg?.get?.['#'] === 'string' ? [msg.get['#']] : [])];
      for (const soul of souls) {
        const decoded = decodeURIComponent(soul);
        if (PRIVATE_NAMESPACES.includes(decoded.split('/')[0]) || /^users\/[^/]+\/private(?:\/|$)/.test(decoded)) out.add(soul);
      }
    }
  } catch {
    /* not JSON */
  }
  return [...out];
}

/** Gun frames are JSON (or arrays of JSON): return the soul of every put-node containing a marker. */
function soulsCarryingMarkers(payload: string): string[] {
  const out = new Set<string>();
  try {
    for (const msg of gunMessages(payload)) {
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
  const privateSouls = channel === 'gun-ws-out' ? privateSoulsIn(payload) : [];
  return {
    ...(privateSouls.length > 0 ? { privateSouls } : {}),
    who,
    channel,
    where,
    size: payload.length,
    ...(payload.includes(PROBE) ? { probe: true } : {}),
    markers,
    ...(first >= 0 ? { excerpt: payload.slice(Math.max(0, first - 60), first + 100), souls: soulsCarryingMarkers(payload) } : {}),
  };
}

/** SharedWorker sockets belong to a separate Chromium target, not to page.on('websocket'). */
async function tapSharedWorkers(browser: Browser, who: string, sink: WireEvent[]): Promise<void> {
  const cdp = await browser.newBrowserCDPSession();
  let commandId = 0;
  const attached = new Set<string>();
  const sockets = new Map<string, string>();
  cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
    const event = JSON.parse(message);
    const params = event.params || {};
    const key = `${sessionId}:${params.requestId}`;
    if (event.method === 'Network.webSocketCreated') sockets.set(key, params.url);
    const url = sockets.get(key) || '';
    if (!/\/gun(\?|$)/.test(url)) return;
    if (event.method === 'Network.webSocketFrameSent') sink.push(scan(who, 'gun-ws-out', url, params.response.payloadData));
    if (event.method === 'Network.webSocketFrameReceived') sink.push(scan(who, 'gun-ws-in', url, params.response.payloadData));
  });
  const attach = async (info: { type: string; targetId: string }): Promise<void> => {
    if (info.type !== 'shared_worker' || attached.has(info.targetId)) return;
    attached.add(info.targetId);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: false });
    await cdp.send('Target.sendMessageToTarget', {
      sessionId, message: JSON.stringify({ id: ++commandId, method: 'Network.enable' }),
    });
  };
  cdp.on('Target.targetCreated', ({ targetInfo }) => { void attach(targetInfo).catch(() => {}); });
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  for (const info of (await cdp.send('Target.getTargets')).targetInfos) await attach(info);
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
    await Promise.all([
      tapSharedWorkers(browserTom!, 'Tom', events),
      tapSharedWorkers(browserJerry!, 'Jerry', events),
    ]);

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

    // Prove both Gun sockets are observed; an empty worker capture cannot qualify privacy.
    for (const [who, page] of [['Tom', pageTom], ['Jerry', pageJerry]] as const) {
      await page.evaluate(({ probe, who }) => {
        const gun = (window as any).__iinpublic_app.getApp().gunService.getGun();
        gun.get('public').get('wire-audit').get(who).put({ probe });
      }, { probe: PROBE, who });
      await expect.poll(() => events.some((event) => event.who === who && event.channel === 'gun-ws-out' && event.probe), {
        timeout: 15_000, message: `${who}: audit must observe a known public Gun write`,
      }).toBe(true);
    }

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
      publicProbeObservedBy: [...new Set(events.filter((event) => event.probe && event.channel === 'gun-ws-out').map((event) => event.who))],
      gunFramesDuringExchange: exchange.filter((event) => event.channel.startsWith('gun-ws-')).length,
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

    // Talk content travels over the direct mesh and, at most, as ciphertext through a server
    // fallback. The core's sharing policy keeps owner Talk repositories and incoming clusters
    // private, so none of the unique plaintext may appear on the hub boundary.
    expect(leaks, 'plaintext talk content reached the hub').toEqual([]);
    // Nothing from a private namespace — the sender's response copy and delivery journal included —
    // is sent to the hub or asked of it, during the whole session (OPEN-91 P2).
    const privateOnWire = [...new Set(events.flatMap((event) => (event.privateSouls ?? []).map((soul) => `${event.who}: ${soul}`)))];
    console.log(`private souls sent to the hub: ${privateOnWire.length}`);
    expect(privateOnWire, 'a private soul reached the hub').toEqual([]);
  });
});
