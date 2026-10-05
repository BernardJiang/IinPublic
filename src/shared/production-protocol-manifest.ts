import {
  BASELINE_ROOM_PROTOCOL_CHECKPOINT,
} from './active-exchange-room';
import {
  createProtocolReleaseKey,
  type ProtocolManifestRuntimePolicy,
  type ProtocolManifestTrustState,
  type SignedProtocolManifest,
} from './protocol-manifest';
import {
  currentTechSupportAnnouncementPub,
  currentTechSupportRecoveryPub,
} from './techsupport';

/**
 * Release-1 trust root. Only public keys are compiled into the application. The corresponding
 * private keys remain in the existing separate announcement/operator and recovery vaults; the
 * manifest signing domain prevents a signature for another protocol from being replayed here.
 * Future releases rotate both roles through the signed manifest chain.
 */
export const PRODUCTION_PROTOCOL_MANIFEST_ANCHOR: ProtocolManifestTrustState = Object.freeze({
  networkId: BASELINE_ROOM_PROTOCOL_CHECKPOINT.networkId,
  sequence: BASELINE_ROOM_PROTOCOL_CHECKPOINT.manifestSequence,
  manifestHash: BASELINE_ROOM_PROTOCOL_CHECKPOINT.manifestHash,
  nextReleaseKeys: [createProtocolReleaseKey(currentTechSupportAnnouncementPub())],
  recoveryPolicy: {
    threshold: 1,
    keys: [createProtocolReleaseKey(currentTechSupportRecoveryPub())],
  },
});

export const PRODUCTION_PROTOCOL_MANIFEST_RUNTIME: ProtocolManifestRuntimePolicy = Object.freeze({
  manifestEngineVersion: 1,
  roomProtocolVersion: 1,
  capabilities: Object.freeze([
    'manifest-relay-v1',
    'room-presence-v2',
    'room-scoped-discovery-v1',
    'sparse-room-mesh-v1',
  ]),
  supportedExtensions: Object.freeze([]),
  minimumChatroomCapacity: 1,
  maximumChatroomCapacity: 10_000,
});

/**
 * Each release appends its verified public manifests here. Release 1 has no successor manifest
 * yet, so this deliberately starts empty; private signing keys must never be added to this file.
 */
export const BUNDLED_PROTOCOL_MANIFEST_HISTORY: readonly SignedProtocolManifest[] = Object.freeze([]);
