/**
 * src/web/services/web-ledger-service.ts
 *
 * WebLedgerService — client-side interaction ledger (Phase E + F).
 *
 * Spec: §3.11 REQ-LEDGER-01–14, §14 Phase 4, §20 Interaction Ledger deep-dive.
 *
 * Responsibilities:
 *  - appendEvent(kind, content) — create + sign + persist a new ledger event
 *  - verifyEvent(event)         — verify CIDv1 id, prev chain, and SEA sig
 *  - getState()                 — return LedgerState (userId → highest seq)
 *  - Local encrypted paths:      ledger/<userId>/events/<seq>
 *  - Local encrypted indexes:    ledger/<userId>/index/talkId/<id>
 *                                ledger/<userId>/index/responseId/<id>
 *                                ledger/<userId>/index/withdrawn/<talkId>
 *
 * REQ-LEDGER-10 (migration compat): legacy business records may still be written by
 * existing services, but this ledger history itself is encrypted local state.
 *
 * Phase F — Delta Sync (REQ-LEDGER-06): ledger state and signed event deltas travel only
 * over the authenticated direct DataChannel. The peered Gun graph is control metadata,
 * never a compatibility archive or third-party relay for ledger history.
 */

import { canonicalSerialize, computeCIDv1 } from '../../shared/cid';
import { computeMerkleRoot } from '../../shared/merkle-checkpoint';
import {
  InteractionKind,
  type CheckpointCreatedContent,
  type InteractionEvent,
  type InteractionEventContent,
  type LedgerState,
  type TalkAnsweredContent,
  type TalkWithdrawnContent,
} from '../../shared/types';
import { deriveRetentionCap, representativeLedgerEventBytes } from '../../shared/graph-size-report';
import type { WebGunService } from './web-gun-service';
import { getSEA } from '../sea-gun';

// (no extra interface needed — LedgerState = Record<string, number>)

/**
 * Safe env read for browser bundles: `IINPUBLIC_E2E_LEDGER_*` are baked in by webpack
 * (DefinePlugin in the DISABLE_HMR=true branch, EnvironmentPlugin in the ordinary `npm run
 * dev` branch — both list these exact keys, webpack.config.js) as literal string
 * replacements of the static expression `process.env.IINPUBLIC_E2E_LEDGER_*`.
 *
 * TODO §S Item 7 bugfix (found while diagnosing docs/TODO.md §S1 — seq 1 never actually
 * got pruned in the real-browser E2E run), two compounding bugs:
 *
 * 1. This used to be one generic `readE2eEnvInt(key)` helper doing `process.env[key]` — a
 *    *dynamic* bracket-notation lookup. Webpack's DefinePlugin/EnvironmentPlugin only do
 *    textual replacement of literal *static* member expressions (e.g.
 *    `process.env.IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL`); neither can see through a
 *    variable key, so `process.env[key]` was never rewritten and reached the browser as-is.
 * 2. Fixing (1) alone (giving each constant its own reader with the key written out as a
 *    literal) still wasn't enough: the reader also wrapped the access in a
 *    `typeof process !== 'undefined' && process.env` runtime guard — copied from
 *    `src/shared/config.ts`'s own `getEnv`, which needs it because it *does* take a dynamic
 *    key. But webpack never defines a bare `process` global in *either* build branch (no
 *    `ProvidePlugin` for it here) — only specific literal `process.env.KEY` expressions get
 *    replaced, and replacement removes the `process` identifier from that call site
 *    entirely. A *separate*, untargeted `typeof process` check has no such literal to be
 *    replaced with, so it stays a real runtime lookup against a global that's never
 *    defined — always `'undefined'`, always false, discarding the correctly-substituted
 *    literal on the other side of the `&&`. Both constants below silently fell back to
 *    their production defaults (100/500) in every real browser, no matter what the E2E env
 *    vars were set to. Fixed by dropping the guard entirely: since webpack.config.js now
 *    lists these keys in *both* branches (with a `''` fallback when unset), the static
 *    `process.env.KEY` expression is always fully replaced at build time — the compiled
 *    code never references a real `process` identifier here, so no guard is needed (the
 *    same reasoning `app.ts`'s `isLedgerDisabledForRun` already relies on for
 *    `process.env.DISABLE_HMR`).
 */
