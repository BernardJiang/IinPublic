/**
 * Local-only peer derivation for contacts view (P0 step 5).
 *
 * Derives the set of peers visible to the current user from three local sources:
 *   (a) localTalkExchanges (localStorage key "localTalkExchanges") — records written
 *       by app.ts#recordLocalTalkExchange when a response arrives over the mesh.
 *   (b) myConversations (passed in) — conversation records from localStorage; each
 *       entry with an otherUserId that differs from self is a confirmed match peer.
 *   (c) knownPeople (passed in) — SEA-encrypted private data for explicitly-labeled
 *       contacts; always included regardless of exchange history.
 *
 * Match % formula (mirrors peer-routes.ts#computeRelationshipStats):
 *   matchRate = (sent.matches + received.matches) / max(totalTalks, 1)
 *   matchPercent = round(matchRate * 100)
 *
 * Precedence when merging duplicate peerId entries across sources:
 *   1. localTalkExchanges stats (most authoritative — written on actual response events)
 *   2. myConversations stats (fallback — each conversation = 1 match)
 *   3. knownPeople stub (zero stats — just ensures the peer appears in the list)
 *   stageName: prefer non-"Unknown" value; latest non-empty wins.
 *   lastInteractionAt: latest timestamp wins.
 */

import type { KnownPerson } from '../../shared/types';
import type { PeerRelationshipStats, PeerSummary } from '../../server/routes/peer-routes';

// ── Local exchange record shape (written by app.ts#recordLocalTalkExchange) ──

export type LocalTalkExchange = {
  peerId: string;
  peerName: string;
  talkId: string;
  title: string;
  outcome: 'match' | 'mismatch' | 'ignore';
  direction: 'sent' | 'received';
  date: string;
  // R-2 forward-compat fields (steps 8-11)
  responseId?: string;
  version?: number;
  respondedAt?: string;
};

export type LocalTalkHistoryItem = {
  talkId: string;
  title: string;
  direction: 'sent' | 'received';
  outcome: 'match' | 'mismatch' | 'pending';
  date: string;
  type?: string;
  identityKey?: string;
};

/**
 * Read all local talk exchange records from localStorage.
 * Storage is a keyed object `{ "${peerId}::${talkId}": exchange }` (see app.ts).
 */
export function readLocalTalkExchanges(): LocalTalkExchange[] {
  try {
    const raw = localStorage.getItem('localTalkExchanges');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LocalTalkExchange[];
    if (parsed && typeof parsed === 'object') return Object.values(parsed) as LocalTalkExchange[];
    return [];
  } catch {
    return [];
  }
}

function emptyStats(): PeerRelationshipStats {
  return {
    sent: { talks: 0, matches: 0 },
    received: { talks: 0, matches: 0 },
    mutualMatchedTalks: 0,
    mutualTagCount: 0,
    totalTalks: 0,
  };
}

function newerDate(a: string | null | undefined, b: string | null | undefined): string {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  if (ta >= tb) return a ?? b ?? new Date(0).toISOString();
  return b ?? new Date(0).toISOString();
}

function pickName(current: string | undefined, candidate: string | undefined): string {
  const c = String(current || '').trim();
  const n = String(candidate || '').trim();
  if (!c || c === 'Unknown') return n || 'Unknown';
  return c;
}

/**
 * Derive PeerSummary entries from the localTalkExchanges localStorage store.
 *
 * Each exchange record keyed by `${peerId}::${talkId}` contributes one sent talk
 * to the sender's stats. Outcomes: 'match' increments sent.matches.
 *
 * Match % formula (mirrors server computeRelationshipStats):
 *   matchRate = sent.matches / max(sent.talks, 1)
 */
