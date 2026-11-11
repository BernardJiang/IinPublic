/**
 * Idempotent import of the app's existing DM transport records into the device event log.
 *
 * During OPEN-110 migration the transport still owns delivery and decryption. Every plaintext
 * record it exposes is mirrored once as an immutable event; `sourceMessageId` is retained only as
 * provenance/deduplication so the graph can become the read model without double-rendering the
 * same message. The marker intentionally survives history trimming, just like `conv-seen`, so an
 * old transport replay cannot resurrect a trimmed message as a new event.
 */
import type { EventChainSigner } from './chain';
import { putEvent } from './events';
import { addToIndex } from './index-buckets';
import { maybeStampWhere, type Locator } from './location-graph';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { personIdOf, personSoul, personWrites } from './people-graph';
import { GRAPH_SCHEMA_VERSION, graphSouls } from './talk-structure';
import type { EventIds } from './talk-events';

export const MESSAGE_TEXT_MAX = 4000;
export const MESSAGE_CONV_MAX = 200;

export type ImportedMessage = {
  conversationId: string;
  otherUserId: string;
  sourceMessageId: string;
  senderId: string;
  text: string;
  when: number;
  talkId?: string;
  channel?: 'public' | 'known' | 'mutual';
  isFromChatbot?: boolean;
};

export function isConversationMessageEvent(event: GraphNode, prefix = 'local/'): boolean {
  return typeof event.text === 'string' && linkSoul(event.conv)?.startsWith(graphSouls(prefix).mine('conv/')) === true;
}

export function createMessageEventGraph(store: NodeStore, ids: EventIds, options: {
  prefix?: string;
  now?: () => number;
  chain?: EventChainSigner;
  locate?: Locator;
} = {}) {
  const prefix = options.prefix ?? 'local/';
  const souls = graphSouls(options.prefix);
  const now = options.now ?? Date.now;

  const markerSoul = (conversationId: string, sourceMessageId: string) =>
    souls.index(`conv-source/${encodeURIComponent(conversationId)}/${encodeURIComponent(sourceMessageId)}`);

  return {
    async importMessage(meUserId: string, input: ImportedMessage): Promise<{ eventId: string; created: boolean }> {
      const conversationId = String(input.conversationId || '');
      const otherUserId = String(input.otherUserId || '');
      const sourceMessageId = String(input.sourceMessageId || '');
      if (!conversationId || conversationId.length > MESSAGE_CONV_MAX || conversationId.includes('/')) {
        throw new Error('invalid message conversation id');
      }
      if (!meUserId || !otherUserId || otherUserId === meUserId) throw new Error('invalid message participants');
      if (!sourceMessageId || sourceMessageId.length > 500) throw new Error('invalid source message id');
      if (typeof input.text !== 'string' || input.text.length > MESSAGE_TEXT_MAX) throw new Error('invalid message text');
      if (input.senderId !== meUserId && input.senderId !== otherUserId) throw new Error('invalid message sender');

      const marker = await store.get(markerSoul(conversationId, sourceMessageId));
      const existing = linkSoul(marker?.ev);
      if (existing?.startsWith(souls.event(''))) {
        return { eventId: existing.slice(souls.event('').length), created: false };
      }

      const suppliedWhen = Number(input.when);
      const when = Number.isFinite(suppliedWhen) && suppliedWhen >= 0
        ? Math.min(Math.floor(suppliedWhen), now() + 5 * 60_000)
        : now();
      const eventId = await ids.next(when);
      const convSoul = souls.mine(`conv/${encodeURIComponent(conversationId)}`);
      const knownConversation = await store.get(convSoul);
      if (knownConversation && personIdOf(prefix, linkSoul(knownConversation.with)) !== otherUserId) {
        throw new Error('conversation belongs to another person');
      }

      const event: GraphNode = {
        v: GRAPH_SCHEMA_VERSION,
        when,
        device: await ids.deviceId(),
        with: link(personSoul(prefix, otherUserId)),
        conv: link(convSoul),
        text: input.text,
        sourceId: sourceMessageId,
      };
      if (input.senderId === meUserId) event.by = link(personSoul(prefix, meUserId));
      if (input.talkId) event.scopeTalk = input.talkId;
      if (input.channel) event.channel = input.channel;
      if (input.isFromChatbot === true) event.bot = true;

      const whereSidecar = await maybeStampWhere(store, options, event, eventId);
      const people = await personWrites(store, prefix, [
        ...(input.senderId === meUserId ? [{ userId: meUserId }] : []),
        { userId: otherUserId },
      ], when);
      const cell = linkSoul(event.where);
      const cellHead = `${prefix}cell/`;
      await Promise.all([
        ...people.map(([soul, node]) => store.put(soul, node)),
        putEvent(store, souls, eventId, event, options.chain, input.senderId === meUserId
          ? { ownBy: personSoul(prefix, meUserId) }
          : undefined),
        ...(knownConversation ? [] : [store.put(convSoul, {
          with: link(personSoul(prefix, otherUserId)),
          startedAt: when,
        })]),
        addToIndex(store, souls.index(`conv/${encodeURIComponent(conversationId)}`), {
          key: eventId,
          target: souls.event(eventId),
          when,
        }, 'day'),
        addToIndex(store, souls.index(`person/${encodeURIComponent(otherUserId)}/ev`), {
          key: eventId,
          target: souls.event(eventId),
          when,
        }),
        ...(cell?.startsWith(cellHead) ? [addToIndex(store, souls.index(`cell/${cell.slice(cellHead.length)}/ev`), {
          key: eventId,
          target: souls.event(eventId),
          when,
        }, 'day')] : []),
        store.put(souls.index('convs'), { [encodeURIComponent(conversationId)]: when }),
        store.put(markerSoul(conversationId, sourceMessageId), { ev: link(souls.event(eventId)) }),
        ...(whereSidecar ? [whereSidecar] : []),
      ]);
      return { eventId, created: true };
    },
  };
}
