export type StarServerPersistencePolicy = 'durable' | 'ephemeral';

export type P2PRuntimeFlags = {
  starServerPersistence: StarServerPersistencePolicy;
  p2pNodeEnabled: boolean;
  p2pDirectChatEnabled: boolean;
  /** Production relay-only hub (`www.iinpublic.com`) — no application radata. */
  relayOnlyHub: boolean;
  /** Mirror server incoming-talk snapshots into local Gun (P2P-L). */
  p2pClientTalkMirror: boolean;
  /** P0: deliver talks via peer Gun offers + local IN index (not server incomingTalksMap). */
  p2pDirectTalkDelivery: boolean;
};

export type ConversationTransportMode = 'star-gun' | 'server-relay' | 'direct-p2p';

export type ConversationTransportDiagnostics = {
  activeMode: ConversationTransportMode;
  availableModes: ConversationTransportMode[];
  messageBodyStorage: 'gun-legacy' | 'relay-ciphertext-only' | 'local-only' | 'gun-local';
  receiptsStorage: 'gun-legacy' | 'local-only' | 'gun-local';
  fallback: ConversationTransportMode | null;
};

export type P2PSignalingKind = 'offer' | 'answer' | 'ice-candidate' | 'connection-state';

export type P2PSignalingEnvelope = {
  version: 1;
  conversationId: string;
  kind: P2PSignalingKind;
  senderPub: string;
  recipientPub: string;
  signalCiphertext: string;
  signature: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
};

export type DirectP2PMessageEnvelope = RelayEnvelope & {
  kind: 'p2p-message';
  transport: 'webrtc-datachannel';
  conversationId: string;
  messageId: string;
};

export type P2PPlatformId = 'web' | 'windows' | 'ubuntu' | 'android' | 'ios';

export type P2PNetworkingSubstrate = 'gun-mesh-websocket-webrtc';

export type P2PPlatformDescriptor = {
  platform: P2PPlatformId;
  packageTarget: string;
  nodeAvailability: 'browser-client' | 'bundled-local-node' | 'foreground-service' | 'foreground-or-notification-assisted';
  backgroundBehavior: string;
  permissionBoundaries: string[];
};

export type P2PNodeCapability =
  | 'signed-discovery'
  | 'encrypted-signaling'
  | 'webrtc-datachannel'
  | 'relay-fallback'
  | 'local-node-supervisor'
  | 'neighbor-cache'
  | 'foreground-service'
  | 'notification-assisted-wakeup';

export type P2PNodeProtocolSpec = {
  version: 1;
  substrate: P2PNetworkingSubstrate;
  identity: {
    publicKeys: Array<keyof SeaPublicIdentity>;
    signature: 'SEA-signature';
    privateKeyRule: string;
  };
  peerDiscovery: {
    messageKind: 'discovery';
    ttlSeconds: number;
    requiredFields: string[];
  };
  handshake: {
    steps: string[];
    replayProtection: string[];
  };
  capabilities: P2PNodeCapability[];
  neighborScore: {
    factors: string[];
    blockedPeerRule: string;
  };
  messageEnvelope: {
    kinds: RelayEnvelope['kind'][];
    encryptionRule: string;
  };
  syncPolicy: {
    localFirstDataClasses: DeviceLinkDataClass[];
    relayOnlyDataClasses: string[];
  };
  platforms: P2PPlatformDescriptor[];
};

export type P2PDiscoveryMessage = RelayEnvelope & {
  kind: 'discovery';
  protocolVersion: 1;
  platform: P2PPlatformId;
  capabilities: P2PNodeCapability[];
  endpointHints: string[];
};

export const SIGNALING_TTL_SECONDS = 120;
export const DISCOVERY_TTL_SECONDS = 60;
export const NEIGHBOR_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PRESENCE_TTL_SECONDS = 45;
export const ROOM_MEMBERSHIP_TTL_SECONDS = 180;

export type SeaPublicIdentity = {
  pub: string;
  epub: string;
};

export type SeaPrivateIdentityMaterial = SeaPublicIdentity & {
  priv: string;
  epriv: string;
};

export type KeyCustodyFormat = 'webcrypto-device-key-v1' | 'os-keychain-v1' | 'imported-recovery-package-v1';

export type KeyCustodyRecord = {
  version: 1;
  format: KeyCustodyFormat;
  publicIdentity: SeaPublicIdentity;
  wrapping: {
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    iv: string;
  };
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
};

export type KeyRecoveryWarning = {
  severity: 'critical';
  message: string;
};

export type DeviceLinkDataClass =
  | 'profile-private-answers'
  | 'contacts'
  | 'blocked-peers'
  | 'neighbor-cache'
  | 'message-history'
  | 'talks'
  | 'chatbot-memory';

export type DevicePairingGrant = {
  pairingId: string;
  trustedDevicePub: string;
  newDevicePub: string;
  selectedDataClasses: DeviceLinkDataClass[];
  expiresAt: string;
  grantSignature: string;
};

export type LinkedDeviceManifest = {
  randomManifestId: string;
  encryptedManifest: string;
  selectedDataClasses: DeviceLinkDataClass[];
  groupKeyVersion: number;
  revokedDevicePubs: string[];
};

export type RelayEnvelope = {
  version: 1;
  kind: 'discovery' | 'signaling' | 'p2p-message';
  senderPub: string;
  recipientPub?: string;
  routeHint?: string;
  bodyCiphertext?: string;
  bodyPlaintext?: never;
  signature: string;
  nonce: string;
  expiresAt: string;
};

export type SeaIdentityPolicy = {
  publicKeys: Array<keyof SeaPublicIdentity>;
  forbiddenPrivateKeys: Array<keyof SeaPrivateIdentityMaterial>;
  keyCustodyFormats: KeyCustodyFormat[];
  relayEnvelopeRule: string;
  directMessageRule: string;
  linkedDeviceRule: string;
};

export type P2PNeighborTransportType = 'webrtc-datachannel' | 'gun-relay' | 'websocket-relay';

export type P2PNeighborTrustStatus = 'trusted' | 'unknown' | 'blocked';

export type P2PNeighborEndpointStatus = 'active' | 'stale' | 'failed';

