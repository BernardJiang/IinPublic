export type StarServerPersistencePolicy = 'durable' | 'ephemeral';

export type P2PRuntimeFlags = {
  starServerPersistence: StarServerPersistencePolicy;
  p2pNodeEnabled: boolean;
  p2pDirectChatEnabled: boolean;
};

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
