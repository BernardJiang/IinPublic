/**
 * The broadcast's target selection with this GUI's lookups (OPEN-91 P4): the rules live in the
 * device core (`src/core/broadcast-selection.ts`).
 */
import * as core from '../../core/broadcast-selection';
import type { BroadcastDeliverySelectionDeps } from '../../core/broadcast-selection';
import { talkRevisionOwedToPeer } from '../services/talk-revision-sent-store';
import { shouldSuppressForPeer } from '../services/web-talk-ledger-store';
import { getBroadcastableTalkIds } from './broadcast-audience-preview';
import { getMyTalks } from './my-talks-storage';

export type { BroadcastDeliverySelectionDeps } from '../../core/broadcast-selection';

const defaultDeps: BroadcastDeliverySelectionDeps = {
  getMyTalks,
  getBroadcastableTalkIds,
  shouldSuppressForPeer,
  revisionOwedToPeer: (receiverId, talkId, revision) => talkRevisionOwedToPeer(receiverId, talkId, revision),
};

export function isBroadcastUnsentForReceiver(receiverId: string, talkId: string, deps: BroadcastDeliverySelectionDeps = defaultDeps): boolean {
  return core.isBroadcastUnsentForReceiver(receiverId, talkId, deps);
}

export function getUnsentBroadcastTalkIds(receiverIds: string[], deps: BroadcastDeliverySelectionDeps = defaultDeps): string[] {
  return core.getUnsentBroadcastTalkIds(receiverIds, deps);
}

export function getUnsentBroadcastTalkIdsForReceiver(receiverId: string, deps: BroadcastDeliverySelectionDeps = defaultDeps): string[] {
  return core.getUnsentBroadcastTalkIdsForReceiver(receiverId, deps);
}

export function getUnsentBroadcastTalkReceiverIds(talkIds: string[], receiverIds: string[], deps: BroadcastDeliverySelectionDeps = defaultDeps): Record<string, string[]> {
  return core.getUnsentBroadcastTalkReceiverIds(talkIds, receiverIds, deps);
}