export type P2PNeighborRecord = {
  peerId: string;
  endpointHints: string[];
  lastSeenAt: string;
  successfulSessions: number;
  latencyMs: number;
  transportType: P2PNeighborTransportType;
  capabilities: P2PNodeCapability[];
  trustStatus: P2PNeighborTrustStatus;
  endpointStatus: P2PNeighborEndpointStatus;
  expiresAt: string;
  nearbyChatrooms: string[];
  isContact: boolean;
};

export type P2PNeighborCacheControls = {
  enabled: boolean;
  localOnly: true;
  privateGraphPublishedByDefault: false;
  exportFormat: 'SEA-encrypted-neighbor-state-v1';
};

export type P2PNeighborCacheState = {
  version: 1;
  controls: P2PNeighborCacheControls;
  publicStarFallback: 'gun-star-server';
  neighbors: P2PNeighborRecord[];
  blockedPeerIds: string[];
  encryptedExport: string | null;
};

export type P2PNeighborCacheAction = 'clear' | 'disable' | 'enable' | 'block-peer' | 'export-encrypted';

export type DataOwnershipRequestType = 'export-server-held-data' | 'delete-server-held-data';

export type DataOwnershipRequest = {
  requestId: string;
  requestType: DataOwnershipRequestType;
  userPub: string;
  status: 'queued';
  createdAt: string;
  relayVisibility: 'metadata-only';
};

export type DeviceLocalDataDeletion = {
  deletedAt: string | null;
  clearedDataClasses: DeviceLinkDataClass[];
  retainedServerHeldRequestUrl: '/api/p2p/data-ownership/request-server-data';
};

export type DataOwnershipPolicy = {
  version: 1;
  deviceLocalDelete: {
    label: "Delete this device's local data";
    clears: DeviceLinkDataClass[];
    doesNotDelete: string[];
  };
  serverHeldDataRequest: {
    label: 'Request/delete server-held data';
    supportedRequests: DataOwnershipRequestType[];
    relayVisibility: 'metadata-only';
  };
  migration: {
    eligibleCategories: Array<(typeof STAR_GUN_PATH_CLASSIFICATIONS)[number]['category']>;
    target: 'local-encrypted-user-owned-storage';
  };
};

export type DataMigrationItem = {
  path: string;
  category: string;
  action: 'move-to-local-encrypted' | 'leave-on-relay';
  reason: string;
};

export type DataMigrationPlan = {
  version: 1;
  items: DataMigrationItem[];
  movedCount: number;
};

export type RelayOnlyPathKind = 'discovery' | 'signaling' | 'presence' | 'room-membership';

export type RelayOnlyTtlPolicy = Record<RelayOnlyPathKind, { ttlSeconds: number; storage: 'relay-only'; bodyRule: string }>;

export type ServerConnectorPathKind =
  | 'relay-metadata'
  | 'author-owned-talk-body'
  | 'owner-private-incoming-talk-index'
  | 'pair-private-talk-response'
  | 'pair-private-conversation'
  | 'legacy-public-talk-response'
  | 'legacy-public-incoming-talk'
  | 'legacy-public-peer-offer'
  | 'legacy-public-peer-catalog'
  | 'unknown';

export type ServerConnectorPathClassification = {
  kind: ServerConnectorPathKind;
  serverCanPersistBody: boolean;
  deprecatedPublicPath: boolean;
  reason: string;
};

export type OwnershipVisibility = 'room' | 'user' | 'pair';

export type OwnershipEnvelopeInput = {
  path: string[] | string;
  visibility: OwnershipVisibility;
  roomId?: string;
  ownerPub?: string;
  pairId?: string;
  encrypted?: boolean;
};

export type OwnershipEnvelope = {
  version: 1;
  path: string[];
  visibility: OwnershipVisibility;
  roomId?: string;
  ownerPub?: string;
  pairId?: string;
  encrypted: boolean;
  classification: ServerConnectorPathClassification;
};

function normalizeGraphPath(path: string[] | string): string[] {
  return Array.isArray(path)
    ? path.map((part) => String(part || '').trim()).filter(Boolean)
    : path.split('/').map((part) => part.trim()).filter(Boolean);
}

/**
 * P1 ownership boundary for new graph writes. It does not perform the write;
 * callers must pass an envelope that proves whether the path is room metadata,
 * user-owned state, or pair-private ciphertext.
 */
export function createOwnershipEnvelope(input: OwnershipEnvelopeInput): OwnershipEnvelope {
  const path = normalizeGraphPath(input.path);
  if (path.length === 0) throw new Error('ownership envelope requires a graph path');
  const classification = classifyServerConnectorPath(path);
  const encrypted = input.encrypted ?? input.visibility !== 'room';

  if (classification.deprecatedPublicPath) {
    throw new Error(`deprecated connector path is not valid for new writes: ${path.join('/')}`);
  }

  if (input.visibility === 'room') {
    const roomId = String(input.roomId || '').trim();
    if (!roomId) throw new Error('room ownership envelope requires roomId');
    if (path[0] !== 'chatrooms' || path[1] !== roomId) {
      throw new Error(`room ownership path must start with chatrooms/${roomId}`);
    }
    if (encrypted) {
      throw new Error('room ownership envelope must be metadata-only, not encrypted user data');
    }
  } else if (input.visibility === 'user') {
    const ownerPub = String(input.ownerPub || '').trim();
    if (!ownerPub) throw new Error('user ownership envelope requires ownerPub');
    const root = path[0];
    if (root !== 'talks' && root !== 'ownerIncomingTalkIndex') {
      throw new Error(`user ownership path must be owner-owned, got ${path.join('/')}`);
    }
    if (!encrypted) throw new Error('user ownership envelope requires encrypted payloads');
  } else {
    const pairId = String(input.pairId || '').trim();
    if (!pairId) throw new Error('pair ownership envelope requires pairId');
    const root = path[0];
    if ((root !== 'pairTalkResponses' && root !== 'pairConversations') || path[1] !== pairId) {
      throw new Error(`pair ownership path must start with pairTalkResponses/${pairId} or pairConversations/${pairId}`);
    }
    if (!encrypted) throw new Error('pair ownership envelope requires encrypted payloads');
  }

  return {
    version: 1,
    path,
    visibility: input.visibility,
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.ownerPub ? { ownerPub: input.ownerPub } : {}),
    ...(input.pairId ? { pairId: input.pairId } : {}),
    encrypted,
    classification,
  };
}

