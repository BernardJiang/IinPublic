/** @jest-environment jsdom */
import { listBroadcastAnchors, syncListBroadcastEffects } from '../../web/ui/list-broadcast-effects';
import { MapBroadcastEffects, type MapBroadcastEvent } from '../../web/ui/map-broadcast-effects';

describe('list broadcast effects', () => {
  let container: HTMLElement;
  let host: HTMLElement;
  let effects: MapBroadcastEffects;
  const rect = (top: number, height = 40) => ({ top, left: 14, width: 40, height, bottom: top + height, right: 54 } as DOMRect);
  const event = (direction: 'outgoing' | 'incoming'): MapBroadcastEvent => ({
    id: direction, direction, roomId: 'nearby-v3', userId: direction === 'incoming' ? 'eve' : 'me', at: Date.now(),
  });
  const rows = () => {
    host.innerHTML = `<button data-broadcast-user-id="me" data-broadcast-self="true"><span class="chatroom-member-avatar"></span></button>
      <div data-broadcast-user-id="eve"><span class="chatroom-member-avatar"></span></div>
      <div data-broadcast-user-id="bob"><span class="chatroom-member-avatar"></span></div>
      <div data-chatroom-id="place"><span class="chatroom-member-avatar"></span></div>`;
    host.querySelectorAll('.chatroom-member-avatar').forEach((avatar, i) => {
      avatar.getBoundingClientRect = () => rect(20 + i * 80);
    });
  };
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="container"><section></section></div>';
    container = document.getElementById('container')!;
    host = container.querySelector('section')!;
    container.getClientRects = () => [rect(0, 400)] as unknown as DOMRectList;
    host.getBoundingClientRect = () => ({ ...rect(0, 400), left: 0, width: 320, right: 320 });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
    rows();
    effects = new MapBroadcastEffects(container, () => listBroadcastAnchors(host), () => ({ outgoing: 'Sending ↓', incoming: 'Receiving ↑' }), host, 'list');
  });
  afterEach(() => { effects.destroy(); document.body.innerHTML = ''; jest.useRealTimers(); });

  it('sends down to recipient avatars, receives up from the sender, and excludes Places', () => {
    effects.sync([{ ...event('outgoing'), recipientIds: ['eve', 'place'] }, event('incoming')]);
    const outgoing = host.querySelector('[data-direction="outgoing"]')!;
    const incoming = host.querySelector('[data-direction="incoming"]')!;
    expect(outgoing.querySelectorAll('line')).toHaveLength(1);
    expect(outgoing.querySelector('line')!.getAttribute('y1')).toBe('40');
    expect(outgoing.querySelector('line')!.getAttribute('y2')).toBe('120');
    expect(incoming.querySelector('line')!.getAttribute('y1')).toBe('120');
    expect(incoming.querySelector('line')!.getAttribute('y2')).toBe('40');
    expect(outgoing.querySelectorAll('path')).toHaveLength(3);
    expect(incoming.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(host.textContent).toContain('Sending ↓Receiving ↑');
    expect(host.querySelectorAll('svg')).toHaveLength(1);
  });

  it('retains elapsed time across roster replacement and does not replay on refresh', () => {
    const broadcast = event('outgoing');
    effects.sync([broadcast]);
    const svg = host.querySelector('svg');
    jest.advanceTimersByTime(1500);
    rows();
    effects.attach(host);
    effects.sync([broadcast]);
    expect(host.querySelector('svg')).toBe(svg);
    jest.advanceTimersByTime(1200);
    expect(host.querySelectorAll('[data-event-id]')).toHaveLength(0);
    effects.sync([broadcast]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('updates geometry on scroll and uses only an arrival halo for an offscreen sender', () => {
    host.style.overflowY = 'auto';
    host.querySelector('[data-broadcast-user-id="eve"] .chatroom-member-avatar')!.getBoundingClientRect = () => rect(900);
    effects.sync([event('incoming')]);
    expect(host.querySelectorAll('line, path')).toHaveLength(0);
    expect(host.querySelector('circle')!.getAttribute('cy')).toBe('40');
    host.scrollTop = 10;
    jest.advanceTimersByTime(32);
    expect(host.querySelector('circle')!.getAttribute('cy')).toBe('50');
    container.getClientRects = () => [] as unknown as DOMRectList;
    jest.advanceTimersByTime(32);
    expect(host.querySelectorAll('[data-event-id]')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('shows static direction cues with reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    effects.sync([event('outgoing'), event('incoming')]);
    const before = host.querySelector('svg')!.innerHTML;
    jest.advanceTimersByTime(500);
    expect(host.querySelector('svg')!.innerHTML).toBe(before);
    jest.advanceTimersByTime(2200);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears active effects when the account or room changes', () => {
    effects.destroy();
    const labels = { outgoing: 'Sending ↓', incoming: 'Receiving ↑' };
    syncListBroadcastEffects(container, host, 'me/nearby', [event('outgoing')], labels);
    expect(host.querySelectorAll('[data-event-id]')).toHaveLength(1);
    syncListBroadcastEffects(container, host, 'me/place', [], labels);
    expect(host.querySelectorAll('[data-event-id]')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
