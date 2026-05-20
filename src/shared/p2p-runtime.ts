export type StarServerPersistencePolicy = 'durable' | 'ephemeral';

export type P2PRuntimeFlags = {
  starServerPersistence: StarServerPersistencePolicy;
  p2pNodeEnabled: boolean;
  p2pDirectChatEnabled: boolean;
};

export type ConversationTransportMode = 'star-gun' | 'server-relay' | 'direct-p2p';

export type ConversationTransportDiagnostics = {
  activeMode: ConversationTransportMode;
  availableModes: ConversationTransportMode[];
  messageBodyStorage: 'gun-legacy' | 'relay-ciphertext-only' | 'local-only';
  receiptsStorage: 'gun-legacy' | 'local-only';
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

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
}

function parsePersistencePolicy(value: string | undefined): StarServerPersistencePolicy {
  return value === 'ephemeral' ? 'ephemeral' : 'durable';
}

export function resolveP2PRuntimeFlags(env: Record<string, string | undefined> = {}): P2PRuntimeFlags {
  const get = (key: string): string | undefined => env[key] ?? readEnv(key);
  return {
    starServerPersistence: parsePersistencePolicy(get('STAR_SERVER_PERSISTENCE')),
    p2pNodeEnabled: parseBooleanFlag(get('P2P_NODE_ENABLED'), false),
    p2pDirectChatEnabled: parseBooleanFlag(get('P2P_DIRECT_CHAT_ENABLED'), false),
  };
}

export function createConversationTransportDiagnostics(flags: P2PRuntimeFlags): ConversationTransportDiagnostics {
  if (flags.p2pDirectChatEnabled) {
    return {
      activeMode: 'direct-p2p',
      availableModes: ['star-gun', 'server-relay', 'direct-p2p'],
      messageBodyStorage: 'local-only',
      receiptsStorage: 'local-only',
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
    category: 'durable-public',
    purpose: 'Author-owned talk definitions needed for broadcast and response replay.',
  },
  {
    path: 'incomingTalksByUser/{userId}',
    category: 'relay-only',
    purpose: 'Current star-mode delivery inbox and dedup clusters for incoming talks.',
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