export type TransportDiagnosticEvent = {
  version: 1;
  mode: ConversationTransportMode;
  usedFallback: boolean;
  fallbackReason: string | null;
  storedTelemetry: false;
  visibleToUser: true;
  createdAt: string;
};

const PRIVATE_SEA_KEYS = ['priv', 'epriv'] as const;

export const SEA_IDENTITY_POLICY: SeaIdentityPolicy = {
  publicKeys: ['pub', 'epub'],
  forbiddenPrivateKeys: ['priv', 'epriv'],
  keyCustodyFormats: ['webcrypto-device-key-v1', 'os-keychain-v1', 'imported-recovery-package-v1'],
  relayEnvelopeRule: 'Relays may store routing metadata, public keys, nonces, signatures, and ciphertext only.',
  directMessageRule: 'Direct P2P message bodies are encrypted per conversation/session and signed by sender pub.',
  linkedDeviceRule: 'Linked devices use random encrypted manifests; relay records must not expose account linkage.',
};

export const KEY_RECOVERY_WARNINGS: KeyRecoveryWarning[] = [
  {
    severity: 'critical',
    message: 'Losing the private key means losing encrypted local/private data that has no other backup.',
  },
] as const;

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

/** E2E/browser override via `/?e2e_p0_talks=1` (see `webAppURLStableChatroom` in tests/e2e/helpers/ports.ts). */
function readBrowserE2eFlag(param: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const v = new URLSearchParams(window.location.search).get(param);
    return v == null || v === '' ? undefined : v;
  } catch {
    return undefined;
  }
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
}

function parsePersistencePolicy(value: string | undefined): StarServerPersistencePolicy {
  return value === 'ephemeral' ? 'ephemeral' : 'durable';
}

export function resolveP2PRuntimeFlags(env: Record<string, string | undefined> = {}): P2PRuntimeFlags {
  const get = (key: string): string | undefined => env[key] ?? readEnv(key);
  const relayOnlyHub = parseBooleanFlag(get('RELAY_ONLY_HUB'), false);
  const urlP0 = readBrowserE2eFlag('e2e_p0_talks');
  const p0DirectTalkDelivery = parseBooleanFlag(
    urlP0 ?? get('P0_DIRECT_TALK_DELIVERY'),
    false,
  );
  const starServerPersistence = relayOnlyHub
    ? 'ephemeral'
    : parsePersistencePolicy(get('STAR_SERVER_PERSISTENCE'));
  return {
    starServerPersistence,
    p2pNodeEnabled: parseBooleanFlag(get('P2P_NODE_ENABLED'), false),
    p2pDirectChatEnabled: parseBooleanFlag(get('P2P_DIRECT_CHAT_ENABLED'), false),
    relayOnlyHub,
    p2pClientTalkMirror: parseBooleanFlag(get('P2P_CLIENT_TALK_MIRROR'), true),
    p2pDirectTalkDelivery: p0DirectTalkDelivery || relayOnlyHub,
  };
}

/** P0 Phase B: browsers exchange talks over Gun mesh; server is discovery relay only. */
export function usesDirectTalkDelivery(flags: P2PRuntimeFlags): boolean {
  return flags.p2pDirectTalkDelivery;
}

/** P2P-K: peer DM bodies must not durably persist on the public hub (TechSupport excepted). */
export function shouldSkipServerGunPersist(
  path: string[],
  flags: P2PRuntimeFlags,
  options: { supportChannel?: boolean; relayP0TalkDelivery?: boolean } = {},
): boolean {
  if (options.supportChannel) return false;
  if (options.relayP0TalkDelivery && parseBooleanFlag(readEnv('IINPUBLIC_ALLOW_LEGACY_SERVER_TALK_HISTORY'), false)) {
    return false;
  }
  if (flags.starServerPersistence !== 'ephemeral' && !flags.relayOnlyHub) return false;
  if (path[0] === 'conversations' && path.length >= 3 && path[2] === 'messages') return true;
  if (path[0] === 'talks') return true;
  if (path[0] === 'incomingTalksByUser') return true;
  if (path[0] === 'peerTalkOffers') return true;
  if (path[0] === 'peerTalkCatalog') return true;
  if (
    path[0] === 'chatrooms' &&
    path.length >= 3 &&
    (path[2] === 'talks' || path[2] === 'announcements')
  ) {
    return true;
  }
  return false;
}

