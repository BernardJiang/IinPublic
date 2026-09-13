#!/usr/bin/env node

import { _electron as electron, chromium, devices } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT = path.resolve(ROOT, process.argv[2] || 'docs/performance/ui-release-profile.json');
const PORT_OFFSET = 764;
const WEB_PORT = 3001 + PORT_OFFSET;
const GUN_PORT = 8080 + PORT_OFFSET;
const ELECTRON_PORT = 19_176;
const TALK_COUNT = 500;
const CONTACT_COUNT = 500;

const children = [];

function round(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function launchProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000); });
  child.stdout.on('data', () => {});
  children.push(child);
  child.on('exit', (code) => {
    if (code && !options.allowExit) {
      process.stderr.write(`[profile-ui] ${command} exited ${code}\n${stderr}\n`);
    }
  });
  return child;
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function installRuntimeObservers(page) {
  await page.evaluate(() => {
    const state = { longTasks: [], events: [] };
    window.__iinpublicProfileRuntime = state;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* unsupported engine */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.events.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch { /* unsupported engine */ }
  });
}

async function waitForReady(page) {
  await page.waitForFunction(
    () => window.__iinpublic_app?.getApp?.()?.initialized === true,
    undefined,
    { timeout: 60_000 },
  );
  const skip = page.locator('[data-testid="walkthrough-skip-btn"]');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function measureStartup(page, label) {
  await waitForReady(page);
  return page.evaluate((profileLabel) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      responseEnd: entry.responseEnd,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    }));
    const startup = window.__iinpublicStartupMetrics || { version: 1, host: {}, phases: {} };
    const launch = startup.host?.processLaunchEpochMs;
    const nodeReady = startup.host?.nodeHealthReadyEpochMs;
    const absolutePhase = (phase) => {
      const relative = startup.phases?.[phase];
      return typeof relative === 'number' ? performance.timeOrigin + relative : null;
    };
    const bundle = resources.find((entry) => /\/bundle\.js(?:\?|$)/.test(entry.name));
    const memory = performance.memory;
    return {
      label: profileLabel,
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      startup,
      milestonesFromProcessLaunchMs: {
        nodeHealthReady: launch && nodeReady ? nodeReady - launch : null,
        htmlParsed: launch && absolutePhase('htmlParsed') ? absolutePhase('htmlParsed') - launch : null,
        bundleExecuted: launch && absolutePhase('bundleExecuted') ? absolutePhase('bundleExecuted') - launch : null,
        firstUsableNavigation: launch && absolutePhase('firstUsableNavigation')
          ? absolutePhase('firstUsableNavigation') - launch
          : null,
        initialSyncComplete: launch && absolutePhase('initialSyncComplete')
          ? absolutePhase('initialSyncComplete') - launch
          : null,
      },
      navigation: nav ? {
        domContentLoadedMs: nav.domContentLoadedEventEnd,
        loadEventMs: nav.loadEventEnd,
        responseStartMs: nav.responseStart,
        responseEndMs: nav.responseEnd,
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize,
      } : null,
      bundle: bundle || null,
      allResourceTransferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      allResourceDecodedBytes: resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      requestedWebpackChunks: resources
        .filter((entry) => /(?:^|\/)bundle\.js$|\.bundle\.js$/.test(new URL(entry.name).pathname))
        .map((entry) => new URL(entry.name).pathname.split('/').pop())
        .sort(),
      heliaRequested: resources.some((entry) => entry.name.includes('helia_dist_src')),
      mapLibreRequested: resources.some((entry) => entry.name.includes('maplibre-gl')),
      usedJsHeapBytes: typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null,
    };
  }, label);
}

