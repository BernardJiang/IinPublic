#!/usr/bin/env node
// A real direct message between two phones (OPEN-92). Non-destructive: it sends one uniquely tagged
// message between two existing identities that already share a conversation. Needs a DEBUG build.
//
//   node scripts/android-dm-responsiveness-check.mjs <senderSerial> <receiverSerial> [--hung-hub] [--no-launch]
//
// On the sender it opens the DM, taps Send, checks the message is on screen and Send is free at
// once, then taps Back and a bottom tab straight away, and measures each reaction and the longest main-thread freeze. It then checks the outcome on the
// other phone. With --hung-hub every hub call hangs (Wi-Fi with no internet): the composer must
// stay responsive and keep the draft if the send cannot finish; delivery is not required.
// Exits 1 if a budget is missed or the message does not arrive.
import { execFileSync } from 'node:child_process';

const HUNG_HUB = 'http://10.255.255.1:8080/gun';
const BUDGET = { shownMs: 200, reactMs: 1_000, freezeMs: 1_000, deliverMs: Number(process.env.DM_DELIVER_MS) || 60_000 };
const [senderSerial, receiverSerial] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const hungHub = process.argv.includes('--hung-hub');
// Times the apps as they are now: a relaunch reloads the page and measures a phone still starting.
const noLaunch = process.argv.includes('--no-launch');
if (!senderSerial || !receiverSerial) {
  console.error('Name the phones: android-dm-responsiveness-check.mjs <sender> <receiver> [--hung-hub]');
  process.exit(2);
}

const adb = (serial, ...args) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout: 60_000 }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextPort = 10_100;

async function evaluate(serial, expression, timeoutMs = 60_000) {
  const pid = adb(serial, 'shell', 'pidof', 'com.iinpublic.app').split(/\s+/)[0];
  if (!pid) throw new Error('app not running');
  const port = nextPort++;
  adb(serial, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = pages.find((candidate) => candidate.type === 'page') || pages[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP evaluate timed out')), timeoutMs);
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        resolve(message.result);
      };
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    ws.close();
    if (reply.exceptionDetails) {
      throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    }
    return reply.result.value;
  } finally {
    adb(serial, 'forward', '--remove', `tcp:${port}`);
  }
}

const launch = (serial, hub) => {
  adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  try { adb(serial, 'shell', 'wm', 'dismiss-keyguard'); } catch { /* older Android */ }
  adb(serial, 'shell', 'am', 'start', '-n', 'com.iinpublic.app/.MainActivity',
    ...(hub ? ['--es', 'hub_gun_url', hub] : []));
};

async function waitReady(serial) {
  const expression = `(() => {
    const app = window.__iinpublic_app?.getApp?.();
    return app?.currentUser?.id && app?.initialized
      ? { id: app.currentUser.id, name: app.currentUser.stageName } : null;
  })()`;
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const user = await evaluate(serial, expression, 15_000).catch(() => null);
    if (user) return user;
    await sleep(1_000);
  }
  throw new Error(`${serial} did not start`);
}

/** Opens the DM from `person`'s page as a person would, and reports the composer state. */
const openDm = (person) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
  const app = window.__iinpublic_app.getApp();
  if (shown('conversation-detail-overlay')) document.getElementById('back-from-conversation')?.click();
  if (shown('peer-detail-overlay')) document.getElementById('back-from-peer-detail')?.click();
  await sleep(300);
  app.uiManager.openUserConversationFirst(${JSON.stringify(person.id)}, ${JSON.stringify(person.name)});
  for (let i = 0; i < 100 && !shown('conversation-detail-overlay'); i++) {
    document.querySelector('#peer-detail-overlay .peer-thread-item')?.click();
    await sleep(100);
  }
  return shown('conversation-detail-overlay');
})()`;

/** Send, then Back, then a tab, as fast as a hurried person would. */
const sendAndLeave = (text) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
  const input = document.getElementById('conversation-message-input');
  const send = document.getElementById('send-conversation-message');
  input.value = ${JSON.stringify(text)};
  input.dispatchEvent(new Event('input', { bubbles: true }));

  let last = performance.now(), maxGap = 0, ticking = true;
  const tick = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; if (ticking) setTimeout(tick, 20); };
  setTimeout(tick, 20);
  await sleep(100);

  const t0 = performance.now();
  let shownAt = null;
  const inThreadNow = () => [...document.querySelectorAll('#conversation-detail-overlay .message-text')]
    .some((node) => node.textContent.includes(${JSON.stringify(text)}));
  const seen = new MutationObserver(() => {
    if (shownAt === null && inThreadNow()) shownAt = performance.now() - t0;
  });
  seen.observe(document.body, { subtree: true, childList: true, characterData: true });
  send.click();
  const sendStaysReady = !document.getElementById('send-conversation-message').disabled && !input.value;
  for (let i = 0; i < 100 && shownAt === null; i++) await sleep(10);

  const back0 = performance.now();
  document.getElementById('back-from-conversation').click();
  let backMs = null;
  for (let i = 0; i < 300 && backMs === null; i++) {
    if (!shown('conversation-detail-overlay')) backMs = Math.round(performance.now() - back0);
    else await sleep(10);
  }

  const tab0 = performance.now();
  const tab = document.querySelector('.nav-btn[data-view="talks"]');
  tab.click();
  let tabMs = null;
  for (let i = 0; i < 300 && tabMs === null; i++) {
    if (tab.classList.contains('active')) tabMs = Math.round(performance.now() - tab0);
    else await sleep(10);
  }
  await sleep(1500);
  ticking = false;
  seen.disconnect();
  return { shownMs: shownAt === null ? null : Math.round(shownAt), sendStaysReady, backMs, tabMs, freezeMs: Math.round(maxGap) };
})()`;