/** P1: the public server may connect peers, but talk/response bodies belong to owners or pairs. */
export function classifyServerConnectorPath(path: string[] | string): ServerConnectorPathClassification {
  const parts = Array.isArray(path)
    ? path
    : path.split('/').filter((part) => part.length > 0);
  const [root, , third] = parts;

  if (root === 'chatrooms') {
    return {
      kind: 'relay-metadata',
      serverCanPersistBody: false,
      deprecatedPublicPath: false,
      reason: 'Chatrooms carry routing announcements and membership metadata only.',
    };
  }
  if (root === 'talks' && third === 'responses') {
    return {
      kind: 'legacy-public-talk-response',
      serverCanPersistBody: false,
      deprecatedPublicPath: true,
      reason: 'Talk responses must be written to pair-private response paths in direct mode.',
    };
  }
  if (root === 'talks') {
    return {
      kind: 'author-owned-talk-body',
      serverCanPersistBody: false,
      deprecatedPublicPath: false,
      reason: 'Canonical talk bodies are author-owned; receivers should get signed references or pair offers.',
    };
  }
  if (root === 'pairTalkResponses') {
    return {
      kind: 'pair-private-talk-response',
      serverCanPersistBody: false,
      deprecatedPublicPath: false,
      reason: 'Responses are scoped to exactly one sender/responder pair.',
    };
  }
  if (root === 'pairConversations') {
    return {
      kind: 'pair-private-conversation',
      serverCanPersistBody: false,
      deprecatedPublicPath: false,
      reason: 'Conversation bodies are scoped to exactly one pair and should not be hub-authoritative.',
    };
  }
  if (root === 'ownerIncomingTalkIndex') {
    return {
      kind: 'owner-private-incoming-talk-index',
      serverCanPersistBody: false,
      deprecatedPublicPath: false,
      reason: 'Direct-mode IN rows are receiver-owned indexes hydrated from pair offers.',
    };
  }
  if (root === 'conversations') {
    return {
      kind: 'pair-private-conversation',
      serverCanPersistBody: false,
      deprecatedPublicPath: true,
      reason: 'Legacy conversation records are removable once pair-private conversations cover the flow.',
    };
  }
  if (root === 'incomingTalksByUser') {
    return {
      kind: 'legacy-public-incoming-talk',
      serverCanPersistBody: false,
      deprecatedPublicPath: true,
      reason: 'Incoming talk bodies must not be server inbox state in direct mode.',
    };
  }
  if (root === 'peerTalkOffers') {
    return {
      kind: 'legacy-public-peer-offer',
      serverCanPersistBody: false,
      deprecatedPublicPath: true,
      reason: 'Offer records must carry encrypted pair metadata or references, not plaintext talk bodies.',
    };
  }
  if (root === 'peerTalkCatalog') {
    return {
      kind: 'legacy-public-peer-catalog',
      serverCanPersistBody: false,
      deprecatedPublicPath: true,
      reason: 'Per-receiver owner indices replace the public peer talk catalog.',
    };
  }
  return {
    kind: 'unknown',
    serverCanPersistBody: true,
    deprecatedPublicPath: false,
    reason: 'No P1 connector boundary rule applies to this path.',
  };
}

export function createConversationTransportDiagnostics(
  flags: P2PRuntimeFlags = resolveP2PRuntimeFlags(),
): ConversationTransportDiagnostics {
  if (flags.p2pDirectChatEnabled) {
    return {
      activeMode: 'direct-p2p',
      availableModes: ['star-gun', 'server-relay', 'direct-p2p'],
      messageBodyStorage: 'gun-local',
      receiptsStorage: 'gun-local',
      fallback: 'server-relay',
    };
  }
  return {
    activeMode: 'star-gun',
    availableModes: ['star-gun', 'server-relay', 'direct-p2p'],
    messageBodyStorage: 'gun-legacy',
    receiptsStorage: 'gun-legacy',
    fallback: null,
  };
}

