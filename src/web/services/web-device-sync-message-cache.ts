/**
 * Local, per-device cache of message plaintext learned through WP5 device-sync's `messages`
 * category (see web-device-sync-service.ts's doc comment). This is deliberately NOT the same
 * storage path `GunMessageStore` uses: a message record here was ECDH-encrypted for the
 * *original* two conversation participants (one of them this identity's OTHER linked device,
 * not this device), so this device cannot re-derive that secret — `identityPrivateKeys` is
 * explicitly device-local/non-transferable (device-sync-contract.ts's DEVICE_SYNC_DATA_INVENTORY).
 * The device-sync protocol instead ships already-decrypted plaintext, re-encrypted only for
 * transport between the two linked devices' own keys; once imported, it is plaintext exactly
 * like every other localStorage-cached app record (`myConversations`, `myTalks`, ...), so it is
 * kept here rather than forced through a decrypt path that can never succeed for it.
 *
 * `mergeMessagesWithSynced` is the read-side join: a conversation this device never natively
 * participated in has no live Gun messages at all (the pair path is keyed by the two ORIGINAL
 * participant ids, not this device's), so the synced cache is its only source of history; a
 * conversation this device also sends into simply gets the union, live copies winning any
 * id collision.
 */

export interface SyncedMessage {
  id: string;
  senderId: string;
  text: string;
  /** ISO timestamp. */
  timestamp: string;
  talkId?: string;
  channel?: 'public' | 'known' | 'mutual';
}

type SyncedMessageStore = Record<string, Record<string, SyncedMessage>>;

const STORAGE_KEY = 'iinpublic_device_sync_synced_messages_v1';

function readStore(): SyncedMessageStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: SyncedMessageStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Idempotent — safe to call repeatedly for the same message id. */
export function addSyncedMessage(conversationId: string, message: SyncedMessage): void {
  if (!conversationId || !message?.id) return;
  const store = readStore();
  const forConversation = store[conversationId] || {};
  forConversation[message.id] = message;
  store[conversationId] = forConversation;
  writeStore(store);
}

export function getSyncedMessages(conversationId: string): SyncedMessage[] {
  const store = readStore();
  return Object.values(store[conversationId] || {});
}

/**
 * Joins live (already-`Message`-shaped, already-decrypted-by-this-device) messages with this
 * device's synced-plaintext cache for the same conversation. Live copies win on id collision
 * (this device's own decrypt is authoritative when it actually has one); result is sorted the
 * same way `GunMessageStore.collectAndDecryptMessages` orders its own output (timestamp, then
 * id) so thread rendering sees one consistent chronological list either way.
 */
export function mergeMessagesWithSynced(conversationId: string, liveMessages: readonly any[]): any[] {
  const synced = getSyncedMessages(conversationId);
  if (synced.length === 0) return [...liveMessages];
  const byId = new Map<string, any>();
  for (const message of liveMessages) {
    if (message?.id) byId.set(String(message.id), message);
  }
  for (const message of synced) {
    if (byId.has(message.id)) continue;
    byId.set(message.id, {
      id: message.id,
      senderId: message.senderId,
      text: message.text,
      isFromChatbot: false,
      timestamp: new Date(message.timestamp),
      readBy: [],
      channel: message.channel || 'public',
      ...(message.talkId ? { talkId: message.talkId } : {}),
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const byTime = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (byTime !== 0) return byTime;
    return String(a.id).localeCompare(String(b.id));
  });
}
