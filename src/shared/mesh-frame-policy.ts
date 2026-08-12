import type { P2PMeshMessageKind, P2PMeshTalkBodyPayload } from './p2p-mesh-protocol';

export type MeshFrameDisposition = 'retain-control' | 'adapt-to-gun-sync' | 'retain-compatibility';
export const MESH_FRAME_INVENTORY: Readonly<Record<P2PMeshMessageKind, MeshFrameDisposition>> = {
  'mesh-ping': 'retain-control',
  'mesh-pong': 'retain-control',
  'talk-announce': 'retain-control',
  'talk-body-request': 'retain-compatibility',
  'talk-body': 'adapt-to-gun-sync',
  'talk-response': 'adapt-to-gun-sync',
  'talk-retracted': 'retain-control',
  ack: 'retain-control',
};

export type MeshSyncCapabilities = {
  protocolVersion: 1;
  gunNativeSync: boolean;
  legacyTalkBodyFrames: boolean;
};
export const CURRENT_MESH_SYNC_CAPABILITIES: Readonly<MeshSyncCapabilities> = {
  protocolVersion: 1,
  gunNativeSync: true,
  legacyTalkBodyFrames: true,
};
export type MeshSyncPreference = 'auto' | 'gun-native' | 'legacy-body';
export function meshSyncCapabilitiesForPreference(preference: MeshSyncPreference): MeshSyncCapabilities {
  if (preference === 'legacy-body') return { protocolVersion: 1, gunNativeSync: false, legacyTalkBodyFrames: true };
  if (preference === 'gun-native') return { protocolVersion: 1, gunNativeSync: true, legacyTalkBodyFrames: false };
  return { ...CURRENT_MESH_SYNC_CAPABILITIES };
}
export function configuredMeshSyncCapabilities(envValue?: string): MeshSyncCapabilities {
  const value = String(envValue || 'auto');
  return meshSyncCapabilitiesForPreference(value === 'legacy-body' || value === 'gun-native' ? value : 'auto');
}

export type MeshSyncMode = 'gun-native' | 'legacy-body' | 'incompatible';
export function negotiateMeshSyncMode(local: MeshSyncCapabilities, remote?: MeshSyncCapabilities): MeshSyncMode {
  if (local.gunNativeSync && remote?.gunNativeSync) return 'gun-native';
  if (local.legacyTalkBodyFrames && (remote?.legacyTalkBodyFrames ?? true)) return 'legacy-body';
  return 'incompatible';
}

/** Old full-body frames are input adapters; callers must commit the result to Gun before ACK. */
export function translateLegacyTalkBody(payload: P2PMeshTalkBodyPayload): {
  talkId: string; authorKey: string; talkData: Record<string, unknown>; source: 'legacy-talk-body-v1';
} {
  return { talkId: payload.talkId, authorKey: payload.authorId, talkData: payload.talkData, source: 'legacy-talk-body-v1' };
}