async function measureInteractionWorkload(page) {
  return page.evaluate(async ({ talkCount, contactCount }) => {
    const app = window.__iinpublic_app.getApp();
    const ui = app.uiManager;
    const nowIso = new Date().toISOString();
    const twoFrames = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const waitFor = async (predicate, timeoutMs = 10_000) => {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error('profile workload timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const sampleScroll = async (preferredSelector) => {
      const candidates = [
        document.querySelector(preferredSelector),
        document.getElementById('talks-list'),
        document.getElementById('main-view-container'),
        document.getElementById('contacts-list-container'),
        document.getElementById('contacts-list'),
        document.scrollingElement,
      ].filter(Boolean);
      let target = candidates.sort(
        (a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight),
      )[0];
      if (!target) {
        return { frames: 0, droppedFrames: 0, p95FrameMs: null, maxFrameMs: null, constrainedViewport: false };
      }
      let constrainedViewport = false;
      if (target.scrollHeight <= target.clientHeight) {
        target = document.querySelector(preferredSelector) || target;
      }
      const originalStyle = target.getAttribute('style');
      if (target.scrollHeight <= target.clientHeight) {
        target.style.height = `${Math.min(600, Math.max(320, innerHeight - 180))}px`;
        target.style.overflowY = 'auto';
        constrainedViewport = true;
      }
      target.scrollTop = 0;
      const intervals = [];
      let previous = performance.now();
      for (let frame = 1; frame <= 60; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame((at) => {
          intervals.push(at - previous);
          previous = at;
          target.scrollTop = ((target.scrollHeight - target.clientHeight) * frame) / 60;
          resolve();
        }));
      }
      const sorted = [...intervals].sort((a, b) => a - b);
      const result = {
        frames: intervals.length,
        droppedFrames: intervals.filter((duration) => duration > 20).length,
        p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
        maxFrameMs: Math.max(...intervals),
        constrainedViewport,
      };
      if (constrainedViewport) {
        if (originalStyle === null) target.removeAttribute('style');
        else target.setAttribute('style', originalStyle);
      }
      return result;
    };

    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    const talks = {};
    for (let i = 0; i < talkCount; i += 1) {
      const id = `perf-talk-${String(i).padStart(4, '0')}`;
      talks[id] = {
        talkId: id,
        title: `Performance Talk ${i}`,
        type: 'flow',
        language: 'en',
        timestamp: nowIso,
        lastInteraction: new Date(Date.now() - i * 1000).toISOString(),
        role: 'created',
        disabled: false,
        fullTalk: { id, title: `Performance Talk ${i}`, type: 'flow', questions: [] },
      };
    }
    localStorage.setItem('myTalks', JSON.stringify(talks));

    const exchanges = {};
    for (let i = 0; i < contactCount; i += 1) {
      const peerId = `perf-peer-${String(i).padStart(4, '0')}`;
      exchanges[`${peerId}::perf-contact-talk-${i}`] = {
        peerId,
        peerName: `Performance Contact ${i}`,
        talkId: `perf-contact-talk-${i}`,
        title: `Contact Talk ${i}`,
        outcome: i % 3 === 0 ? 'mismatch' : 'match',
        direction: i % 2 === 0 ? 'sent' : 'received',
        date: new Date(Date.now() - i * 1000).toISOString(),
      };
    }
    localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));

    const routeHost = document.createElement('div');
    routeHost.id = 'route-editor';
    routeHost.style.cssText = 'position:absolute;left:-10000px;width:900px;';
    document.body.appendChild(routeHost);
    ui.routeEditorQuestions = Array.from({ length: 100 }, (_, i) => ({
      id: `perf-q-${i}`,
      text: `Performance question ${i}`,
      answers: [
        { id: `perf-q-${i}-yes`, text: 'Yes', isMatch: true, isTerminal: true },
        { id: `perf-q-${i}-no`, text: 'No', isIgnore: true, isTerminal: true },
      ],
    }));
    const routeMountStart = performance.now();
    ui.renderRouteEditor();
    void routeHost.offsetHeight;
    const routeMountMs = performance.now() - routeMountStart;
    const routeInput = routeHost.querySelector('.route-question-text');
    const routeUpdateStart = performance.now();
    routeInput.value = 'Updated performance question';
    routeInput.dispatchEvent(new Event('input', { bubbles: true }));
    void routeHost.offsetHeight;
    const routeUpdateMs = performance.now() - routeUpdateStart;
    const routeDomNodes = routeHost.querySelectorAll('*').length;
    routeHost.remove();

    const talksStart = performance.now();
    document.querySelector('.nav-btn[data-view="talks"]').click();
    const talksFirstRows = document.querySelectorAll('#talks-list .talk-list-item').length;
    const talksFirstChunkMs = performance.now() - talksStart;
    await waitFor(() => document.querySelectorAll('#talks-list .talk-list-item').length >= talkCount);
    await twoFrames();
    const talksFullRenderMs = performance.now() - talksStart;
    const talksScroll = await sampleScroll('#talks-list');
    const talksInput = document.getElementById('talks-filter-query');
    const talksInputStart = performance.now();
    talksInput.value = 'Performance Talk 499';
    talksInput.dispatchEvent(new Event('input', { bubbles: true }));
    await twoFrames();
    const talksInputLatencyMs = performance.now() - talksInputStart;

    const contactsStart = performance.now();
    document.querySelector('.nav-btn[data-view="contacts"]').click();
    const contactsFirstRows = document.querySelectorAll('#contacts-list .contact-item').length;
    const contactsFirstChunkMs = performance.now() - contactsStart;
    await waitFor(() => document.querySelectorAll('#contacts-list .contact-item').length >= contactCount);
    await twoFrames();
    const contactsFullRenderMs = performance.now() - contactsStart;
    const contactsScroll = await sampleScroll('#contacts-list');
    const contactsInput = document.getElementById('contacts-filter-name');
    const contactsInputStart = performance.now();
    contactsInput.value = 'Performance Contact 499';
    contactsInput.dispatchEvent(new Event('input', { bubbles: true }));
    await twoFrames();
    const contactsInputLatencyMs = performance.now() - contactsInputStart;

    const profileRuntime = window.__iinpublicProfileRuntime || { longTasks: [], events: [] };
    const longTasks = profileRuntime.longTasks || [];
    const events = profileRuntime.events || [];
    return {
      dataset: { talks: talkCount, contacts: contactCount, routeQuestions: 100 },
      routeEditor: { mountMs: routeMountMs, updateMs: routeUpdateMs, domNodes: routeDomNodes },
      talks: {
        firstRows: talksFirstRows,
        firstChunkMs: talksFirstChunkMs,
        fullRenderMs: talksFullRenderMs,
        inputLatencyMs: talksInputLatencyMs,
        scroll: talksScroll,
      },
      contacts: {
        firstRows: contactsFirstRows,
        firstChunkMs: contactsFirstChunkMs,
        fullRenderMs: contactsFullRenderMs,
        inputLatencyMs: contactsInputLatencyMs,
        scroll: contactsScroll,
      },
      longTasks: {
        count: longTasks.length,
        totalDurationMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
        top: [...longTasks].sort((a, b) => b.duration - a.duration).slice(0, 10),
      },
      eventTiming: {
        count: events.length,
        p95DurationMs: events.length
          ? [...events].map((entry) => entry.duration).sort((a, b) => a - b)[Math.floor(events.length * 0.95)]
          : null,
        maxDurationMs: events.length ? Math.max(...events.map((entry) => entry.duration)) : null,
      },
      heapBeforeBytes: heapBefore,
      heapAfterBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, { talkCount: TALK_COUNT, contactCount: CONTACT_COUNT });
}

