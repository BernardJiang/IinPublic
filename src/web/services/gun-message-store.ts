import { Message } from '../../shared/types';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import type { ConversationTransportMode } from '../../shared/p2p-runtime';
import { boundRecentWires, DEFAULT_RECONCILE_WINDOW, type ReconcileMessage } from '../../shared/conversation-reconcile';
import type { SendMessageOptions } from './web-conversation-service';
import { WebGunService } from './web-gun-service';
import { computeMerkleRoot, sha256Hex } from '../../shared/merkle-checkpoint';
import { deriveRetentionCap, representativePairConversationMessageBytes } from '../../shared/graph-size-report';
import {
  LocalPrivateConversationRepository,
  type LocalConversationWire,
} from './local-private-conversation-repository';

/**
 * Safe env read for browser bundles: `IINPUBLIC_E2E_MESSAGE_*` are baked in by webpack
 * (DefinePlugin in the DISABLE_HMR=true branch, EnvironmentPlugin in the ordinary `npm run
 * dev` branch — both list these exact keys, webpack.config.js) as literal string
 * replacements of the static expression `process.env.IINPUBLIC_E2E_MESSAGE_*`.
 *
 * TODO §S Item 7 bugfix (found while diagnosing docs/TODO.md §S1's ledger prune failure —
 * the sibling `WebLedgerService` had the identical bug, see its own doc comment for the
 * full story), two compounding bugs:
 *
 * 1. This used to be one generic `readE2eEnvInt(key)` helper doing `process.env[key]` — a
 *    *dynamic* bracket-notation lookup that neither DefinePlugin nor EnvironmentPlugin can
 *    see through (both only replace literal *static* member expressions), so the
 *    expression reached the browser unrewritten.
 * 2. Fixing (1) alone still wasn't enough: the reader also wrapped the access in a
 *    `typeof process !== 'undefined' && process.env` runtime guard. Webpack never defines
 *    a bare `process` global in *either* build branch (no `ProvidePlugin` for it here) —
 *    only the specific literal `process.env.KEY` expressions get replaced, removing the
 *    `process` identifier from that call site entirely. The *separate*, untargeted `typeof
 *    process` check has no literal to be replaced with, so it stays a real runtime lookup
 *    against a global that's never defined — always `'undefined'`, always false,
 *    discarding the correctly-substituted literal on the other side of the `&&`. Both
 *    constants below always fell back to their production defaults (50/200) in every real
 *    browser, no matter what the E2E env vars were set to. Fixed by dropping the guard
 *    entirely: since webpack.config.js now lists these keys in *both* branches (with a
 *    `''` fallback when unset), the static `process.env.KEY` expression is always fully
 *    replaced at build time — no guard needed (the same reasoning `app.ts`'s
 *    `isLedgerDisabledForRun` already relies on for `process.env.DISABLE_HMR`).
 */
const readMessageCheckpointIntervalEnv = (): string | undefined =>
  process.env.IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL || undefined;
const readMessageRetentionWindowEnv = (): string | undefined =>
  process.env.IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW || undefined;
const readMessageEnumerateWaitMsEnv = (): string | undefined =>
  process.env.IINPUBLIC_E2E_MESSAGE_ENUMERATE_WAIT_MS || undefined;

/**
 * TODO §S (docs/design/section-s-merkle-checkpoint-pruning-design-note.md, Item 4): every
 * N messages, checkpoint a conversation's message window and prune anything older than
 * the retention window — the message-side analogue of the ledger's Items 1/2, reusing
 * Item 0's merkle module. Named constants so the production values (Item 5 is a policy
 * decision) are a one-line edit later.
 *
 * TODO §S Item 7: overridable via env, same rationale as LEDGER_CHECKPOINT_INTERVAL in
 * web-ledger-service.ts — real sequential Gun-backed sends at production scale are too
 * slow to drive hundreds of times in a real-browser E2E test. Unset, these are the
 * production defaults.
 *
 * TODO §S2: `MESSAGE_RETENTION_WINDOW`'s unset fallback is no longer a flat guess — it's
 * `deriveRetentionCap`'s `floor(categoryShare / measuredAverageBytes)` against a real
 * measured pair-conversation-message sample and the shared 8 MiB local-storage budget
 * (`graph-size-report.ts`). `gun-message-store.test.ts` pins this back to the previous
 * flat 200 via `IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW` (`src/test/setup.ts`) so its own
 * small, specific-boundary test scenarios don't need to scale up to the new (much larger)
 * derived cap.
 */
