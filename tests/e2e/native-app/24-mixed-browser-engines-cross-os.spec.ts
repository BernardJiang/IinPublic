/**
 * OPEN-16 / OPEN-19: mixed browser ENGINES across operating systems in one Mac-controlled
 * scenario — local macOS Chromium, real Microsoft Edge on windows-test, real Firefox on
 * ubuntu-test. Different engines on different operating systems, all on one Gun hub, every
 * directed pair proven by an explicit match completion.
 */
import { chromium, test, expect, type Browser } from '@playwright/test';
import { execFileSync } from 'child_process';
import { bootstrapBrowserUserOnOrigin, forceJoinGlobal, readGlobalMembersFromHub } from './helpers/native-app';
import { clickBroadcastUntilBulkAck, completeTalksInAppByAnswerIds, createTagTalkViaEditor } from '../helpers/talk-demo-ui';
import { launchUbuntuFirefoxPeer, type UbuntuFirefoxPeer } from './helpers/ubuntu-firefox-peer';
import { launchWindowsChromePeer, type WindowsBrowserPeer } from './helpers/windows-live-peer';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const WEB_PORT = HUB_GUN_PORT - 8080 + 3001;
const RUN = process.env.E2E_REAL_MIXED_BROWSER_ENGINES === '1';
process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

const reachable = (host: string) => {
  try { execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, 'echo up'], { timeout: 15_000, stdio: 'pipe' }); return true; } catch { return false; }
};

test.describe('Mixed browser engines across operating systems', () => {
  test.skip(!RUN, 'Set E2E_REAL_MIXED_BROWSER_ENGINES=1.');
  let local: Browser | undefined;
  let closeLocal: (() => Promise<void>) | undefined;
  let edge: WindowsBrowserPeer | undefined;
  let ff: UbuntuFirefoxPeer | undefined;

  test.afterAll(async () => {
    await closeLocal?.().catch(() => {});
    await local?.close().catch(() => {});
    await edge?.close().catch(() => {});
    await ff?.close().catch(() => {});
  });

  test('macOS Chromium + Windows Edge + Ubuntu Firefox exchange matching talks pairwise', async () => {
    test.setTimeout(30 * 60_000);
    test.skip(!reachable(process.env.WINDOWS_E2E_SSH_HOST || 'windows-test'), 'windows-test is unreachable.');
    test.skip(!reachable(process.env.UBUNTU_E2E_SSH_HOST || 'ubuntu-test'), 'ubuntu-test is unreachable.');
    const origin = `http://127.0.0.1:${WEB_PORT}`;
    const forward = [WEB_PORT, HUB_GUN_PORT];
    const peers: Array<{ name: string; page: import('@playwright/test').Page; id: string; talk?: Awaited<ReturnType<typeof createTagTalkViaEditor>> }> = [];

    local = await chromium.launch({ headless: true, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
    const mac = await bootstrapBrowserUserOnOrigin(local, origin, 'Mix Mac Chromium', 'Mix Mac Chromium', { waitForSupportGreeting: false });
    closeLocal = mac.close;
    peers.push({ name: 'Mix Mac Chromium', page: mac.page, id: mac.userId });

    edge = await launchWindowsChromePeer({ browser: 'edge', reverseForwardPorts: forward });
    const win = await bootstrapBrowserUserOnOrigin(edge.browser, origin, 'Mix Windows Edge', 'Mix Windows Edge', { waitForSupportGreeting: false });
    expect(await win.page.evaluate(() => navigator.userAgent)).toMatch(/Edg\//);
    peers.push({ name: 'Mix Windows Edge', page: win.page, id: win.userId });

    ff = await launchUbuntuFirefoxPeer({ reverseForwardPorts: forward });
    const ub = await bootstrapBrowserUserOnOrigin(ff.browser, origin, 'Mix Ubuntu Firefox', 'Mix Ubuntu Firefox', { waitForSupportGreeting: false });
    expect(await ub.page.evaluate(() => navigator.userAgent)).toMatch(/Firefox\//);
    peers.push({ name: 'Mix Ubuntu Firefox', page: ub.page, id: ub.userId });

    await Promise.all(peers.map((p) => forceJoinGlobal(p.page)));
    await expect.poll(async () => {
      const ids = new Set((await readGlobalMembersFromHub(HUB_GUN_PORT)).map((m) => m.userId));
      return peers.filter((p) => ids.has(p.id)).length;
    }, { timeout: 90_000, intervals: [1000, 2000, 3000] }).toBe(peers.length);

    const runId = `mixed-engines-${Date.now()}`;
    for (const p of peers) p.talk = await createTagTalkViaEditor(p.page, { title: `${runId}-${p.name.replace(/\s+/g, '-')}`, timeoutMs: 90_000 });
    for (const p of peers) await clickBroadcastUntilBulkAck(p.page, { minGunPeers: 1, minSent: 1 });
    for (const receiver of peers) for (const author of peers) {
      if (receiver === author) continue;
      console.log(`[mixed-engines] completing: ${author.name} -> ${receiver.name}`);
      await completeTalksInAppByAnswerIds(receiver.page, [{ talkId: author.talk!.talkId, talkData: author.talk!.talkData, answerIds: ['a_0_match'], outcome: 'match' }]);
    }
  });
});