export function createP2PSignalingEnvelope(params: Omit<P2PSignalingEnvelope, 'version' | 'createdAt' | 'expiresAt'> & {
  now?: Date;
  ttlSeconds?: number;
}): P2PSignalingEnvelope {
  if (!params.signalCiphertext || !params.signalCiphertext.startsWith('SEA{')) {
    throw new Error('P2P signaling payloads must be encrypted ciphertext');
  }
  assertNoPrivateSeaMaterial(params);
  const now = params.now ?? new Date();
  const ttlSeconds = params.ttlSeconds ?? SIGNALING_TTL_SECONDS;
  return {
    version: 1,
    conversationId: params.conversationId,
    kind: params.kind,
    senderPub: params.senderPub,
    recipientPub: params.recipientPub,
    signalCiphertext: params.signalCiphertext,
    signature: params.signature,
    nonce: params.nonce,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

export function createDirectP2PMessageEnvelope(params: Omit<DirectP2PMessageEnvelope, 'version' | 'kind' | 'transport' | 'bodyPlaintext'> & {
  bodyPlaintext?: string;
}): DirectP2PMessageEnvelope {
  const relayEnvelope = createRelayEnvelope({
    kind: 'p2p-message',
    senderPub: params.senderPub,
    ...(params.recipientPub ? { recipientPub: params.recipientPub } : {}),
    ...(params.routeHint ? { routeHint: params.routeHint } : {}),
    ...(params.bodyCiphertext ? { bodyCiphertext: params.bodyCiphertext } : {}),
    signature: params.signature,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
    ...(params.bodyPlaintext ? { bodyPlaintext: params.bodyPlaintext } : {}),
  });
  return {
    ...relayEnvelope,
    kind: 'p2p-message',
    transport: 'webrtc-datachannel',
    conversationId: params.conversationId,
    messageId: params.messageId,
  };
}

export const P2P_PLATFORM_DESCRIPTORS: P2PPlatformDescriptor[] = [
  {
    platform: 'web',
    packageTarget: 'browser app',
    nodeAvailability: 'browser-client',
    backgroundBehavior: 'Foreground tab participates through WebRTC and pairs with a localhost node when installed.',
    permissionBoundaries: ['browser storage', 'WebRTC permission prompts', 'explicit local-node pairing'],
  },
  {
    platform: 'windows',
    packageTarget: 'desktop shell plus local service',
    nodeAvailability: 'bundled-local-node',
    backgroundBehavior: 'Supervisor starts a signed local service during desktop sessions; autoupdate must update UI and node together.',
    permissionBoundaries: ['OS keychain', 'firewall/network access', 'owner-controlled stop and wipe'],
  },
  {
    platform: 'ubuntu',
    packageTarget: 'desktop package plus user systemd service',
    nodeAvailability: 'bundled-local-node',
    backgroundBehavior: 'User-scoped service can run with the desktop session and stops/wipes through the supervisor.',
    permissionBoundaries: ['secret service/keyring', 'user service controls', 'owner-controlled stop and wipe'],
  },
  {
    platform: 'android',
    packageTarget: 'native app foreground service',
    nodeAvailability: 'foreground-service',
    backgroundBehavior: 'Long-running P2P requires foreground-service notification, battery limits, and explicit GPS boundaries.',
    permissionBoundaries: ['foreground-service notification', 'battery optimization', 'GPS permission boundary', 'Android keystore'],
  },
  {
    platform: 'ios',
    packageTarget: 'native app foreground peer',
    nodeAvailability: 'foreground-or-notification-assisted',
    backgroundBehavior: 'No always-on node is assumed; use foreground-only peers or notification-assisted wakeup.',
    permissionBoundaries: ['Keychain', 'notification permission', 'foreground execution limits'],
  },
] as const;

export function createP2PNodeProtocolSpec(): P2PNodeProtocolSpec {
  return {
    version: 1,
    substrate: 'gun-mesh-websocket-webrtc',
    identity: {
      publicKeys: ['pub', 'epub'],
      signature: 'SEA-signature',
      privateKeyRule: SEA_IDENTITY_POLICY.relayEnvelopeRule,
    },
    peerDiscovery: {
      messageKind: 'discovery',
      ttlSeconds: DISCOVERY_TTL_SECONDS,
      requiredFields: ['protocolVersion', 'platform', 'senderPub', 'capabilities', 'endpointHints', 'signature', 'nonce', 'expiresAt'],
    },
    handshake: {
      steps: [
        'publish signed discovery envelope',
        'exchange encrypted signaling offer/answer/candidates',
        'verify sender pub and nonce before accepting transport',
        'open encrypted WebRTC DataChannel with relay fallback available',
      ],
      replayProtection: ['nonce', 'signature', 'expiresAt'],
    },
    capabilities: [
      'signed-discovery',
      'encrypted-signaling',
      'webrtc-datachannel',
      'relay-fallback',
      'local-node-supervisor',
      'neighbor-cache',
      'foreground-service',
      'notification-assisted-wakeup',
    ],
    neighborScore: {
      factors: ['recent successful session', 'nearby chatroom overlap', 'known contact', 'low observed latency', 'relay fallback success'],
      blockedPeerRule: 'Blocked peers are never eligible as remembered neighbors or bootstrap candidates.',
    },
    messageEnvelope: {
      kinds: ['discovery', 'signaling', 'p2p-message'],
      encryptionRule: 'Discovery is signed metadata only; signaling and direct messages must carry ciphertext-only bodies.',
    },
    syncPolicy: {
      localFirstDataClasses: ['profile-private-answers', 'contacts', 'blocked-peers', 'neighbor-cache', 'message-history', 'talks', 'chatbot-memory'],
      relayOnlyDataClasses: ['discovery', 'signaling', 'presence', 'room-membership'],
    },
    platforms: [...P2P_PLATFORM_DESCRIPTORS],
  };
}

export function createP2PDiscoveryMessage(params: Omit<P2PDiscoveryMessage, 'version' | 'kind' | 'protocolVersion' | 'bodyPlaintext'> & {
  bodyPlaintext?: string;
}): P2PDiscoveryMessage {
  if (!params.capabilities?.includes('signed-discovery')) {
    throw new Error('P2P discovery requires signed-discovery capability');
  }
  if (!params.endpointHints || params.endpointHints.length === 0) {
    throw new Error('P2P discovery requires at least one endpoint hint');
  }
  const relayEnvelope = createRelayEnvelope({
    kind: 'discovery',
    senderPub: params.senderPub,
    ...(params.recipientPub ? { recipientPub: params.recipientPub } : {}),
    ...(params.routeHint ? { routeHint: params.routeHint } : {}),
    signature: params.signature,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
    ...(params.bodyPlaintext ? { bodyPlaintext: params.bodyPlaintext } : {}),
  });
  return {
    ...relayEnvelope,
    kind: 'discovery',
    protocolVersion: 1,
    platform: params.platform,
    capabilities: params.capabilities,
    endpointHints: params.endpointHints,
  };
}

export function createP2PNeighborCacheState(
  overrides: Partial<P2PNeighborCacheState> = {},
): P2PNeighborCacheState {
  const controls = overrides.controls ?? {
    enabled: true,
    localOnly: true,
    privateGraphPublishedByDefault: false,
    exportFormat: 'SEA-encrypted-neighbor-state-v1',
  };
  const blockedPeerIds = [...new Set(overrides.blockedPeerIds ?? [])];
  const neighbors = pruneExpiredP2PNeighbors(
    {
      version: 1,
      controls,
      publicStarFallback: overrides.publicStarFallback ?? 'gun-star-server',
      neighbors: overrides.neighbors ?? [],
      blockedPeerIds,
      encryptedExport: overrides.encryptedExport ?? null,
    },
    new Date(),
  ).neighbors;
  return {
    version: 1,
    controls,
    publicStarFallback: overrides.publicStarFallback ?? 'gun-star-server',
    neighbors,
    blockedPeerIds,
    encryptedExport: overrides.encryptedExport ?? null,
  };
}

export function scoreP2PNeighbor(record: P2PNeighborRecord, now = new Date()): number {
  if (record.trustStatus === 'blocked' || record.endpointStatus !== 'active') return -1;
  const ageMs = Math.max(0, now.getTime() - new Date(record.lastSeenAt).getTime());
  const recency = Math.max(0, 30 - Math.floor(ageMs / (60 * 60 * 1000)));
  const sessionScore = Math.min(30, Math.max(0, record.successfulSessions) * 6);
  const chatroomScore = Math.min(15, record.nearbyChatrooms.length * 5);
  const contactScore = record.isContact ? 15 : 0;
  const latencyScore = Math.max(0, 20 - Math.floor(Math.max(0, record.latencyMs) / 25));
  const relayScore = record.transportType === 'gun-relay' || record.transportType === 'websocket-relay' ? 4 : 0;
  return recency + sessionScore + chatroomScore + contactScore + latencyScore + relayScore;
}

export function pruneExpiredP2PNeighbors(state: P2PNeighborCacheState, now = new Date()): P2PNeighborCacheState {
  const blocked = new Set(state.blockedPeerIds);
  const fresh = state.neighbors.filter((neighbor) => {
    const expiresAt = new Date(neighbor.expiresAt).getTime();
    return expiresAt > now.getTime() && neighbor.trustStatus !== 'blocked' && !blocked.has(neighbor.peerId);
  });
  return { ...state, neighbors: sortP2PNeighbors(fresh, now) };
}

export function upsertP2PNeighbor(
  state: P2PNeighborCacheState,
  record: Omit<P2PNeighborRecord, 'expiresAt'> & { expiresAt?: string },
  now = new Date(),
): P2PNeighborCacheState {
  if (!state.controls.enabled) return state;
  if (!record.peerId) throw new Error('Neighbor cache requires peerId');
  if (!record.endpointHints || record.endpointHints.length === 0) {
    throw new Error('Neighbor cache requires endpoint hints');
  }
  assertNoPrivateSeaMaterial(record);
  const blocked = new Set(state.blockedPeerIds);
  if (record.trustStatus === 'blocked') blocked.add(record.peerId);
  if (blocked.has(record.peerId)) {
    return {
      ...state,
      blockedPeerIds: [...blocked],
      neighbors: state.neighbors.filter((neighbor) => neighbor.peerId !== record.peerId),
    };
  }
  const normalized: P2PNeighborRecord = {
    ...record,
    endpointHints: [...new Set(record.endpointHints)],
    capabilities: [...new Set(record.capabilities)],
    nearbyChatrooms: [...new Set(record.nearbyChatrooms)],
    successfulSessions: Math.max(0, record.successfulSessions),
    latencyMs: Math.max(0, record.latencyMs),
    expiresAt: record.expiresAt ?? new Date(now.getTime() + NEIGHBOR_CACHE_TTL_SECONDS * 1000).toISOString(),
  };
  const next = state.neighbors.filter((neighbor) => neighbor.peerId !== normalized.peerId);
  next.push(normalized);
  return pruneExpiredP2PNeighbors({ ...state, blockedPeerIds: [...blocked], neighbors: next }, now);
}

export function getP2PBootstrapCandidates(state: P2PNeighborCacheState, now = new Date()): P2PNeighborRecord[] {
  if (!state.controls.enabled) return [];
  return pruneExpiredP2PNeighbors(state, now).neighbors.filter((neighbor) => {
    return neighbor.endpointStatus === 'active' && neighbor.endpointHints.length > 0 && scoreP2PNeighbor(neighbor, now) >= 0;
  });
}

export function applyP2PNeighborCacheAction(
  state: P2PNeighborCacheState,
  action: P2PNeighborCacheAction,
  params: { peerId?: string; encryptedExport?: string } = {},
): P2PNeighborCacheState {
  if (action === 'clear') {
    return { ...state, neighbors: [], encryptedExport: null };
  }
  if (action === 'disable') {
    return { ...state, controls: { ...state.controls, enabled: false }, neighbors: [], encryptedExport: null };
  }
  if (action === 'enable') {
    return { ...state, controls: { ...state.controls, enabled: true } };
  }
  if (action === 'block-peer') {
    if (!params.peerId) throw new Error('peerId is required to block a remembered peer');
    const blockedPeerIds = [...new Set([...state.blockedPeerIds, params.peerId])];
    return {
      ...state,
      blockedPeerIds,
      neighbors: state.neighbors.filter((neighbor) => neighbor.peerId !== params.peerId),
    };
  }
  if (action === 'export-encrypted') {
    const encryptedExport = params.encryptedExport || 'SEA{"ct":"encrypted-neighbor-state"}';
    if (!encryptedExport.startsWith('SEA{')) {
      throw new Error('Neighbor cache export must be encrypted');
    }
    return { ...state, encryptedExport };
  }
  return state;
}

export function createDataOwnershipPolicy(): DataOwnershipPolicy {
  return {
    version: 1,
    deviceLocalDelete: {
      label: "Delete this device's local data",
      clears: ['profile-private-answers', 'contacts', 'blocked-peers', 'neighbor-cache', 'message-history', 'talks', 'chatbot-memory'],
      doesNotDelete: ['public profile records', 'public reputation counters', 'active relay TTL records'],
    },
    serverHeldDataRequest: {
      label: 'Request/delete server-held data',
      supportedRequests: ['export-server-held-data', 'delete-server-held-data'],
      relayVisibility: 'metadata-only',
    },
    migration: {
      eligibleCategories: ['encrypted-user-owned', 'removable-legacy'],
      target: 'local-encrypted-user-owned-storage',
    },
  };
}

export function createDeviceLocalDataDeletion(now = new Date()): DeviceLocalDataDeletion {
  return {
    deletedAt: now.toISOString(),
    clearedDataClasses: [...createDataOwnershipPolicy().deviceLocalDelete.clears],
    retainedServerHeldRequestUrl: '/api/p2p/data-ownership/request-server-data',
  };
}

export function createDataOwnershipRequest(
  requestType: DataOwnershipRequestType,
  userPub: string,
  now = new Date(),
): DataOwnershipRequest {
  if (!userPub) throw new Error('userPub is required for server-held data requests');
  if (!createDataOwnershipPolicy().serverHeldDataRequest.supportedRequests.includes(requestType)) {
    throw new Error('Unsupported server-held data request type');
  }
  return {
    requestId: `data_req_${now.getTime()}_${requestType}`,
    requestType,
    userPub,
    status: 'queued',
    createdAt: now.toISOString(),
    relayVisibility: 'metadata-only',
  };
}

export function createDataMigrationPlan(
  paths: Array<{ path: string; category: string; purpose?: string }> = [...STAR_GUN_PATH_CLASSIFICATIONS],
): DataMigrationPlan {
  const eligible = new Set<string>(createDataOwnershipPolicy().migration.eligibleCategories);
  const items = paths.map((item) => {
    const canMove = eligible.has(item.category);
    return {
      path: item.path,
      category: item.category,
      action: canMove ? 'move-to-local-encrypted' : 'leave-on-relay',
      reason: canMove ? 'Eligible private or legacy server-held data migrates to encrypted owner storage.' : 'Relay/public data remains on its existing boundary.',
    } satisfies DataMigrationItem;
  });
  return {
    version: 1,
    items,
    movedCount: items.filter((item) => item.action === 'move-to-local-encrypted').length,
  };
}

export function createRelayOnlyTtlPolicy(): RelayOnlyTtlPolicy {
  return {
    discovery: { ttlSeconds: DISCOVERY_TTL_SECONDS, storage: 'relay-only', bodyRule: 'signed metadata, no plaintext body' },
    signaling: { ttlSeconds: SIGNALING_TTL_SECONDS, storage: 'relay-only', bodyRule: 'encrypted signaling ciphertext only' },
    presence: { ttlSeconds: PRESENCE_TTL_SECONDS, storage: 'relay-only', bodyRule: 'presence metadata expires quickly' },
    'room-membership': { ttlSeconds: ROOM_MEMBERSHIP_TTL_SECONDS, storage: 'relay-only', bodyRule: 'membership is current-state routing metadata' },
  };
}

export function createTransportDiagnosticEvent(
  mode: ConversationTransportMode,
  fallbackReason: string | null = null,
  now = new Date(),
): TransportDiagnosticEvent {
  return {
    version: 1,
    mode,
    usedFallback: mode !== 'direct-p2p' || !!fallbackReason,
    fallbackReason,
    storedTelemetry: false,
    visibleToUser: true,
    createdAt: now.toISOString(),
  };
}

function sortP2PNeighbors(neighbors: P2PNeighborRecord[], now = new Date()): P2PNeighborRecord[] {
  return [...neighbors].sort((a, b) => {
    const scoreDelta = scoreP2PNeighbor(b, now) - scoreP2PNeighbor(a, now);
    if (scoreDelta !== 0) return scoreDelta;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });
}

export function toPublicSeaIdentity(pair: SeaPrivateIdentityMaterial | SeaPublicIdentity): SeaPublicIdentity {
  if (!pair?.pub || !pair?.epub) {
    throw new Error('SEA public identity requires pub and epub');
  }
  return { pub: pair.pub, epub: pair.epub };
}

export function findPrivateSeaMaterial(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...findPrivateSeaMaterial(item, `${path}[${index}]`));
    });
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if ((PRIVATE_SEA_KEYS as readonly string[]).includes(key) && typeof child === 'string' && child.length > 0) {
      found.push(childPath);
    }
    found.push(...findPrivateSeaMaterial(child, childPath));
  }
  return found;
}

