import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { boundRecentWires, DEFAULT_RECONCILE_WINDOW, type ReconcileMessage } from '../../shared/conversation-reconcile';
import type { SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';
import { computeMerkleRoot, sha256Hex } from '../../shared/merkle-checkpoint';

/**
 * Safe env read for browser bundles: `IINPUBLIC_E2E_MESSAGE_*` are only ever defined by
 * webpack's DISABLE_HMR=true DefinePlugin branch (webpack.config.js), so a normal
 * `npm run dev` bundle (EnvironmentPlugin branch, no `process` global at all) hit
 * "process is not defined" at module load — before this file even finished importing —
 * the moment this was a bare `process.env.X` read. Every other browser-side env read in
 * this codebase guards with `typeof process !== 'undefined'` for exactly this reason
 * (src/shared/config.ts's own getEnv, web-chatroom-service.ts, p2p-webrtc-session.ts, …).
 */
const readE2eEnvInt = (key: string): string | undefined =>
  typeof process !== 'undefined' && process.env ? process.env[key] : undefined;

/**
 * TODO §S (docs/design/section-s-merkle-checkpoint-pruning-design-note.md, Item 4): every
 * N messages, checkpoint a conversation's message window and prune anything older than
 * the retention window — the message-side analogue of the ledger's Items 1/2, reusing
 * Item 0's merkle module. Named constants so the production values (Item 5 is a policy
 * decision) are a one-line edit later.
 *
 * TODO §S Item 7: overridable via env, same rationale as LEDGER_CHECKPOINT_INTERVAL in
 * web-ledger-service.ts — real sequential Gun-backed sends at production scale (50/200)
 * are too slow to drive hundreds of times in a real-browser E2E test. Unset, these are
 * exactly the production defaults.
 */
export const MESSAGE_CHECKPOINT_INTERVAL =
  parseInt(readE2eEnvInt('IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL') || '', 10) || 50;
export const MESSAGE_RETENTION_WINDOW =
  parseInt(readE2eEnvInt('IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW') || '', 10) || 200;

/**
 * SRS §28.9.4: leaves commit to both ordering and ciphertext integrity without
 * disclosing plaintext (`leafHashes` entries are `msgId:SHA-256(wire.text)` — `wire.text`
 * is already ciphertext for any SEA-encrypted channel). Stored as `contentJson` on the
 * checkpoint node (Gun cannot hold nested arrays — same convention as the ledger's
 * `CheckpointCreatedContent`/`contentJson`).
 */
export interface MessageCheckpointContent {
  rangeStartId: string;
  rangeEndId: string;
  count: number;
  merkleRoot: string;
  leafHashes: string[];
  createdAt: string;
}

interface MessageCheckpointLocalState {
  /** Count of messages (in chronological order) already covered by a written checkpoint. */
  lastCheckpointedCount: number;
  /** Count of messages already pruned from Gun (always <= lastCheckpointedCount). */
  prunedThroughCount: number;
  /** Rebuilt from Gun once per conversation per instance lifetime (see getMessageCheckpointState). */
  stateLoaded: boolean;
  /** Guards against an overlapping pass if another send fires before this one finishes. */
  checkpointInFlight: boolean;
  /** Coalesces sends arriving during a pass into one follow-up scan of the latest graph. */
  checkpointPending: boolean;
}

/**
 * TODO §S Item 4: pure decision logic, deliberately separated from all Gun read/write
 * calls — same "no DOM, no Gun, no WebRTC" philosophy as this file's sibling
 * `conversation-reconcile.ts` ("this module is the pure, single source of truth for
 * 'what to send / what to keep'... so the convergence logic is fully unit-tested").
 * `maybeCreateMessageCheckpoint`/`pruneMessages` below call these and only handle the
 * Gun wiring; keeping the window/root/retention math here lets it be unit-tested without
 * a real or mocked Gun graph.
 */
export async function planMessageCheckpoint(
  wires: ReadonlyArray<{ id: string; text: string }>,
  lastCheckpointedCount: number,
  intervalSize: number,
  prunedPrefixCount = 0,
): Promise<{ content: MessageCheckpointContent; newLastCheckpointedCount: number } | null> {
  const localWindowStart = lastCheckpointedCount - prunedPrefixCount;
  if (localWindowStart < 0 || wires.length - localWindowStart < intervalSize) return null;
  const window = wires.slice(localWindowStart, localWindowStart + intervalSize);
  const leafHashes = await Promise.all(window.map(async (w) => `${w.id}:${await sha256Hex(w.text)}`));
  const merkleRoot = await computeMerkleRoot(leafHashes);
  return {
    content: {
      rangeStartId: window[0].id,
      rangeEndId: window[window.length - 1].id,
      count: window.length,
      merkleRoot,
      leafHashes,
      createdAt: new Date().toISOString(),
    },
    newLastCheckpointedCount: lastCheckpointedCount + window.length,
  };
}

/**
 * TODO §S Item 4: mirrors the ledger's Item 2 "checkpoint before delete" boundary math —
 * never deletes past what's already been checkpointed, and never re-derives a smaller
 * boundary than what's already been pruned. Returns null when there's nothing new to
 * prune (`deletableThrough` hasn't advanced past `prunedThroughCount`).
 */
export function planMessagePruning(
  totalCount: number,
  lastCheckpointedCount: number,
  prunedThroughCount: number,
  retentionWindow: number,
): { deletableThrough: number } | null {
  const deletableThrough = Math.min(lastCheckpointedCount, totalCount - retentionWindow);
  if (deletableThrough <= prunedThroughCount) return null;
  return { deletableThrough };
}

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
  /** Per-matched-talk thread scope (redesign §5); absent/'direct' = the pair DM thread. */
  talkId?: string;
  /**
   * K2 (docs/TODO.md): present only on the signed TechSupport welcome greeting. Lets a later
   * render pass re-verify the stored record's authenticity (`verifyTechSupportGreeting`)
   * independent of the write-time check, defending against a tampered downstream write.
   */
  greetingLocale?: string;
  greetingSignature?: string;
  greetingAuthorPub?: string;
  /**
   * K5 (docs/TODO.md): present only on a locally-rendered FAQ auto-answer. `faqQuestionKey`
   * identifies which cached bundle entry this message renders; `faqAuthorPub`/`faqSignature`
   * are the cached bundle's own signature, carried on the message so a later render pass can
   * re-verify (`verifyFaqBundle`) that the cache backing this message is still authentic.
   */
  faqQuestionKey?: string;
  faqAuthorPub?: string;
  faqSignature?: string;
  /**
   * K5: present only on the signed "new question" acknowledgement. Same re-verify-on-render
   * discipline as the greeting fields above (`verifySupportAck`).
   */
  ackLocale?: string;
  ackSignature?: string;
  ackAuthorPub?: string;
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
  private collectRetryCounts = new Map<string, number>();
  private collectRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** TODO §S Item 4: per-conversation checkpoint/prune bookkeeping, keyed by conversationId. */
  private messageCheckpointState = new Map<string, MessageCheckpointLocalState>();
  /**
   * TODO §S Item 4: conversations currently mid-Phase-5-reconcile (digest build or
   * backfill read) — the prune pass skips a conversation while its flag is set, so a
   * delete can't interleave with `listLocalWires`'s own multi-hundred-ms collection
   * window and hand a peer a torn read. Set/cleared by `setReconcileInFlight`, called
   * from `DirectP2PConversationTransport` around its `getLocalMessageDigest`/
   * `getMessagesForBackfill` hooks.
   */
  private reconcileInFlight = new Set<string>();

  constructor(protected gunService: WebGunService) {}

  /** TODO §S Item 4: see reconcileInFlight's doc comment above. */
  setReconcileInFlight(conversationId: string, inFlight: boolean): void {
    if (inFlight) this.reconcileInFlight.add(conversationId);
    else this.reconcileInFlight.delete(conversationId);
  }

  /**
   * Canonical ordinary pair conversations embed both participant ids in the id itself
   * (`conv_pair_<idLow>_<idHigh>`, ids sorted; see WebConversationService.createConversation).
   * Parsing the id is synchronous and cannot race Gun record replication, so it is the
   * preferred way to resolve the peer id. User ids are UUIDs (no underscores), so the two
   * ids split cleanly on '_'.
   */
  private otherIdFromCanonicalConversationId(conversationId: string, myId: string): string | undefined {
    const PREFIX = 'conv_pair_';
    if (!conversationId.startsWith(PREFIX)) return undefined;
    const parts = conversationId.slice(PREFIX.length).split('_');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    if (parts[0] === myId) return parts[1];
    if (parts[1] === myId) return parts[0];
    return undefined;
  }

  private async getOtherParticipantId(conversationId: string, myId: string): Promise<string | undefined> {
    const fromCanonicalId = this.otherIdFromCanonicalConversationId(conversationId, myId);
    if (fromCanonicalId) return fromCanonicalId;
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

  /** Epub keys are immutable per user; one HTTP lookup per peer is enough. Without this
   *  cache, collectAndDecryptMessages paid a network round-trip PER MESSAGE (same peer!),
   *  turning a 12-message history render into ~10s+ and blowing e2e budgets after reload. */
  private readonly epubByUserId = new Map<string, string>();

  private async getUserEpub(userId: string, attempts = 8): Promise<string | undefined> {
    const cached = this.epubByUserId.get(userId);
    if (cached) return cached;
    // WebGunService.getPublicUser()/get() rejects when the *first* `.once()` callback fires
    // with `data === undefined` — a normal transient state for a peer record that hasn't
    // synced to this device's local Gun yet (freshly-matched conversation, cold page). That
    // is not a decrypt failure; treat it the same as "no epub yet" so callers fall back to
    // ciphertext instead of the whole decrypt batch being lost to an unhandled rejection.
    //
    // Retry a few times: a received message can beat the sender's epub sync to this device,
    // and without a retry the message renders once as raw SEA ciphertext and never
    // re-decrypts (the messages subscription doesn't re-fire when the peer's user node lands).
    for (let i = 0; i < attempts; i += 1) {
      try {
        const user = await this.gunService.getPublicUser(userId);
        if (user.epub) {
          this.epubByUserId.set(userId, user.epub);
          return user.epub;
        }
      } catch {
        /* transient — retry below */
      }
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return undefined;
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

  private readMessageNode(root: any, messageId: string, timeoutMs = 150): Promise<any | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: any | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      root.get(messageId).once((data: any) => finish(data || null));
    });
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
      ...(opts?.talkId && opts.talkId !== 'direct' ? { talkId: opts.talkId } : {}),
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
      ...(wire.talkId ? { talkId: wire.talkId } : {}),
      ...(wire.greetingLocale ? { greetingLocale: wire.greetingLocale } : {}),
      ...(wire.greetingSignature ? { greetingSignature: wire.greetingSignature } : {}),
      ...(wire.greetingAuthorPub ? { greetingAuthorPub: wire.greetingAuthorPub } : {}),
      ...(wire.faqQuestionKey ? { faqQuestionKey: wire.faqQuestionKey } : {}),
      ...(wire.faqAuthorPub ? { faqAuthorPub: wire.faqAuthorPub } : {}),
      ...(wire.faqSignature ? { faqSignature: wire.faqSignature } : {}),
      ...(wire.ackLocale ? { ackLocale: wire.ackLocale } : {}),
      ...(wire.ackSignature ? { ackSignature: wire.ackSignature } : {}),
      ...(wire.ackAuthorPub ? { ackAuthorPub: wire.ackAuthorPub } : {}),
    };
    if (wire.transport === 'direct-p2p' && opts.otherUserId) {
      gun
        .get('pairConversations')
        .get(this.pairIdForUsers(wire.senderId, opts.otherUserId))
        .get(conversationId)
        .get('messages')
        .get(wire.id)
        .put(record);
      // No legacy-root mirror: direct-p2p DM bodies live ONLY in the pair-private path
      // (spec §19.4; 09-messaging asserts the legacy root stays empty). The subscription
      // races this used to paper over are handled by the retrying pair-root attach in
      // subscribeToMessages and the canonical conv_pair_ id fallback in
      // getOtherParticipantId.
    } else {
      gun.get(`conversations/${conversationId}`).get('messages').get(wire.id).put(record);
    }

    // TODO §S Item 4: fire-and-forget checkpoint/prune pass — matches this method's own
    // fire-and-forget write style (no caller awaits putMessageRecord's Gun ack either).
    void this.maybeCreateMessageCheckpoint(
      conversationId,
      wire.senderId,
      opts.otherUserId,
      wire.transport ?? this.mode,
    ).catch((err) => console.warn('[GunMessageStore] message checkpoint pass failed (non-fatal)', err));
  }

  /**
   * TODO §S Item 4: the Gun root for a conversation's non-message children (checkpoints,
   * checkpointState) — mirrors putMessageRecord's own pair-vs-legacy path split so a
   * conversation's checkpoint data lives alongside its messages.
   */
  private conversationRoot(
    conversationId: string,
    transport: string,
    senderId: string,
    otherUserId?: string,
  ): any {
    const gun = this.gunService.getGun();
    if (transport === 'direct-p2p' && otherUserId) {
      return gun.get('pairConversations').get(this.pairIdForUsers(senderId, otherUserId)).get(conversationId);
    }
    return gun.get(`conversations/${conversationId}`);
  }

  private readNodeOnce(root: any, timeoutMs = 200): Promise<any | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: any | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      root.once((data: any) => finish(data || null));
    });
  }

  private async getMessageCheckpointState(
    conversationId: string,
    transport: string,
    senderId: string,
    otherUserId?: string,
  ): Promise<MessageCheckpointLocalState> {
    let state = this.messageCheckpointState.get(conversationId);
    if (state?.stateLoaded) return state;
    if (!state) {
      state = {
        lastCheckpointedCount: 0,
        prunedThroughCount: 0,
        stateLoaded: false,
        checkpointInFlight: false,
        checkpointPending: false,
      };
      // Publish the shared state before the async read so concurrent sends cannot create
      // independent lock objects and run overlapping checkpoint passes.
      this.messageCheckpointState.set(conversationId, state);
    }
    const raw = await this.readNodeOnce(
      this.conversationRoot(conversationId, transport, senderId, otherUserId).get('checkpointState'),
    );
    if (raw && typeof raw === 'object') {
      state.lastCheckpointedCount = typeof raw.lastCheckpointedCount === 'number' ? raw.lastCheckpointedCount : 0;
      state.prunedThroughCount = typeof raw.prunedThroughCount === 'number' ? raw.prunedThroughCount : 0;
    }
    state.stateLoaded = true;
    return state;
  }

  private writeCheckpointState(
    conversationId: string,
    transport: string,
    senderId: string,
    otherUserId: string | undefined,
    state: MessageCheckpointLocalState,
  ): Promise<void> {
    return this.putWithAck(
      this.conversationRoot(conversationId, transport, senderId, otherUserId).get('checkpointState'),
      { lastCheckpointedCount: state.lastCheckpointedCount, prunedThroughCount: state.prunedThroughCount },
    );
  }

  /** Resolve only when Gun acknowledges the mutation; never advance durable bookkeeping first. */
  private putWithAck(root: any, value: Record<string, unknown> | null, timeoutMs = 12_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('Gun mutation acknowledgement timed out')),
        timeoutMs,
      );
      root.put(value, (ack: any) => {
        if (ack?.err) finish(new Error(String(ack.err)));
        else finish();
      });
    });
  }

  /**
   * TODO §S Item 4: every MESSAGE_CHECKPOINT_INTERVAL messages (chronological order,
   * same timestamp+id tiebreak as collectAndDecryptMessages), write one checkpoint
   * committing to that window's `msgId:SHA-256(ciphertext)` leaves, then prune anything
   * older than MESSAGE_RETENTION_WINDOW behind the most recent checkpoint. Best-effort,
   * fire-and-forget (called from the end of putMessageRecord, never awaited by callers).
   */
  private async maybeCreateMessageCheckpoint(
    conversationId: string,
    senderId: string,
    otherUserId: string | undefined,
    transport: string,
  ): Promise<void> {
    if (this.reconcileInFlight.has(conversationId)) return;
    const state = await this.getMessageCheckpointState(conversationId, transport, senderId, otherUserId);
    if (state.checkpointInFlight) {
      state.checkpointPending = true;
      return;
    }
    state.checkpointInFlight = true;

    try {
      // Full chronological read — bounded in practice by the retention policy itself (older
      // messages get pruned, so this array never grows past ~MESSAGE_RETENTION_WINDOW plus
      // one checkpoint interval's worth of headroom once the steady state is reached).
      const wires = await this.listLocalWires(conversationId, senderId, otherUserId, 0);
      const plan = await planMessageCheckpoint(
        wires,
        state.lastCheckpointedCount,
        MESSAGE_CHECKPOINT_INTERVAL,
        state.prunedThroughCount,
      );
      if (!plan || this.reconcileInFlight.has(conversationId)) return;

      await this.putWithAck(
        this.conversationRoot(conversationId, transport, senderId, otherUserId)
          .get('checkpoints')
          .get(`count_${plan.newLastCheckpointedCount}`),
        { contentJson: JSON.stringify(plan.content) },
      );

      state.lastCheckpointedCount = plan.newLastCheckpointedCount;
      await this.writeCheckpointState(conversationId, transport, senderId, otherUserId, state);

      const observedAbsoluteCount = state.prunedThroughCount + wires.length;
      await this.pruneMessages(conversationId, transport, senderId, otherUserId, wires, state);
      if (observedAbsoluteCount - state.lastCheckpointedCount >= MESSAGE_CHECKPOINT_INTERVAL) {
        state.checkpointPending = true;
      }
    } finally {
      state.checkpointInFlight = false;
      if (state.checkpointPending) {
        state.checkpointPending = false;
        void this.maybeCreateMessageCheckpoint(conversationId, senderId, otherUserId, transport)
          .catch((err) => console.warn('[GunMessageStore] queued checkpoint pass failed (non-fatal)', err));
      }
    }
  }

  /**
   * TODO §S Item 4: delete every message more than MESSAGE_RETENTION_WINDOW behind the
   * most recently written checkpoint — mirrors the ledger's Item 2 "checkpoint before
   * delete" ordering (only ever called after this pass's own writeCheckpointState above
   * has resolved). Each wire is deleted from *its own* recorded transport's path, not
   * necessarily the current call's transport — a conversation's transport is fixed in
   * practice, but this stays correct even if that ever changes.
   */
  private async pruneMessages(
    conversationId: string,
    transport: string,
    senderId: string,
    otherUserId: string | undefined,
    wires: ReconcileMessage[],
    state: MessageCheckpointLocalState,
  ): Promise<void> {
    if (this.reconcileInFlight.has(conversationId)) return;
    const plan = planMessagePruning(
      state.prunedThroughCount + wires.length,
      state.lastCheckpointedCount,
      state.prunedThroughCount,
      MESSAGE_RETENTION_WINDOW,
    );
    if (!plan) return;

    const deleteCount = plan.deletableThrough - state.prunedThroughCount;
    await Promise.all(wires.slice(0, deleteCount).map((wire) =>
      this.deleteMessageRecord(conversationId, wire.id, wire.transport || transport, senderId, otherUserId)));
    state.prunedThroughCount = plan.deletableThrough;
    await this.writeCheckpointState(conversationId, transport, senderId, otherUserId, state);
  }

  /** TODO §S Item 4: same `.get(id).put(null)` deletion pattern putMessageRecord writes through. */
  private deleteMessageRecord(
    conversationId: string,
    wireId: string,
    transport: string,
    senderId: string,
    otherUserId?: string,
  ): Promise<void> {
    const gun = this.gunService.getGun();
    if (transport === 'direct-p2p' && otherUserId) {
      return this.putWithAck(gun
        .get('pairConversations')
        .get(this.pairIdForUsers(senderId, otherUserId))
        .get(conversationId)
        .get('messages')
        .get(wireId), null);
    }
    return this.putWithAck(gun.get(`conversations/${conversationId}`).get('messages').get(wireId), null);
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
        ...(record.talkId ? { talkId: String(record.talkId) } : {}),
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
    let lastEmittedCount = 0;
    const emitAppendOnly = (messages: Message[]) => {
      if (messages.length < lastEmittedCount) return;
      lastEmittedCount = messages.length;
      callback(messages);
    };
    const collectSoon = () => {
      setTimeout(() => {
        void this.collectAndDecryptMessages(conversationId, processedMessages, emitAppendOnly, myUserId, otherUserId);
      }, 300);
    };
    const ingestMessageId = (messageId: string): void => {
      if (!messageId || messageId.startsWith('_')) return;
      if (processedMessages.has(messageId)) return;
      processedMessages.add(messageId);
      collectSoon();
    };

    const subscribeRoot = (root: any) => root
      .get(`conversations/${conversationId}`)
      .get('messages')
      .map()
      .on((_messageData: any, messageId: string) => {
        ingestMessageId(messageId);
      });

    subscribeRoot(gun);
    if (myUserId) {
      // The pair-root branch must not be one-shot: at overlay-open time the conversation
      // record (and the caller's otherUserId) can lag replication. A failed attach here used
      // to silently kill peer-message rendering for the whole subscription lifetime — the
      // legacy-mirror write masked that until it was removed. Retry until the peer id
      // resolves (canonical `conv_pair_` ids resolve synchronously and never retry).
      const attachPairRoot = async (): Promise<boolean> => {
        const resolved = await this.getPairMessageRoot(conversationId, myUserId, otherUserId).catch(() => null);
        if (!resolved) return false;
        const root = resolved.root;
        const onChild = (_messageData: any, messageId: string) => {
          ingestMessageId(messageId);
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
        // Cold-start pull: after a reload the local graph is empty and history must be
        // resolved from the hub through the 4-hop pair chain. A single `.once` can sit on
        // Gun's slow resolution path for 10s+ (measured), starving the UI. Re-issuing the
        // bootstrap read forces fresh asks and cuts the cold pull to a couple of seconds;
        // it stops as soon as any message id lands (live `.on` covers the rest).
        let bootstrapAttempts = 0;
        const rebootstrap = () => {
          if (processedMessages.size > 0 || bootstrapAttempts >= 12) return;
          bootstrapAttempts += 1;
          root.map().once(onChild);
          setTimeout(rebootstrap, 1_000);
        };
        setTimeout(rebootstrap, 1_000);
        return true;
      };
      const tryAttachPairRoot = (attempt: number): void => {
        void attachPairRoot().then((attached) => {
          if (!attached && attempt < 15) setTimeout(() => tryAttachPairRoot(attempt + 1), 1000);
        });
      };
      tryAttachPairRoot(0);
    }

    if (myUserId) {
      void this.listLocalWires(conversationId, myUserId, otherUserId)
        .then((wires) => {
          let added = false;
          for (const wire of wires) {
            const messageId = String(wire.id || '').trim();
            if (!messageId || processedMessages.has(messageId)) continue;
            processedMessages.add(messageId);
            added = true;
          }
          if (added) collectSoon();
        })
        .catch(() => undefined);
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
      const pairMsg = pairRoot ? await this.readMessageNode(pairRoot, msgId) : null;
      const msg = pairMsg?.text
        ? pairMsg
        : await this.readMessageNode(
          gun.get(`conversations/${conversationId}`).get('messages'),
          msgId,
        );
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
        ...(msg.talkId ? { talkId: String(msg.talkId) } : {}),
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

    const missingCount = ids.length - messagesArray.length;
    const retryKey = `${conversationId}:${myUserId || ''}:${otherUserId || ''}`;
    if (missingCount > 0) {
      const nextRetryCount = (this.collectRetryCounts.get(retryKey) || 0) + 1;
      this.collectRetryCounts.set(retryKey, nextRetryCount);
      if (nextRetryCount <= 20 && !this.collectRetryTimers.has(retryKey)) {
        const timer = setTimeout(() => {
          this.collectRetryTimers.delete(retryKey);
          void this.collectAndDecryptMessages(conversationId, processedMessages, callback, myUserId, otherUserId);
        }, 500);
        this.collectRetryTimers.set(retryKey, timer);
      }
    } else {
      this.collectRetryCounts.delete(retryKey);
      const timer = this.collectRetryTimers.get(retryKey);
      if (timer) clearTimeout(timer);
      this.collectRetryTimers.delete(retryKey);
    }
  }
}
