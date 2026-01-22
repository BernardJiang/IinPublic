export const CONFIG = {
  // Chatroom settings
  CHATROOM_CAPACITY: 1000,
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
    BULK_SEND_DAILY: 5
  },
  
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
  DEBUG_MODE: process.env.NODE_ENV !== 'production',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
} as const;