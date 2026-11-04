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

/**
 * OPEN-106 step 3: a graph event of this kind reached the page over a graph link (a Talk from
 * `from`, or an answer from `from`). Reads `window.__iinpublic_graph_events`.
 */
export async function expectGraphEvent(page: Page, label: string, type: 'talk' | 'answer' | 'talk-deleted', from?: string): Promise<void> {
  await expect.poll(() => page.evaluate(({ type, from }) => ((window as any).__iinpublic_graph_events ?? [])
    .some((event: any) => event.type === type && (!from || event.from === from)), { type, from }), {
    timeout: 30_000, message: `${label}: no ${type} event over a graph link`,
  }).toBe(true);
}

/**
 * OPEN-106: my answer to `authorId`'s Talk is in my device graph, where the Me tab reads it
 * (`graph.answerHistory`), with at least one answer.
 */
export async function expectGraphAnswerHistory(page: Page, label: string, authorId?: string): Promise<void> {
  await expect.poll(() => page.evaluate(async (author) => {
    const records = await ((window as any).__iinpublic_graph_answer_history?.() ?? []);
    return (records as any[]).some((record) => !record.mine && (!author || record.withUser === author) && record.answers?.length > 0);
  }, authorId ?? ''), { timeout: 30_000, message: `${label}: no answer to ${authorId || 'a received'} Talk in the device graph` }).toBe(true);
}
