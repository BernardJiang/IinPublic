/** OPEN-91 P6: real worker/storage ownership and per-tab sessions, in one browser origin. */
import { buildSync } from 'esbuild';
import SEA from 'gun/sea';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { waitForAppReady } from '../../helpers/timing';

const bridgeBundle = buildSync({
  entryPoints: ['src/web/services/gun-bridge.ts'], bundle: true, write: false,
  format: 'iife', globalName: 'CoreTest', platform: 'browser',
}).outputFiles[0].text;

async function client(context: BrowserContext, baseURL: string, dedicated: boolean): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseURL}/core-test.html`);
  if (dedicated) await page.evaluate(() => Object.defineProperty(window, 'SharedWorker', { value: undefined }));
  await page.addScriptTag({ content: bridgeBundle });
  await page.evaluate(async () => {
    const w = window as any;
    w.bridge = new w.CoreTest.GunBridge();
    w.events = [];
    await w.bridge.init();
  });
  return page;
}
const core = (page: Page, request: any) => page.evaluate((request) => (window as any).bridge.core(request), request);
const snapshot = (page: Page) => core(page, { name: 'collection.snapshot', collection: 'myTalks' });

for (const dedicated of [false, true]) {
  test(`${dedicated ? 'elected dedicated worker' : 'shared worker'} preserves simultaneous writes and survives a tab closing`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    await context.route('**/core-test.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Core ownership test</title>' }));
    try {
      const a = await client(context, baseURL!, dedicated);
      const b = await client(context, baseURL!, dedicated);
      const c = await client(context, baseURL!, dedicated);
      const expected = Object.fromEntries(Array.from({ length: 36 }, (_, i) => [`talk-${i}`, { title: `Talk ${i}` }]));
      await Promise.all([a, b, c].map((page, n) => core(page, {
        name: 'collection.upsert', collection: 'myTalks',
        entries: Object.fromEntries(Object.entries(expected).filter((_, i) => i % 3 === n)),
      })));
      for (const page of [a, b, c]) await expect.poll(() => snapshot(page)).toEqual(expected);

      // Every bridge allocates sub_1: sessions must not replace/unsubscribe another tab's listener.
      for (const page of [a, b, c]) await page.evaluate(() => {
        const w = window as any;
        w.unsubscribe = w.bridge.subscribe('local/tab-subscription', (data: any) => w.events.push(data?.value));
      });
      await a.evaluate(() => (window as any).bridge.put('local/tab-subscription', { value: 'before' }));
      for (const page of [a, b, c]) await expect.poll(() => page.evaluate(() => (window as any).events)).toContain('before');
      await a.evaluate(() => (window as any).unsubscribe());
      await b.evaluate(() => (window as any).bridge.put('local/tab-subscription', { value: 'after-unsubscribe' }));
      for (const page of [b, c]) await expect.poll(() => page.evaluate(() => (window as any).events)).toContain('after-unsubscribe');

      // Login/logout is per tab even though storage is shared. A different identity must not
      // replace the owner's signer while another tab is using it.
      const pair = await SEA.pair();
      for (const page of [a, b, c]) await page.evaluate(async (pair) => {
        const w = window as any;
        await w.bridge.login(pair);
        const auth = await w.bridge.gunTransport().call({ op: 'auth', pair });
        if (!auth.ok) throw new Error(auth.err);
      }, pair);
      await b.evaluate(() => (window as any).bridge.putPrivate('shared-test', { secret: 'same-owner' }));
      expect(await c.evaluate(() => (window as any).bridge.getPrivate('shared-test'))).toEqual({ secret: 'same-owner' });
      await a.evaluate(() => (window as any).bridge.logout());
      expect(await a.evaluate(() => (window as any).bridge.getPrivate('shared-test').catch((e: Error) => e.message))).toBe('Not logged in');
      expect(await c.evaluate(() => (window as any).bridge.getPrivate('shared-test'))).toEqual({ secret: 'same-owner' });
      const otherPair = await SEA.pair();
      expect(await a.evaluate((pair) => (window as any).bridge.login(pair).catch((e: Error) => e.message), otherPair)).toContain('Another identity');

      // Closing the first page kills the dedicated owner; followers must recover from disk.
      await a.close();
      await expect.poll(() => snapshot(b).catch(() => null), { timeout: 30_000 }).toEqual(expected);
      await expect.poll(() => c.evaluate(() => (window as any).bridge.getPrivate('shared-test').catch(() => null)), { timeout: 20_000 }).toEqual({ secret: 'same-owner' });
      await b.evaluate(() => (window as any).bridge.put('local/tab-subscription', { value: 'after-close' }));
      await expect.poll(() => c.evaluate(() => (window as any).events), { timeout: 20_000 }).toContain('after-close');
      await core(c, { name: 'collection.remove', collection: 'myTalks', keys: ['talk-0'] });
      delete expected['talk-0'];
      await expect.poll(() => snapshot(b)).toEqual(expected);

      // End every worker, then reload persisted data into a fresh owner on the same origin.
      await Promise.all([b, c].map((page) => page.evaluate(() => (window as any).bridge.terminate())));
      await Promise.all([b.close(), c.close()]);
      const reloaded = await client(context, baseURL!, dedicated);
      await expect.poll(() => snapshot(reloaded)).toEqual(expected);
    } finally { await context.close(); }
  });
}

// The raw worker cases above isolate storage races. This case uses normal custody/auth startup.
test('two app tabs keep the same identity and both confirmed edits after the first tab closes', async ({ browser }) => {
  const { context, page: a } = await bootstrapUser(browser, 'CoreTabs', 'Core Tabs Owner');
  try {
    const b = await context.newPage();
    await b.goto(a.url());
    await waitForAppReady(b);
    const identity = (page: Page) => page.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    expect(await identity(b)).toBe(await identity(a));
    for (const page of [a, b]) await page.evaluate(() => { (window as any).bridge = (window as any).__iinpublic_app.getApp().gunService.getBridge(); });
    await Promise.all([a, b].map((page, n) => core(page, { name: 'collection.upsert', collection: 'appData', entries: { [`core-tab-${n}`]: `saved-${n}` } })));
    const read = () => core(b, { name: 'collection.snapshot', collection: 'appData' });
    await expect.poll(read).toMatchObject({ 'core-tab-0': 'saved-0', 'core-tab-1': 'saved-1' });
    await a.close();
    await expect.poll(() => read().catch(() => null)).toMatchObject({ 'core-tab-0': 'saved-0', 'core-tab-1': 'saved-1' });
    await expect.poll(() => b.evaluate(() => (window as any).bridge.putPrivate('core-tab-probe', { saved: true }).then(() => (window as any).bridge.getPrivate('core-tab-probe')).catch(() => null)), { timeout: 20_000 }).toEqual({ saved: true });
  } finally { await context.close(); }
});

test('simultaneous first app tabs create one device identity', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ geolocation: { latitude: 32.7157, longitude: -117.1611 }, permissions: ['geolocation'] });
  await context.addInitScript(() => { (window as any).__test_location = { latitude: 32.7157, longitude: -117.1611, accuracy: 10 }; });
  try {
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(async (page) => { await page.goto(baseURL!); await waitForAppReady(page); }));
    const identities = await Promise.all(pages.map((page) => page.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      return { userId: app.currentUser.id, pub: app.gunService.getStoredPair().pub };
    })));
    expect(identities[0]).toEqual(identities[1]);
  } finally { await context.close(); }
});
