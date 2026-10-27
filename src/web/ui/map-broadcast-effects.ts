export type MapBroadcastEvent = {
  id: string;
  roomId: string;
  userId: string;
  direction: 'outgoing' | 'incoming';
  at: number;
  recipientIds?: readonly string[];
};
export type MapEffectPoint = { x: number; y: number };
export type MapEffectAnchors = { self?: MapEffectPoint; peers: Map<string, MapEffectPoint>; nearby: MapEffectPoint[] };
export const MAP_BROADCAST_DURATION_MS = 2_600;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A short, bounded, local-only overlay. Never animates a transport retry or an idle map. */
export class MapBroadcastEffects {
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly active = new Map<string, MapBroadcastEvent>();
  private readonly seen = new Set<string>();
  private frame: number | undefined;
  private readonly onVisibility = () => { if (document.hidden) this.clear(); };

  constructor(
    private readonly container: HTMLElement,
    private readonly anchors: () => MapEffectAnchors,
    private readonly labels?: () => { outgoing: string; incoming: string } | undefined,
    host: HTMLElement = container,
    private readonly layout: 'map' | 'list' = 'map',
  ) {
    this.svg.classList.add('chatroom-map-broadcast-effects');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('data-testid', `${layout}-broadcast-effects`);
    host.appendChild(this.svg);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Keep event identity and elapsed time when a roster refresh replaces its rows. */
  attach(host: HTMLElement): void {
    if (this.svg.parentElement !== host) host.appendChild(this.svg);
  }

  sync(events: readonly MapBroadcastEvent[]): void {
    if (!this.visible()) { this.clear(); return; }
    const anchors = this.anchors();
    for (const event of events) {
      if (this.seen.has(event.id) || Date.now() - event.at >= MAP_BROADCAST_DURATION_MS || !anchors.self) continue;
      this.seen.add(event.id);
      this.active.set(event.id, event);
      if (this.active.size > 8) this.active.delete(this.active.keys().next().value!);
    }
    while (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    if (this.active.size && this.frame === undefined) this.draw();
  }

  clear(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.active.clear();
    this.svg.replaceChildren();
  }

  destroy(): void {
    this.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.svg.remove();
  }

  private visible(): boolean {
    return !document.hidden && this.container.isConnected && this.container.getClientRects().length > 0;
  }

  private draw = (): void => {
    this.frame = undefined;
    if (!this.visible()) { this.clear(); return; }
    const anchors = this.anchors();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const nodes: SVGElement[] = [];
    const shape = (name: 'circle' | 'line' | 'path', attributes: Record<string, string | number>, parent: SVGGElement) => {
      const node = document.createElementNS(SVG_NS, name);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      parent.appendChild(node);
    };
    for (const [id, event] of this.active) {
      const elapsed = Date.now() - event.at;
      if (elapsed >= MAP_BROADCAST_DURATION_MS || !anchors.self) { this.active.delete(id); continue; }
      const incoming = event.direction === 'incoming';
      const sender = incoming ? anchors.peers.get(event.userId) : undefined;
      const start = incoming ? sender ?? anchors.self : anchors.self;
      const recipients = event.recipientIds
        ? [...new Set(event.recipientIds.flatMap((id) => { const point = anchors.peers.get(id); return point ? [point] : []; }))]
        : anchors.nearby;
      // An unknown/off-map sender gets only an inward arrival halo, never a fabricated origin.
      const targets = incoming ? (sender ? [anchors.self] : []) : recipients.slice(0, 12);
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('data-direction', event.direction);
      group.setAttribute('data-event-id', id);
      group.setAttribute('stroke', incoming ? '#a855f7' : '#0284c7');
      group.setAttribute('fill', 'none');
      group.setAttribute('stroke-width', '2');
      group.setAttribute('opacity', String(reduced ? 0.7 : Math.min(1, (MAP_BROADCAST_DURATION_MS - elapsed) / 500)));
      const radius = Math.min(Math.max(this.container.clientWidth, this.container.clientHeight), Math.max(72, ...targets.map((point) => Math.hypot(point.x - start.x, point.y - start.y))));
      // Outgoing rings expand from me. Incoming rings expand from the sender, with directed
      // pulses and an arrival halo at me. Reduced motion keeps the same colour/direction static.
      for (let wave = 0; this.layout === 'map' && wave < (reduced ? 1 : 3); wave++) {
        const phase = reduced ? 0.65 : ((elapsed / 1_500 + wave / 3) % 1);
        shape('circle', { cx: start.x, cy: start.y, r: Math.max(8, radius * (incoming && !sender ? 1 - phase : phase)), opacity: reduced ? 0.5 : (1 - phase) * 0.65, 'stroke-dasharray': incoming ? '4 5' : 'none' }, group);
      }
      for (const target of targets) {
        shape('line', { x1: start.x, y1: start.y, x2: target.x, y2: target.y, opacity: 0.25, 'stroke-dasharray': incoming ? '3 6' : 'none' }, group);
        const phase = reduced ? 1 : Math.min(1, (elapsed % 1_200) / 900);
        shape('circle', { cx: start.x + (target.x - start.x) * phase, cy: start.y + (target.y - start.y) * phase, r: reduced ? 5 : 4, fill: incoming ? '#a855f7' : '#0284c7' }, group);
        if (this.layout === 'list') {
          // Narrow wavefronts travel along the avatar column without crossing names or Places.
          for (let wave = 0; wave < (reduced ? 1 : 3); wave++) {
            const progress = reduced ? 0.5 : (elapsed / 1_500 + wave / 3) % 1;
            const x = start.x + (target.x - start.x) * progress;
            const y = start.y + (target.y - start.y) * progress;
            const bend = incoming ? -12 : 12;
            shape('path', { d: `M ${x - 21} ${y} Q ${x} ${y + bend} ${x + 21} ${y}`, opacity: reduced ? 0.65 : (1 - progress) * 0.8, 'stroke-dasharray': incoming ? '4 3' : 'none' }, group);
          }
        }
      }
      if (this.layout === 'list' && !incoming && !targets.length) shape('circle', { cx: start.x, cy: start.y, r: 20, opacity: 0.6 }, group);
      if (incoming) shape('circle', { cx: anchors.self.x, cy: anchors.self.y, r: reduced ? 19 : 17 + 5 * Math.sin(elapsed / 170), opacity: 0.8 }, group);
      nodes.push(group);
    }
    const labels = this.labels?.();
    let labelRow = 0;
    for (const direction of ['outgoing', 'incoming'] as const) {
      if (!labels?.[direction] || ![...this.active.values()].some((event) => event.direction === direction)) continue;
      const label = document.createElementNS(SVG_NS, 'text');
      label.textContent = labels[direction];
      label.setAttribute('x', String(this.layout === 'list' ? (anchors.self?.x ?? 0) + 36 + 110 * labelRow : 12));
      label.setAttribute('y', String(this.layout === 'list' ? (anchors.self?.y ?? 0) + 18 : 24 + 22 * labelRow));
      labelRow++;
      label.setAttribute('class', 'chatroom-map-broadcast-label');
      label.setAttribute('fill', direction === 'outgoing' ? '#0369a1' : '#7e22ce');
      nodes.push(label);
    }
    this.svg.replaceChildren(...nodes);
    if (this.active.size) this.frame = requestAnimationFrame(this.draw);
  };
}