export function assertNoPrivateSeaMaterial(value: unknown): void {
  const privatePaths = findPrivateSeaMaterial(value);
  if (privatePaths.length > 0) {
    throw new Error(`Private SEA key material is not publishable: ${privatePaths.join(', ')}`);
  }
}

export function createRelayEnvelope(params: Omit<RelayEnvelope, 'version' | 'bodyPlaintext'> & { bodyPlaintext?: string }): RelayEnvelope {
  if (params.bodyPlaintext) {
    throw new Error('Relay envelopes cannot contain plaintext message bodies');
  }
  assertNoPrivateSeaMaterial(params);
  return {
    version: 1,
    kind: params.kind,
    senderPub: params.senderPub,
    ...(params.recipientPub ? { recipientPub: params.recipientPub } : {}),
    ...(params.routeHint ? { routeHint: params.routeHint } : {}),
    ...(params.bodyCiphertext ? { bodyCiphertext: params.bodyCiphertext } : {}),
    signature: params.signature,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  };
}

export function createLinkedDeviceManifest(params: LinkedDeviceManifest): LinkedDeviceManifest {
  if (!params.randomManifestId || params.randomManifestId.includes(params.revokedDevicePubs[0] || ' ')) {
    throw new Error('Linked-device manifests require unlinkable random ids');
  }
  if (!params.encryptedManifest) {
    throw new Error('Linked-device manifests must store encrypted manifests only');
  }
  assertNoPrivateSeaMaterial(params);
  return { ...params };
}

