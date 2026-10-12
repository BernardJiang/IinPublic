/**
 * Shared steps for the adaptive-Nearby map demos (stage4 specs 08/09): boot users at fixed points,
 * open the map, caption and capture the shaded Nearby area, and travel by tapping the map.
 */
import * as fs from 'fs';
import { PNG } from 'pngjs';
import { Browser, BrowserContext, Page, TestInfo, chromium } from '@playwright/test';
import { expect } from './fixtures';
import { injectIdbClear, gotoWebApp } from './clear-database';
import { afterLoad, afterNav, delay, headless } from './timing';
import { webBaseURL } from './ports';
import { attachE2eBrowserTabLabel } from './e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from './webrtc-chromium';

export type LatLng = { latitude: number; longitude: number };
/** Which chatroom view the demo watches: the map, or the plain list (no map at all). */
export type DemoView = 'map' | 'list';
const GRID_SIZE = { width: 480, height: 640 };
export type NearbyArea = { west: number; south: number; east: number; north: number; approximateDiameterMeters: number };

/** A few km apart around downtown San Diego. */
export const SAN_DIEGO_SPOTS: LatLng[] = [
  { latitude: 32.7157, longitude: -117.1611 },
  { latitude: 32.7300, longitude: -117.1500 },
  { latitude: 32.7050, longitude: -117.1750 },
  { latitude: 32.7400, longitude: -117.1800 },
];

export const formatDiameter = (meters: number): string =>
  meters >= 10_000 ? `${Math.round(meters / 1000).toLocaleString('en-US')} km` : `${(meters / 1000).toFixed(1)} km`;

export class NearbyMapDemo {
  readonly browsers: Browser[] = [];
  readonly contexts: BrowserContext[] = [];
  readonly frames: Array<{ label: string; step: string; diameter: string }> = [];

  constructor(private readonly info: TestInfo, private readonly url: string, readonly view: DemoView = 'map') {}

