/**
 * OPEN-108 (spec §31.13 REQ-GRAPH-40..45) across two devices, written once against TestActor:
 * phone-path/12 runs it with host phone nodes and native-app/39 with two real phones; the web
 * version is stage2/97.
 *
 *   J-GRAPH-01  after a real exchange (a Talk, its answer), each device's own event chain
 *               verifies and each holds the other's signed acknowledgement of its log;
 *   J-GRAPH-02  one of A's own chained events rewritten where the stopped device keeps it is
 *               reported by the restarted core (`chainBreaks`, the first bad seq), never repaired.
 *
 * The tamper itself depends on where the device keeps its store (a folder, a phone's private
 * files), so the spec passes it in as `restartWithTamperedEvent`.
 */
import { expect, type Page } from '@playwright/test';
import type { TestActor } from '../helpers/test-actor';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ChainStatus = { ok: boolean; checked: number; chainBreaks: number; firstBadSeq?: number; reason?: string };
export type GraphLinkStatus = { peerUserId: string; open: boolean; lastAck?: { n: number; when: number; skewMs: number } };
export type GraphStatus = { userId?: string; links: GraphLinkStatus[]; chain?: ChainStatus };

export const graphStatus = (page: Page): Promise<GraphStatus | null> =>
  page.evaluate(() => (window as any).__iinpublic_graph_status?.() ?? null);

/** My device id, as embedded in every graph id this device hands out (`<when>-<deviceId>-<n>`). */
export async function graphDeviceId(page: Page): Promise<string> {
  const id = await page.evaluate(() => (window as any).__iinpublic_new_talk_id?.() ?? null);
  const device = typeof id === 'string' ? id.split('-')[1] ?? '' : '';
  if (!/^[0-9a-f]{32}$/.test(device)) throw new Error(`no graph device id on this page (got ${JSON.stringify(id)})`);
  return device;
}

/** J-GRAPH-01: both chains verify, and each side holds the other's signed acknowledgement. */
export async function expectSignedExchange(a: TestActor, aId: string, b: TestActor, bId: string, timeout = 90_000): Promise<void> {
  for (const [actor, peerId] of [[a, bId], [b, aId]] as const) {
    await expect.poll(async () => {
      const status = await graphStatus(actor.page);
      const link = status?.links.find((l) => l.peerUserId === peerId);
      return { chainOk: status?.chain?.ok ?? null, ack: typeof link?.lastAck?.n === 'number', skew: typeof link?.lastAck?.skewMs === 'number' };
    }, { timeout, message: `${actor.id}: own chain not verified, or no signed acknowledgement from ${peerId.slice(0, 8)}` })
      .toEqual({ chainOk: true, ack: true, skew: true });
  }
}

/**
 * J-GRAPH-02: `restartWithTamperedEvent` stops A, rewrites one of A's own chained events (by A's
 * device id) and starts A again, returning the page and the tampered event's seq. The restarted
 * core must report exactly that break, by its signature.
 */
export async function expectTamperReported(
  a: TestActor,
  restartWithTamperedEvent: (deviceId: string) => Promise<{ page: Page; seq: number }>,
): Promise<void> {
  const deviceId = await graphDeviceId(a.page);
  const { page, seq } = await restartWithTamperedEvent(deviceId);
  await expect.poll(async () => (await graphStatus(page))?.chain ?? null, {
    timeout: 90_000, message: `${a.id} after restart: the tampered event (seq ${seq}) was never reported`,
  }).toMatchObject({ ok: false, chainBreaks: 1, firstBadSeq: seq, reason: 'sig' });
}
