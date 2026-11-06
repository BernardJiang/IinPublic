/**
 * The device graph (OPEN-106) in e2e: the counts of my Talks written into it, Talk ids from it.
 * It runs in whichever core the page uses (the web worker, or a phone's embedded node).
 */
import { expect, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A new Talk id from this page's device graph (OPEN-106 step 2e): a Talk the spec writes into the
 * author's My Talks and sends over graph links must be known by its graph id on both sides.
 */
export async function newGraphTalkId(page: Page): Promise<string> {
  const id = await page.evaluate(() => (window as any).__iinpublic_new_talk_id?.() ?? null);
  if (typeof id !== 'string' || !id) throw new Error('this page has no device graph to take a Talk id from');
  return id;
}

export function deviceGraphStatus(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__iinpublic_device_graph_status?.() ?? null);
}

/** Waits until the counts include `expected`, with no read-back mismatch and no error. */
export async function expectDeviceGraph(page: Page, label: string, expected: Record<string, number>): Promise<void> {
  await expect.poll(() => deviceGraphStatus(page), { timeout: 20_000, message: `${label}: my Talks in the device graph` })
    .toMatchObject({ enabled: true, ...expected, errors: 0 });
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