  /** `large` users get a big window, the rest small side windows; every window is recorded. */
  async boot(label: string, spot: LatLng, slot: number, large: boolean): Promise<Page> {
    // List view: four equal windows in a 2×2 grid, so every user's list is visible at once.
    const index = Number(label.slice(1)) - 1;
    const list = this.view === 'list';
    const size = list ? GRID_SIZE : large ? { width: 900, height: 950 } : { width: 480, height: 650 };
    const position = list
      ? `${(index % 2) * (GRID_SIZE.width + 10)},${Math.floor(index / 2) * (GRID_SIZE.height + 90)}`
      : large ? `${slot * 120},${slot * 40}` : `${900 + slot * 60},${slot * 60}`;
    const browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(0, 50),
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${position}`, `--window-size=${size.width},${size.height + 50}`],
    });
    this.browsers.push(browser);
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 1,
      recordVideo: { dir: this.info.outputPath(`video-${label}`), size },
    });
    this.contexts.push(context);
    const page = await context.newPage();
    await injectIdbClear(page);
    await page.addInitScript((loc) => { (window as any).__test_location = { ...loc, accuracy: 25 }; }, spot);
    await gotoWebApp(page, webBaseURL() + this.url, 30_000);
    await afterLoad();
    await expect.poll(() => roomOf(page), { timeout: 60_000, message: `${label} should join a Nearby room` }).toMatch(/^nearby_/);
    attachE2eBrowserTabLabel(page, label);
    return page;
  }

  async close(): Promise<void> {
    for (const context of this.contexts) {
      for (const page of context.pages()) {
        await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      }
      await context.close().catch(() => {});
    }
    for (const browser of this.browsers) await browser.close().catch(() => {});
  }

  /** Caption the page, let MapLibre settle, and save + attach a screenshot. */
  async capture(page: Page, label: string, step: string, people?: DemoPerson[]): Promise<void> {
    const area = await areaOf(page);
    const diameter = area ? formatDiameter(area.approximateDiameterMeters) : 'n/a';
    await caption(page, `${label}: ${step} — Nearby ≈ ${diameter}`);
    await page.waitForTimeout(2_500);
    if (people) await drawPeopleOverlay(page, people);
    const name = `${String(this.frames.length).padStart(2, '0')}-${label}`;
    const body = await page.screenshot({ path: this.info.outputPath(`${name}-map.png`) });
    await this.info.attach(`${name} ${step} (${diameter})`, { body, contentType: 'image/png' });
    this.frames.push({ label, step, diameter });
    console.log(`[map] ${label} ${step}: ${(await roomOf(page)).slice(0, 28)}… area ≈ ${diameter}`);
  }

  /** Show the demo's chatroom view (map or list) on this page. */
  async show(page: Page): Promise<void> {
    if (this.view === 'map') await openMap(page);
    else await openList(page);
  }

  /**
   * List view: caption every user's window, screenshot all four, and save them as one 2×2 image
   * (U1 U2 / U3 U4) so a single frame shows who is in which group.
   */
  async captureGrid(pages: Record<string, Page>, step: string): Promise<void> {
    const labels = Object.keys(pages).sort();
    const shots: PNG[] = [];
    for (const label of labels) {
      const page = pages[label]!;
      await caption(page, `${label}: ${step}`);
      // Below the Places section, so the current-group row stays readable.
      await page.evaluate(() => {
        const el = document.getElementById('e2e-map-caption');
        if (el) { el.style.top = 'auto'; el.style.bottom = '72px'; }
      });
    }
    await pages[labels[0]!]!.waitForTimeout(1_200);
    for (const label of labels) shots.push(PNG.sync.read(await pages[label]!.screenshot()));
    const cellW = Math.max(...shots.map((shot) => shot.width));
    const cellH = Math.max(...shots.map((shot) => shot.height));
    const grid = new PNG({ width: cellW * 2 + 6, height: cellH * Math.ceil(shots.length / 2) + 6 });
    grid.data.fill(255);
    shots.forEach((shot, i) => PNG.bitblt(shot, grid, 0, 0, shot.width, shot.height, (i % 2) * (cellW + 6), Math.floor(i / 2) * (cellH + 6)));
    const name = `${String(this.frames.length).padStart(2, '0')}-list`;
    const path = this.info.outputPath(`${name}.png`);
    const body = PNG.sync.write(grid);
    fs.writeFileSync(path, body);
    await this.info.attach(`${name} ${step}`, { body, contentType: 'image/png' });
    this.frames.push({ label: 'all', step, diameter: '' });
    const rooms = await Promise.all(labels.map(async (label) => `${label}:${(await roomOf(pages[label]!)).slice(-6)}`));
    console.log(`[list] ${step}: ${rooms.join('  ')}`);
  }

  summary(): string {
    return this.frames.map((f) => `  ${f.label.padEnd(4)} ${f.step.padEnd(40)} ${f.diameter}`).join('\n');
  }
}

/** Where one demo user is: their declared (home or travel) point and their current Nearby room. */
export type DemoPerson = { label: string; point: LatLng; roomId: string; area: NearbyArea | null; traveling: boolean; regionName?: string };

/** Snapshot every user's room and area; `points` is each user's current encounter point. */
export async function people(pages: Record<string, Page>, points: Record<string, LatLng>): Promise<DemoPerson[]> {
  const out: DemoPerson[] = [];
  for (const [label, page] of Object.entries(pages)) {
    out.push({ label, point: points[label]!, roomId: await roomOf(page), area: await areaOf(page), traveling: await isTraveling(page) });
  }
  return out;
}

const REGION_COLORS = ['#dc2626', '#2563eb', '#9333ea', '#ea580c', '#0891b2', '#65a30d'];

/**
 * TEST-ONLY overlay: a coloured outline + headcount for every occupied region. The app shows only
 * your own region; user dots (★ / green / yellow) are drawn by the app itself.
 */
export async function drawPeopleOverlay(page: Page, everyone: DemoPerson[]): Promise<void> {
  const rooms = [...new Set(everyone.map((person) => person.roomId))];
  const regions: Array<{ x: number; y: number; w: number; h: number; color: string; text: string }> = [];
  for (const [index, roomId] of rooms.entries()) {
    const members = everyone.filter((person) => person.roomId === roomId);
    const area = members[0]!.area;
    if (!area) continue;
    const nw = await mapPixelFor(page, { latitude: area.north, longitude: area.west });
    const se = await mapPixelFor(page, { latitude: area.south, longitude: area.east });
    regions.push({
      x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y,
      color: REGION_COLORS[index % REGION_COLORS.length]!,
      text: `${members[0]!.regionName ?? `Region ${String.fromCharCode(65 + index)}`} · ${members.length} user${members.length === 1 ? '' : 's'}`,
    });
  }
  // User pins come from the app itself now (star / green / yellow); the overlay adds only regions.
  const pins: Array<{ x: number; y: number; color: string; text: string }> = [];
  await page.evaluate(({ regions, pins }) => {
    document.getElementById('e2e-people-overlay')?.remove();
    const root = document.createElement('div');
    root.id = 'e2e-people-overlay';
    root.setAttribute('style', 'position:fixed;inset:0;z-index:99998;pointer-events:none');
    for (const region of regions) {
      const box = document.createElement('div');
      box.setAttribute('style', `position:fixed;left:${region.x}px;top:${region.y}px;width:${region.w}px;height:${region.h}px;`
        + `border:3px dashed ${region.color};box-sizing:border-box`);
      const tag = document.createElement('span');
      tag.textContent = region.text;
      tag.setAttribute('style', `position:absolute;left:0;top:-22px;padding:1px 6px;background:${region.color};color:#fff;`
        + 'font:700 12px system-ui;border-radius:4px;white-space:nowrap');
      box.appendChild(tag);
      root.appendChild(box);
    }
    for (const pin of pins) {
      const dot = document.createElement('div');
      dot.setAttribute('style', `position:fixed;left:${pin.x - 7}px;top:${pin.y - 7}px;width:14px;height:14px;border-radius:50%;`
        + `background:${pin.color};border:2px solid #fff;box-shadow:0 0 0 1px #0006`);
      const tag = document.createElement('span');
      tag.textContent = pin.text;
      tag.setAttribute('style', 'position:absolute;left:14px;top:-4px;padding:0 4px;background:#fff;color:#111;'
        + 'font:700 12px system-ui;border-radius:3px;box-shadow:0 0 0 1px #0004;white-space:nowrap');
      dot.appendChild(tag);
      root.appendChild(dot);
    }
    document.body.appendChild(root);
  }, { regions, pins });
}

