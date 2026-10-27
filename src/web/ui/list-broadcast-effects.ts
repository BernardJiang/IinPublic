import { MapBroadcastEffects, type MapBroadcastEvent, type MapEffectAnchors } from './map-broadcast-effects';

type ListEffects = {
  scope: string;
  host: HTMLElement;
  labels: { outgoing: string; incoming: string };
  effects: MapBroadcastEffects;
};
const lists = new WeakMap<HTMLElement, ListEffects>();

/** Geometry comes only from rendered people. Place rows are never animation destinations. */
export function listBroadcastAnchors(host: HTMLElement): MapEffectAnchors {
  const bounds = host.getBoundingClientRect();
  const anchors: MapEffectAnchors = { peers: new Map(), nearby: [] };
  let top = 0;
  let bottom = window.innerHeight;
  for (let parent: HTMLElement | null = host; parent; parent = parent.parentElement) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
    const rect = parent.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  host.querySelectorAll<HTMLElement>('[data-broadcast-user-id]').forEach((row) => {
    const avatar = row.querySelector('.chatroom-member-avatar')?.getBoundingClientRect();
    if (!avatar?.width || !avatar.height) return;
    const x = avatar.left + avatar.width / 2;
    const y = avatar.top + avatar.height / 2;
    if (y < top || y > bottom || x < 0 || x > window.innerWidth) return;
    const point = { x: x - bounds.left + host.scrollLeft, y: y - bounds.top + host.scrollTop };
    if (row.dataset.broadcastSelf === 'true') anchors.self = point;
    else {
      anchors.peers.set(row.dataset.broadcastUserId!, point);
      anchors.nearby.push(point);
    }
  });
  return anchors;
}

export function syncListBroadcastEffects(
  container: HTMLElement,
  host: HTMLElement,
  scope: string,
  events: readonly MapBroadcastEvent[],
  labels: { outgoing: string; incoming: string },
): void {
  let state = lists.get(container);
  if (!state) {
    const created = { scope, host, labels } as ListEffects;
    created.effects = new MapBroadcastEffects(container, () => listBroadcastAnchors(created.host), () => created.labels, host, 'list');
    state = created;
    lists.set(container, state);
  }
  if (state.scope !== scope) state.effects.clear();
  state.scope = scope;
  state.host = host;
  state.labels = labels;
  state.effects.attach(host);
  state.effects.sync(events);
}
