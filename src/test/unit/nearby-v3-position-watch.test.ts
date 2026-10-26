/** Phone-path J-PLACE-11: a move during a stuck search still sends my card to the hub at once. */
import { createPositionWatch } from '../../web/services/nearby-v3-runtime';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the position watch', () => {
  it('sends the card for a second move while the search for the first is stuck on slow swaps', async () => {
    let outOfPlace = false;
    const sent: string[] = [];
    let where = 'nearby';
    const service = {
      cardIsOutOfPlace: () => outOfPlace,
      reissueIfOutOfPlace: async () => { sent.push(where); outOfPlace = false; },
      // The search waits on a swap to someone who already left (two 15 s timeouts).
      refresh: () => new Promise<void>(() => undefined),
    };
    const check = createPositionWatch(service);

    where = 'place:cafe'; outOfPlace = true;
    check();
    await flush();
    expect(sent).toEqual(['place:cafe']);

    // Out again 20 ms later, with that search still running.
    where = 'nearby'; outOfPlace = true;
    check();
    await flush();
    expect(sent).toEqual(['place:cafe', 'nearby']);
  });

  it('does nothing while the card says where I am, and sends one card at a time', async () => {
    let release: () => void = () => undefined;
    const reissue = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const check = createPositionWatch({ cardIsOutOfPlace: () => true, reissueIfOutOfPlace: reissue, refresh: async () => undefined });
    check();
    check();
    expect(reissue).toHaveBeenCalledTimes(1);
    release();
    await flush();
    check();
    expect(reissue).toHaveBeenCalledTimes(2);

    const idle = jest.fn(async () => undefined);
    createPositionWatch({ cardIsOutOfPlace: () => false, reissueIfOutOfPlace: idle, refresh: idle })();
    expect(idle).not.toHaveBeenCalled();
  });
});