export const roomOf = (page: Page): Promise<string> =>
  page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''));

export const areaOf = (page: Page): Promise<NearbyArea | null> =>
  page.evaluate(() => ((window as any).__iinpublic_app?.getApp?.()?.uiManager?.nearbyMapArea ?? null) as NearbyArea | null);

export const isTraveling = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.travelModeActive);

export async function openList(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="chatrooms"]').click();
  await afterNav();
  if (await page.locator('#back-to-chatrooms').isVisible().catch(() => false)) {
    await page.locator('#back-to-chatrooms').click();
    await afterNav();
  }
  await page.locator('[data-testid="chatroom-list-view-btn"]').click();
  await expect(page.locator('[data-testid="current-group-section"]')).toBeVisible({ timeout: 30_000 });
}

export async function openMap(page: Page): Promise<void> {
  await page.locator('.nav-btn[data-view="chatrooms"]').click();
  await afterNav();
  if (await page.locator('#back-to-chatrooms').isVisible().catch(() => false)) {
    await page.locator('#back-to-chatrooms').click();
    await afterNav();
  }
  await page.locator('[data-testid="chatroom-map-view-btn"]').click();
  const map = page.locator('[data-testid="chatroom-map"]');
  await expect(map).toHaveClass(/maplibregl-map/, { timeout: 30_000 });
  await expect(map).toHaveAttribute('data-nearby-area-visible', 'true', { timeout: 30_000 });
}