export function peersFromLocalTalkExchanges(currentUserId: string): PeerSummary[] {
  const byPeer = new Map<string, PeerSummary>();
  for (const exchange of readLocalTalkExchanges()) {
    const peerId = String(exchange?.peerId || '').trim();
    if (!peerId || peerId === currentUserId) continue;
    const isMatch = String(exchange?.outcome || '').toLowerCase() === 'match';
    const date = String(exchange?.date || new Date(0).toISOString());
    const peerName = String(exchange?.peerName || 'Unknown');

    const existing = byPeer.get(peerId);
    if (!existing) {
      byPeer.set(peerId, {
        peerId,
        stageName: peerName,
        lastInteractionAt: date,
        stats: {
          sent: { talks: 1, matches: isMatch ? 1 : 0 },
          received: { talks: 0, matches: 0 },
          mutualMatchedTalks: isMatch ? 1 : 0,
          mutualTagCount: 0,
          totalTalks: 1,
        },
      });
    } else {
      existing.stageName = pickName(existing.stageName, peerName);
      existing.lastInteractionAt = newerDate(existing.lastInteractionAt, date);
      existing.stats.sent.talks += 1;
      existing.stats.totalTalks += 1;
      if (isMatch) {
        existing.stats.sent.matches += 1;
        existing.stats.mutualMatchedTalks += 1;
      }
    }
  }
  return Array.from(byPeer.values());
}

/**
 * Derive PeerSummary entries from myConversations (each conversation = 1 match peer).
 * Support channels (conversation.supportChannel === true) are excluded.
 */
export function peersFromLocalConversations(
  conversations: Record<string, any>,
  currentUserId: string,
): PeerSummary[] {
  const byPeer = new Map<string, PeerSummary>();
  for (const conversation of Object.values(conversations || {})) {
    const peerId = String(conversation?.otherUserId || '').trim();
    if (!peerId || peerId === currentUserId || conversation?.supportChannel === true) continue;
    const peerName = String(conversation?.otherUserName || 'Unknown');
    const date = String(
      conversation?.lastMessageTime || conversation?.createdAt || new Date(0).toISOString(),
    );

    const existing = byPeer.get(peerId);
    if (!existing) {
      byPeer.set(peerId, {
        peerId,
        stageName: peerName,
        lastInteractionAt: date,
        stats: {
          sent: { talks: 1, matches: 1 },
          received: { talks: 0, matches: 0 },
          mutualMatchedTalks: 1,
          mutualTagCount: 0,
          totalTalks: 1,
        },
      });
    } else {
      existing.stageName = pickName(existing.stageName, peerName);
      existing.lastInteractionAt = newerDate(existing.lastInteractionAt, date);
      existing.stats.sent.talks += 1;
      existing.stats.totalTalks += 1;
      existing.stats.sent.matches += 1;
      existing.stats.mutualMatchedTalks += 1;
    }
  }
  return Array.from(byPeer.values());
}

/**
 * Derive PeerSummary stub entries from the knownPeople list.
 * Always includes labeled contacts even if no exchange has happened yet.
 */
export function peersFromKnownPeople(
  knownPeople: KnownPerson[],
  currentUserId: string,
): PeerSummary[] {
  return knownPeople
    .filter((p) => p.userId && p.userId !== currentUserId)
    .map((p) => ({
      peerId: p.userId,
      stageName: String(p.nickname || 'Unknown'),
      lastInteractionAt: p.addedAt ? new Date(p.addedAt).toISOString() : new Date(0).toISOString(),
      stats: emptyStats(),
    }));
}

/**
 * Merge two PeerSummary arrays (no-server, local-first).
 *
 * Precedence: `primary` wins on stat values (take max); `secondary` fills gaps.
 * stageName: prefer the non-"Unknown" winner; if both known, prefer primary.
 * lastInteractionAt: latest wins.
 */