function normalizeNumbers(value) {
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeNumbers(child)]));
  }
  return typeof value === 'number' ? round(value) : value;
}

async function profileChromium(label, contextOptions) {
  const processLaunchEpochMs = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  try {
    const context = await browser.newContext(contextOptions);
    await context.addInitScript(() => {
      const state = { longTasks: [], events: [] };
      window.__iinpublicProfileRuntime = state;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch { /* unsupported */ }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.events.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          }
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      } catch { /* unsupported */ }
    });
    const page = await context.newPage();
    const url = `http://127.0.0.1:${WEB_PORT}/?perf_process_launch_ms=${processLaunchEpochMs}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const cold = await measureStartup(page, `${label}-cold`);
    const interactions = await measureInteractionWorkload(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    const warm = await measureStartup(page, `${label}-warm`);
    await context.close();
    return normalizeNumbers({ cold, warm, interactions });
  } finally {
    await browser.close();
  }
}

function electronLaunchTarget() {
  const explicit = String(process.env.IINPUBLIC_DESKTOP_EXECUTABLE || '').trim();
  if (explicit) return { executablePath: explicit, args: [] };
  if (process.platform === 'darwin') {
    const packaged = path.join(
      ROOT,
      'platforms/desktop/dist/mac-arm64/IinPublic.app/Contents/MacOS/IinPublic',
    );
    if (existsSync(packaged)) return { executablePath: packaged, args: [] };
    const executablePath = path.join(
      ROOT,
      'platforms/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    );
    return { executablePath, args: ['.'], cwd: path.join(ROOT, 'platforms/desktop') };
  }
  if (process.platform === 'win32') {
    const executablePath = path.join(ROOT, 'platforms/desktop/node_modules/electron/dist/electron.exe');
    return { executablePath, args: ['.'], cwd: path.join(ROOT, 'platforms/desktop') };
  }
  const executablePath = path.join(ROOT, 'platforms/desktop/node_modules/electron/dist/electron');
  return { executablePath, args: ['.'], cwd: path.join(ROOT, 'platforms/desktop') };
}

async function profileElectron() {
  const target = electronLaunchTarget();
  if (!existsSync(target.executablePath)) {
    throw new Error(`Electron executable missing: ${target.executablePath}`);
  }
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'iinpublic-ui-profile-'));
  let application;
  try {
    application = await electron.launch({
      executablePath: target.executablePath,
      args: ['--enable-precise-memory-info', '--disable-features=WebRtcHideLocalIpsWithMdns', ...target.args],
      ...(target.cwd ? { cwd: target.cwd } : {}),
      env: {
        ...process.env,
        IINPUBLIC_LOCAL_PORT: String(ELECTRON_PORT),
        IINPUBLIC_HUB_GUN_URL: `http://127.0.0.1:${GUN_PORT}/gun`,
        IINPUBLIC_USER_DATA_DIR: userDataDir,
        IINPUBLIC_LAN_DISCOVERY_ENABLED: '0',
        E2E_GUN_MEMORY_ONLY: '0',
        DEV_GUN_FRESH: '0',
      },
      timeout: 120_000,
    });
    const page = await application.firstWindow();
    await installRuntimeObservers(page);
    const cold = await measureStartup(page, 'electron-release-assets-cold');
    const interactions = await measureInteractionWorkload(page);
    return normalizeNumbers({ cold, interactions });
  } finally {
    await application?.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

function bundleInventory() {
  const distWeb = path.join(ROOT, 'dist/web');
  const files = readdirSync(distWeb)
    .filter((filename) => filename.endsWith('.js') && !filename.endsWith('.js.map'))
    .sort((a, b) => (a === 'bundle.js' ? -1 : b === 'bundle.js' ? 1 : a.localeCompare(b)));
  return Object.fromEntries(files.map((filename) => {
    const filePath = path.join(distWeb, filename);
    const bytes = readFileSync(filePath);
    const source = bytes.toString('utf8');
    return [filename, {
      bytes: statSync(filePath).size,
      gzipBytes: gzipSync(bytes).length,
      contentHints: filename === 'bundle.js' ? [] : [
        ...(source.includes('helia') || source.includes('createHelia') ? ['helia'] : []),
        ...(source.includes('maplibre') || source.includes('maplibregl') ? ['maplibre'] : []),
      ],
    }];
  }));
}

async function main() {
  if (!existsSync(path.join(ROOT, 'dist/web/bundle.js'))) {
    throw new Error('dist/web/bundle.js is missing; run npm run build:production first');
  }
  launchProcess(process.execPath, ['dist/server/server/index.js'], {
    env: {
      PORT: String(GUN_PORT),
      CHATROOM_MAX_CAPACITY: '50',
      CHATROOM_ENABLE_FIFO: 'false',
      E2E_GUN_MEMORY_ONLY: '1',
      RELAY_ONLY_HUB: '1',
      STAR_SERVER_PERSISTENCE: 'ephemeral',
      IINPUBLIC_LAN_DISCOVERY_ENABLED: '0',
    },
  });
  launchProcess(process.execPath, ['scripts/e2e-static-web.mjs', String(WEB_PORT)], {
    env: { IINPUBLIC_STATIC_CACHE: '1' },
  });
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${GUN_PORT}/health`),
    waitForHttp(`http://127.0.0.1:${WEB_PORT}/`),
  ]);

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    workingTreeDirty: execFileSync('git', ['status', '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim().length > 0,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      chromium: chromium.name(),
      measurement: 'production webpack assets served locally; fresh isolated profile per platform',
    },
    dataset: { talks: TALK_COUNT, contacts: CONTACT_COUNT, routeQuestions: 100 },
    bundles: bundleInventory(),
    profiles: {
      browserDesktop: await profileChromium('browser-desktop', {
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      }),
      androidPixel5Profile: await profileChromium('android-pixel-5-profile', devices['Pixel 5']),
      electronDesktop: await profileElectron(),
    },
  };

  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`[profile-ui] wrote ${path.relative(ROOT, OUTPUT)}\n`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

try {
  await main();
} finally {
  await Promise.all(children.map(stopChild));
}
