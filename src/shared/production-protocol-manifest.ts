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
import bundledProtocolManifestHistory from './protocol-manifest-history.signed.json';

/**
 * Historical release-1 trust root. Manifest-aware builds already shipped with the TechSupport
 * announcement public key in this checkpoint, so it cannot be replaced without stranding those
 * clients. The first bundled manifest uses that key exactly once to bridge into a dedicated,
 * one-time protocol-release key. Later manifests rotate only dedicated protocol-release keys.
 * The signing domain prevents an announcement signature from being replayed as a manifest.
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
 * Public signed history bundled into every distribution. The operator-only manifest tool appends
 * to the JSON artifact after verifying the entire chain from the historical anchor. Private keys
 * and passphrases remain in ignored offline vaults and must never be added here.
 */
export const BUNDLED_PROTOCOL_MANIFEST_HISTORY: readonly SignedProtocolManifest[] = Object.freeze(
  bundledProtocolManifestHistory as readonly SignedProtocolManifest[],
);
