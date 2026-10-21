import { portableSha256Hex } from './portable-sha256';
import { pyramidBlock, pyramidCell, pyramidCellId, type PyramidPoint } from './nearby-v3-pyramid';

/**
 * Offline Nearby (docs/design/nearby-and-place-chatrooms.md §3.7 "Gossip": "Offline, the phones I
 * can reach are my list"). Without the hub there are no introductions, so a phone that cannot reach
 * the hub posts its signed card on a local board: a Gun channel per map cell under `p2p-signal`
 * (kept in memory only by every node). Offline a phone's Gun is peered only with the phones it found
 * over LAN or Wi-Fi Direct, so only they read it; each reads its own cell and the eight around it.
 */

/** Level-10 cells are about 39 km wide: the 3×3 block covers every privacy precision's snapping. */
export const NEARBY_LOCAL_BOARD_LEVEL = 10;

export function nearbyLocalBoardChannel(cellId: string): string {
  return portableSha256Hex(`iinpublic:nearby-local:v1:${cellId}`);
}

/** Where a phone at `point` posts its card. */
export function nearbyLocalPostChannel(point: PyramidPoint): string {
  return nearbyLocalBoardChannel(pyramidCellId(pyramidCell(point, NEARBY_LOCAL_BOARD_LEVEL)));
}

/** The channels a phone at `point` reads: its cell and the eight around it. */
export function nearbyLocalReadChannels(point: PyramidPoint): string[] {
  return pyramidBlock(point, NEARBY_LOCAL_BOARD_LEVEL).map(nearbyLocalBoardChannel);
}
