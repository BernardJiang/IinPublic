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

/** Scopes with no hub roster, membership writes or chat: Contacts only and Nearby. */
export function hasNoHubRoster(value: string | null | undefined): boolean {
  return isLocalOnlyRoomScope(value) || isNearbyRoomId(value);
}
