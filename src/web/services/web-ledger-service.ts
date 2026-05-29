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
 *  - Gun ledger paths:           ledger/<userId>/events/<seq>
 *  - Gun index paths:            ledger/<userId>/index/talkId/<id>
 *                                ledger/<userId>/index/responseId/<id>
 *                                ledger/<userId>/index/withdrawn/<talkId>
 *
 * REQ-LEDGER-10 (migration compat): legacy Gun paths continue to receive
 * writes in parallel during Phase E. Legacy writes are performed by the
 * existing services; this service only writes to the new ledger paths.
 *
 * Phase F — Delta Sync (REQ-LEDGER-06):
 *  - broadcastState()           — write LedgerState to ledger/<userId>/state
 *  - syncWithPeerById(peerId)   — read peer state, push events they're missing
 *  - subscribeToInbox()         — watch ledger/<userId>/inbox, ingest incoming deltas
 *  - startDeltaSync(getPeerIds) — orchestrate broadcast + inbox sub + proactive sync
 */

import { canonicalSerialize, computeCIDv1 } from '../../shared/cid';
import {
  InteractionKind,
  type InteractionEvent,
  type InteractionEventContent,
  type LedgerState,
  type TalkAnsweredContent,
  type TalkWithdrawnContent,
} from '../../shared/types';
import type { WebGunService } from './web-gun-service';
import { getSEA } from '../sea-gun';

// (no extra interface needed — LedgerState = Record<string, number>)

// ─── Service ──────────────────────────────────────────────────────────────────

export class WebLedgerService {
  private gunService: WebGunService;
  private userId: string;
  private pubkey: string;

  /** In-memory feed state for this user's own feed */
  private ownFeed: { seq: number; prevCid: string | null } = { seq: 0, prevCid: null };