export const MESSAGE_CHECKPOINT_INTERVAL =
  parseInt(readMessageCheckpointIntervalEnv() || '', 10) || 50;
export const MESSAGE_RETENTION_WINDOW =
  parseInt(readMessageRetentionWindowEnv() || '', 10) ||
  deriveRetentionCap(representativePairConversationMessageBytes(), 200);
/**
 * How long listLocalWires waits for Gun's .map() to enumerate a conversation's messages before
 * giving up and returning whatever it collected — see listLocalWires's own doc comment for why
 * 500ms (this file's original value) undercounted often enough on real devices to matter.
 * Overridable for tests the same way as the two constants above (fake Gun in tests has no real
 * network latency to wait out, so a short value here doesn't sacrifice test correctness).
 */
export const MESSAGE_ENUMERATE_WAIT_MS =
  parseInt(readMessageEnumerateWaitMsEnv() || '', 10) || 1_500;

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

/**
 * Legacy-compatible pure checkpoint decision logic. Current persistence performs this
 * work inside LocalPrivateConversationRepository; these exports remain for policy tests
 * and migration documentation without retaining any peered-Gun write machinery.
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
   * docs/TODO.md OPEN-31: the whole signed per-entry FAQ record (JSON string — Gun can't store a
   * nested object as one field) the answer was rendered from. Present instead of relying on a
   * cached bundle; `faqAuthorPub`/`faqSignature` above mirror the record's own fields.
   */
  faqEntryJson?: string;
  /**
   * K5: present only on the signed "new question" acknowledgement. Same re-verify-on-render
   * discipline as the greeting fields above (`verifySupportAck`).
   */
  ackLocale?: string;
  ackSignature?: string;
  ackAuthorPub?: string;
  /**
   * K2-extended (docs/TODO.md): present only on a signed "getting started" tip — one of the
   * follow-up messages sent right after the welcome greeting. `tipIndex` identifies which
   * entry of the signed, locale-scoped tips array this message renders, so a later render pass
   * can re-verify (`verifyOnboardingTips`) that the cached bundle backing it is still authentic.
   */
  tipIndex?: number;
  tipLocale?: string;
  tipSignature?: string;
  tipAuthorPub?: string;
};

