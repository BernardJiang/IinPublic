/**
 * Decision-locked application data ownership model.
 *
 * This is intentionally declarative: repositories and migration tests can import
 * it without depending on the web runtime. Temporary stores describe current
 * compatibility debt; `targetAuthoritativeStore` is the invariant new code must
 * satisfy. See docs/architecture/gun-authoritative-store-inventory.md.
 */

export type VisibilityClass = 'room-public' | 'user-private' | 'pair-private';
export type DurableDataClass =
  | 'authored-talk'
  | 'received-talk'
  | 'incoming-cluster'
  | 'me-qa'
  | 'chatbot-memory'
  | 'talk-response'
  | 'conversation-message'
  | 'chatroom'
  | 'reputation-input'
  | 'talk-ledger';

export type StoreKind =
  | 'local-gun'
  | 'local-storage'
  | 'memory-cache'
  | 'remote-gun-relay'
  | 'encrypted-mailbox';

export type DataInvariant = {
  dataClass: DurableDataClass;
  visibility: VisibilityClass;
  targetSoul: string;
  targetAuthoritativeStore: 'local-gun';
  currentStores: readonly StoreKind[];
  temporaryOnlyStores: readonly Exclude<StoreKind, 'local-gun'>[];
};

export const AUTHORITATIVE_DATA_INVARIANTS: readonly DataInvariant[] = [
  { dataClass: 'authored-talk', visibility: 'room-public', targetSoul: 'users/<authorSeaPub>/talks/<talkId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-storage', 'remote-gun-relay'], temporaryOnlyStores: ['local-storage', 'remote-gun-relay'] },
  { dataClass: 'received-talk', visibility: 'user-private', targetSoul: 'users/<ownerSeaPub>/receivedTalks/<authorSeaPub>/<talkId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-storage', 'memory-cache'], temporaryOnlyStores: ['local-storage', 'memory-cache'] },
  { dataClass: 'incoming-cluster', visibility: 'user-private', targetSoul: 'users/<ownerSeaPub>/incomingTalkClusters/<identityKey>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-gun'], temporaryOnlyStores: [] },
  { dataClass: 'me-qa', visibility: 'user-private', targetSoul: 'users/<ownerSeaPub>/meQa/<questionCid>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-storage'], temporaryOnlyStores: ['local-storage'] },
  { dataClass: 'chatbot-memory', visibility: 'user-private', targetSoul: 'users/<ownerSeaPub>/chatbotMemory/<questionCid>/<contextHash>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-storage'], temporaryOnlyStores: ['local-storage'] },
  { dataClass: 'talk-response', visibility: 'pair-private', targetSoul: 'pairs/<pairId>/talkResponses/<talkId>/<responseId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-gun', 'encrypted-mailbox'], temporaryOnlyStores: ['encrypted-mailbox'] },
  { dataClass: 'conversation-message', visibility: 'pair-private', targetSoul: 'pairs/<pairId>/conversations/<conversationId>/messages/<messageId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-gun', 'local-storage', 'encrypted-mailbox'], temporaryOnlyStores: ['local-storage', 'encrypted-mailbox'] },
  { dataClass: 'chatroom', visibility: 'room-public', targetSoul: 'rooms/<roomId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-gun', 'remote-gun-relay'], temporaryOnlyStores: ['remote-gun-relay'] },
  { dataClass: 'reputation-input', visibility: 'user-private', targetSoul: 'users/<ownerSeaPub>/reputationInputs/<eventId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-storage'], temporaryOnlyStores: ['local-storage'] },
  { dataClass: 'talk-ledger', visibility: 'user-private', targetSoul: 'users/<ownerSeaPub>/talkLedger/<entryKind>/<entryId>', targetAuthoritativeStore: 'local-gun', currentStores: ['local-storage'], temporaryOnlyStores: ['local-storage'] },
] as const;

export const DURABLE_DATA_CLASSES: readonly DurableDataClass[] = [
  'authored-talk', 'received-talk', 'incoming-cluster', 'me-qa', 'chatbot-memory',
  'talk-response', 'conversation-message', 'chatroom', 'reputation-input', 'talk-ledger',
] as const;