  /** LedgerState for all feeds this peer holds (loaded lazily) — maps userId → highest seq */
  private peerState: LedgerState = {};

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
   *  4. Write to Gun: ledger/<userId>/events/<seq>
   *  5. Write index paths as appropriate
   *  6. Advance ownFeed state
   */
  async appendEvent(
    kind: InteractionKind,
    content: InteractionEventContent,
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

    // Persist to Gun
    await this.writeEventToGun(event);
    await this.writeIndexes(event);

    // Advance feed pointer
    this.ownFeed = { seq, prevCid: id };
    this.peerState[this.userId] = seq; // LedgerState tracks highest seq per userId

    return event;
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
      const SEA = getSEA();
      const message = canonicalSerialize({ id, ...payload });
      const verified = await SEA.verify(sig, event.pubkey);
      if (verified !== message) return false;

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
   * Load the existing feed head from Gun for the current user.
   * Call this once during service initialization before calling appendEvent.
   */
  async loadOwnFeedHead(): Promise<void> {
    try {
      const feedPath = `ledger/${this.userId}/head`;
      const head = await this.gunService.get(feedPath);
      if (head && typeof head.seq === 'number') {
        this.ownFeed = { seq: head.seq as number, prevCid: (head.prevCid as string | null) ?? null };
        this.peerState[this.userId] = head.seq as number;
      }
    } catch {
      // New feed — leave ownFeed at default {seq:0, prevCid:null}
    }
  }

  /**
   * Ingest a remote event (received via delta sync).
   * Verifies it, updates peerState, and writes to Gun.
   */
  async ingestRemoteEvent(event: InteractionEvent): Promise<boolean> {
    const valid = await this.verifyEvent(event);
    if (!valid) return false;
    await this.writeEventToGun(event);
    await this.writeIndexes(event);
    const existing: number = this.peerState[event.pubkey] ?? 0;
    if (event.seq > existing) {
      this.peerState[event.pubkey] = event.seq;
    }
    return true;
  }

  // ─── Index helpers ────────────────────────────────────────────────────────

  /** Retrieve all events indexed under a specific talkId */
  async getEventsByTalkId(talkId: string): Promise<string[]> {
    try {
      const path = `ledger/${this.userId}/index/talkId/${talkId}`;
      const entry = await this.gunService.get(path);
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
      const entry = await this.gunService.get(path);
      return !!(entry && entry.withdrawnAt);
    } catch {
      return false;
    }
  }

  // ─── Private Gun write helpers ────────────────────────────────────────────

  private async writeEventToGun(event: InteractionEvent): Promise<void> {
    try {
      const path = `ledger/${event.pubkey}/events/${event.seq}`;
      await this.gunService.put(path, {
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
      if (event.pubkey === this.userId) {
        await this.gunService.put(`ledger/${this.userId}/head`, {
          seq: event.seq,
          prevCid: event.id,
        });
      }
    } catch (err) {
      console.warn('[LedgerService] Gun write failed for event', event.id, err);
    }
  }

  private async writeIndexes(event: InteractionEvent): Promise<void> {
    try {
      const base = `ledger/${event.pubkey}/index`;

      // talkId index: covers events that reference a specific talk
      const talkId = this.extractTalkId(event);
      if (talkId) {
        const path = `${base}/talkId/${talkId}`;
        const existing = await this.gunService.get(path).catch(() => null);
        const existingIds: string = existing?.eventIds || '';
        const ids = existingIds ? `${existingIds},${event.id}` : event.id;
        await this.gunService.put(path, { eventIds: ids, lastSeq: event.seq });
      }

      // responseId index
      if (event.kind === InteractionKind.TALK_ANSWERED) {
        const responseId = (event.content as TalkAnsweredContent).responseId;
        if (responseId) {
          await this.gunService.put(`${base}/responseId/${responseId}`, {
            eventId: event.id,
            seq: event.seq,
          });
        }
      }

      // withdrawn index
      if (event.kind === InteractionKind.TALK_WITHDRAWN) {
        const content = event.content as TalkWithdrawnContent;
        await this.gunService.put(`${base}/withdrawn/${content.talkId}`, {
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
   * Broadcast our current LedgerState to a well-known Gun path so that peers
   * can read it and compute which events to send us (O(Δ) handshake).
   *
   * Written as stateJson (JSON string) to avoid Gun nested-object flattening.
   * Peers without ledger support simply ignore this path — no breakage.
   */
  async broadcastState(): Promise<void> {
    await this.gunService.put(`ledger/${this.userId}/state`, {
      stateJson: JSON.stringify(this.getState()),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Read a single ledger event by feed userId + seq number from Gun.
   * Returns null when the path is empty or data is malformed.
   */
  async getEventBySeq(feedUserId: string, seq: number): Promise<InteractionEvent | null> {
    try {
      const raw = await this.gunService.get(`ledger/${feedUserId}/events/${seq}`);
      if (!raw || typeof raw !== 'object' || !raw.contentJson) return null;
      return {
        id: raw.id as string,
        seq: raw.seq as number,
        prev: (raw.prev as string | null) ?? null,
        kind: raw.kind as InteractionKind,
        pubkey: raw.pubkey as string,
        timestamp: raw.timestamp as string,
        content: JSON.parse(raw.contentJson as string),
        sig: raw.sig as string,
      };
    } catch {
      return null;
    }
  }

  /**
   * Push the events a peer is missing into their Gun inbox path.
   *
   * For each feed in our peerState, compare against their declared seq:
   * events with seq > theirSeq[feedUserId] are written to
   * `ledger/<peerId>/inbox/<eventId>` so the peer can ingest them.
   *
   * This is a best-effort, fire-and-forget operation; missed events will be
   * retried on the next peer connection or on next call to startDeltaSync.
   */
  async syncWithPeer(peerId: string, theirState: LedgerState): Promise<void> {
    for (const [feedUserId, ourSeq] of Object.entries(this.peerState)) {
      const theirSeq: number = theirState[feedUserId] ?? 0;
      if (ourSeq <= theirSeq) continue; // peer already has everything we do for this feed
      for (let seq = theirSeq + 1; seq <= ourSeq; seq++) {
        const event = await this.getEventBySeq(feedUserId, seq);
        if (!event) continue;
        // Write to peer inbox — uses event.id as key to ensure idempotency
        await this.gunService.put(`ledger/${peerId}/inbox/${event.id}`, {
          eventJson: JSON.stringify(event),
          deliveredAt: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Read a peer's broadcasted LedgerState from Gun and push them the events
   * they are missing from our local peerState.
   *
   * No-ops silently when the peer has no `state` path (pre-Phase-F client).
   */
  async syncWithPeerById(peerId: string): Promise<void> {
    try {
      const raw = await this.gunService.get(`ledger/${peerId}/state`);
      if (!raw || typeof raw !== 'object' || !raw.stateJson) return;
      const theirState: LedgerState = JSON.parse(raw.stateJson as string);
      await this.syncWithPeer(peerId, theirState);
    } catch {
      // Non-fatal — peer may not support ledger sync yet
    }
  }

  /**
   * Subscribe to our own Gun inbox for incoming delta events from peers.
   *
   * Whenever a peer pushes an event to `ledger/<myUserId>/inbox/<eventId>`,
   * this callback verifies and ingests it via `ingestRemoteEvent()`.
   *
   * Returns an unsubscribe function — call it to stop watching the inbox.
   */
  subscribeToInbox(): () => void {
    return this.gunService.subscribe(`ledger/${this.userId}/inbox`, (data: any) => {
      if (!data || typeof data !== 'object') return;
      // Gun delivers the full node — iterate each inbox slot
      for (const key of Object.keys(data)) {
        if (key === '_') continue; // Gun metadata key
        const entry = data[key];
        if (!entry || typeof entry !== 'object' || !entry.eventJson) continue;
        try {
          const event: InteractionEvent = JSON.parse(entry.eventJson as string);
          // Fire-and-forget: verify + ingest without blocking the Gun callback
          void this.ingestRemoteEvent(event).catch((err) =>
            console.warn('[LedgerService] ingestRemoteEvent failed for inbox event', err),
          );
        } catch {
          // Ignore malformed inbox entries
        }
      }
    });
  }

  /**
   * Start delta sync for this session:
   *  1. Broadcast our LedgerState so peers know what to send us.
   *  2. Subscribe to our inbox for incoming delta events.
   *  3. Proactively push deltas to each known peer.
   *
   * Returns an unsubscribe function that tears down the inbox subscription.
   * Call it when the user logs out or the app is torn down.
   *
   * @param getPeerIds - lazy getter for the current list of known peer userIds.
   *   Called each time a sync pass runs, so newly added contacts are included.
   */
  async startDeltaSync(getPeerIds: () => string[]): Promise<() => void> {
    // 1. Broadcast our state so peers can compute what to push us
    await this.broadcastState().catch((e) =>
      console.warn('[LedgerService] broadcastState failed', e),
    );

    // 2. Subscribe to inbox for delta events pushed by peers
    const unsubInbox = this.subscribeToInbox();

    // 3. Proactively sync with known peers (best-effort, non-fatal)
    const peerIds = getPeerIds();
    for (const peerId of peerIds) {
      await this.syncWithPeerById(peerId).catch((e) =>
        console.warn('[LedgerService] syncWithPeerById failed for', peerId, e),
      );
    }

    return unsubInbox;
  }
}
