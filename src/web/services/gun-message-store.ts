import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { boundRecentWires, DEFAULT_RECONCILE_WINDOW, type ReconcileMessage } from '../../shared/conversation-reconcile';
import type { SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';

/** Wire shape shared by P2P transports when persisting to Gun (REQ-P2P-01). */
export type ConversationMessageWire = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
  transport?: string;
  encryption?: 'sea-ecdh-v1';
  prevSeen?: string;
  isFromChatbot?: boolean;
};

/**
 * Gun-on-device message persistence — the durable source of truth for
 * `conversations/<id>/messages` (and pair-private `pairConversations/...`), per spec
 * §19.4. Builds/persists outbound messages, writes message records idempotently, and
 * subscribes to + decrypts the conversation graph.
 *
 * This is the store that `DirectP2PConversationTransport` writes through (WebRTC is
 * notify/sync only). It is intentionally NOT a `ConversationTransport`: the
 * `mode`/`sendMessage` "transport" facade lives in `StarGunConversationTransport`,
 * which extends this class. Splitting the two (P2P-messaging Phase 2) keeps the Gun
 * persistence role distinct from the star-fallback transport role.
 */
export class GunMessageStore {
  /** Default transport label for records that don't carry their own (overridden by subclasses). */
  mode: ConversationTransportMode = 'direct-p2p';

  /**
   * Tracks the most-recent message id from the *other* participant, keyed by
   * `${conversationId}:${myUserId}`. Updated by subscribeToMessages when
   * myUserId is provided; read by buildAndPersistMessage to populate prevSeen.
   */
  private lastSeenFromOther = new Map<string, string>();

  constructor(protected gunService: WebGunService) {}