const readLedgerCheckpointIntervalEnv = (): string | undefined =>
  process.env.IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL || undefined;
const readLedgerRetentionWindowEnv = (): string | undefined =>
  process.env.IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW || undefined;

/**
 * TODO §S (docs/design/section-s-merkle-checkpoint-pruning-design-note.md, Item 1/5): every
 * N events, write one signed Merkle checkpoint (SRS §28.9.2). Named constants so the real
 * production values (once decided — Item 5 is a policy decision, not a coding change) are a
 * one-line edit, not a re-implementation. Exported for tests and for Item 2's pruning window.
 *
 * TODO §S Item 7: overridable via env (parsed once at module load, same pattern
 * webpack.config.js already uses for CHATROOM_MAX_CAPACITY etc.) — real sequential Gun
 * round trips at the production scale take several seconds each, so driving hundreds of
 * them in a real-browser E2E test is impractically slow. The E2E spec sets these to a
 * small value to prove the checkpoint/prune mechanism fires correctly without grinding
 * through production-scale event counts; unset, these are the production defaults.
 *
 * TODO §S2: `LEDGER_RETENTION_WINDOW`'s unset fallback is no longer a flat guess — it's
 * `deriveRetentionCap`'s `floor(categoryShare / measuredAverageBytes)` against a real
 * measured ledger-event sample and the shared 8 MiB local-storage budget
 * (`graph-size-report.ts`), so retention scales with how much a ledger event actually
 * costs to store rather than an arbitrary round number. `web-ledger-service.test.ts` pins
 * this back to the previous flat 500 via `IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW`
 * (`src/test/setup.ts`) so its own small, specific-boundary test scenarios don't need to
 * scale up to the new (much larger) derived cap.
 */
export const LEDGER_CHECKPOINT_INTERVAL =
  parseInt(readLedgerCheckpointIntervalEnv() || '', 10) || 100;
export const LEDGER_RETENTION_WINDOW =
  parseInt(readLedgerRetentionWindowEnv() || '', 10) ||
  deriveRetentionCap(representativeLedgerEventBytes(), 500);

// ─── Service ──────────────────────────────────────────────────────────────────

export class WebLedgerService {
  private gunService: WebGunService;
  private userId: string;
  private pubkey: string;

  /** In-memory feed state for this user's own feed */
  private ownFeed: { seq: number; prevCid: string | null } = { seq: 0, prevCid: null };

  /** LedgerState for all feeds this peer holds (loaded lazily) — maps userId → highest seq */
  private peerState: LedgerState = {};

  /**
   * TODO §S Item 1: event ids appended since the last confirmed checkpoint, in append
   * order. Rebuilt from Gun once at session start (`loadOwnFeedHead`) rather than
   * persisted, since it's only ever a bounded (< LEDGER_CHECKPOINT_INTERVAL) read.
   */
  private pendingWindowIds: string[] = [];
  /** Highest seq already covered by a confirmed checkpoint (0 = none yet). */
  private lastCheckpointSeq = 0;
  /** TODO §S Item 2: highest seq already deleted from Gun (0 = nothing pruned yet). */
  private prunedThroughSeq = 0;
  /** Guards against overlapping checkpoint-creation passes if appendEvent is called again mid-flight. */
  private checkpointInFlight = false;