export function mergePeerSummaryLists(primary: PeerSummary[], secondary: PeerSummary[]): PeerSummary[] {
  const byPeer = new Map<string, PeerSummary>();
  for (const p of primary) byPeer.set(p.peerId, { ...p, stats: { ...p.stats, sent: { ...p.stats.sent }, received: { ...p.stats.received } } });

  for (const s of secondary) {
    const existing = byPeer.get(s.peerId);
    if (!existing) {
      byPeer.set(s.peerId, { ...s, stats: { ...s.stats, sent: { ...s.stats.sent }, received: { ...s.stats.received } } });
      continue;
    }
    existing.stageName = pickName(existing.stageName, s.stageName);
    existing.lastInteractionAt = newerDate(existing.lastInteractionAt, s.lastInteractionAt);
    existing.stats.totalTalks = Math.max(existing.stats.totalTalks, s.stats.totalTalks);
    existing.stats.sent.talks = Math.max(existing.stats.sent.talks, s.stats.sent.talks);
    existing.stats.received.talks = Math.max(existing.stats.received.talks, s.stats.received.talks);
    existing.stats.sent.matches = Math.max(existing.stats.sent.matches, s.stats.sent.matches);
    existing.stats.received.matches = Math.max(existing.stats.received.matches, s.stats.received.matches);
    existing.stats.mutualMatchedTalks = Math.max(existing.stats.mutualMatchedTalks, s.stats.mutualMatchedTalks);
    existing.stats.mutualTagCount = Math.max(existing.stats.mutualTagCount, s.stats.mutualTagCount);
  }
  return Array.from(byPeer.values());
}

/**
 * Derive all local peers for the current user, merging the three sources with
 * priority: localTalkExchanges > myConversations > knownPeople.
 *
 * Excludes: currentUserId, TechSupport root (handled separately in contacts-view).
 */
export function deriveLocalPeers(opts: {
  currentUserId: string;
  conversations: Record<string, any>;
  knownPeople: KnownPerson[];
}): PeerSummary[] {
  const { currentUserId, conversations, knownPeople } = opts;
  // Priority: exchanges > conversations > knownPeople stubs
  const fromExchanges = peersFromLocalTalkExchanges(currentUserId);
  const fromConversations = peersFromLocalConversations(conversations, currentUserId);
  const fromKnown = peersFromKnownPeople(knownPeople, currentUserId);
  // Merge: exchanges are most authoritative
  return mergePeerSummaryLists(
    mergePeerSummaryLists(fromExchanges, fromConversations),
    fromKnown,
  );
}

/**
 * Compute match percentage (0–100) for display in contact cards.
 *
 * Formula mirrors peer-routes.ts#computeRelationshipStats:
 *   matchedTalks = sent.matches + received.matches
 *   matchRate    = matchedTalks / max(totalTalks, 1)
 *   matchPercent = round(matchRate * 100)
 *
 * This is intentionally the same arithmetic used by the server so the value shown
 * in the contacts view is consistent whether data came from the server or locally.
 */
export function computeMatchPercent(stats: PeerRelationshipStats): number {
  const matchedTalks = stats.sent.matches + stats.received.matches;
  const rate = stats.totalTalks > 0 ? matchedTalks / stats.totalTalks : 0;
  return Math.round(rate * 100);
}

/**
 * Build local talk history for a specific peer, merging:
 *   (a) myConversations — contributes direction='sent', outcome='match' entries
 *   (b) localTalkExchanges — contributes direction/outcome from exchange records
 *
 * Items are keyed by talkId; localTalkExchanges win over conversation-derived items.
 * Entries with no talkId are skipped.
 */
