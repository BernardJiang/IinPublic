/**
 * Adam (Electron desktop app), Eve (Chromium), and Bob (WebKit — Safari's engine)
 * exchange one talk of each of the 4 types (tag/flow/survey/route), answer every
 * received talk as a match, and verify all three appear in each other's Contacts.
 *
 * No prior spec mixes three different runtime engines in one matching scenario —
 * 02-browser-and-desktop-app-presence.spec.ts covers browser+Electron presence and a
 * single 1:1 DM, but never talk broadcast/match, and never a third (WebKit) engine.
 * This is deliberately heavier than that file's "keep it narrow" guidance (see
 * README.md) — it exists to prove the full talk-matching path (not just presence and
 * DMs) actually propagates across topologies that are architecturally different:
 * Eve/Bob connect directly to the shared test hub's Gun instance, while Adam's
 * Electron shell runs its own separate embedded local Gun node that only dials the
 * hub for discovery/signaling (see platforms/desktop/main.js). If that turns out not
 * to hold, this spec is the place that should catch it.
 */
import { chromium, webkit, type Browser, type Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapBrowserUserOnOrigin,
  bootstrapNativeWindow,
  forceJoinGlobal,
  launchNativeUser,
  readGlobalMembersFromHub,
  type NativeUser,
} from './helpers/native-app';
import {
  clickBroadcastUntilBulkAck,
  completeTalksInAppByAnswerIds,
  createTalksFromCompanyPage,
  waitForDistinctGunPeersExcludingSelf,
} from '../helpers/talk-demo-ui';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const APP_PORT = 19141; // distinct from 19111/19121/19122 used by the other native-app specs
const WEBRTC_LAUNCH_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

// tests/e2e/helpers/talk-demo-ui.ts (and everything it calls) resolves the hub via
// gunBaseURL(), which defaults to 8080 + E2E_PORT_OFFSET + parallelSlot() — the
// standard per-worker scheme from tests/e2e/helpers/ports.ts. This suite's hub runs
// on a different, fixed port (HUB_GUN_PORT, default 9078), so without this the
// helpers' internal API calls would silently target the wrong (likely not-running)
// server. Setting it once here, before any helper call, fixes every gunBaseURL()
// call for the rest of this process — safe because no other native-app spec in this
// single-worker config relies on the default.
process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

type UserRun = {
  name: string;
  stageName: string;
  page: Page;
  id: string;
  talks?: Array<{ title: string; talkId: string; talkData: any }>;
};

const TYPES: Array<{ type: 'tag' | 'flow' | 'survey' | 'route'; questions: number }> = [
  { type: 'tag', questions: 1 },
  { type: 'flow', questions: 2 },
  { type: 'survey', questions: 2 },
  { type: 'route', questions: 4 },
];

function talkSet(authorId: string, owner: string, runId: string): any[] {
  return TYPES.map(({ type, questions }) => {
    const title = `${runId} ${owner} ${type}`;
    return {
      title,
      authorId,
      type,
      language: 'en',
      isAdult: false,
      tags: [],
      questions: Array.from({ length: questions }, (_, qi) => ({
        id: `q_${qi + 1}`,
        text: `${title}: question ${qi + 1}`,
        answers: [
          { id: `match_${qi + 1}`, text: `Match ${qi + 1}`, isMatch: true, isTerminal: qi === questions - 1 },
          { id: `ignore_${qi + 1}`, text: `Ignore ${qi + 1}`, isIgnore: true, isTerminal: true },
        ],
      })),
      createdAt: new Date().toISOString(),
      isTemplate: false,
      usageCount: 0,
    };
  });
}

async function readCurrentPublicUser(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const user = app?.currentUser || {};
    const pair = app?.gunService?.getStoredPair?.();
    return {
      ...user,
      ...(pair?.pub ? { pub: pair.pub } : {}),
      ...(pair?.epub ? { epub: pair.epub } : {}),
    };
  });
}

