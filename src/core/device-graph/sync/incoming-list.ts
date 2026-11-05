/**
 * The incoming list from the device graph (OPEN-106 step 2e iv, spec §31.10). A Talk someone sent
 * me is a graph arrival; the list shows the ones the app accepted (its intake filters, its
 * receiving limit), one row per Talk content with every sender that sent it — the app's
 * `IncomingTalkClusterWire`. The core keeps only what the graph does not:
 *
 *   ix/shown/<talkId>   { <senderId>: '{"name":…,"omit":[…]}' }   accepted from this sender
 *
 * `omit`: the tags left out of what I am asked (already exchanged with the author, REQ-LEDGER-16),
 * so the row is the Talk as the app was given it. Rows are built on each read; nothing of the
 * Talk is stored twice. A Talk its author deleted leaves the list (its arrivals read as none).
 */
import { buildTalkIdentityKey } from '../../../shared/cid';
import {
  DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS,
  mergeIncomingTalkCluster,
  type IncomingTalkClusterWire,
} from '../../../shared/peer-talk-delivery';
import { filterTalkForRecipient } from '../../../shared/tag-identity';
import type { DeviceGraph } from '../device-graph';
import { linkSoul, type NodeStore } from '../node-store';
import { graphSouls } from '../talk-structure';
import { appTalkOf } from './graph-host';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Shown = { name: string; omit?: string[] };

export function createIncomingList(options: { store: NodeStore; graph: DeviceGraph; maxRows?: number }) {
  const { store, graph } = options;
  const souls = graphSouls(graph.prefix);
  const shownSoul = (talkId: string) => souls.index(`shown/${talkId}`);
  const maxRows = options.maxRows ?? DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS;

  function parseShown(raw: unknown): Shown | undefined {
    if (typeof raw !== 'string') return undefined;
    try {
      const value = JSON.parse(raw);
      return value && typeof value.name === 'string' ? value : undefined;
    } catch { return undefined; }
  }

  /** When each sender's latest arrival of this Talk was written. */
  async function arrivalTimes(talkId: string): Promise<Map<string, number>> {
    const received = await store.get(souls.index(`received/${talkId}`));
    const out = new Map<string, number>();
    await Promise.all(Object.entries(received || {}).map(async ([userId, value]) => {
      const soul = linkSoul(value);
      const arrival = soul ? await store.get(soul) : null;
      if (arrival && !arrival.ignored) out.set(userId, Number(arrival.when) || 0);
    }));
    return out;
  }

  return {
    /** The app accepted this Talk from this sender: it is on the list. */
    async accept(talkId: string, senderId: string, senderName: string, omit?: string[]): Promise<void> {
      const value: Shown = { name: senderName || senderId, ...(omit?.length ? { omit: omit.map(String) } : {}) };
      await store.put(shownSoul(talkId), { [senderId]: JSON.stringify(value) });
    },

    /** The list, newest row last-updated first, at most `maxRows` rows. */
    async rows(): Promise<IncomingTalkClusterWire[]> {
      const deliveries: Array<{ talkId: string; talkData: Record<string, unknown>; senderId: string; senderName: string; when: number }> = [];
      for (const talkId of await graph.arrivals.incoming()) {
        const shown = await store.get(shownSoul(talkId));
        if (!shown) continue;
        const talk = await graph.arrivals.read(talkId);
        if (!talk) continue;
        const times = await arrivalTimes(talkId);
        const base = appTalkOf(talk as any);
        for (const senderId of talk.senders) {
          const accepted = parseShown(shown[senderId]);
          if (!accepted || !times.has(senderId)) continue;
          let body: Record<string, any> = base;
          if (accepted.omit?.length) {
            const trimmed = filterTalkForRecipient(base as any, new Set(accepted.omit));
            if (!trimmed) continue;
            body = trimmed.filtered as Record<string, any>;
          }
          deliveries.push({ talkId, senderId, senderName: accepted.name, when: times.get(senderId)!, talkData: { ...body, id: talkId, authorId: senderId, authorName: accepted.name } });
        }
      }
      // Oldest first, so each row ends on its latest delivery.
      deliveries.sort((a, b) => a.when - b.when);
      const rows = new Map<string, IncomingTalkClusterWire>();
      for (const delivery of deliveries) {
        const key = buildTalkIdentityKey(delivery.talkData);
        rows.set(key, mergeIncomingTalkCluster(rows.get(key), { ...delivery, now: new Date(delivery.when) }));
      }
      return [...rows.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, maxRows);
    },
  };
}

export type IncomingList = ReturnType<typeof createIncomingList>;
