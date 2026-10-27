/** @jest-environment jsdom */
import { MapTalkConnections, type MapTalkConnection } from '../../web/ui/map-talk-connections';

const text = { count: (count: number) => `${count} Talks`, with: (name: string) => `With ${name}`, open: 'Open Talks' };
const link = (peerId = 'eve'): MapTalkConnection => ({ peerId, name: peerId, count: 3, from: { x: 100, y: 100 }, to: { x: 300, y: 100 } });

describe('map Talk connections', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="map"></div>'; });

  it('selects a wide line without navigating, supports its Open button, and stops map double-click zoom', () => {
    const host = document.getElementById('map')!;
    const background = jest.fn(); host.addEventListener('dblclick', background);
    const open = jest.fn();
    const overlay = new MapTalkConnections(host);
    overlay.sync([link(), link('bob')], text, open);
    const hit = host.querySelector('[data-testid="map-talk-line"]')!;
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(open).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="map-connection-panel"]')?.textContent).toBe('With eve · 3 TalksOpen Talks');
    expect(host.querySelectorAll('.chatroom-map-connection-line.dimmed')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[data-testid="map-connection-open"]')!.click();
    expect(open).toHaveBeenLastCalledWith('eve', 'eve');
    hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(background).not.toHaveBeenCalled();
  });

  it('preserves line targets and selection during pan/zoom and clears stale peer actions', () => {
    const host = document.getElementById('map')!;
    const open = jest.fn();
    const overlay = new MapTalkConnections(host);
    overlay.sync([link()], text, open);
    const hit = host.querySelector('[data-testid="map-talk-line"]')!;
    overlay.select('eve');
    overlay.sync([{ ...link(), to: { x: 500, y: 200 }, count: 4 }], text, open);
    expect(host.querySelector('[data-testid="map-talk-line"]')).toBe(hit);
    expect(hit.getAttribute('x2')).toBe('500');
    expect(host.querySelector('[data-testid="map-connection-panel"]')?.textContent).toContain('4 Talks');
    overlay.sync([], text, open);
    expect(host.querySelector('[data-testid="map-talk-line"]')).toBeNull();
    expect(host.querySelector<HTMLElement>('[data-testid="map-connection-panel"]')!.hidden).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-testid="map-connection-open"]')!.click();
    expect(open).not.toHaveBeenCalled();
    overlay.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('offers keyboard navigation and a single-tap label alternative', () => {
    const host = document.getElementById('map')!;
    const open = jest.fn();
    const overlay = new MapTalkConnections(host);
    overlay.sync([link()], text, open);
    const label = host.querySelector<HTMLButtonElement>('[data-testid="map-talk-line-label"]')!;
    label.click();
    expect(label.getAttribute('aria-pressed')).toBe('true');
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.activeElement).toBe(host.querySelector('[data-testid="map-connection-open"]'));
    expect(open).not.toHaveBeenCalled();
    (document.activeElement as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith('eve', 'eve');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector<HTMLElement>('[data-testid="map-connection-panel"]')!.hidden).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[data-testid="map-talk-line"]'));
  });

  it('keeps labels off nearby markers and other labels while retaining selectable lines', () => {
    const host = document.getElementById('map')!;
    const overlay = new MapTalkConnections(host);
    overlay.sync([link(), link('bob')], text, jest.fn());
    const labels = host.querySelectorAll<HTMLButtonElement>('[data-testid="map-talk-line-label"]');
    expect([...labels].filter((label) => !label.hidden)).toHaveLength(1);
    overlay.sync([{ ...link(), to: { x: 180, y: 100 } }], text, jest.fn());
    expect(host.querySelector<HTMLButtonElement>('[data-testid="map-talk-line-label"]')!.hidden).toBe(true);
    host.querySelector('[data-testid="map-talk-line"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector<HTMLElement>('[data-testid="map-connection-panel"]')!.hidden).toBe(false);
    expect(host.querySelector('[data-testid="map-connection-panel"]')!.textContent).toContain('3 Talks');
  });
});
