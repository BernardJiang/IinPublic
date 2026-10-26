/**
 * A bounded Contacts list (OPEN-87 S5). Every tag or Talk exchange makes the other person a
 * Contact, and the exchange store is one localStorage map rewritten on every exchange, so both grow
 * without limit. People with a relationship are always kept; people the user has only exchanged
 * Talks with are capped (Settings, default 1,000) and the rest are pruned, fewest shared tags and
 * oldest exchange first, mirroring the size-triggered incoming-cluster prune
 * (`planIncomingTalkClusterPrune`). Pruning deletes their exchange records and hides them from
 * Contacts; a new exchange or a message brings a person back.
 */
import type { PeerSummary } from '../../shared/peer-summary-types';
import { removeExchangePeers } from './exchange-view';
import { appStorageAsStorage } from './core-storage';

export const CONTACTS_CAP_OPTIONS = [500, 1_000, 2_000] as const;
export const DEFAULT_CONTACTS_CAP = 1_000;
const CAP_KEY = 'iinpublic_contacts_cap_v1';
const PRUNED_KEY = 'iinpublic_contacts_pruned_v1';

export function getContactsCap(storage: Storage = appStorageAsStorage): number {
  try {
    const value = Number(storage.getItem(CAP_KEY));
    return (CONTACTS_CAP_OPTIONS as readonly number[]).includes(value) ? value : DEFAULT_CONTACTS_CAP;
  } catch {
    return DEFAULT_CONTACTS_CAP;
  }
}

export function setContactsCap(cap: number, storage: Storage = appStorageAsStorage): void {
  if ((CONTACTS_CAP_OPTIONS as readonly number[]).includes(cap)) storage.setItem(CAP_KEY, String(cap));
}

export function getPrunedPeerIds(storage: Storage = appStorageAsStorage): Set<string> {
  try {
    const parsed = JSON.parse(storage.getItem(PRUNED_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function savePrunedPeerIds(ids: Set<string>, storage: Storage): void {
  if (ids.size === 0) storage.removeItem(PRUNED_KEY);
  else storage.setItem(PRUNED_KEY, JSON.stringify(Array.from(ids)));
}

/** A new exchange with a pruned person brings them back. */
export function unprunePeer(peerId: string, storage: Storage = appStorageAsStorage): void {
  try {
    const ids = getPrunedPeerIds(storage);
    if (ids.delete(peerId)) savePrunedPeerIds(ids, storage);
  } catch {
    // Pruning only shortens a list; a storage failure must not break recording an exchange.
  }
}

export type ContactsPruneInput = {
  peers: PeerSummary[];
  conversations: Record<string, any>;
  /** Explicit Contacts: relationship labels, Friend marks, nicknames. */
  knownPeopleIds: Set<string>;
  isBlocked: (peerId: string) => boolean;
  pinnedIds: Set<string>;
  cap: number;
  sharedTags: (peerId: string) => number;
};

/** People always kept: an explicit Contact, a block, a pin, or a conversation with messages. */
export function relationshipPeerIds(input: Omit<ContactsPruneInput, 'peers' | 'cap' | 'sharedTags'>): Set<string> {
  const keep = new Set<string>([...input.knownPeopleIds, ...input.pinnedIds]);
  for (const conversation of Object.values<any>(input.conversations || {})) {
    const peerId = String(conversation?.otherUserId || '');
    if (!peerId) continue;
    if (conversation?.supportChannel === true || String(conversation?.lastMessage || '').trim()) keep.add(peerId);
  }
  return keep;
}

/** Which exchange-only people fall beyond the cap: fewest shared tags, then oldest exchange. */
export function planContactsPrune(input: ContactsPruneInput): { drop: string[]; keepAlways: Set<string> } {
  const keepAlways = relationshipPeerIds(input);
  const candidates = input.peers.filter((peer) => !keepAlways.has(peer.peerId) && !input.isBlocked(peer.peerId));
  if (candidates.length <= input.cap) return { drop: [], keepAlways };
  const ranked = [...candidates].sort((a, b) =>
    input.sharedTags(b.peerId) - input.sharedTags(a.peerId)
    || new Date(b.lastInteractionAt || 0).getTime() - new Date(a.lastInteractionAt || 0).getTime()
    || a.peerId.localeCompare(b.peerId));
  return { drop: ranked.slice(input.cap).map((peer) => peer.peerId), keepAlways };
}

/**
 * Deletes the dropped people's exchange records (in the device core's log, through the GUI's view)
 * and hides them from Contacts. People who have since gained a relationship are shown again.
 */
export function applyContactsPrune(drop: string[], keepAlways: Set<string>, storage: Storage = appStorageAsStorage): void {
  const pruned = getPrunedPeerIds(storage);
  for (const peerId of keepAlways) pruned.delete(peerId);
  if (drop.length > 0) {
    removeExchangePeers(drop);
    for (const peerId of drop) pruned.add(peerId);
  }
  savePrunedPeerIds(pruned, storage);
}
