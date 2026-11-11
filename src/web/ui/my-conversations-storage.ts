/**
 * My Conversations live in the device core (OPEN-91 P3, `core-views.ts`); this was one localStorage
 * JSON map (`myConversations`) rewritten whole on every message status change. Callers edit the
 * returned map and hand it back to `setMyConversations`, so reads are copies and only what changed
 * is written.
 */
import { myConversationsView } from '../services/core-views';
import { graphConversationProjection, graphConversationsForView } from '../services/graph-tab-projection';

export type MyConversationMap = Record<string, any>;

export function getMyConversations(): MyConversationMap {
  return JSON.parse(JSON.stringify(graphConversationsForView(myConversationsView.all()))) as MyConversationMap;
}

/** Replaces My Conversations with this map; only what changed is written. */
export function setMyConversations(conversations: MyConversationMap): void {
  const current = myConversationsView.all();
  const persisted = Object.fromEntries(Object.entries(conversations).flatMap(([id, record]) => {
    if (!graphConversationProjection(id)) return [[id, record]];
    // Membership and immutable message summaries are graph projections. The collection keeps
    // only editable/display state such as names, unread flags, block/deal state and presence.
    const {
      conversationId: _conversationId, otherUserId: _otherUserId, createdAt: _createdAt,
      lastMessage: _lastMessage, lastMessageTime: _lastMessageTime,
      graphLastEventId: _graphLastEventId, ...displayState
    } = record;
    return Object.keys(displayState).length ? [[id, displayState]] : [];
  }));
  const changed = Object.fromEntries(Object.entries(persisted)
    .filter(([id, record]) => JSON.stringify(current[id]) !== JSON.stringify(record)));
  myConversationsView.set(JSON.parse(JSON.stringify(changed)) as MyConversationMap);
  myConversationsView.remove(Object.keys(current).filter((id) => !(id in persisted)));
}
