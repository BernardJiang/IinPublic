import { isPlaceRoomId } from './place-rooms';

/**
 * Nearby scopes (docs/design/nearby-and-place-chatrooms.md §3.7). Nearby is not a shared room: it
 * is each phone's own list of the people nearest to it, so it has one local scope id and no hub
 * roster. Contacts only is the other local scope.
 */
export const NEARBY_NEIGHBORHOOD_METERS = 1_000;
export const NEARBY_CLOSE_METERS = 400;
/** Broader privacy choices for homes, workplaces, and other sensitive locations. */
export const NEARBY_CITYWIDE_METERS = 10_000;
export const NEARBY_REGIONAL_METERS = 50_000;
/** Local exchange scope. It must never be published as an Internet/Gun room membership. */
export const CONTACTS_ONLY_SCOPE_ID = 'local_contacts_only_v1';
/** Nearby: my personal list is the audience; no hub roster, no membership writes, no chat. */
export const NEARBY_V3_ROOM_ID = 'nearby-v3';

export type NearbyPrivacyMode =
  | 'contacts-only'
  | 'neighborhood'
  | 'close-nearby'
  | 'citywide'
  | 'regional'
  | 'location-off';

export type NearbyPublicMode = Extract<
  NearbyPrivacyMode,
  'neighborhood' | 'close-nearby' | 'citywide' | 'regional'
>;

/** How finely my public point is snapped (public-location.ts). */
export function nearbyBasePrecisionMeters(mode: NearbyPublicMode): number {
  switch (mode) {
    case 'close-nearby': return NEARBY_CLOSE_METERS;
    case 'neighborhood': return NEARBY_NEIGHBORHOOD_METERS;
    case 'citywide': return NEARBY_CITYWIDE_METERS;
    case 'regional': return NEARBY_REGIONAL_METERS;
    default: throw new Error('location mode cannot participate in automatic Nearby');
  }
}

export function isNearbyPublicMode(mode: NearbyPrivacyMode): mode is NearbyPublicMode {
  return mode === 'close-nearby'
    || mode === 'neighborhood'
    || mode === 'citywide'
    || mode === 'regional';
}

export function isNearbyRoomId(value: string | null | undefined): boolean {
  return value === NEARBY_V3_ROOM_ID;
}

export function isLocalOnlyRoomScope(value: string | null | undefined): boolean {
  return value === CONTACTS_ONLY_SCOPE_ID;
}

/**
 * Scopes whose members are each person's own list (§3.7): Nearby, and a Place ("Places in v3":
 * members find each other the same way, with cards scoped to the Place).
 */
export function isPersonalListScope(value: string | null | undefined): boolean {
  return isNearbyRoomId(value) || isPlaceRoomId(String(value || ''));
}

/**
 * Whether an automatic catch-up (my Talks owed in this scope, sent when a link to a peer comes up)
 * may go to this peer. In a personal-list scope (Nearby, a Place) the audience is my own current
 * list, never whoever links to me: eligibility is one-way (§3.7, OPEN-86 E2), so a person whose
 * page includes me may open a link without being on mine. Shared rooms keep their roster rule.
 */
export function isCatchUpRecipient(
  scopeId: string,
  peerId: string,
  currentListUserIds: ReadonlySet<string>,
): boolean {
  return !isPersonalListScope(scopeId) || currentListUserIds.has(peerId);
}

/** Scopes with no hub roster or membership writes: Contacts only and the personal-list scopes. */
export function hasNoHubRoster(value: string | null | undefined): boolean {
  return isLocalOnlyRoomScope(value) || isPersonalListScope(value);
}

/** Only a Place keeps a shared chat feed (bounded HTTP pages since OPEN-80); Nearby has none. */
export function hasRoomChat(value: string | null | undefined): boolean {
  return isPlaceRoomId(String(value || ''));
}