/** How the message looks in this phone's open conversation. */
const inThread = (text) => `(() => {
  const nodes = [...document.querySelectorAll('#conversation-detail-overlay .message-text')];
  const hits = nodes.filter((node) => node.textContent.includes(${JSON.stringify(text)}));
  return { count: hits.length, draft: document.getElementById('conversation-message-input')?.value || '' };
})()`;

const failures = [];
const fail = (what) => { failures.push(what); console.log(`   ✘ ${what}`); };

if (!noLaunch) {
  launch(senderSerial, hungHub ? HUNG_HUB : undefined);
  if (!hungHub) launch(receiverSerial);
}
const sender = await waitReady(senderSerial);
const receiver = await waitReady(receiverSerial);
console.log(`${sender.name} (${senderSerial}) → ${receiver.name} (${receiverSerial})${hungHub ? ', sender hub black-holed' : ''}`);

try {
  if (!await evaluate(senderSerial, openDm(receiver))) throw new Error('sender could not open the DM');
  // Open first, so the arrival time is the message's and not the time taken to open the thread.
  if (!hungHub && !await evaluate(receiverSerial, openDm(sender))) throw new Error('receiver could not open the DM');
  const text = `dm-check ${Date.now()}`;
  const sent = Date.now();
  const timing = await evaluate(senderSerial, sendAndLeave(text));
  console.log(`   own message shown ${timing.shownMs ?? 'not within 1 s'} ms · Send ready ${timing.sendStaysReady} · Back ${timing.backMs ?? 'never'} ms · tab ${timing.tabMs ?? 'never'} ms · longest freeze ${timing.freezeMs} ms`);
  if (timing.shownMs === null || timing.shownMs > BUDGET.shownMs) fail(`own message on screen: ${timing.shownMs ?? 'not within 1 s'}`);
  if (!timing.sendStaysReady) fail('Send was not ready for the next message');
  if (timing.backMs === null || timing.backMs > BUDGET.reactMs) fail(`Back: ${timing.backMs ?? 'never'}`);
  if (timing.tabMs === null || timing.tabMs > BUDGET.reactMs) fail(`tab: ${timing.tabMs ?? 'never'}`);
  if (timing.freezeMs >= BUDGET.freezeMs) fail(`froze ${timing.freezeMs} ms`);

  if (hungHub) {
    await sleep(20_000);
    await evaluate(senderSerial, openDm(receiver));
    const local = await evaluate(senderSerial, inThread(text));
    console.log(`   after 20 s: in thread ${local.count}, draft kept ${local.draft === text}`);
    if (local.count !== 1 && local.draft !== text) fail('message is neither in the thread nor kept as a draft');
  } else {
    let arrived = 0;
    while (Date.now() - sent < BUDGET.deliverMs && arrived === 0) {
      arrived = (await evaluate(receiverSerial, inThread(text))).count;
      if (arrived === 0) await sleep(1_000);
    }
    console.log(`   received ${arrived} time(s) in ${Date.now() - sent} ms`);
    if (arrived !== 1) fail(`receiver has the message ${arrived} time(s)`);
  }
} catch (error) {
  fail(`check aborted: ${error.message}`);
} finally {
  if (hungHub) {
    adb(senderSerial, 'shell', 'am', 'force-stop', 'com.iinpublic.app');
    launch(senderSerial);
  }
}

console.log(failures.length ? `\n${failures.length} problem(s).` : '\nWithin budget.');
process.exit(failures.length ? 1 : 0);
