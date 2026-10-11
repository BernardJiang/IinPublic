import type { KnownPerson, TalkIntakeFilters } from './types';

/**
 * One symmetric policy for Talk offers and Talk responses.
 *
 * The preference defaults open so existing accounts keep IinPublic's stranger-
 * discovery behavior. Once enabled, a missing or not-yet-loaded contact list is
 * deliberately fail-closed: no Talk data crosses an unverified edge.
 */
type AudienceFilters = Pick<TalkIntakeFilters, 'contactsOnlyTalks' | 'residentsOnlyTalks'>;

/**
 * Talk audience: everyone in the room (default), Residents only (no known Travelers ✈), or
 * Contacts only. Contacts always pass. `travelerIds` are the room members marked as Travelers.
 */
export function talkContactPolicyAllowsPeer(
  peerId: string,
  filters: AudienceFilters | undefined,
  knownPeople: readonly Pick<KnownPerson, 'userId'>[] | undefined,
  travelerIds?: ReadonlySet<string>,
): boolean {
  const normalizedPeerId = String(peerId || '').trim();
  const isContact = !!normalizedPeerId && (knownPeople || []).some((person) => person.userId === normalizedPeerId);
  if (filters?.contactsOnlyTalks === true) return isContact;
  if (filters?.residentsOnlyTalks === true && travelerIds?.has(normalizedPeerId)) return isContact;
  return true;
}

export function filterTalkPeersByContactPolicy(
  peerIds: readonly string[],
  filters: AudienceFilters | undefined,
  knownPeople: readonly Pick<KnownPerson, 'userId'>[] | undefined,
  travelerIds?: ReadonlySet<string>,
): string[] {
  if (filters?.contactsOnlyTalks !== true && filters?.residentsOnlyTalks !== true) return [...peerIds];
  return peerIds.filter((peerId) => talkContactPolicyAllowsPeer(peerId, filters, knownPeople, travelerIds));
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