  private async getOtherParticipantId(conversationId: string, myId: string): Promise<string | undefined> {
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      gun.get(`conversations/${conversationId}`).once((d: any) => {
        if (!d?.data) {
          resolve(undefined);
          return;
        }
        try {
          const c = JSON.parse(d.data);
          const parts: string[] = c.participants || [];
          resolve(parts.find((p) => p !== myId));
        } catch {
          resolve(undefined);
        }
      });
    });
  }

  private async getUserEpub(userId: string): Promise<string | undefined> {
    // WebGunService.getPublicUser()/get() rejects when the *first* `.once()` callback fires
    // with `data === undefined` — a normal transient state for a peer record that hasn't
    // synced to this device's local Gun yet (freshly-matched conversation, cold page). That
    // is not a decrypt failure; treat it the same as "no epub yet" so callers fall back to
    // ciphertext instead of the whole decrypt batch being lost to an unhandled rejection.
    try {
      const user = await this.gunService.getPublicUser(userId);
      return user.epub;
    } catch {
      return undefined;
    }
  }

  private pairIdForUsers(userA: string, userB: string): string {
    return [String(userA || '').trim(), String(userB || '').trim()].sort().join('__');
  }

  /**
   * Builds the `pairConversations/<pairId>/<conversationId>/messages` Gun chain synchronously.
   * Gun chain objects implement `.then()` (sugar for `.get(...).then(cb)`), which means a bare
   * chain returned from an `async` function gets treated as a thenable and silently unwrapped
   * by the Promise machinery on `await`/`.then()` at the call site — the caller ends up with
   * Gun's *data snapshot* instead of the chain, and `root.map` is undefined. Keeping this
   * builder synchronous (never `async`, never itself awaited) avoids that trap; only the
   * `otherId` lookup above it is async.
   */
  private buildPairMessageRoot(conversationId: string, myId: string, otherId: string): any {
    return this.gunService
      .getGun()
      .get('pairConversations')
      .get(this.pairIdForUsers(myId, otherId))
      .get(conversationId)
      .get('messages');
  }

  /**
   * Resolves the pair-message-root Gun chain. Returns it wrapped in `{ root }` rather than
   * bare: a bare Gun chain is a thenable (see `buildPairMessageRoot` comment above), so
   * `return chain` from this `async` method would get silently unwrapped by the caller's
   * `await`/`.then()` into Gun's data snapshot instead of the chain — `root.map` would then
   * be `undefined` and every caller's `.catch(() => undefined)` swallows the resulting
   * TypeError, permanently breaking the `pairConversations` subscription branch. Wrapping in
   * a plain (non-thenable) object sidesteps the trap.
   */
  private async getPairMessageRoot(
    conversationId: string,
    myId: string,
    otherUserId?: string,
  ): Promise<{ root: any } | null> {
    const otherId = otherUserId || (await this.getOtherParticipantId(conversationId, myId));
    if (!otherId) return null;
    return { root: this.buildPairMessageRoot(conversationId, myId, otherId) };
  }

  private async getPairMessageSecret(conversationId: string, myId: string, peerUserId?: string): Promise<string> {
    const pair = this.gunService.getStoredPair();
    if (!pair) {
      throw new Error('No SEA keypair — call ensureKeypairAndAuth first');
    }
    const otherId = peerUserId || (await this.getOtherParticipantId(conversationId, myId));
    if (!otherId) {
      throw new Error('Could not resolve recipient for encrypted channel');
    }
    const epub = await this.getUserEpub(otherId);
    if (!epub) {
      throw new Error('Recipient has no epub published');
    }
    return getSEA().secret(epub, pair);
  }

  /**
   * Build outbound wire + Gun record, persist locally, return wire for P2P notify (P2P-H).
   */
  async buildAndPersistMessage(
    conversationId: string,
    senderId: string,
    text: string,
    opts?: SendMessageOptions & { transport?: ConversationTransportMode },
  ): Promise<ConversationMessageWire> {
    const channel = opts?.channel ?? 'public';
    const transport = opts?.transport ?? this.mode;
    const messageId = String(opts?.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    const prevSeen = this.lastSeenFromOther.get(`${conversationId}:${senderId}`) ?? undefined;
    const otherUserId = opts?.otherUserId ?? (await this.getOtherParticipantId(conversationId, senderId));

    let payloadText = text;
    const shouldEncrypt = channel !== 'public' || transport === 'direct-p2p';
    const base: ConversationMessageWire = {
      id: messageId,
      senderId,
      text: payloadText,
      timestamp: new Date().toISOString(),
      channel,
      transport,
      ...(opts?.isFromChatbot ? { isFromChatbot: true } : {}),
      ...(prevSeen !== undefined ? { prevSeen } : {}),
    };

    if (shouldEncrypt) {
      const secret = await this.getPairMessageSecret(conversationId, senderId, otherUserId);
      payloadText = await getSEA().encrypt(text, secret);
      base.text = payloadText;
      base.encryption = 'sea-ecdh-v1';
    }

    this.putMessageRecord(
      conversationId,
      base,
      otherUserId ? { otherUserId } : {},
    );
    return base;
  }

  /** Idempotent write of a message node to local Gun (and hub sync during migration). */
  putMessageRecord(conversationId: string, wire: ConversationMessageWire, opts: { otherUserId?: string } = {}): void {
    const gun = this.gunService.getGun();
    const record = {
      id: wire.id,
      senderId: wire.senderId,
      text: wire.text,
      timestamp: wire.timestamp,
      channel: wire.channel,
      transport: wire.transport ?? this.mode,
      ...(wire.encryption ? { encryption: wire.encryption } : {}),
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
      ...(wire.isFromChatbot ? { isFromChatbot: true } : {}),
    };
    if (wire.transport === 'direct-p2p' && opts.otherUserId) {
      gun
        .get('pairConversations')
        .get(this.pairIdForUsers(wire.senderId, opts.otherUserId))
        .get(conversationId)
        .get('messages')
        .get(wire.id)
        .put(record);
      return;
    }
    gun.get(`conversations/${conversationId}`).get('messages').get(wire.id).put(record);
  }

  /**
   * One-shot read of all locally-held RAW message wires for a conversation (pair-private
   * path + legacy path), without decrypting. Used by Phase 5 peer↔peer reconciliation to
   * build the local digest and backfill set. Best-effort: resolves after a short settle.
   *
   * Bounded to the most-recent `limit` messages (default `DEFAULT_RECONCILE_WINDOW`) so a
   * very long conversation neither produces a huge digest frame nor enumerates the whole
   * history each reconcile; pass `limit <= 0` to read the full set. Old messages outside
   * the window are assumed already converged (they were reconciled when recent).
   */
  async listLocalWires(
    conversationId: string,
    myUserId: string,
    otherUserId?: string,
    limit: number = DEFAULT_RECONCILE_WINDOW,
  ): Promise<ReconcileMessage[]> {
    const gun = this.gunService.getGun();
    const byId = new Map<string, ReconcileMessage>();
    const collect = (record: any, id: string) => {
      if (!id || id.startsWith('_') || !record || typeof record !== 'object' || !record.text) return;
      byId.set(id, {
        id: String(record.id || id),
        senderId: String(record.senderId || ''),
        text: String(record.text),
        timestamp: String(record.timestamp || ''),
        channel: String(record.channel || 'public'),
        transport: String(record.transport || this.mode),
        ...(record.encryption === 'sea-ecdh-v1' ? { encryption: 'sea-ecdh-v1' as const } : {}),
        ...(record.prevSeen !== undefined ? { prevSeen: String(record.prevSeen) } : {}),
        ...(record.isFromChatbot ? { isFromChatbot: true } : {}),
      });
    };
    return new Promise((resolve) => {
      gun.get(`conversations/${conversationId}`).get('messages').map().once(collect);
      void this.getPairMessageRoot(conversationId, myUserId, otherUserId)
        .then((resolved) => {
          if (resolved) resolved.root.map().once(collect);
        })
        .catch(() => undefined);
      setTimeout(() => resolve(boundRecentWires([...byId.values()], limit)), 500);
    });
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): () => void {
    const gun = this.gunService.getGun();
    const processedMessages = new Set<string>();

    const subscribeRoot = (root: any) => root
      .get(`conversations/${conversationId}`)
      .get('messages')
      .map()
      .on((_messageData: any, messageId: string) => {
        if (!messageId || messageId.startsWith('_')) return;
        if (processedMessages.has(messageId)) return;

        processedMessages.add(messageId);
        setTimeout(() => {
          void this.collectAndDecryptMessages(conversationId, processedMessages, callback, myUserId, otherUserId);
        }, 300);
      });

    subscribeRoot(gun);
    if (myUserId) {
      void this.getPairMessageRoot(conversationId, myUserId, otherUserId).then((resolved) => {
        if (!resolved) return;
        const root = resolved.root;
        const onChild = (_messageData: any, messageId: string) => {
          if (!messageId || messageId.startsWith('_')) return;
          if (processedMessages.has(messageId)) return;

          processedMessages.add(messageId);
          setTimeout(() => {
            void this.collectAndDecryptMessages(conversationId, processedMessages, callback, myUserId, otherUserId);
          }, 300);
        };
        root.map().on(onChild);
        // Bootstrap read: `.map().on()` is expected to replay already-present children on
        // subscribe, but a subscription raced against a peer's write to a graph-linked path
        // (`pairConversations/<pairId>/<conversationId>/messages`, reached via a Gun soul
        // reference rather than a plain top-level key) can miss that replay — the listener
        // attaches to a node the local graph still considers empty and the live "put" event
        // from the relay arrives on a socket frame the listener wasn't registered in time
        // for. A one-shot `.map().once()` right after `.on()` is a cheap, idempotent
        // (dedup via `processedMessages`) safety net that guarantees any message already
        // durable in Gun gets rendered even if the live event was missed.
        root.map().once(onChild);
      }).catch(() => undefined);
    }

    return () => {
      console.log(`👋 Unsubscribed from user ${conversationId} messages (${this.mode})`);
    };
  }

  private async collectAndDecryptMessages(
    conversationId: string,
    processedMessages: Set<string>,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): Promise<void> {
    const gun = this.gunService.getGun();
    const pair = this.gunService.getStoredPair();
    const ids = Array.from(processedMessages);
    const messagesArray: Message[] = [];
    const otherId = myUserId ? otherUserId || await this.getOtherParticipantId(conversationId, myUserId) : undefined;
    const resolvedPairRoot = myUserId ? await this.getPairMessageRoot(conversationId, myUserId, otherId) : null;
    const pairRoot = resolvedPairRoot ? resolvedPairRoot.root : null;

    for (const msgId of ids) {
      const msg = await new Promise<any>((resolve) => {
        if (pairRoot) {
          pairRoot.get(msgId).once((pairData: any) => {
            if (pairData?.text) {
              resolve(pairData);
              return;
            }
            gun
              .get(`conversations/${conversationId}`)
              .get('messages')
              .get(msgId)
              .once((data: any) => resolve(data));
          });
          return;
        }
        gun
          .get(`conversations/${conversationId}`)
          .get('messages')
          .get(msgId)
          .once((data: any) => resolve(data));
      });
      if (!msg || !msg.text) continue;

      let text = String(msg.text);
      const ch = (msg.channel as Message['channel']) || 'public';

      // Never let a single message's decrypt-path failure (epub lookup, SEA secret/decrypt,
      // participant resolution) abort the whole batch — that would drop `callback(messagesArray)`
      // entirely via an unhandled rejection and leave the UI stuck on the empty state even
      // though every other message (and this one, as ciphertext) is legitimately available.
      try {
        if ((ch !== 'public' || msg.encryption === 'sea-ecdh-v1') && pair) {
          const SEA = getSEA();
          const peerForSecret = myUserId && String(msg.senderId) === myUserId ? otherId : String(msg.senderId);
          const peerEpub = peerForSecret ? await this.getUserEpub(peerForSecret) : undefined;
          if (peerEpub) {
            try {
              const secret = await SEA.secret(peerEpub, pair as GunPair);
              const dec = await SEA.decrypt(text, secret);
              if (dec) {
                text = typeof dec === 'string' ? dec : String(dec);
              }
            } catch {
              /* leave ciphertext */
            }
          }
        }
      } catch {
        /* leave ciphertext — see comment above */
      }

      messagesArray.push({
        id: msg.id || msgId,
        senderId: msg.senderId,
        text,
        isFromChatbot: !!msg.isFromChatbot,
        questionId: msg.questionId,
        answerId: msg.answerId,
        timestamp: new Date(msg.timestamp),
        readBy: msg.readBy || [],
        channel: ch,
        prevSeen: msg.prevSeen ?? undefined,
      });
    }

    // Tie-break on message id when timestamps collide (two peers sending within the same
    // millisecond — realistic for concurrent DMs, not just a test artifact). Without a
    // deterministic tie-breaker, `sort()`'s stability preserves *pre-sort* array order, which
    // is derived from `Array.from(processedMessages)` — a peer-local Gun `.on()`/`.once()`
    // arrival order that is **not** guaranteed to match between the two participants. That let
    // A and B converge on different orderings for same-millisecond messages. Message ids are
    // identical, durable strings on both sides, so sorting by id after timestamp is
    // reproducible everywhere.
    messagesArray.sort((a, b) => {
      const byTime = a.timestamp.getTime() - b.timestamp.getTime();
      if (byTime !== 0) return byTime;
      return String(a.id).localeCompare(String(b.id));
    });

    if (myUserId) {
      for (const m of messagesArray) {
        if (m.senderId && m.senderId !== myUserId) {
          this.lastSeenFromOther.set(`${conversationId}:${myUserId}`, m.id);
        }
      }
    }

    callback(messagesArray);
  }
}
