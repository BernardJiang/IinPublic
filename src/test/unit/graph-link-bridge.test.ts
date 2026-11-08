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

  test('frames the mesh refuses for an open link are sent, in order, once it can (e2e 05-mailbox)', async () => {
    let pulls = 0;
    const core = jest.fn(async (request: any) => {
      if (request.name === 'graph.pull') {
        pulls += 1;
        if (pulls === 2) return { out: [{ to: 'tom', raw: 'my-head' }, { to: 'tom', raw: 'reply' }], events: [] };
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { out: [], events: [] };
      }
      return {};
    });
    // Tom's new connection is not live on this side yet: the first sends are refused.
    let live = false;
    const sent: string[] = [];
    const mesh = { sendGraphGun: async (_to: string, raw: string) => { if (!live) return false; sent.push(raw); return true; }, liveNeighborIds: () => [] };
    const bridge = new GraphLinkBridge({ core: core as any, mesh: () => mesh, keys: async () => ({ pub: 'tp', epub: 'te' }), onEvent: () => undefined });
    await bridge.start({ userId: 'me', pair });
    await expect(bridge.open('tom')).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toEqual([]);
    live = true;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sent).toEqual(['my-head', 'reply']);
    bridge.stop();
  });
});

describe('GraphLinkBridge: a neighbor whose keys are not known yet (native-app/12, 2026-11-08)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const idleCore = () => jest.fn(async (request: any) => {
    if (request.name === 'graph.pull') return new Promise(() => undefined); // the loop waits
    return {};
  });

  test('the link opens once their keys are found, while they stay connected', async () => {
    const core = idleCore();
    let keysKnown = false;
    const mesh = { sendGraphGun: async () => true, liveNeighborIds: () => ['bob'] };
    const onOpened: string[] = [];
    const bridge = new GraphLinkBridge({
      core: core as any, mesh: () => mesh,
      keys: async () => (keysKnown ? { pub: 'bp', epub: 'be' } : null), onEvent: () => undefined,
      onOpened: (id) => onOpened.push(id),
    });
    await bridge.start({ userId: 'me', pair });
    await jest.advanceTimersByTimeAsync(0);
    expect(core.mock.calls.some(([r]) => r.name === 'graph.open')).toBe(false);
    keysKnown = true; // their public record reached the hub
    await jest.advanceTimersByTimeAsync(4_000);
    expect(core.mock.calls.filter(([r]) => r.name === 'graph.open')).toEqual([[{ name: 'graph.open', peerUserId: 'bob', pub: 'bp', epub: 'be' }]]);
    // …and the app hears it, so the offers that waited for this link go now.
    expect(onOpened).toEqual(['bob']);
    bridge.stop();
  });

  test('it stops trying when they disconnect, or when the bridge stops', async () => {
    const core = idleCore();
    let live = ['bob', 'carol'];
    const keys = jest.fn(async (_userId: string): Promise<{ pub: string; epub: string } | null> => null);
    const mesh = { sendGraphGun: async () => true, liveNeighborIds: () => live };
    const bridge = new GraphLinkBridge({ core: core as any, mesh: () => mesh, keys, onEvent: () => undefined });
    await bridge.start({ userId: 'me', pair });
    await jest.advanceTimersByTimeAsync(0);
    expect(keys).toHaveBeenCalledTimes(2);
    live = ['carol']; // bob dropped
    bridge.close('bob');
    await jest.advanceTimersByTimeAsync(1_500);
    expect(keys.mock.calls.map(([id]) => id)).toEqual(['bob', 'carol', 'carol']);
    bridge.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(keys).toHaveBeenCalledTimes(3);
  });
});
