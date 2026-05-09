// Helper to safely access environment variables in browser and Node.js
const getEnv = (key: string, defaultValue: string): string => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || defaultValue;
  }
  return defaultValue;
};

/** Playwright e2e starts the API with E2E_GUN_MEMORY_ONLY — align FIFO/capacity so server matches the e2e web bundle. */
const e2eServerGun =
  typeof process !== 'undefined' &&
  process.env &&
  (process.env.E2E_GUN_MEMORY_ONLY === '1' || process.env.E2E_GUN_MEMORY_ONLY === 'true');

const browserLocalLoopback =
  typeof window !== 'undefined' &&
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');

/**
 * Read a URL search param at module load time (browser only, non-production).
 * Allows e2e tests to override specific CONFIG values per page by navigating to
 * `/?e2e_capacity=3&e2e_fifo=true` without needing a separate webpack build.
 * Returns null on server / in production.
 */
const e2eUrlParam = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
};

export const CONFIG = {
  // Chatroom settings
  CHATROOM_CAPACITY: parseInt(
    e2eUrlParam('e2e_capacity') ??
      getEnv('CHATROOM_MAX_CAPACITY', e2eServerGun || browserLocalLoopback ? '50' : '3'),
    10,
  ),
  CHATROOM_ENABLE_FIFO:
    (e2eUrlParam('e2e_fifo') ??
      getEnv('CHATROOM_ENABLE_FIFO', e2eServerGun || browserLocalLoopback ? 'false' : 'true')) !==
    'false',
  GLOBAL_CHATROOM_ID: 'global',

  // Bulk sending limits
  MAX_BULK_RECIPIENTS: 1000,
  DEFAULT_BULK_LIMIT: 100,

  // Location privacy
  LOCATION_BLUR_RADIUS: 1000, // meters
  MAX_LOCATION_PRECISION: 100, // meters

  // Rate limiting
  RATE_LIMITS: {
    TALK_SEND_DAILY: 10,
    TALK_SEND_WEEKLY: 50,
    MESSAGE_PER_MINUTE: 60,
    BULK_SEND_DAILY: 5,
  },
  /** Min milliseconds between a user's send/receive talk edges (0 = off). Env: IINPUBLIC_SYMMETRIC_TALK_EDGE_COOLDOWN_MS */
  SYMMETRIC_TALK_EDGE_COOLDOWN_MS: Math.max(
    0,
    parseInt(getEnv('IINPUBLIC_SYMMETRIC_TALK_EDGE_COOLDOWN_MS', '0'), 10) || 0,
  ),

  // Talk structure
  MAX_QUESTIONS_PER_TALK: 20,
  MAX_ANSWERS_PER_QUESTION: 10,
  MAX_TALK_DEPTH: 10,

  // Content filtering
  GRAMMAR_THRESHOLD: 0.7,
  DIRTY_WORDS_STRICTNESS: 'moderate',

  // Reputation
  MIN_REPUTATION_FOR_BULK: -10,
  BLOCK_IMPACT_MULTIPLIER: 2,

  // Performance
  MESSAGE_HISTORY_LIMIT: 1000,
  CONVERSATION_EXPIRY_DAYS: 30,

  // Survey
  MIN_SURVEY_RESPONSES: 5,
  MAX_SURVEY_QUESTIONS: 15,

  // Age verification
  MIN_AGE_FOR_ADULT_CONTENT: 18,
  AGE_VERIFICATION_THRESHOLD: 3, // votes needed

  // Development
  DEBUG_MODE: getEnv('NODE_ENV', 'development') !== 'production',
  LOG_LEVEL: getEnv('LOG_LEVEL', 'info'),
} as const;