export function localTalkHistoryForPeer(
  peerId: string,
  conversations: Record<string, any>,
  myTalks: Record<string, any>,
  fallbackTalkTitle: string,
): LocalTalkHistoryItem[] {
  const byTalk = new Map<string, LocalTalkHistoryItem>();

  // (a) conversations — each matched conversation gives a 'sent'/'match' entry
  for (const conversation of Object.values(conversations || {}) as any[]) {
    if (String(conversation?.otherUserId || '').trim() !== peerId) continue;
    const talkId = String(conversation?.talkId || '').trim();
    if (!talkId) continue;
    const localTalk = myTalks[talkId];
    byTalk.set(talkId, {
      talkId,
      title: String(
        localTalk?.title || localTalk?.fullTalk?.title || fallbackTalkTitle,
      ),
      direction: 'sent',
      outcome: 'match',
      date: String(
        conversation?.lastMessageTime || conversation?.createdAt || new Date(0).toISOString(),
      ),
    });
  }

  // (b) localTalkExchanges — authoritative, overwrites conversation-derived entries
  for (const exchange of readLocalTalkExchanges()) {
    if (String(exchange?.peerId || '').trim() !== peerId) continue;
    const talkId = String(exchange?.talkId || '').trim();
    if (!talkId) continue;
    const existing = byTalk.get(talkId);
    const outcome = String(exchange?.outcome || '').toLowerCase() as LocalTalkHistoryItem['outcome'];
    const normalizedOutcome: LocalTalkHistoryItem['outcome'] =
      outcome === 'match' ? 'match' : outcome === 'mismatch' ? 'mismatch' : 'pending';
    byTalk.set(talkId, {
      talkId,
      title: String(
        exchange?.title || existing?.title || fallbackTalkTitle,
      ),
      direction: (exchange?.direction as 'sent' | 'received') || existing?.direction || 'sent',
      outcome: normalizedOutcome,
      date: String(exchange?.date || existing?.date || new Date(0).toISOString()),
    });
  }

  return Array.from(byTalk.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * Derive CreatorReplyRow-compatible items from localTalkExchanges for the replies panel.
 *
 * This replaces the server call to GET /api/users/:id/replies. Each exchange record
 * that is authored by the current user (direction='sent') and has a known outcome
 * contributes one row. Exchange records with direction='received' are skipped — the
 * author's reply panel shows responses TO their talks, not talks they received.
 *
 * The server's CreatorReplyItem shape includes responseId, language, answerMode, and
 * answers[] fields that are not available locally. We emit safe defaults for those so
 * the render path (which guards them with optional checks) still works.
 */
export type LocalCreatorReplyRow = {
  responseId: string;
  talkId: string;
  title: string;
  type: string;
  language: string;
  responderId: string;
  responderName: string;
  outcome: 'match' | 'ignore' | 'mismatch';
  answerMode: 'manual' | 'auto';
  date: string;
  answers: Array<{ questionId: string; answerId: string; answerText: string }>;
};

export function deriveLocalCreatorReplies(currentUserId: string): LocalCreatorReplyRow[] {
  if (!currentUserId) return [];
  const rows: LocalCreatorReplyRow[] = [];
  const seen = new Set<string>();
  for (const exchange of readLocalTalkExchanges()) {
    // Only sent talks (talks the current user authored and sent to the peer)
    if (String(exchange?.direction || 'sent').toLowerCase() !== 'sent') continue;
    const peerId = String(exchange?.peerId || '').trim();
    const talkId = String(exchange?.talkId || '').trim();
    if (!peerId || !talkId || peerId === currentUserId) continue;
    // Use responseId if available (step 4 forward-compat), otherwise synthesize one
    const responseId = exchange?.responseId || `${talkId}::${peerId}`;
    if (seen.has(responseId)) continue;
    seen.add(responseId);
    const outcomeRaw = String(exchange?.outcome || '').toLowerCase();
    const outcome: LocalCreatorReplyRow['outcome'] =
      outcomeRaw === 'match' ? 'match' : outcomeRaw === 'ignore' ? 'ignore' : 'mismatch';
    rows.push({
      responseId,
      talkId,
      title: String(exchange?.title || 'Untitled Talk'),
      type: 'flow',        // type not stored in local exchange; default to 'flow'
      language: 'en',      // language not stored; default to 'en'
      responderId: peerId,
      responderName: String(exchange?.peerName || 'Unknown'),
      outcome,
      answerMode: 'manual', // answerMode not stored locally; default to 'manual'
      date: String(exchange?.date || new Date(0).toISOString()),
      answers: [],           // answers not stored locally
    });
  }
  rows.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  return rows;
}
