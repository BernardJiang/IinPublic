// graph.pull hands out what the page has not acknowledged (starter-tags spec, 2026-11-18): a pull
// answer that came after the page gave up waiting must not take its arrivals and frames with it.

import { createPullBuffer } from '../../core/device-graph/sync/graph-host';

const frame = (raw: string) => ({ to: 'kim', raw });
const talk = (talkId: string) => ({ type: 'talk' as const, talkId, from: 'kim' });

describe('graph.pull buffer', () => {
  it('hands a batch out again until the page acknowledges it', () => {
    const pulls = createPullBuffer();
    const first = pulls.handOut([frame('a')], [talk('t1')]);
    expect(first).toEqual({ out: [frame('a')], events: [talk('t1')], seq: 1 });
    // That answer never reached the page: its next pull acknowledges only what came before.
    pulls.acknowledge(0);
    const again = pulls.handOut([frame('b')], []);
    expect(again).toEqual({ out: [frame('a'), frame('b')], events: [talk('t1')], seq: 2 });
    pulls.acknowledge(2);
    expect(pulls.held()).toBe(0);
    expect(pulls.handOut([], [])).toEqual({ out: [], events: [], seq: 2 });
  });

  it('keeps everything for a pull without an acknowledgement, and at most the newest batches', () => {
    const pulls = createPullBuffer(2);
    pulls.handOut([frame('a')], []);
    pulls.acknowledge(undefined);
    pulls.handOut([frame('b')], []);
    expect(pulls.handOut([frame('c')], []).out).toEqual([frame('b'), frame('c')]);
  });
});
