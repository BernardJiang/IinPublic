import type { KnownPerson } from '../../shared/types';
import type { UiTranslationKey } from './ui-translations';
import { deriveLocalPeers } from '../services/local-peer-derivation';
import { getPrunedPeerIds } from '../services/contacts-prune';
import type { PersonRowStats } from './person-row';

/** A contact's words and figures shared by Contacts and the Nearby list (person-row.ts). */

const RELATIONSHIP_LABEL_TRANSLATION_KEYS: Record<string, UiTranslationKey> = {
  friend: 'friends',
  relative: 'relatives',
  coworker: 'coworkers',
  acquaintance: 'acquaintances',
  partner: 'partners',
  custom: 'custom',
};

function formatSingleRelationshipLabel(label: string, deps: { text: (key: UiTranslationKey) => string }): string {
  const key = RELATIONSHIP_LABEL_TRANSLATION_KEYS[label];
  return key ? deps.text(key) : label;
}

/**
 * A contact can carry more than one `RelationshipLabel` at once (e.g. friend + coworker) —
 * called either with the raw `KnownPerson` (joins every label the contact has, comma-separated)
 * or with a single label string (e.g. rendering one checkbox's option text in the edit dialog).
 */
export function formatRelationshipLabel(
  relationship: KnownPerson | string | undefined,
  deps: { text: (key: UiTranslationKey) => string },
): string {
  if (typeof relationship === 'string') {
    return formatSingleRelationshipLabel(relationship, deps);
  }
  const labels = relationship?.labels || [];
  if (labels.length === 0) return deps.text('contactNoRelationship');
  return labels
    .map((label) => {
      if (label === 'custom') {
        const customLabel = String(relationship?.customLabel || '').trim();
        if (customLabel) return customLabel;
      }
      return formatSingleRelationshipLabel(label, deps);
    })
    .join(', ');
}

/**
 * Each contact's row figures exactly as Contacts shows them (same derivation): the Nearby list
 * draws its person rows from this so both tabs agree (person-row.ts).
 */
export function personRowSummaries(input: {
  currentUserId: string;
  conversations: Record<string, any>;
  knownPeople: KnownPerson[];
  text: (key: UiTranslationKey) => string;
}): Map<string, { stats: PersonRowStats; relationship?: string; displayName: string }> {
  const known = new Map(input.knownPeople.map((entry) => [entry.userId, entry] as const));
  const pruned = getPrunedPeerIds();
  const rows = new Map<string, { stats: PersonRowStats; relationship?: string; displayName: string }>();
  for (const peer of deriveLocalPeers(input)) {
    if (pruned.has(peer.peerId)) continue;
    const person = known.get(peer.peerId);
    rows.set(peer.peerId, {
      stats: {
        totalTalks: peer.stats.totalTalks,
        matches: peer.stats.mutualMatchedTalks,
        sent: peer.stats.sent.talks,
        received: peer.stats.received.talks,
      },
      ...(person?.labels?.length ? { relationship: formatRelationshipLabel(person, input) } : {}),
      displayName: buildDisplayName(peer.stageName, person),
    });
  }
  return rows;
}

/**
 * A nickname is the user's own, private label for this contact — it defaults to
 * mirroring the contact's live stage name (empty `known.nickname` falls through to
 * `stageName` below) until the user deliberately sets one, at which point it's sticky:
 * shown alone, and no longer follows the contact's future stage-name changes.
 */
export function buildDisplayName(stageName: string, known?: KnownPerson): string {
  const nickname = String(known?.nickname || '').trim();
  const baseStageName = String(stageName || 'Unknown').trim() || 'Unknown';
  return nickname || baseStageName;
}