/**
 * Encrypted peerless Gun-on-device message persistence, per spec §19.4. New message
 * bodies/checkpoints live in a bounded private envelope. The former public
 * `pairConversations/<pair>/<conversation>/messages` and legacy conversation-message
 * paths are read only
 * for one mixed-release import and never receive new writes.
 *
 * This is the store that `DirectP2PConversationTransport` writes through (WebRTC is
 * notify/sync only). It is intentionally NOT a `ConversationTransport`: the
 * `mode`/`sendMessage` "transport" facade lives in `StarGunConversationTransport`,
 * which extends this class. Splitting the two keeps endpoint persistence distinct from
 * live delivery and reconciliation over the authenticated DataChannel.
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

  private readonly privateRepository: LocalPrivateConversationRepository;

  constructor(protected gunService: WebGunService) {
    this.privateRepository = new LocalPrivateConversationRepository(
      gunService,
      MESSAGE_CHECKPOINT_INTERVAL,
      MESSAGE_RETENTION_WINDOW,
    );
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

    await this.putMessageRecord(
      conversationId,
      base,
      otherUserId ? { otherUserId } : {},
    );
    return base;
  }

  /** Idempotent write to the encrypted, peerless worker Gun. */
  async putMessageRecord(
    conversationId: string,
    wire: ConversationMessageWire,
    _opts: { otherUserId?: string } = {},
  ): Promise<void> {
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
      ...(wire.faqEntryJson ? { faqEntryJson: wire.faqEntryJson } : {}),
      ...(wire.ackLocale ? { ackLocale: wire.ackLocale } : {}),
      ...(wire.ackSignature ? { ackSignature: wire.ackSignature } : {}),
      ...(wire.ackAuthorPub ? { ackAuthorPub: wire.ackAuthorPub } : {}),
      // tipIndex may legitimately be 0 — check presence, not truthiness (mirrors prevSeen above).
      ...(wire.tipIndex !== undefined ? { tipIndex: wire.tipIndex } : {}),
      ...(wire.tipLocale ? { tipLocale: wire.tipLocale } : {}),
      ...(wire.tipSignature ? { tipSignature: wire.tipSignature } : {}),
      ...(wire.tipAuthorPub ? { tipAuthorPub: wire.tipAuthorPub } : {}),
    };
    await this.privateRepository.append(conversationId, record as LocalConversationWire);
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
    // Used only by one-time mixed-release import. The current encrypted local envelope
    // has deterministic reads and does not need a settle window.
    enumerateWaitMs: number = MESSAGE_ENUMERATE_WAIT_MS,
  ): Promise<ReconcileMessage[]> {
    const local = await this.privateRepository.list(conversationId);
    if (local.length > 0) {
      return boundRecentWires(local as ReconcileMessage[], limit);
    }

    // One mixed-release import from the former peered conversation graphs. This is the only
    // remaining read of those paths; no local mutation is ever written back to them.
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
    const legacy = await new Promise<ReconcileMessage[]>((resolve) => {
      gun.get(`conversations/${conversationId}`).get('messages').map().once(collect);
      void this.getPairMessageRoot(conversationId, myUserId, otherUserId)
        .then((resolved) => {
          if (resolved) resolved.root.map().once(collect);
        })
        .catch(() => undefined);
      setTimeout(() => resolve([...byId.values()]), enumerateWaitMs);
    });
    if (legacy.length > 0) {
      await this.privateRepository.importIfEmpty(conversationId, legacy as LocalConversationWire[]);
    }
    return boundRecentWires(legacy, limit);
  }

  subscribeToMessages(
    conversationId: string,
    callback: (messages: Message[]) => void,
    myUserId?: string,
    otherUserId?: string,
  ): () => void {
    let disposed = false;
    let lastSignature = '';
    const emit = (wires: LocalConversationWire[]) => {
      const signature = wires.map((wire) => wire.id).join('|');
      if (disposed || signature === lastSignature) return;
      lastSignature = signature;
      void this.decryptLocalWires(conversationId, wires, myUserId, otherUserId)
        .then((messages) => {
          if (!disposed) callback(messages);
        })
        .catch(() => undefined);
    };

    const offPrivate = this.privateRepository.subscribe(conversationId, emit);
    void this.listLocalWires(conversationId, myUserId || '', otherUserId, 0)
      .then((wires) => emit(wires as LocalConversationWire[]))
      .catch(() => {
        if (!disposed) callback([]);
      });

    return () => {
      disposed = true;
      offPrivate();
      console.log(`👋 Unsubscribed from user ${conversationId} messages (${this.mode})`);
    };
  }

  private async decryptLocalWires(
    conversationId: string,
    wires: LocalConversationWire[],
    myUserId?: string,
    otherUserId?: string,
  ): Promise<Message[]> {
    const pair = this.gunService.getStoredPair();
    const messagesArray: Message[] = [];
    const otherId = myUserId ? otherUserId || await this.getOtherParticipantId(conversationId, myUserId) : undefined;

    for (const msg of wires) {
      if (!msg?.id || !msg.text) continue;

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
        id: msg.id,
        senderId: String(msg.senderId || ''),
        text,
        isFromChatbot: !!msg.isFromChatbot,
        timestamp: new Date(String(msg.timestamp)),
        readBy: Array.isArray(msg.readBy) ? msg.readBy as string[] : [],
        channel: ch,
        ...(typeof msg.questionId === 'string' ? { questionId: msg.questionId } : {}),
        ...(typeof msg.answerId === 'string' ? { answerId: msg.answerId } : {}),
        ...(msg.prevSeen !== undefined ? { prevSeen: String(msg.prevSeen) } : {}),
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

    return messagesArray;
  }
}
