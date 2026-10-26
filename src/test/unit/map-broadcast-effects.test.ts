/** @jest-environment jsdom */
import { MapBroadcastEffects, MAP_BROADCAST_DURATION_MS, type MapBroadcastEvent, type MapEffectAnchors } from '../../web/ui/map-broadcast-effects';

const event = (direction: 'outgoing' | 'incoming', id: string = direction): MapBroadcastEvent =>
  ({ id, roomId: 'nearby-v3', userId: direction === 'outgoing' ? 'adam' : 'eve', direction, at: Date.now() });

describe('map broadcast effects', () => {
  let container: HTMLDivElement;
  let effects: MapBroadcastEffects;
  let anchors: MapEffectAnchors;
  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(container, 'getClientRects', { value: () => [{ width: 320, height: 500 }] });
    Object.defineProperty(container, 'clientWidth', { value: 320 });
    Object.defineProperty(container, 'clientHeight', { value: 500 });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
    anchors = { self: { x: 160, y: 250 }, peers: new Map([['eve', { x: 80, y: 180 }]]), nearby: [{ x: 80, y: 180 }] };
    effects = new MapBroadcastEffects(container, () => anchors);
  });
  afterEach(() => { effects.destroy(); container.remove(); jest.useRealTimers(); });

  it('sends blue waves from me to peers and distinct purple dashed pulses from the sender to me', () => {
    effects.sync([event('outgoing'), event('incoming')]);
    const outgoing = container.querySelector('[data-direction="outgoing"]')!;
    const incoming = container.querySelector('[data-direction="incoming"]')!;
    expect(outgoing.getAttribute('stroke')).not.toBe(incoming.getAttribute('stroke'));
    expect(outgoing.querySelector('line')!.getAttribute('x1')).toBe('160');
    expect(outgoing.querySelector('line')!.getAttribute('x2')).toBe('80');
    expect(incoming.querySelector('line')!.getAttribute('x1')).toBe('80');
    expect(incoming.querySelector('line')!.getAttribute('x2')).toBe('160');
    expect(incoming.querySelector('circle')!.getAttribute('stroke-dasharray')).toBe('4 5');
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('only directs outgoing pulses to the selected recipients', () => {
    anchors.peers.set('other', { x: 250, y: 100 });
    anchors.nearby.push({ x: 250, y: 100 });
    effects.sync([{ ...event('outgoing'), recipientIds: ['eve'] }]);
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(container.querySelector('line')!.getAttribute('x2')).toBe('80');
  });

  it('expires without looping, replaying on data refresh, or leaving an animation timer', () => {
    const broadcast = event('outgoing');
    effects.sync([broadcast]);
    jest.advanceTimersByTime(500);
    effects.sync([broadcast]);
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(1);
    jest.advanceTimersByTime(MAP_BROADCAST_DURATION_MS);
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
    effects.sync([broadcast]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('tracks projected markers as the map moves, and stops when hidden', () => {
    effects.sync([event('incoming')]);
    anchors.self = { x: 200, y: 300 };
    jest.advanceTimersByTime(32);
    expect(container.querySelector('line')!.getAttribute('x2')).toBe('200');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('uses static indicators for reduced motion and never invents an unknown sender’s location', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    effects.sync([{ ...event('incoming'), userId: 'unknown' }]);
    expect(container.querySelectorAll('line')).toHaveLength(0);
    expect(container.querySelector('circle')!.getAttribute('cx')).toBe('160');
    effects.sync([event('incoming', 'known')]);
    jest.advanceTimersByTime(32);
    const before = container.innerHTML;
    jest.advanceTimersByTime(500);
    expect(container.innerHTML).toBe(before);
  });

  it('bounds simultaneous effects during a burst', () => {
    effects.sync(Array.from({ length: 30 }, (_, i) => event('outgoing', String(i))));
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(8);
  });
});
