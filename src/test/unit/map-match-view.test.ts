import type { MapMatchExchange, MapMatchUpdate } from '../../shared/map-matches';
import { MapMatchView } from '../../web/services/map-match-view';

describe('map match view', () => {
  const exchange = (outcome: MapMatchExchange['outcome'], revision = 1): MapMatchExchange =>
    ({ peerId: 'eve', talkId: 'talk-1', direction: 'sent', outcome, revision });

  it('applies Talk connection patches and removes old connections on a replacement snapshot or reset', () => {
    const publishTalks = jest.fn();
    const view = new MapMatchView(jest.fn(), publishTalks);
    let update!: (event: MapMatchUpdate) => void;
    view.setSource({ subscribe: (listener) => { update = listener; return jest.fn(); } });
    update({ type: 'snapshot', counts: {}, talkIdsByPeer: { eve: ['one', 'one', 'two'] } });
    expect(publishTalks).toHaveBeenLastCalledWith(new Map([['eve', ['one', 'two']]]));
    update({ type: 'patch', counts: {}, talkIdsByPeer: { bob: ['three'] } });
    expect(publishTalks).toHaveBeenLastCalledWith(new Map([['eve', ['one', 'two']], ['bob', ['three']]]));
    update({ type: 'patch', counts: {}, talkIdsByPeer: { eve: null } });
    expect(publishTalks).toHaveBeenLastCalledWith(new Map([['bob', ['three']]]));
    update({ type: 'snapshot', counts: {} });
    expect(publishTalks).toHaveBeenLastCalledWith(new Map());
    view.reset();
    update({ type: 'snapshot', counts: {}, talkIdsByPeer: { eve: ['stale'] } });
    expect(publishTalks).toHaveBeenLastCalledWith(new Map());
  });

  it('restores a core snapshot and applies committed count updates without reading storage', () => {
    const publish = jest.fn();
    const view = new MapMatchView(publish);
    let update!: (event: MapMatchUpdate) => void;
    view.setSource({ subscribe: (listener) => {
      update = listener;
      listener({ type: 'snapshot', counts: { eve: 3, bob: 1 } });
      return jest.fn();
    } });
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 3], ['bob', 1]]));
    update({ type: 'patch', counts: { eve: 4, bob: null, carol: 2 } });
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 4], ['carol', 2]]));
    view.observeExchange(exchange('mismatch', 2));
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 4], ['carol', 2]]));
    update({ type: 'snapshot', counts: { bob: 2, eve: 0, carol: -1, invalid: 1.5 } });
    expect(publish).toHaveBeenLastCalledWith(new Map([['bob', 2]]));
  });

  it('projects live outcomes, deduplicates directions, and rejects older revisions', () => {
    const publish = jest.fn();
    const view = new MapMatchView(publish);
    view.observeExchange(exchange('match'));
    view.observeExchange({ ...exchange('match'), direction: 'received' });
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
    view.observeExchange(exchange('mismatch', 2));
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
    view.observeExchange({ ...exchange('mismatch', 2), direction: 'received' });
    expect(publish).toHaveBeenLastCalledWith(new Map());
    view.observeExchange(exchange('match', 1));
    expect(publish).toHaveBeenLastCalledWith(new Map());
    view.observeExchange(exchange('match', 3));
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
  });

  it('clears the old owner and ignores late callbacks when replacing or resetting a source', () => {
    const publish = jest.fn();
    const view = new MapMatchView(publish);
    const unsubscribe = jest.fn();
    let previous!: (event: MapMatchUpdate) => void;
    view.setSource({ subscribe: (listener) => { previous = listener; return unsubscribe; } });
    previous({ type: 'snapshot', counts: { eve: 3 } });
    let current!: (event: MapMatchUpdate) => void;
    view.setSource({ subscribe: (listener) => { current = listener; return jest.fn(); } });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    previous({ type: 'patch', counts: { eve: 5 } });
    expect(publish).toHaveBeenLastCalledWith(new Map());
    current({ type: 'snapshot', counts: { bob: 2 } });
    expect(publish).toHaveBeenLastCalledWith(new Map([['bob', 2]]));
    view.reset();
    current({ type: 'patch', counts: { bob: 3 } });
    expect(publish).toHaveBeenLastCalledWith(new Map());
    view.observeExchange(exchange('match'));
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
  });

  it('clears a partially delivered snapshot if subscription fails', () => {
    const publish = jest.fn();
    const view = new MapMatchView(publish);
    expect(() => view.setSource({ subscribe: (listener) => {
      listener({ type: 'snapshot', counts: { eve: 2 } });
      throw new Error('disconnected');
    } })).toThrow('disconnected');
    expect(publish).toHaveBeenLastCalledWith(new Map());
    view.observeExchange(exchange('match'));
    expect(publish).toHaveBeenLastCalledWith(new Map([['eve', 1]]));
  });
});
