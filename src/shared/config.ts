// Helper to safely access environment variables in browser and Node.js
const getEnv = (key: string, defaultValue: string): string => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || defaultValue;
  }
  return defaultValue;
};

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

/** Max users per chatroom in release builds (local debug uses 3 — see CONFIG.CHATROOM_CAPACITY). */
export const RELEASE_CHATROOM_CAPACITY = 498;

export const CONFIG = {
  // Chatroom settings
  // Capacity/FIFO rule (one rule for the web bundle, the Node server and the embedded apps):
  //   release (default)  -> RELEASE_CHATROOM_CAPACITY, FIFO on
  //   local debug        -> 3, FIFO on   (webpack `--mode development` and the dev:* scripts bake/export it)
  //   tests              -> whatever they pass explicitly (CHATROOM_MAX_CAPACITY / CHATROOM_ENABLE_FIFO env,
  //                         or `?e2e_capacity=` / `?e2e_fifo=` on the page URL)
  // The `process.env.X` reads are static on purpose so webpack can inline them in the browser bundle.
  CHATROOM_CAPACITY: parseInt(
    e2eUrlParam('e2e_capacity') || process.env.CHATROOM_MAX_CAPACITY || String(RELEASE_CHATROOM_CAPACITY),
    10,
  ),
  CHATROOM_ENABLE_FIFO:
    (e2eUrlParam('e2e_fifo') || process.env.CHATROOM_ENABLE_FIFO || 'true') !== 'false',
  GLOBAL_CHATROOM_ID: 'global',
  /** OSM vector basemap used by the lazy MapLibre chatroom view. Override for self-hosting. */
  CHATROOM_MAP_STYLE_URL:
    typeof process !== 'undefined' && process.env?.IINPUBLIC_MAP_STYLE_URL
      ? process.env.IINPUBLIC_MAP_STYLE_URL
      : 'https://tiles.openfreemap.org/styles/liberty',

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
