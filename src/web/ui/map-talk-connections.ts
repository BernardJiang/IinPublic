import type { MapEffectPoint } from './map-broadcast-effects';

export type MapTalkConnection = {
  peerId: string;
  name: string;
  count: number;
  from: MapEffectPoint;
  to: MapEffectPoint;
};
type ConnectionText = { count: (count: number) => string; with: (name: string) => string; open: string };
const NS = 'http://www.w3.org/2000/svg';

/** Neutral exchange history, separate from transient broadcast waves. No animation loop. */
export class MapTalkConnections {
  private readonly root = document.createElement('div');
  private readonly svg = document.createElementNS(NS, 'svg');
  private readonly panel = document.createElement('div');
  private readonly title = document.createElement('span');
  private readonly open = document.createElement('button');
  private readonly rows = new Map<string, { line: SVGLineElement; hit: SVGLineElement; label: HTMLButtonElement }>();
  private links = new Map<string, MapTalkConnection>();
  private selected: string | undefined;
  private text?: ConnectionText;
  private openTalks?: (peerId: string, name: string) => void;
  private obstacles: readonly MapEffectPoint[] = [];

  constructor(host: HTMLElement) {
    this.root.className = 'chatroom-map-connections';
    this.root.dataset.testid = 'map-talk-connections';
    this.svg.classList.add('chatroom-map-connection-lines');
    this.panel.className = 'chatroom-map-connection-panel';
    this.panel.dataset.testid = 'map-connection-panel';
    this.open.type = 'button';
    this.open.dataset.testid = 'map-connection-open';
    this.open.addEventListener('click', (event) => { event.stopPropagation(); this.activate(); });
    this.panel.addEventListener('click', (event) => event.stopPropagation());
    this.panel.addEventListener('dblclick', (event) => { event.preventDefault(); event.stopPropagation(); });
    this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.panel.append(this.title, this.open);
    this.panel.hidden = true;
    this.root.append(this.svg, this.panel);
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      const previous = this.rows.get(this.selected ?? '');
      this.select();
      previous?.hit.focus();
    });
    host.appendChild(this.root);
  }

  sync(links: readonly MapTalkConnection[], text: ConnectionText, openTalks: (peerId: string, name: string) => void, obstacles: readonly MapEffectPoint[] = []): void {
    this.links = new Map(links.map((link) => [link.peerId, link]));
    this.text = text;
    this.openTalks = openTalks;
    this.obstacles = obstacles;
    for (const [id, row] of this.rows) {
      if (this.links.has(id)) continue;
      row.line.remove(); row.hit.remove(); row.label.remove(); this.rows.delete(id);
    }
    if (this.selected && !this.links.has(this.selected)) this.selected = undefined;
    for (const link of links) {
      let row = this.rows.get(link.peerId);
      if (!row) {
        const line = document.createElementNS(NS, 'line');
        line.classList.add('chatroom-map-connection-line');
        const hit = document.createElementNS(NS, 'line');
        hit.classList.add('chatroom-map-connection-hit');
        hit.dataset.testid = 'map-talk-line';
        hit.dataset.peerId = link.peerId;
        hit.setAttribute('role', 'button');
        hit.setAttribute('tabindex', '0');
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'chatroom-map-connection-label';
        label.dataset.testid = 'map-talk-line-label';
        label.dataset.peerId = link.peerId;
        for (const element of [hit, label]) {
          element.addEventListener('pointerdown', (event) => event.stopPropagation());
          element.addEventListener('click', (event) => { event.stopPropagation(); this.select(link.peerId); });
          element.addEventListener('dblclick', (event) => {
            event.preventDefault(); event.stopPropagation(); this.select(link.peerId); this.activate();
          });
          element.addEventListener('keydown', (event) => {
            if (!(event instanceof KeyboardEvent)) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation(); this.select(link.peerId);
              this.open.focus();
            }
          });
        }
        this.svg.append(line, hit);
        this.root.appendChild(label);
        row = { line, hit, label };
        this.rows.set(link.peerId, row);
      }
      for (const element of [row.line, row.hit]) {
        element.setAttribute('x1', String(link.from.x)); element.setAttribute('y1', String(link.from.y));
        element.setAttribute('x2', String(link.to.x)); element.setAttribute('y2', String(link.to.y));
      }
      const label = `${text.with(link.name)} · ${text.count(link.count)}`;
      row.hit.setAttribute('aria-label', label);
      row.label.setAttribute('aria-label', label);
      row.label.textContent = text.count(link.count);
      // Keep count labels away from both the star and the person's marker.
      row.label.style.left = `${link.from.x + (link.to.x - link.from.x) * 0.62}px`;
      row.label.style.top = `${link.from.y + (link.to.y - link.from.y) * 0.62}px`;
    }
    this.paintSelection();
  }

  select(peerId?: string): void { this.selected = this.links.has(peerId ?? '') ? peerId : undefined; this.paintSelection(); }
  clear(): void {
    this.links.clear(); this.selected = undefined;
    for (const row of this.rows.values()) { row.line.remove(); row.hit.remove(); row.label.remove(); }
    this.rows.clear(); this.panel.hidden = true;
  }
  destroy(): void { this.clear(); this.root.remove(); }

  private activate(): void {
    const link = this.links.get(this.selected ?? '');
    if (link) this.openTalks?.(link.peerId, link.name);
  }

  private paintSelection(): void {
    const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const labelHeight = window.matchMedia?.('(pointer: coarse)').matches ? 44 : 28;
    // In small Places the lines remain tappable, but overlapping labels yield to person markers.
    // The selected line's panel always carries its full count and Open action.
    const ordered = [...this.rows].sort(([a], [b]) => Number(b === this.selected) - Number(a === this.selected));
    for (const [id, row] of ordered) {
      const link = this.links.get(id)!;
      const x = link.from.x + (link.to.x - link.from.x) * 0.62;
      const y = link.from.y + (link.to.y - link.from.y) * 0.62;
      const width = Math.max(44, (row.label.textContent?.length ?? 0) * 7 + 16);
      const rect = { left: x - width / 2, right: x + width / 2, top: y - labelHeight / 2, bottom: y + labelHeight / 2 };
      const hitsMarker = [...this.obstacles, link.from, link.to].some((point) =>
        Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom)) < 24);
      const hitsLabel = occupied.some((other) => rect.left < other.right + 4 && rect.right > other.left - 4 && rect.top < other.bottom + 4 && rect.bottom > other.top - 4);
      row.label.hidden = hitsMarker || hitsLabel;
      if (!row.label.hidden) occupied.push(rect);
    }
    for (const [id, row] of this.rows) {
      const selected = this.selected === id;
      row.line.classList.toggle('selected', selected);
      row.line.classList.toggle('dimmed', !!this.selected && !selected);
      row.label.classList.toggle('dimmed', !!this.selected && !selected);
      row.label.setAttribute('aria-pressed', String(selected));
      row.hit.setAttribute('aria-pressed', String(selected));
    }
    const link = this.links.get(this.selected ?? '');
    this.panel.hidden = !link;
    if (link && this.text) {
      this.title.textContent = `${this.text.with(link.name)} · ${this.text.count(link.count)}`;
      this.open.textContent = this.text.open;
    }
  }
}