export function scanRelayStorageForSeaLeaks(graph: Record<string, unknown>): {
  ok: boolean;
  privateKeyPaths: string[];
  plaintextMessagePaths: string[];
} {
  const privateKeyPaths = findPrivateSeaMaterial(graph);
  const plaintextMessagePaths: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (
        key === 'text' &&
        typeof child === 'string' &&
        child.trim() !== '' &&
        !child.startsWith('SEA{') &&
        !child.startsWith('enc:') &&
        path.includes('messages')
      ) {
        plaintextMessagePaths.push(childPath);
      }
      walk(child, childPath);
    }
  };
  walk(graph, '$');
  return {
    ok: privateKeyPaths.length === 0 && plaintextMessagePaths.length === 0,
    privateKeyPaths,
    plaintextMessagePaths,
  };
}

export const STAR_GUN_PATH_CLASSIFICATIONS = [
  {
    path: 'users/{userId}/profile',
    category: 'encrypted-user-owned',
    purpose: 'Profile foundation fields and private Q/A mirrors controlled by the user.',
  },
  {
    path: 'users/{userId}/publicProfile',
    category: 'durable-public',
    purpose: 'Stage name, avatar, languages, interests, and visibility-filtered profile fields.',
  },
  {
    path: 'users/{userId}/reputation',
    category: 'durable-public',
    purpose: 'Public reputation counters used for credit, blocking, age vouching, and send limits.',
  },
  {
    path: 'chatrooms/{chatroomId}',
    category: 'durable-public',
    purpose: 'Automatic and custom chatroom metadata plus current membership map.',
  },
  {
    path: 'talks/{talkId}',
    category: 'encrypted-user-owned',
    purpose: 'Author-owned canonical talk definitions referenced by direct pair offers.',
  },
  {
    path: 'incomingTalksByUser/{userId}',
    category: 'relay-only',
    purpose: 'Legacy star-mode delivery inbox and dedup clusters for incoming talks.',
  },
  {
    path: 'ownerIncomingTalkIndex/{userId}',
    category: 'encrypted-user-owned',
    purpose: 'Direct-mode receiver-owned IN index hydrated from pair offers.',
  },
  {
    path: 'conversations/{conversationId}',
    category: 'removable-legacy',
    purpose: 'Star-mode matched chat records retained for compatibility until direct transport replaces them.',
  },
  {
    path: 'talkAnswerTemplateByUser/{userId}',
    category: 'encrypted-user-owned',
    purpose: 'Chatbot answer templates and exact memory records owned by the responder.',
  },
  {
    path: 'exactChatbotMemoryByUser/{userId}',
    category: 'encrypted-user-owned',
    purpose: 'Exact chatbot memory index for deterministic answer reuse.',
  },
  {
    path: 'stats/*',
    category: 'durable-public',
    purpose: 'Aggregated talk response statistics with privacy thresholds and no precise location.',
  },
] as const;

export type LocalNodeStatus = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'stopping' | 'wiped';

