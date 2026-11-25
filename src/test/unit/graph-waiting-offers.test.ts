import { GraphWaitingOffers } from '../../web/services/graph-waiting-offers';

describe('GraphWaitingOffers (OPEN-111 a)', () => {
  const setup = (open: Set<string>) => {
    let now = 1_000;
    const ready: string[] = [];
    const waiting = new GraphWaitingOffers({ isOpen: (id) => open.has(id), onReady: (id) => ready.push(id), now: () => now });
    return { waiting, ready, advance: (ms: number) => { now += ms; } };
  };

  it('offers again when the link opens later', () => {
    const { waiting, ready } = setup(new Set());
    waiting.add(['bob']);
    expect(ready).toEqual([]);
    expect(waiting.peers()).toEqual(['bob']);
    expect(waiting.opened('bob')).toBe(true);
    expect(ready).toEqual(['bob']);
    expect(waiting.opened('bob')).toBe(false);
  });

  it('offers again at once when the link opened while the offer was in the core', () => {
    const open = new Set<string>();
    const { waiting, ready } = setup(open);
    open.add('bob');
    expect(waiting.opened('bob')).toBe(false); // onOpened fired first: nobody waited yet
    waiting.add(['bob', 'cy']);
    expect(ready).toEqual(['bob']);
    expect(waiting.peers()).toEqual(['cy']);
  });

  it('re-checks an open link at most once per 5 s, so a core that keeps answering waiting cannot loop', () => {
    const { waiting, ready, advance } = setup(new Set(['bob']));
    waiting.add(['bob']);
    waiting.add(['bob']);
    expect(ready).toEqual(['bob']);
    expect(waiting.peers()).toEqual(['bob']);
    advance(5_000);
    waiting.add(['bob']);
    expect(ready).toEqual(['bob', 'bob']);
  });

  it('a neighbor that connects takes over what waited', () => {
    const { waiting, ready } = setup(new Set());
    waiting.add(['bob']);
    expect(waiting.take('bob')).toBe(true);
    expect(waiting.opened('bob')).toBe(false);
    expect(ready).toEqual([]);
  });
});
