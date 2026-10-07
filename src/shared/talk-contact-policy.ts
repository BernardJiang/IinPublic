import type { KnownPerson, TalkIntakeFilters } from './types';

/**
 * One symmetric policy for Talk offers and Talk responses.
 *
 * The preference defaults open so existing accounts keep IinPublic's stranger-
 * discovery behavior. Once enabled, a missing or not-yet-loaded contact list is
 * deliberately fail-closed: no Talk data crosses an unverified edge.
 */
export function talkContactPolicyAllowsPeer(
  peerId: string,
  filters: Pick<TalkIntakeFilters, 'contactsOnlyTalks'> | undefined,
  knownPeople: readonly Pick<KnownPerson, 'userId'>[] | undefined,
): boolean {
  if (filters?.contactsOnlyTalks !== true) return true;
  const normalizedPeerId = String(peerId || '').trim();
  if (!normalizedPeerId) return false;
  return (knownPeople || []).some((person) => person.userId === normalizedPeerId);
}

export function filterTalkPeersByContactPolicy(
  peerIds: readonly string[],
  filters: Pick<TalkIntakeFilters, 'contactsOnlyTalks'> | undefined,
  knownPeople: readonly Pick<KnownPerson, 'userId'>[] | undefined,
): string[] {
  if (filters?.contactsOnlyTalks !== true) return [...peerIds];
  const contactIds = new Set((knownPeople || []).map((person) => person.userId));
  return peerIds.filter((peerId) => contactIds.has(peerId));
}

type IncomingClusterSender = {
  senderId?: string;
  lastTalkId?: string;
  lastReceivedAt?: string;
  [key: string]: unknown;
};

type IncomingCluster = {
  senders?: Record<string, IncomingClusterSender>;
  talkIds?: Record<string, unknown>;
  latestTalkId?: string;
  [key: string]: unknown;
};

/**
 * Hide durable offers received before the preference was enabled. A content
 * cluster can contain the same Talk from contacts and strangers, so retain only
 * contact sender/talk references and point the row at a contact-owned Talk id.
 * The stored cluster is not deleted; disabling the preference restores it.
 */
export function filterIncomingTalkClustersByContactPolicy<T extends IncomingCluster>(
  clusters: readonly T[],
  filters: Pick<TalkIntakeFilters, 'contactsOnlyTalks'> | undefined,
  knownPeople: readonly Pick<KnownPerson, 'userId'>[] | undefined,
): T[] {
  if (filters?.contactsOnlyTalks !== true) return [...clusters];
  const contactIds = new Set((knownPeople || []).map((person) => person.userId));
  const visible: T[] = [];

  for (const cluster of clusters) {
    const senderEntries = Object.entries(cluster.senders || {}).filter(([, sender]) =>
      contactIds.has(String(sender.senderId || '')),
    );
    if (senderEntries.length === 0) continue;
    if (senderEntries.length === Object.keys(cluster.senders || {}).length) {
      visible.push(cluster);
      continue;
    }

    const allowedTalkIds = new Set(
      senderEntries.map(([, sender]) => String(sender.lastTalkId || '')).filter(Boolean),
    );
    const latestSender = senderEntries
      .map(([, sender]) => sender)
      .sort((a, b) => String(b.lastReceivedAt || '').localeCompare(String(a.lastReceivedAt || '')))[0];
    visible.push({
      ...cluster,
      senders: Object.fromEntries(senderEntries),
      talkIds: Object.fromEntries(
        Object.entries(cluster.talkIds || {}).filter(([talkId]) => allowedTalkIds.has(talkId)),
      ),
      latestTalkId: latestSender?.lastTalkId || cluster.latestTalkId,
    });
  }

  return visible;
}
