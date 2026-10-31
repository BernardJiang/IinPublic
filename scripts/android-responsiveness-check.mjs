#!/usr/bin/env node
// GUI responsiveness on real Android phones (docs/testing/gui-responsiveness-test-plan.md, P5).
// Non-destructive: no app data is cleared, no identity is renamed or blocked. Needs a DEBUG build
// installed (WebView debugging; the hub_gun_url launch override).
//
//   NATIVE_APP_ANDROID_SERIALS=<serial1>,<serial2> node scripts/android-responsiveness-check.mjs [--hung-hub]
//
// For each phone: (re)launch the app (with --hung-hub: pointed at a black-holed address, so every
// hub request hangs, like Wi-Fi with no internet), wait for it to start, then over raw CDP measure
//   - how long the page freezes while an attestation key is generated (sync bridge vs async),
//   - tap → first visible change, and the longest main-thread freeze, for the five tabs, New Room,
//     Create talk and Refresh Location,
//   - opening the TechSupport chat from its person page.
// Exits 1 if any budget is missed (start > 20 s, reaction > 1 s, freeze ≥ 1 s, async attestation
// freeze ≥ 250 ms). Afterwards each phone is relaunched normally (production hub) and put to sleep.
import { execFileSync } from 'node:child_process';

const HUNG_HUB = 'http://10.255.255.1:8080/gun';
const BUDGET = { startMs: 20_000, reactMs: 1_000, freezeMs: 1_000, asyncAttestFreezeMs: 250 };
const hungHub = process.argv.includes('--hung-hub');
const serials = (process.env.NATIVE_APP_ANDROID_SERIALS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (serials.length === 0) {
  console.error('Name the phones: NATIVE_APP_ANDROID_SERIALS=<serial>[,<serial>...] (they are shared).');
  process.exit(2);
}

const adb = (serial, ...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout: 60_000 }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextPort = 9500;

/** Evaluate an async expression in the app's WebView over raw CDP. */
async function evaluate(serial, expression, timeoutMs = 180_000) {
  const pid = adb(serial, 'shell', 'pidof', 'com.iinpublic.app').split(/\s+/)[0];
  if (!pid) throw new Error('app not running');
  const socket = (adb(serial, 'shell', 'cat', '/proc/net/unix').match(new RegExp(`webview_devtools_remote_${pid}\\b`)) || [])[0];
  if (!socket) throw new Error(`no WebView devtools socket for pid ${pid} (is this a debug build?)`);
  const port = nextPort++;
  adb(serial, 'forward', `tcp:${port}`, `localabstract:${socket}`);
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = pages.find((p) => p.type === 'page') || pages[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP evaluate timed out')), timeoutMs);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        resolve(msg.result);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    ws.close();
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  } finally {
    adb(serial, 'forward', '--remove', `tcp:${port}`);
  }
}

const READY = `(async () => { const a = window.__iinpublic_app?.getApp?.(); return !!(a?.currentUser?.id && a?.initialized); })()`;

const ATTEST = `(async () => {
  const att = window.IinPublicAttestation;
  if (!att) return null;
  const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const measure = async (run) => {
    let last = performance.now(), maxGap = 0, ticking = true;
    const tick = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; if (ticking) setTimeout(tick, 20); };
    setTimeout(tick, 20);
    await new Promise((r) => setTimeout(r, 100));
    const ok = await run();
    await new Promise((r) => setTimeout(r, 100));
    ticking = false;
    return { ok, freezeMs: Math.round(maxGap) };
  };
  const sync = await measure(async () => JSON.parse(att.generateAttestedKey(challenge)).ok === true);
  const async_ = typeof att.generateAttestedKeyAsync !== 'function' ? null : await measure(() => new Promise((resolve) => {
    const id = 'probe_' + Date.now();
    const on = (e) => { if (e.detail?.id !== id) return; window.removeEventListener('iinpublic-attestation-result', on); resolve(JSON.parse(e.detail.payload).ok === true); };
    window.addEventListener('iinpublic-attestation-result', on);
    if (!att.generateAttestedKeyAsync(id, challenge)) resolve(false);
  }));
  return { sync, async: async_ };
})()`;

const TAPS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = () => {
    document.querySelectorAll('.notification, .modal-overlay').forEach((n) => n.remove());
    for (const id of ['back-from-conversation', 'back-from-peer-detail']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
  };
  const tap = async (label, selector, settle = 1500) => {
    clean();
    await sleep(300);
    const el = document.querySelector(selector);
    if (!el) return { label, missing: true };
    let changedAt = null, last = performance.now(), maxGap = 0, ticking = true;
    const tick = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; if (ticking) setTimeout(tick, 20); };
    setTimeout(tick, 20);
    const obs = new MutationObserver(() => { if (changedAt === null) changedAt = performance.now(); });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const t0 = performance.now();
    el.click();
    await sleep(settle);
    ticking = false; obs.disconnect();
    return { label, reactMs: changedAt === null ? null : Math.round(changedAt - t0), freezeMs: Math.round(maxGap) };
  };
  const out = [];
  for (const view of ['talks', 'contacts', 'me', 'settings', 'chatrooms']) out.push(await tap('tab ' + view, '.nav-btn[data-view="' + view + '"]'));
  out.push(await tap('New Room', '#create-custom-chatroom-btn'));
  document.getElementById('cancel-custom-room-btn')?.click();
  document.querySelector('.nav-btn[data-view="talks"]').click();
  out.push(await tap('Create talk', '#create-talk-btn'));
  document.getElementById('talk-editor-modal')?.remove();
  document.querySelector('.nav-btn[data-view="settings"]').click();
  out.push(await tap('Refresh Location', '#settings-refresh-location-btn'));
  // The TechSupport chat from its person page (Contacts → name → thread row).
  clean();
  document.querySelector('.nav-btn[data-view="contacts"]').click();
  await sleep(800);
  document.querySelector('.contact-item[data-support-contact="true"] .contact-item-name')?.click();
  let row = null;
  for (let i = 0; i < 100 && !row; i++) { row = document.querySelector('#peer-detail-overlay .peer-thread-item'); if (!row) await sleep(100); }
  if (row) {
    const overlay = document.getElementById('conversation-detail-overlay');
    const t0 = performance.now();
    row.click();
    let opened = null;
    for (let i = 0; i < 200 && opened === null; i++) { if (getComputedStyle(overlay).display !== 'none') opened = Math.round(performance.now() - t0); else await sleep(25); }
    out.push({ label: 'open TechSupport chat', reactMs: opened, freezeMs: 0 });
  } else {
    out.push({ label: 'open TechSupport chat', missing: true });
  }
  clean();
  document.querySelector('.nav-btn[data-view="chatrooms"]').click();
  return out;
})()`;

const failures = [];
const fail = (serial, what) => { failures.push(`${serial}: ${what}`); console.log(`   ✘ ${what}`); };

for (const serial of serials) {
  const model = adb(serial, 'shell', 'getprop', 'ro.product.model');
  const version = (adb(serial, 'shell', 'dumpsys', 'package', 'com.iinpublic.app').match(/versionName=(\S+)/) || [])[1];
  console.log(`\n== ${serial} (${model}, IinPublic ${version ?? 'not installed'})${hungHub ? ', hub black-holed' : ''}`);
  if (!version) { fail(serial, 'IinPublic is not installed'); continue; }
  try {
    adb(serial, 'shell', 'am', 'force-stop', 'com.iinpublic.app');
    adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
    try { adb(serial, 'shell', 'wm', 'dismiss-keyguard'); } catch { /* older Android */ }
    adb(serial, 'shell', 'am', 'start', '-n', 'com.iinpublic.app/.MainActivity', ...(hungHub ? ['--es', 'hub_gun_url', HUNG_HUB] : []));
    const started = Date.now();
    let ready = false;
    while (!ready && Date.now() - started < 90_000) {
      ready = await evaluate(serial, READY, 15_000).catch(() => false);
      if (!ready) await sleep(1_000);
    }
    const startMs = Date.now() - started;
    console.log(`   start: ${ready ? `${startMs} ms` : 'did not finish in 90 s'}`);
    if (!ready || startMs > BUDGET.startMs) fail(serial, `start ${ready ? `${startMs} ms` : 'never'} (budget ${BUDGET.startMs} ms)`);
    if (!ready) continue;

    const attest = await evaluate(serial, ATTEST);
    if (attest) {
      console.log(`   attestation key: sync freeze ${attest.sync.freezeMs} ms, async freeze ${attest.async ? `${attest.async.freezeMs} ms` : 'n/a (old build)'}`);
      if (!attest.async) fail(serial, 'no async attestation bridge (build older than 1.0.204)');
      else if (attest.async.freezeMs >= BUDGET.asyncAttestFreezeMs) fail(serial, `async attestation froze the page ${attest.async.freezeMs} ms`);
    }

    for (const tap of await evaluate(serial, TAPS)) {
      if (tap.missing) { fail(serial, `${tap.label}: control not found`); continue; }
      console.log(`   ${tap.label.padEnd(22)} reacted ${tap.reactMs === null ? 'NEVER' : `${tap.reactMs} ms`}, longest freeze ${tap.freezeMs} ms`);
      if (tap.reactMs === null || tap.reactMs > BUDGET.reactMs) fail(serial, `${tap.label}: reaction ${tap.reactMs ?? 'never'}`);
      if (tap.freezeMs >= BUDGET.freezeMs) fail(serial, `${tap.label}: froze ${tap.freezeMs} ms`);
    }
  } catch (error) {
    fail(serial, `check aborted: ${error.message}`);
  } finally {
    // Back on production, screen off.
    try {
      if (hungHub) {
        adb(serial, 'shell', 'am', 'force-stop', 'com.iinpublic.app');
        adb(serial, 'shell', 'am', 'start', '-n', 'com.iinpublic.app/.MainActivity');
      }
      adb(serial, 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
    } catch { /* phone dropped off USB */ }
  }
}

console.log(failures.length ? `\n${failures.length} budget miss(es):\n${failures.join('\n')}` : '\nAll phones within budget.');
process.exit(failures.length ? 1 : 0);