export type LocalNodeDataClass =
  | 'user-data'
  | 'neighbor-cache'
  | 'private-profile'
  | 'message-history'
  | 'encrypted-backup';

export type LocalNodePermissionDisclosure = {
  key: string;
  label: string;
  description: string;
  required: boolean;
};

export type LocalNodePersistenceControl = {
  dataClass: LocalNodeDataClass;
  localOnly: boolean;
  enabled: boolean;
  exportable: boolean;
};

export type LocalNodeSessionPairing = {
  required: true;
  trustModel: 'signed-session-pairing';
  bridgeUrl: string;
  expiresInSeconds: number;
};

export type LocalNodeIdentityBinding = {
  webIdentityId: string;
  nodeIdentityId: string;
  proof: string;
  createdAt: string;
};

export type LocalNodeSupervisorSnapshot = {
  status: LocalNodeStatus;
  uiProcess: 'browser' | 'desktop-shell';
  serviceProcess: 'gun-libp2p-local-service';
  health: {
    ok: boolean;
    lastCheckedAt: string | null;
    reason: string;
  };
  permissionDisclosures: LocalNodePermissionDisclosure[];
  sessionPairing: LocalNodeSessionPairing;
  identityBinding: LocalNodeIdentityBinding | null;
  persistenceControls: LocalNodePersistenceControl[];
};

export type LocalNodeAction = 'start' | 'stop' | 'restart' | 'health-check' | 'wipe' | 'bind-identity';

export const LOCAL_NODE_PERMISSION_DISCLOSURES: LocalNodePermissionDisclosure[] = [
  {
    key: 'storage',
    label: 'Storage',
    description: 'Stores selected private data on this device and can be wiped by the owner.',
    required: true,
  },
  {
    key: 'bandwidth',
    label: 'Bandwidth',
    description: 'Uses network bandwidth for discovery, relay fallback, and peer sync while enabled.',
    required: true,
  },
  {
    key: 'battery',
    label: 'Battery',
    description: 'May use extra battery while maintaining peer connectivity.',
    required: true,
  },
  {
    key: 'background',
    label: 'Background behavior',
    description: 'Desktop packages run a separate local service process; web mode must pair explicitly.',
    required: true,
  },
  {
    key: 'local-port',
    label: 'Local port',
    description: 'Browsers connect through a localhost WebSocket bridge after signed session pairing.',
    required: true,
  },
  {
    key: 'delete-stop',
    label: 'Stop and delete',
    description: 'The owner can stop the node or delete local node state at any time.',
    required: true,
  },
] as const;

export const DEFAULT_LOCAL_NODE_PERSISTENCE_CONTROLS: LocalNodePersistenceControl[] = [
  { dataClass: 'user-data', localOnly: true, enabled: true, exportable: true },
  { dataClass: 'neighbor-cache', localOnly: true, enabled: true, exportable: true },
  { dataClass: 'private-profile', localOnly: true, enabled: true, exportable: true },
  { dataClass: 'message-history', localOnly: true, enabled: true, exportable: true },
  { dataClass: 'encrypted-backup', localOnly: true, enabled: false, exportable: true },
] as const;

export function createLocalNodeSupervisorSnapshot(
  overrides: Partial<LocalNodeSupervisorSnapshot> = {},
): LocalNodeSupervisorSnapshot {
  const status = overrides.status ?? 'stopped';
  const running = status === 'running';
  return {
    status,
    uiProcess: overrides.uiProcess ?? 'browser',
    serviceProcess: overrides.serviceProcess ?? 'gun-libp2p-local-service',
    health: overrides.health ?? {
      ok: running,
      lastCheckedAt: null,
      reason: running ? 'Local node is accepting paired browser sessions.' : 'Local node is stopped.',
    },
    permissionDisclosures: overrides.permissionDisclosures ?? [...LOCAL_NODE_PERMISSION_DISCLOSURES],
    sessionPairing: overrides.sessionPairing ?? {
      required: true,
      trustModel: 'signed-session-pairing',
      bridgeUrl: 'ws://127.0.0.1:8765/iinpublic-local-node',
      expiresInSeconds: 120,
    },
    identityBinding: overrides.identityBinding ?? null,
    persistenceControls: overrides.persistenceControls ?? [...DEFAULT_LOCAL_NODE_PERSISTENCE_CONTROLS],
  };
}

export function applyLocalNodeAction(
  snapshot: LocalNodeSupervisorSnapshot,
  action: LocalNodeAction,
  now = new Date(),
  binding?: Pick<LocalNodeIdentityBinding, 'webIdentityId' | 'nodeIdentityId' | 'proof'>,
): LocalNodeSupervisorSnapshot {
  const at = now.toISOString();
  if (action === 'start') {
    return {
      ...snapshot,
      status: 'running',
      health: { ok: true, lastCheckedAt: at, reason: 'Local node is accepting paired browser sessions.' },
    };
  }
  if (action === 'stop') {
    return {
      ...snapshot,
      status: 'stopped',
      health: { ok: false, lastCheckedAt: at, reason: 'Local node was stopped by the owner.' },
    };
  }
  if (action === 'restart') {
    return {
      ...snapshot,
      status: 'running',
      health: { ok: true, lastCheckedAt: at, reason: 'Local node restarted successfully.' },
    };
  }
  if (action === 'health-check') {
    return {
      ...snapshot,
      health: {
        ok: snapshot.status === 'running',
        lastCheckedAt: at,
        reason: snapshot.status === 'running' ? 'Local node health check passed.' : 'Local node is not running.',
      },
    };
  }
  if (action === 'wipe') {
    return {
      ...createLocalNodeSupervisorSnapshot({ uiProcess: snapshot.uiProcess }),
      status: 'wiped',
      health: { ok: false, lastCheckedAt: at, reason: 'Local node data was wiped by the owner.' },
    };
  }
  if (action === 'bind-identity') {
    if (!binding?.webIdentityId || !binding.nodeIdentityId || !binding.proof) {
      throw new Error('webIdentityId, nodeIdentityId, and proof are required to bind a local node identity');
    }
    return {
      ...snapshot,
      identityBinding: { ...binding, createdAt: at },
    };
  }
  return snapshot;
}
