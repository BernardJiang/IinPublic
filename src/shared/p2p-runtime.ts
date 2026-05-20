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
