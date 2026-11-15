/**
 * Batching (OPEN-114): what I send one person while an entry of our pair log is being written goes
 * into the next entry together, up to these limits. One signature, one hash and one encryption per
 * entry, and the receiver reads one entry instead of many: a first meeting's whole catch-up is a few
 * entries. Kept apart from `graph-sync.ts` so the page can read the limits without the sync code.
 */
export const BATCH_MAX_ITEMS = 64;
export const BATCH_MAX_CHARS = 64_000;
/** An entry larger than this is written as its own node; the log block holds a pointer to it, so a
 * block (256 entries) stays far below one Radisk file (1 MB). */
export const INLINE_ENTRY_MAX_CHARS = 4_096;
