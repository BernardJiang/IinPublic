/**
 * In-memory GUI projection of the device graph for OPEN-110. The device core owns the snapshot;
 * this module only lets synchronous tab renderers consume the most recently loaded copy. Nothing
 * here is durable, so every row remains rebuildable from events and graph indexes.
 */
import type {
  GraphPersonHistoryItem,
  GraphTabConversation,
  GraphTabPerson,
  GraphTabSnapshot,
  GraphTabTalk,
} from '../../core/device-graph/sync/graph-host';
import type { PeerSummary } from '../../shared/peer-summary-types';

let snapshot: GraphTabSnapshot | null = null;

export function setGraphTabSnapshot(next: GraphTabSnapshot | null): void {
  snapshot = next ? JSON.parse(JSON.stringify(next)) as GraphTabSnapshot : null;
}

export function getGraphTabSnapshot(): GraphTabSnapshot | null {
  return snapshot;
}

export function resetGraphTabSnapshotForTests(): void {
  snapshot = null;
}

function talkEntry(row: GraphTabTalk): Record<string, any> {
  const talk = row.talk as Record<string, any>;
  return {
    talkId: row.talkId,
    title: String(talk.title ?? ''),
    type: String(talk.type ?? 'flow'),
    ...(typeof talk.language === 'string' ? { language: talk.language } : {}),
    timestamp: new Date(Number(talk.updatedAt ?? talk.createdAt ?? 0) || 0).toISOString(),
    role: 'created',
    fullTalk: { ...talk, id: row.talkId, graphVersionId: row.versionId, graphVersionHistory: [...row.versionHistory] },
    disabled: talk.active === false,
  };
}

export function graphTalkProjection(talkId: string): Record<string, any> | undefined {
  const row = snapshot?.talks.find((candidate) => candidate.talkId === talkId);
  return row ? talkEntry(row) : undefined;
}

/** Graph fields win; the legacy row contributes device-local display state during migration. */
export function graphTalksForView(stored: Record<string, any>): Record<string, any> {
  const out = { ...stored };
  for (const row of snapshot?.talks ?? []) {
    const graph = talkEntry(row);
    const local = stored[row.talkId] ?? {};
    out[row.talkId] = {
      ...graph,
      ...local,
      talkId: graph.talkId,
      title: graph.title,
      type: graph.type,
      timestamp: graph.timestamp,
      role: 'created',
      fullTalk: graph.fullTalk,
      disabled: graph.disabled,
    };
  }
  return out;
}

function conversationEntry(row: GraphTabConversation): Record<string, any> {
  return {
    conversationId: row.conversationId,
    otherUserId: row.otherUserId,
    createdAt: new Date(row.startedAt || row.lastWhen || 0).toISOString(),
    lastMessageTime: new Date(row.lastWhen || row.startedAt || 0).toISOString(),
    ...(row.lastMessage !== undefined ? { lastMessage: row.lastMessage } : {}),
    graphLastEventId: row.lastEventId,
    ...(row.talkIds.length === 1 ? { talkId: row.talkIds[0] } : {}),
    relatedTalkIds: [...row.talkIds],
  };
}

export function graphConversationProjection(conversationId: string): Record<string, any> | undefined {
  const row = snapshot?.conversations.find((candidate) => candidate.conversationId === conversationId);
  return row ? conversationEntry(row) : undefined;
}

/** Membership and immutable latest-message fields come from the graph; UI state stays local. */
export function graphConversationsForView(stored: Record<string, any>): Record<string, any> {
  const out = { ...stored };
  for (const row of snapshot?.conversations ?? []) {
    const graph = conversationEntry(row);
    out[row.conversationId] = { ...graph, ...(stored[row.conversationId] ?? {}), ...graph };
  }
  return out;
}

function graphPeer(person: GraphTabPerson): PeerSummary {
  const conversationCount = person.conversationIds.length;
  // Exchange indexes count content atoms, not Talks. They prove membership but must never be
  // displayed as Talk statistics; legacy/event-derived exact counts merge on top when present.
  const talkCount = person.exchanged > 0 || person.answered > 0 ? 1 : 0;
  const total = Math.max(conversationCount, talkCount);
  return {
    peerId: person.userId,
    stageName: 'Unknown',
    lastInteractionAt: new Date(person.lastWhen || 0).toISOString(),
    stats: {
      sent: { talks: total, matches: conversationCount },
      received: { talks: 0, matches: 0 },
      mutualMatchedTalks: conversationCount,
      mutualTagCount: 0,
      totalTalks: total,
    },
  };
}

/**
 * Contacts membership from graph exchange/conversation indexes. Editable contacts merge later.
 * `ignoreConversationIds`: conversations that do not make a Contact (support channels — the
 * built-in TechSupport row stands for them, as in `deriveLocalPeers`); a person known only
 * through those is left out.
 */
export function graphContactPeers(options: { ignoreConversationIds?: ReadonlySet<string> } = {}): PeerSummary[] {
  const ignore = options.ignoreConversationIds;
  return (snapshot?.people ?? []).flatMap((person) => {
    const conversationIds = ignore ? person.conversationIds.filter((id) => !ignore.has(id)) : person.conversationIds;
    if (!conversationIds.length && !(person.exchanged > 0) && !(person.answered > 0)) return [];
    return [graphPeer({ ...person, conversationIds })];
  });
}

export function graphPersonHistory(userId: string): GraphPersonHistoryItem[] {
  return snapshot?.people.find((person) => person.userId === userId)?.history ?? [];
}

/** Talk → people edge projection used by graph-focus while the full query loads on demand. */
export function graphPeopleForTalk(talkId: string): Array<{ userId: string; when: number }> {
  return (snapshot?.people ?? []).flatMap((person) => {
    const newest = person.history.find((event) => event.talkId === talkId);
    return newest ? [{ userId: person.userId, when: newest.when }] : [];
  }).sort((a, b) => b.when - a.when || a.userId.localeCompare(b.userId));
}

export function graphTalkIdsForPerson(userId: string): string[] {
  const person = snapshot?.people.find((candidate) => candidate.userId === userId);
  const conversationTalks = (person?.conversationIds ?? []).flatMap((conversationId) =>
    snapshot?.conversations.find((conversation) => conversation.conversationId === conversationId)?.talkIds ?? []);
  return [...new Set([
    ...graphPersonHistory(userId).flatMap((event) => event.talkId ? [event.talkId] : []),
    ...conversationTalks,
  ])];
}

export function graphPlaceScopesForPerson(userId: string): Array<{ scopeId: string; at: number }> {
  return (snapshot?.nearbyScopes ?? []).flatMap((scope) =>
    scope.kind === 'place' && scope.members.some((member) => member.userId === userId)
      ? [{ scopeId: scope.scopeId, at: scope.updatedAt }]
      : []);
}

export function graphPeopleForPlace(scopeId: string): string[] {
  return snapshot?.nearbyScopes.find((scope) => scope.scopeId === scopeId && scope.kind === 'place')
    ?.members.map((member) => member.userId) ?? [];
}
