/**
 * The page's half of graph links: what the core writes for a link that is still opening (its first
 * reads of the other person's log) is sent once the link is open, not dropped. Dropped, the
 * subscription was lost and Gun never asks again: answers to a Talk were never read (e2e mass/02,
 * the 2026-11-07 release run).
 */
import { GraphLinkBridge } from '../../web/services/graph-link-bridge';

const pair = { pub: 'p', priv: 'q', epub: 'e', epriv: 'f' };

describe('GraphLinkBridge', () => {
  test('frames for a link that is still opening are sent when it opens', async () => {
    let finishOpen: () => void = () => undefined;
    let openStarted: () => void = () => undefined;
    const opening = new Promise<void>((resolve) => { openStarted = resolve; });
    let pulls = 0;
    const core = jest.fn(async (request: any) => {
      if (request.name === 'graph.open') {
        // The core queues its first reads while it opens the link (as graph-sync's open does).
        openStarted();
        await new Promise<void>((resolve) => { finishOpen = resolve; });
        return {};
      }
      if (request.name === 'graph.pull') {
        pulls += 1;
        if (pulls === 1) { await opening; return { out: [{ to: 'bob', raw: 'first-read' }], events: [] }; }
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { out: [], events: [] };
      }
      return {};
    });
    const sent: Array<[string, string]> = [];
    const mesh = { sendGraphGun: async (to: string, raw: string) => { sent.push([to, raw]); return true; }, liveNeighborIds: () => [] };
    const bridge = new GraphLinkBridge({ core: core as any, mesh: () => mesh, keys: async () => ({ pub: 'bp', epub: 'be' }), onEvent: () => undefined });
    await bridge.start({ userId: 'me', pair });
    const opened = bridge.open('bob');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pulls).toBeGreaterThanOrEqual(1);
    expect(sent).toEqual([]);
    finishOpen();
    await expect(opened).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([['bob', 'first-read']]);
    bridge.stop();
  });

  test('frames for someone with no link opening are dropped', async () => {
    let pulls = 0;
    const core = jest.fn(async (request: any) => {
      if (request.name === 'graph.pull') {
        pulls += 1;
        if (pulls === 1) return { out: [{ to: 'carol', raw: 'stray' }], events: [] };
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { out: [], events: [] };
      }
      return {};
    });
    const sent: string[] = [];
    const mesh = { sendGraphGun: async (_to: string, raw: string) => { sent.push(raw); return true; }, liveNeighborIds: () => [] };
    const bridge = new GraphLinkBridge({ core: core as any, mesh: () => mesh, keys: async () => null, onEvent: () => undefined });
    await bridge.start({ userId: 'me', pair });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toEqual([]);
    bridge.stop();
  });
});
