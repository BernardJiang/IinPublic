import type { GPSCoordinate } from './types';
import { receiverPassesBroadcastTagTargeting } from './broadcast-tag-targeting';
import { haversineMilesBetween } from './talk-intake-filters';

/**
 * Audience filters applied at bulk register/receiver-preview time (receiver-side checks only).
 */
export function appendBulkBroadcastDeliveryRejections(
  rejectedBy: string[],
  args: {
    talkTags?: ReadonlyArray<{ name?: string | null }>;
    broadcastTargetTags: readonly string[];
    broadcastMaxDistanceMiles?: number;
    senderPivot?: { latitude: number; longitude: number };
    receiverInterestTokens: readonly string[];
    receiverLocation?: GPSCoordinate;
  },
): void {
  const {
    broadcastTargetTags,
    broadcastMaxDistanceMiles,
    senderPivot,
    receiverInterestTokens,
    receiverLocation,
    talkTags,
  } = args;

  if (
    broadcastTargetTags.length > 0 &&
    !receiverPassesBroadcastTagTargeting({
      broadcastTargetTags,
      ...(talkTags != null ? { talkTags } : {}),
      receiverInterestTokens,
    })
  ) {
    rejectedBy.push('tag_targeting');
  }

  if (
    typeof broadcastMaxDistanceMiles === 'number' &&
    Number.isFinite(broadcastMaxDistanceMiles) &&
    broadcastMaxDistanceMiles > 0 &&
    senderPivot &&
    receiverLocation
  ) {
    const mi = haversineMilesBetween(receiverLocation, senderPivot);
    if (mi > broadcastMaxDistanceMiles) {
      rejectedBy.push('broadcast_max_distance');
    }
  }
}