async function publishPublicUserToHub(user: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

test.describe('Native app: three-engine talk exchange (Electron + Chromium + WebKit)', () => {
  let chromiumBrowser: Browser | undefined;
  let webkitBrowser: Browser | undefined;
  let native: NativeUser | undefined;
  let closeEve: (() => Promise<void>) | undefined;
  let closeBob: (() => Promise<void>) | undefined;
  let userDataDir = '';
  const users: UserRun[] = [];

  test.afterAll(async () => {
    await closeEve?.().catch(() => {});
    await closeBob?.().catch(() => {});
    await chromiumBrowser?.close().catch(() => {});
    await webkitBrowser?.close().catch(() => {});
    await native?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test("Adam (Mac app), Eve (Chrome), Bob (Safari) exchange all 4 talk types and land in each other's contacts", async () => {
    test.setTimeout(300_000);

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-three-engine-e2e-'));
    native = await launchNativeUser({
      localPort: APP_PORT,
      hubGunUrl: `http://127.0.0.1:${HUB_GUN_PORT}/gun`,
      userDataDir,
    });
    const adamId = await bootstrapNativeWindow(native.window, 'Adam', { waitForSupportGreeting: false });

    chromiumBrowser = await chromium.launch({ headless: true, args: WEBRTC_LAUNCH_ARGS });
    const eve = await bootstrapBrowserUserOnOrigin(
      chromiumBrowser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Eve (Chrome)',
      'Eve',
      { waitForSupportGreeting: false },
    );
    closeEve = eve.close;

    webkitBrowser = await webkit.launch({ headless: true });
    const bob = await bootstrapBrowserUserOnOrigin(
      webkitBrowser,
      `http://127.0.0.1:${WEB_PORT}`,
      'Bob (Safari)',
      'Bob',
      { waitForSupportGreeting: false },
    );
    closeBob = bob.close;

    users.push(
      { name: 'Adam', stageName: 'Adam', page: native.window, id: adamId },
      { name: 'Eve', stageName: 'Eve', page: eve.page, id: eve.userId },
      { name: 'Bob', stageName: 'Bob', page: bob.page, id: bob.userId },
    );
    expect(new Set(users.map((u) => u.id)).size).toBe(3);

    // Presence: force-join Global and publish each user to the shared hub, then wait
    // until the hub's own member list — and each page's own view of the room — agrees
    // all three are present (mirrors 02-browser-and-desktop-app-presence.spec.ts's
    // pairwise check, extended to three-way).
    for (const u of users) await forceJoinGlobal(u.page);
    for (const u of users) await publishPublicUserToHub(await readCurrentPublicUser(u.page));

    await expect
      .poll(
        async () => {
          const ids = (await readGlobalMembersFromHub(HUB_GUN_PORT)).map((m) => m.userId);
          return users.every((u) => ids.includes(u.id));
        },
        { timeout: 30_000, intervals: [1000, 1500, 2000] },
      )
      .toBe(true);

    for (const u of users) {
      const otherIds = users.filter((o) => o !== u).map((o) => o.id);
      await expect
        .poll(
          () =>
            u.page.evaluate((ids: string[]) => {
              const members =
                (window as any).__iinpublic_app?.getApp?.()?.uiManager?.getCurrentChatroomMembers?.() || [];
              const memberIds = new Set(members.map((m: any) => m.userId));
              return ids.every((id) => memberIds.has(id));
            }, otherIds),
          { timeout: 45_000, intervals: [1000, 1500, 2000] },
        )
        .toBe(true);
    }

    const runId = `three-engine-${Date.now()}`;
    for (const u of users) {
      u.talks = await createTalksFromCompanyPage(u.page, talkSet(u.id, u.name, runId));
    }

    // Warm room-mesh discovery before broadcasting. Adam's embedded node only dials the
    // hub for discovery/signaling (not full Gun sync) so, unlike two plain browser pages
    // on the same shared Gun server, a mesh neighbor link to Eve/Bob is not automatic —
    // give it a real budget and don't fail the whole run if warming alone falls short;
    // clickBroadcastUntilBulkAck below has its own delivery-path fallback.
    for (const u of users) {
      const otherCount = users.length - 1;
      await waitForDistinctGunPeersExcludingSelf(u.page, otherCount, 60_000).catch(() => {});
    }

    for (const u of users) {
      await clickBroadcastUntilBulkAck(u.page, { minGunPeers: 2, minSent: TYPES.length });
    }

    for (const recipient of users) {
      const received = users.filter((author) => author !== recipient).flatMap((author) => author.talks!);
      await completeTalksInAppByAnswerIds(
        recipient.page,
        received.map((talk) => ({
          talkId: talk.talkId,
          talkData: talk.talkData,
          answerIds: talk.talkData.questions.map((question: any) => question.answers[0].id),
          outcome: 'match' as const,
        })),
      );
    }

    for (const u of users) {
      await u.page.click('.nav-btn[data-view="contacts"]');
      await expect(
        u.page.locator('#contacts-list .contact-item:not([data-support-contact="true"])'),
      ).toHaveCount(2, { timeout: 30_000 });
      for (const other of users.filter((o) => o !== u)) {
        await expect(u.page.locator('#contacts-list').getByText(other.name)).toBeVisible({ timeout: 10_000 });
      }
    }
  });
});
