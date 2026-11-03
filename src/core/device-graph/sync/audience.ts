/**
 * Who may receive each of my shared graph souls (REQ-GRAPH-32): the outgoing audience filter asks
 * this, synchronously, for every message Gun would send to a direct link.
 *
 * - My Talk version `g/<me>/t/<talkTag>…` goes to the people I granted it to.
 * - My log to one person `g/<me>/p/<pairTag>…` goes to that person only.
 * - From a link I accept only that person's own souls `g/<them>/…`, so nobody can write into my
 *   part or anyone else's, and nothing is relayed: a soul is only ever sent by its sender.
 *
 * Grants are kept in `local/sync/grants/<talkTag>`, listed by month in `local/sync/grant-months/
 * <yyyy-mm>` (a node stays well under Radisk's 1 MB file), and loaded into memory at start.
 */
import type { NodeStore } from '../node-store';
import { parseGraphSoul, userTag } from './wire-names';

export type GraphAudience = {
  /** May this soul of mine be sent to this person's link? */
  mayReceive(peerUserId: string, soul: string): boolean;
  /** May this soul be accepted from (or asked of) this person's link? */
  mayAccept(peerUserId: string, soul: string): boolean;
};

export function createGraphAudience(store: NodeStore, options: { me: string; prefix?: string }) {
  const prefix = options.prefix ?? 'local/';
  const myTag = userTag(options.me);
  const grants = new Map<string, Set<string>>();
  const pairs = new Map<string, string>();
  const tags = new Map<string, string>();
  const tagOf = (userId: string) => {
    let tag = tags.get(userId);
    if (!tag) { tag = userTag(userId); tags.set(userId, tag); }
    return tag;
  };
  const grantSoul = (talkTag: string) => `${prefix}sync/grants/${talkTag}`;
  const months = `${prefix}sync/grant-months`;
  const month = (when: number) => new Date(when).toISOString().slice(0, 7);

  const audience: GraphAudience & {
    grant(talkTag: string, peerUserIds: string[], when?: number): Promise<void>;
    revoke(talkTag: string, peerUserIds: string[]): Promise<void>;
    setPair(peerUserId: string, pairTag: string): void;
    load(): Promise<number>;
    granted(talkTag: string): string[];
  } = {
    mayReceive(peerUserId, soul) {
      const parsed = parseGraphSoul(soul);
      if (!parsed || parsed.sender !== myTag) return false;
      if (parsed.kind === 'p') return pairs.get(peerUserId) === parsed.tag;
      return grants.get(parsed.tag)?.has(peerUserId) === true;
    },
    mayAccept(peerUserId, soul) {
      const parsed = parseGraphSoul(soul);
      return !!parsed && parsed.sender === tagOf(peerUserId);
    },
    async grant(talkTag, peerUserIds, when = Date.now()) {
      const set = grants.get(talkTag) ?? new Set<string>();
      const added = peerUserIds.filter((id) => !set.has(id));
      if (!added.length) return;
      for (const id of added) set.add(id);
      grants.set(talkTag, set);
      await Promise.all([
        store.put(grantSoul(talkTag), Object.fromEntries(added.map((id) => [id, true]))),
        ...(set.size === added.length ? [store.put(`${months}/${month(when)}`, { [talkTag]: true }), store.put(months, { [month(when)]: true })] : []),
      ]);
    },
    async revoke(talkTag, peerUserIds) {
      const set = grants.get(talkTag);
      if (!set) return;
      for (const id of peerUserIds) set.delete(id);
      await store.put(grantSoul(talkTag), Object.fromEntries(peerUserIds.map((id) => [id, null])));
    },
    setPair(peerUserId, pairTag) { pairs.set(peerUserId, pairTag); },
    granted: (talkTag) => [...(grants.get(talkTag) ?? [])],
    async load() {
      const directory = await store.get(months);
      const talkTags: string[] = [];
      for (const m of Object.keys(directory || {}).filter((k) => directory![k] === true)) {
        const node = await store.get(`${months}/${m}`);
        talkTags.push(...Object.keys(node || {}).filter((tag) => node![tag] === true));
      }
      await Promise.all(talkTags.map(async (talkTag) => {
        const node = await store.get(grantSoul(talkTag));
        grants.set(talkTag, new Set(Object.keys(node || {}).filter((id) => node![id] === true)));
      }));
      return talkTags.length;
    },
  };
  return audience;
}
