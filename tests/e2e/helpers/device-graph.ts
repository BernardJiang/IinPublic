/**
 * The device graph mirror (OPEN-106 phase 4) in e2e: turn it on for a user, and check its counts.
 * It runs in whichever core the page uses (the web worker, or a phone's embedded node).
 */
import { expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function enableDeviceGraph(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__iinpublic_collection_edit('settings', { set: { deviceGraph: 'true' } }));
}

export function deviceGraphStatus(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__iinpublic_device_graph_status?.() ?? null);
}

/** Waits until the counts include `expected`, with no read-back mismatch and no error. */
export async function expectDeviceGraph(page: Page, label: string, expected: Record<string, number>): Promise<void> {
  await expect.poll(() => deviceGraphStatus(page), { timeout: 20_000, message: `${label}: device graph mirror` })
    .toMatchObject({ enabled: true, ...expected, mismatches: 0, errors: 0 });
}