/** A fixed caption overlay so screenshots and video say what step they show. */
export const caption = (page: Page, text: string): Promise<void> => page.evaluate((value) => {
  let el = document.getElementById('e2e-map-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'e2e-map-caption';
    el.setAttribute('style', 'position:fixed;left:50%;transform:translateX(-50%);top:130px;z-index:99999;padding:8px 12px;max-width:80vw;'
      + 'background:rgba(15,23,42,.85);color:#fff;font:600 15px system-ui;border-radius:8px;pointer-events:none');
    document.body.appendChild(el);
  }
  el.textContent = `🧪 ${value}`; // test annotation only — never part of the app
}, text);

/**
 * Pixel of `point` on the map, assuming the view the map jumped to for the current Nearby area
 * (chatroom-map-view.ts focusCurrentRoom: area centre, zoom log2(earth / (2 × diameter)), 512 px tiles).
 */
async function mapPixelFor(page: Page, point: LatLng): Promise<{ x: number; y: number }> {
  const area = await areaOf(page);
  if (!area) throw new Error('no Nearby area to aim at');
  const box = (await page.locator('[data-testid="chatroom-map"]').boundingBox())!;
  const zoom = Math.max(2, Math.min(18, Math.log2(40_075_016 / Math.max(1, area.approximateDiameterMeters * 2))));
  const world = 512 * 2 ** zoom;
  const project = (p: LatLng) => {
    const sin = Math.sin((p.latitude * Math.PI) / 180);
    return {
      x: ((p.longitude + 180) / 360) * world,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world,
    };
  };
  const center = project({ latitude: (area.south + area.north) / 2, longitude: (area.west + area.east) / 2 });
  const target = project(point);
  return { x: box.x + box.width / 2 + (target.x - center.x), y: box.y + box.height / 2 + (target.y - center.y) };
}

/** Tap `point` on the map and press "Join as traveler" on the card that opens there. */
export async function travelByMapTap(page: Page, point: LatLng): Promise<void> {
  const { x, y } = await mapPixelFor(page, point);
  await page.mouse.click(x, y);
  const enter = page.locator('[data-testid="map-nearby-point-enter"]');
  await expect(enter).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800); // let the viewer see the card before it is used
  await enter.click();
  await expect.poll(() => isTraveling(page), { timeout: 30_000 }).toBe(true);
}

/** Leave travel with the app bar's Return home button. */
export async function returnHome(page: Page): Promise<void> {
  const button = page.locator('#return-home-btn');
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await button.click();
  await expect.poll(() => isTraveling(page), { timeout: 30_000 }).toBe(false);
}

/** Room → member labels, from each page's own current room. */
export async function occupancy(pages: Record<string, Page>): Promise<Map<string, string[]>> {
  const rooms = new Map<string, string[]>();
  for (const [label, page] of Object.entries(pages)) {
    const room = await roomOf(page);
    rooms.set(room, [...(rooms.get(room) ?? []), label]);
  }
  return rooms;
}

export const describeOccupancy = (rooms: Map<string, string[]>): string =>
  [...rooms.entries()].map(([room, labels]) => `${room.slice(-6)}:[${labels.join(',')}]`).join('  ');

/** Poll until no page changes room for `quietMs`; `onChange` sees each change. */
export async function waitUntilSettled(
  pages: Record<string, Page>,
  quietMs: number,
  timeoutMs: number,
  onChange?: (label: string, room: string) => Promise<void>,
): Promise<void> {
  const last = new Map<string, string>();
  for (const [label, page] of Object.entries(pages)) last.set(label, await roomOf(page));
  const started = Date.now();
  let lastChangeAt = Date.now();
  while (Date.now() - lastChangeAt < quietMs) {
    if (Date.now() - started > timeoutMs) throw new Error(`rooms did not settle within ${timeoutMs} ms`);
    for (const [label, page] of Object.entries(pages)) {
      const room = await roomOf(page);
      if (room !== last.get(label) && /^nearby_/.test(room)) {
        last.set(label, room);
        lastChangeAt = Date.now();
        await onChange?.(label, room);
      }
    }
    await pages[Object.keys(pages)[0]!]!.waitForTimeout(1_000);
  }
}