  constructor(gunService: WebGunService, userId: string, pubkey: string) {
    this.gunService = gunService;
    this.userId = userId;
    this.pubkey = pubkey;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Append a new event to this user's ledger feed.
   *
   * Steps:
   *  1. Build the event payload (without id + sig)
   *  2. Compute id = CIDv1 of canonical payload
   *  3. SEA-sign the canonical payload
   *  4. Write to encrypted local storage: ledger/<userId>/events/<seq>
   *  5. Write index paths as appropriate
   *  6. Advance ownFeed state
   */
  async appendEvent(
    kind: InteractionKind,
    content: InteractionEventContent,
    /**
     * TODO §S Item 1: internal-only — set by `maybeCreateCheckpoint` on the recursive
     * `appendEvent` call it makes to write the checkpoint event itself, so that call
     * doesn't re-trigger checkpoint creation from inside checkpoint creation. Not part of
     * the public API; ordinary callers never pass this.
     */
    internalOptions?: { skipCheckpointCheck?: boolean },
  ): Promise<InteractionEvent> {
    const seq = this.ownFeed.seq + 1;
    const prev = this.ownFeed.prevCid;
    const timestamp = new Date().toISOString();

    // The payload that gets hashed and signed (everything except id + sig)
    const payload = {
      seq,
      prev,
      kind,
      pubkey: this.pubkey,
      timestamp,
      content,
    };

    const id = await computeCIDv1(payload);
    const SEA = getSEA();
    const pair = this.gunService.getStoredPair();
    const sig = pair
      ? await SEA.sign(canonicalSerialize({ id, ...payload }), pair)
      : '';

    const event: InteractionEvent = { id, sig, ...payload };

    // Persist to encrypted peerless Gun — own feed, keyed by userId.
    await this.writeEventToGun(event, this.userId);
    await this.writeIndexes(event, this.userId);

    // Advance feed pointer
    this.ownFeed = { seq, prevCid: id };
    this.peerState[this.userId] = seq; // LedgerState tracks highest seq per userId

    // TODO §S Item 1: every event (including a checkpoint event itself) counts toward
    // some future checkpoint's window.
    this.pendingWindowIds.push(event.id);
    if (!internalOptions?.skipCheckpointCheck) {
      await this.maybeCreateCheckpoint().catch((err) =>
        console.warn('[LedgerService] checkpoint creation failed (non-fatal), will retry on next append', err),
      );
    }

    return event;
  }

  /**
   * TODO §S Item 1: if enough events have accumulated since the last confirmed
   * checkpoint, write one now — a signed `CHECKPOINT_CREATED` event committing to the
   * Merkle root of the window's event ids (SRS §28.9.2) — then run Item 2's pruning pass
   * for anything now outside the retention window.
   *
   * `checkpointInFlight` guards against a second overlapping pass if `appendEvent` is
   * called again before this one finishes; the ledger has no write queue today (callers
   * fire-and-forget per `app.ts`'s `void this.ledgerService.appendEvent(...)`), so without
   * this guard two concurrent windows could each try to claim the same pending ids.
   */
  private async maybeCreateCheckpoint(): Promise<void> {
    if (this.checkpointInFlight) return;
    if (this.pendingWindowIds.length < LEDGER_CHECKPOINT_INTERVAL) return;

    this.checkpointInFlight = true;
    try {
      const windowIds = this.pendingWindowIds.slice(0, LEDGER_CHECKPOINT_INTERVAL);
      const rangeEnd = this.ownFeed.seq;
      const rangeStart = rangeEnd - windowIds.length + 1;
      const merkleRoot = await computeMerkleRoot(windowIds);
      const content: CheckpointCreatedContent = {
        rangeStart,
        rangeEnd,
        merkleRoot,
        count: windowIds.length,
        leafIds: windowIds,
      };

      // Set before the recursive appendEvent call so that call's own head-node write
      // (writeEventToGun) already reflects the new checkpoint.
      this.lastCheckpointSeq = rangeEnd;
      const checkpointEvent = await this.appendEvent(
        InteractionKind.CHECKPOINT_CREATED,
        content,
        { skipCheckpointCheck: true },
      );
      // Only drop the processed window from pending once the checkpoint event itself is
      // confirmed written — a failure above throws before this line, leaving the window
      // intact for a retry on the next real append.
      this.pendingWindowIds = this.pendingWindowIds.slice(windowIds.length);

      await this.writeCheckpointIndex(checkpointEvent, content);
      await this.pruneLedgerEvents();
    } finally {
      this.checkpointInFlight = false;
    }
  }

  /**
   * Delete already-checkpointed events that fall outside the retained local window.
   * The checkpoint is persisted first, and each replacement tombstone stays inside the
   * encrypted peerless store. The watermark advances only through confirmed writes.
   */
  private async pruneLedgerEvents(): Promise<void> {
    const deletableThrough = Math.min(this.lastCheckpointSeq, this.ownFeed.seq - LEDGER_RETENTION_WINDOW);
    if (deletableThrough <= this.prunedThroughSeq) return;

    let prunedUpTo = this.prunedThroughSeq;
    for (let seq = this.prunedThroughSeq + 1; seq <= deletableThrough; seq += 1) {
      try {
        await this.gunService.putPrivate(`ledger/${this.userId}/events/${seq}`, {
          pruned: true,
          prunedAt: new Date().toISOString(),
        });
        prunedUpTo = seq;
      } catch (err) {
        // Stop at the first failure rather than skip ahead — the next checkpoint's
        // prune pass retries from here. Nulling every field is idempotent, so
        // re-attempting an already-deleted seq on retry is harmless, just redundant.
        console.warn('[LedgerService] prune failed at seq', seq, err);
        break;
      }
    }

    if (prunedUpTo === this.prunedThroughSeq) return; // nothing actually deleted
    this.prunedThroughSeq = prunedUpTo;
    // The per-append head write (writeEventToGun) already ran with the stale
    // prunedThroughSeq for this call chain's own checkpoint event — persist the real
    // value now rather than waiting for some future append.
    try {
      await this.gunService.putPrivate(`ledger/${this.userId}/head`, {
        seq: this.ownFeed.seq,
        prevCid: this.ownFeed.prevCid,
        lastCheckpointSeq: this.lastCheckpointSeq,
        prunedThroughSeq: this.prunedThroughSeq,
      });
    } catch (err) {
      console.warn('[LedgerService] failed to persist prunedThroughSeq watermark', err);
    }
  }

  /**
   * TODO §S Item 1: fast lookup index for SRS §9.3 step 1 ("Alice locates the checkpoint
   * for the 100-event window containing E's seq"). The checkpoint's full content
   * (merkleRoot, leafIds, sig) lives on the chained event itself
   * (`ledger/<userId>/events/<checkpointEvent.seq>`, readable via `getEventBySeq`) — this
   * index only maps a covered seq range to which event holds it, so Item 3 doesn't need
   * to scan the whole chain to find "the checkpoint covering seq N."
   */
  private async writeCheckpointIndex(
    checkpointEvent: InteractionEvent,
    content: CheckpointCreatedContent,
  ): Promise<void> {
    try {
      await this.gunService.putPrivate(`ledger/${this.userId}/checkpoints/seq_${content.rangeEnd}`, {
        eventSeq: checkpointEvent.seq,
        rangeStart: content.rangeStart,
        rangeEnd: content.rangeEnd,
      });
    } catch (err) {
      console.warn('[LedgerService] checkpoint index write failed', err);
    }
  }

  /**
   * Verify an event:
   *  - CIDv1 id matches the canonical payload
   *  - prev field is consistent (trusts the caller for chain integrity checks)
   *  - SEA signature is valid for the claimed pubkey
   *
   * Returns true if the event is valid.
   */
  async verifyEvent(event: InteractionEvent): Promise<boolean> {
    try {
      const { id, sig, ...payload } = event;

      // 1. Recompute CIDv1
      const expectedId = await computeCIDv1(payload);
      if (id !== expectedId) return false;

      // 2. Verify SEA signature
      //
      // TODO §S Item 1 bugfix (pre-existing, found while testing checkpoint creation):
      // `SEA.verify` auto-JSON.parses the verified payload back into an object whenever
      // it looks like JSON — which `canonicalSerialize`'s output always does — so
      // `verified` comes back as an object, never the original string. The old
      // `verified !== message` comparison (object !== string) was therefore always
      // false for every event, meaning no event's signature has ever actually verified
      // successfully through this path (the only caller, `ingestRemoteEvent`, silently
      // rejected every remote delta-sync event as a result). Fixed by normalizing
      // `verified` back to its canonical string form before comparing — `verified` is
      // just the parsed form of `message`, and `canonicalSerialize`'s object it was
      // parsed from already has sorted keys, so re-stringifying reproduces the same
      // string (JSON.parse preserves source key order; JS objects preserve string-key
      // insertion order).
      const SEA = getSEA();
      const message = canonicalSerialize({ id, ...payload });
      const verified = await SEA.verify(sig, event.pubkey);
      const verifiedMessage = typeof verified === 'string' ? verified : JSON.stringify(verified);
      if (verifiedMessage !== message) return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return the current LedgerState: a map of userId → highest seq this peer holds.
   * Used for the LEDGER_STATE delta-sync handshake (Phase F).
   */
  getState(): LedgerState {
    return { ...this.peerState };
  }

  /**
   * Load the existing feed head from encrypted local Gun for the current user.
   * Call this once during service initialization before calling appendEvent.
   */
  async loadOwnFeedHead(): Promise<void> {
    try {
      const feedPath = `ledger/${this.userId}/head`;
      const head = await this.gunService.getPrivate(feedPath);
      if (head && typeof head.seq === 'number') {
        this.ownFeed = { seq: head.seq as number, prevCid: (head.prevCid as string | null) ?? null };
        this.peerState[this.userId] = head.seq as number;
        this.lastCheckpointSeq = typeof head.lastCheckpointSeq === 'number' ? head.lastCheckpointSeq : 0;
        this.prunedThroughSeq = typeof head.prunedThroughSeq === 'number' ? head.prunedThroughSeq : 0;
        await this.rebuildPendingWindow();
      }
    } catch {
      // New feed — leave ownFeed at default {seq:0, prevCid:null}
    }
  }

  /**
   * TODO §S Item 1: `pendingWindowIds` is in-memory only, so a reload loses it. Rebuild it
   * once at session start with a bounded (< LEDGER_CHECKPOINT_INTERVAL) set of Gun reads —
   * far cheaper than persisting the array on every append, and only ever paid once per
   * session rather than on every event.
   */
  private async rebuildPendingWindow(): Promise<void> {
    const ids: string[] = [];
    for (let seq = this.lastCheckpointSeq + 1; seq <= this.ownFeed.seq; seq += 1) {
      const event = await this.getEventBySeq(this.userId, seq);
      if (event) ids.push(event.id);
    }
    this.pendingWindowIds = ids;
  }

  /**
   * Ingest a remote event received on an authenticated direct channel.
   * Verifies it, updates peerState, and writes it to encrypted local Gun.
   */
  async ingestRemoteEvent(event: InteractionEvent, feedKey = event.pubkey): Promise<boolean> {
    const valid = await this.verifyEvent(event);
    if (!valid) return false;

    // TODO §S Item 3: a CHECKPOINT_CREATED event's SEA signature only proves *who* signed
    // it, not that its own content is internally consistent — a buggy or malicious signer
    // could sign a merkleRoot that doesn't actually match its own leafIds. Since a
    // checkpoint is meant to be independently re-verifiable (not merely
    // trusted-because-signed), recompute the root from the retained leaf set and reject
    // on mismatch. Ordinary event kinds have no such derived-content invariant to check.
    if (event.kind === InteractionKind.CHECKPOINT_CREATED) {
      const content = event.content as CheckpointCreatedContent;
      const recomputed = await computeMerkleRoot(content.leafIds);
      if (recomputed !== content.merkleRoot) return false;
    }

    // Direct-session callers pass the authenticated peer's user id as feedKey. The
    // pubkey fallback remains only for old callers that have no separate user id.
    await this.writeEventToGun(event, feedKey);
    await this.writeIndexes(event, feedKey);
    const existing: number = this.peerState[feedKey] ?? 0;
    if (event.seq > existing) {
      this.peerState[feedKey] = event.seq;
    }
    return true;
  }

  // ─── Index helpers ────────────────────────────────────────────────────────

  /** Retrieve all events indexed under a specific talkId */
  async getEventsByTalkId(talkId: string): Promise<string[]> {
    try {
      const path = `ledger/${this.userId}/index/talkId/${talkId}`;
      const entry = await this.gunService.getPrivate(path);
      if (!entry || !entry.eventIds) return [];
      return String(entry.eventIds).split(',').filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Check whether a talk has been withdrawn */
  async isTalkWithdrawn(talkId: string): Promise<boolean> {
    try {
      const path = `ledger/${this.userId}/index/withdrawn/${talkId}`;
      const entry = await this.gunService.getPrivate(path);
      return !!(entry && entry.withdrawnAt);
    } catch {
      return false;
    }
  }

  // ─── Encrypted local write helpers ───────────────────────────────────────

  /**
   * TODO §S Item 1 bugfix (pre-existing, found while wiring checkpoint creation): this
   * used to compute its own write path from `event.pubkey`, while every read-side
   * counterpart (`getEventBySeq`, `loadOwnFeedHead`, `peerState[this.userId]`, and this
   * class's own doc comments / the spec's `ledger/<userId>/events/<seq>` path) addresses
   * a user's own feed by `userId`, not `pubkey` — two different strings in the real app
   * (`app.ts`'s `initLedger` constructs this service with `currentUser.id` and
   * `pair.pub`, never equal). Concretely, `if (event.pubkey === this.userId)` was always
   * false, so `ledger/<userId>/head` was **never written for anyone**, meaning
   * `loadOwnFeedHead` always found nothing and every session's own feed silently
   * restarted from seq 1 — overwriting the previous session's events at the same path.
   * Fixed by taking an explicit `feedKey` from the caller (mirroring `getEventBySeq`'s
   * already-correct parameterization) instead of inferring it from the event: `userId`
   * for events this instance authors (`appendEvent`) and the authenticated remote user id
   * for events ingested from a direct session. `event.pubkey` is only a compatibility
   * fallback for callers without that identity binding.
   */
  private async writeEventToGun(event: InteractionEvent, feedKey: string): Promise<void> {
    try {
      const path = `ledger/${feedKey}/events/${event.seq}`;
      await this.gunService.putPrivate(path, {
        id: event.id,
        seq: event.seq,
        prev: event.prev,
        kind: event.kind,
        pubkey: event.pubkey,
        timestamp: event.timestamp,
        contentJson: JSON.stringify(event.content),
        sig: event.sig,
      });
      // Also update the head pointer for this feed
      if (feedKey === this.userId) {
        await this.gunService.putPrivate(`ledger/${this.userId}/head`, {
          seq: event.seq,
          prevCid: event.id,
          // TODO §S Item 1: persisted so a reload's loadOwnFeedHead knows where the
          // pending (uncheckpointed) window starts without scanning the whole chain.
          lastCheckpointSeq: this.lastCheckpointSeq,
          // TODO §S Item 2: persisted so a reload doesn't re-attempt pruning the entire
          // history again (harmless — delete is idempotent — but wasteful).
          prunedThroughSeq: this.prunedThroughSeq,
        });
      }
    } catch (err) {
      console.warn('[LedgerService] Gun write failed for event', event.id, err);
    }
  }

  private async writeIndexes(event: InteractionEvent, feedKey: string): Promise<void> {
    try {
      const base = `ledger/${feedKey}/index`;

      // talkId index: covers events that reference a specific talk
      const talkId = this.extractTalkId(event);
      if (talkId) {
        const path = `${base}/talkId/${talkId}`;
        const existing = await this.gunService.getPrivate(path).catch(() => null);
        const existingIds: string = existing?.eventIds || '';
        const ids = existingIds ? `${existingIds},${event.id}` : event.id;
        await this.gunService.putPrivate(path, { eventIds: ids, lastSeq: event.seq });
      }

      // responseId index
      if (event.kind === InteractionKind.TALK_ANSWERED) {
        const responseId = (event.content as TalkAnsweredContent).responseId;
        if (responseId) {
          await this.gunService.putPrivate(`${base}/responseId/${responseId}`, {
            eventId: event.id,
            seq: event.seq,
          });
        }
      }

      // withdrawn index
      if (event.kind === InteractionKind.TALK_WITHDRAWN) {
        const content = event.content as TalkWithdrawnContent;
        await this.gunService.putPrivate(`${base}/withdrawn/${content.talkId}`, {
          withdrawnAt: event.timestamp,
          eventId: event.id,
          gracePeriodMs: content.gracePeriodMs,
        });
      }
    } catch (err) {
      console.warn('[LedgerService] Index write failed for event', event.id, err);
    }
  }

  private extractTalkId(event: InteractionEvent): string | null {
    const c = event.content as unknown as Record<string, unknown>;
    if (typeof c['talkId'] === 'string') return c['talkId'] as string;
    if (typeof c['oldTalkId'] === 'string') return c['oldTalkId'] as string;
    return null;
  }

  // ─── Phase F: Delta Sync (REQ-LEDGER-06) ─────────────────────────────────────

  /**
   * Read a single ledger event by feed userId + seq number from Gun.
   * Returns null when the path is empty or data is malformed.
   *
   * TODO §S Item 7 bugfix (found via real E2E testing — the FakeGunStore unit tests never
   * exercise this, since it's a plain in-memory Map with no such coercion): a real
   * `WebGunService.get()` auto-converts any ISO-date-*looking* string field back into a
   * JS `Date` object (`deserializeDates`'s own regex match on read) — `timestamp` always
   * matches. `computeCIDv1`'s `canonicalSerialize` treats a `Date` as a plain object and
   * calls `Object.keys()` on it, which is empty (a `Date`'s internal state isn't an
   * enumerable own property), serializing it as `{}` — silently changing the payload and
   * breaking every CID/signature recomputation for any event ever read back through this
   * method (checkpoint verification, delta-sync ingest, everything). Normalized back to
   * the original ISO string here so it round-trips exactly as `appendEvent` wrote it.
   */
  async getEventBySeq(feedUserId: string, seq: number): Promise<InteractionEvent | null> {
    try {
      const raw = await this.gunService.getPrivate(`ledger/${feedUserId}/events/${seq}`);
      if (!raw || typeof raw !== 'object' || !raw.contentJson) return null;
      const timestamp = raw.timestamp instanceof Date ? raw.timestamp.toISOString() : (raw.timestamp as string);
      return {
        id: raw.id as string,
        seq: raw.seq as number,
        prev: (raw.prev as string | null) ?? null,
        kind: raw.kind as InteractionKind,
        pubkey: raw.pubkey as string,
        timestamp,
        content: JSON.parse(raw.contentJson as string),
        sig: raw.sig as string,
      };
    } catch {
      return null;
    }
  }

  /**
   * TODO §S Item 3: locate the checkpoint covering `seq` on `feedKey`'s feed, given the
   * fixed checkpoint cadence (`LEDGER_CHECKPOINT_INTERVAL`). A checkpoint's own event seq
   * (e.g. 101 for the window 1-100) is itself covered by the *next* checkpoint's window
   * (101-200) rather than its own — so this is computed directly from `seq`, not looked
   * up by scanning, matching `writeCheckpointIndex`'s `seq_<rangeEnd>` key convention.
   * Returns null if no such checkpoint index entry exists yet (nothing to hand back for
   * that seq — the caller just skips it).
   */
  private async findCheckpointCoveringSeq(
    feedKey: string,
    seq: number,
  ): Promise<{ eventSeq: number; rangeStart: number; rangeEnd: number } | null> {
    const rangeEnd = Math.ceil(seq / LEDGER_CHECKPOINT_INTERVAL) * LEDGER_CHECKPOINT_INTERVAL;
    try {
      const index = await this.gunService.getPrivate(`ledger/${feedKey}/checkpoints/seq_${rangeEnd}`);
      if (!index || typeof index.eventSeq !== 'number') return null;
      return {
        eventSeq: index.eventSeq as number,
        rangeStart: index.rangeStart as number,
        rangeEnd: index.rangeEnd as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Build the signed events a directly connected peer is missing.
   *
   * For each feed in our peerState, compare against their declared seq:
   * Only this device owner's feed is eligible; remotely ingested feeds are never forwarded.
   *
   * TODO §S Item 3: a seq inside an already-pruned range (Item 2) has no raw event node
   * left to send — `getEventBySeq` returns null for it. Rather than silently skipping it
   * (leaving the peer permanently missing that history), find the checkpoint covering it
   * and push *that* — a `CHECKPOINT_CREATED` event is itself an ordinary, already-signed
   * `InteractionEvent`, so it travels through the same signed direct-channel event frame
   * and the same `ingestRemoteEvent` path as any other event. One checkpoint accounts for a whole
   * `LEDGER_CHECKPOINT_INTERVAL`-sized range, so once we've sent it the loop jumps
   * straight to `rangeEnd + 1` instead of re-deriving the same checkpoint for every seq
   * in that range.
   *
   * (Sending the whole checkpoint — rather than a per-leaf `buildMerkleProof` for one
   * specific seq — is a deliberate simplification over the design note's original sketch:
   * per-leaf proofs need a seq→leaf mapping, but `leafIds` is retained in *sorted* order
   * for the tree math, not append/seq order, so which leaf belongs to which seq is not
   * recoverable once the raw event is gone. The whole-checkpoint transfer sidesteps
   * this — the peer gets the complete leaf set, the recomputed root, and the SEA
   * signature, which is sufficient to prove the whole range without needing to target
   * any single seq. `buildMerkleProof`/`verifyMerkleProof` remain correct, tested
   * primitives (Items 0/6) for a genuinely different use case — proving one *specific*
   * claimed event id against a checkpoint someone else holds, without needing the whole
   * leaf array.)
   *
   * The caller splits the returned list into bounded authenticated DataChannel frames.
   */
  async buildDeltaForPeer(theirState: LedgerState): Promise<InteractionEvent[]> {
    const delta: InteractionEvent[] = [];
    const includedIds = new Set<string>();
    const ownSeq = this.peerState[this.userId] ?? 0;
    for (const [feedUserId, ourSeq] of [[this.userId, ownSeq]] as Array<[string, number]>) {
      const theirSeq: number = theirState[feedUserId] ?? 0;
      if (ourSeq <= theirSeq) continue; // peer already has everything we do for this feed
      let seq = theirSeq + 1;
      while (seq <= ourSeq) {
        const event = await this.getEventBySeq(feedUserId, seq);
        if (event) {
          if (!includedIds.has(event.id)) {
            includedIds.add(event.id);
            delta.push(event);
          }
          seq += 1;
          continue;
        }

        const checkpoint = await this.findCheckpointCoveringSeq(feedUserId, seq);
        if (!checkpoint) {
          // Nothing recoverable for this seq (no checkpoint covers it yet) — move on
          // rather than loop forever on a gap we can't fill.
          seq += 1;
          continue;
        }
        const checkpointEvent = await this.getEventBySeq(feedUserId, checkpoint.eventSeq);
        if (checkpointEvent && !includedIds.has(checkpointEvent.id)) {
          includedIds.add(checkpointEvent.id);
          delta.push(checkpointEvent);
        }
        seq = checkpoint.rangeEnd + 1; // one checkpoint accounts for its whole range
      }
    }
    return delta;
  }

  /** Verify and persist a signed direct-channel delta before later frames are processed. */
  async ingestRemoteEvents(sourceUserId: string, events: InteractionEvent[]): Promise<void> {
    for (const event of events) {
      await this.ingestRemoteEvent(event, sourceUserId);
    }
  }

}
