/**
 * The person↔tag graph (OPEN-87 S4), built only from data this device already holds:
 * - a person likes a tag when they sent it to me (they own that tag Talk: the senders of my incoming
 *   cluster for its identity key), or when a tag exchange with them matched (they liked my copy, or
 *   I liked theirs);
 * - I like a tag when it is one of my own active tag Talks (created or copied, not disabled).
 * A tag is its content identity key, so identical tags from different people are one node.
 */
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { STARTER_TAGS_SOURCE_ID } from '../../shared/starter-tags';

export type TagGraphInput = {
  currentUserId: string;
  /** Incoming talk clusters (identityKey, type, title, senders). */
  incoming: any[];
  /** My Talks map (`myTalks` local store). */
  myTalks: Record<string, any>;
  /** `localTalkExchanges` map: `${peerId}::${talkId}` → { peerId, peerName, talkId, type, title, outcome }. */
  exchanges: Record<string, any> | any[];
};

export type TagNode = { key: string; label: string; likers: Map<string, string>; mine: boolean };
export type TagGraph = { tags: Map<string, TagNode> };

const isTag = (value: any): boolean => String(value?.type || '').toLowerCase() === 'tag';
/** Local fixtures (starter source, demo guides) and TechSupport are not people in this graph. */
const isPerson = (id: string, me: string): boolean =>
  !!id && id !== me && id !== STARTER_TAGS_SOURCE_ID && id !== TECHSUPPORT_ROOT_USER_ID && !id.startsWith('iinpublic-demo-');

export function buildTagGraph(input: TagGraphInput): TagGraph {
  const tags = new Map<string, TagNode>();
  const node = (key: string, label: string): TagNode => {
    let found = tags.get(key);
    if (!found) {
      found = { key, label: label || key, likers: new Map(), mine: false };
      tags.set(key, found);
    } else if (!found.label || found.label === key) {
      found.label = label || key;
    }
    return found;
  };

  for (const [id, entry] of Object.entries(input.myTalks || {})) {
    const talk = entry?.fullTalk;
    if (!isTag(talk) || (entry?.role !== 'created' && entry?.role !== 'copied') || entry?.disabled) continue;
    node(String(talk?.id || id), String(talk?.title || entry?.title || '')).mine = true;
  }
  for (const cluster of input.incoming || []) {
    if (!isTag(cluster) || !cluster?.identityKey) continue;
    const tag = node(String(cluster.identityKey), String(cluster.title || ''));
    for (const [senderId, sender] of Object.entries<any>(cluster.senders || {})) {
      if (isPerson(senderId, input.currentUserId)) tag.likers.set(senderId, String(sender?.senderName || senderId));
    }
  }
  for (const exchange of Object.values<any>(input.exchanges || {})) {
    const peerId = String(exchange?.peerId || '');
    if (!isTag(exchange) || String(exchange?.outcome || '') !== 'match' || !isPerson(peerId, input.currentUserId)) continue;
    const tag = node(String(exchange.talkId || ''), String(exchange.title || ''));
    if (!tag.likers.has(peerId)) tag.likers.set(peerId, String(exchange.peerName || peerId));
  }
  tags.delete('');
  return { tags };
}

/** People who like a tag, the ones sharing the most of my tags first. */
export function likersOfTag(graph: TagGraph, key: string): Array<{ peerId: string; name: string; shared: number }> {
  const tag = graph.tags.get(key);
  if (!tag) return [];
  return Array.from(tag.likers, ([peerId, name]) => ({ peerId, name, shared: sharedTagCount(graph, peerId) }))
    .sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name));
}

/** A person's tags, the ones I like too first. */
export function tagsOfPeer(graph: TagGraph, peerId: string): Array<{ key: string; label: string; shared: boolean }> {
  return Array.from(graph.tags.values())
    .filter((tag) => tag.likers.has(peerId))
    .map((tag) => ({ key: tag.key, label: tag.label, shared: tag.mine }))
    .sort((a, b) => Number(b.shared) - Number(a.shared) || a.label.localeCompare(b.label));
}

export function sharedTagCount(graph: TagGraph, peerId: string): number {
  let count = 0;
  for (const tag of graph.tags.values()) if (tag.mine && tag.likers.has(peerId)) count += 1;
  return count;
}

/** Every known tag with how many people like it; `query` matches the label, case-insensitively. */
export function tagDirectory(graph: TagGraph, query = ''): Array<{ key: string; label: string; count: number; mine: boolean }> {
  const needle = query.trim().toLowerCase();
  return Array.from(graph.tags.values())
    .filter((tag) => (tag.mine || tag.likers.size > 0) && (!needle || tag.label.toLowerCase().includes(needle)))
    .map((tag) => ({ key: tag.key, label: tag.label, count: tag.likers.size, mine: tag.mine }))
    .sort((a, b) => b.count - a.count || Number(b.mine) - Number(a.mine) || a.label.localeCompare(b.label));
}
