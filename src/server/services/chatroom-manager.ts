import { parseAnchorCell, placeRoomId } from '../../shared/place-rooms';
import type { ChatroomMapLocation } from '../../shared/chatroom-map-locations';
import { randomBytes } from 'crypto';
import { portableSha256Hex } from '../../shared/portable-sha256';
import { verifySignedPlaceDescriptor, type SignedPlaceDescriptor } from '../../shared/place-descriptor';
import type { PlaceAdmissionClaim } from '../../shared/place-admission-evidence';
import { isTechSupportId } from '../../shared/techsupport';
import { GunService } from './gun-service';
import { PresenceDurableStore, type PresenceMember } from './presence-durable-store';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';
import {
  foldSlotsIntoPrunedAggregate,
  incrementVisitSlot,
  LEGACY_VISIT_SLOT_ID,
  legacyMigrationState,
  planVisitCounterPrune,
  prunedVisitAggregatePath,
  publishedVisitTotalsPath,
  readPrunedVisitAggregate,
  readVisitCounterState,
  readVisitSlot,
  visitCounterMapPath,
  visitCounterPath,
  visitTotalsWithPruned,
} from '../../shared/visit-counter';

function withoutLegacyRoomAuthority(meta: Record<string, unknown>): Record<string, unknown> {
  const { capacity: _capacity, ownerId: _ownerId, owner: _owner, moderator: _moderator, ...safe } = meta;
  return safe;
}

type ActiveRoomMember = {
  userId: string;
  stageName: string;
  lastSeen: string;
  isTraveler?: boolean;
};

type RoomMemberSummary = {
  userId: string;
  stageName: string;
  isTraveler?: boolean;
};

export class ChatroomManager {
  private fastActiveMembers = new Map<string, Map<string, ActiveRoomMember>>();
  /** When the in-memory roster dropped a member for staleness (per room). Reconciliation must not
   *  revive them from a durable record that simply hasn't caught up yet (OPEN-43). */
  private stalePrunedAt = new Map<string, Map<string, number>>();
  /**
   * Authoritative in-process room metadata (same pattern as fastActiveMembers /
   * the server's incomingTalksMap): Gun paths are a mirror. `.once` reads of
   * `chatroomMeta/<id>` can time out on an ephemeral in-memory hub even for data
   * this process just wrote, which made create→rename fail with "chatroom not
   * found" and degraded listed room names to ids.
   */
  private roomMetaCache = new Map<string, any>();
  /** E2E reset fence — see resetForTesting()/predatesReset(). 0 in production (no filtering). */
  private membersResetAt = 0;

  /** Publish signed, expiring ownerless admission evidence so partitioned indexes can converge. */
  async publishPlaceAdmissionClaim(claim: PlaceAdmissionClaim): Promise<void> {
    const roomKey = portableSha256Hex(claim.roomId).slice(0, 32);
    const identityKey = portableSha256Hex(claim.pub).slice(0, 32);
    await this.gunService.putPath(
      ['place-admission-claims', roomKey, identityKey],
      { claimJson: JSON.stringify(claim), expiresAt: claim.expiresAt },
    );
  }

  async listPlaceAdmissionClaims(roomId: string): Promise<PlaceAdmissionClaim[]> {
    const roomKey = portableSha256Hex(roomId).slice(0, 32);
    const rows = await this.gunService.listPathChildren(['place-admission-claims', roomKey]);
    return rows.flatMap((row) => {
      try {
        const claim = JSON.parse(String(row.claimJson || '')) as PlaceAdmissionClaim;
        return claim.roomId === roomId ? [claim] : [];
      } catch {
        return [];
      }
    });
  }

  async removePlaceAdmissionClaim(roomId: string, pub: string): Promise<void> {
    const roomKey = portableSha256Hex(roomId).slice(0, 32);
    const identityKey = portableSha256Hex(pub).slice(0, 32);
    await this.gunService.putPath(['place-admission-claims', roomKey, identityKey], null);
  }

  private staleMemberCountSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private gunService: GunService,
    /** docs/TODO.md — "browsers don't see the Ubuntu/Windows apps" fix, 2026-09-15: a durable
     *  (radisk:true) backing store for chatroom presence, isolated from the relay's ephemeral
     *  main graph. Optional so existing direct-construction unit tests keep compiling; every
     *  write method below no-ops the durable side when absent. See presence-durable-store.ts's
     *  own doc comment for why this exists and what it deliberately does NOT cover. */
    private presenceStore?: PresenceDurableStore,
  ) {
    // Without a periodic sweep, a room whose members simply stop heartbeating (no explicit
    // leave) never gets its published headcount badge (public/room-member-counts) corrected
    // until *something* happens to call getFastActiveMembers for that room again (an API
    // request, a join). Sweep every tracked room on the same cadence the client-side
    // heartbeat/TTL system already uses, so the badge self-heals even with zero traffic.
    //
    // getFastActiveMembers() only drops a stale entry from this process's own in-memory map —
    // it never touches the Gun-persisted chatrooms/<id>/users and chatroomMembers/<id> nodes.
    // getActiveMembersWithStageName() only runs pruneStaleRoomMemberships() (the one path that
    // DOES write isActive:false back to those Gun nodes) when the fast map is empty for that
    // room — which, once any real traffic exists, it almost never is again. Every browser's own
    // UI reads that Gun-persisted roster directly (WebChatroomService.subscribeToMembers), not
    // this in-memory map, so a member who simply closed their tab stayed visible as a "ghost" in
    // everyone else's member list forever (confirmed live in production, 2026-09-04: entries
    // from four days earlier still marked isActive in the shared graph). Run the Gun-writing
    // prune on the same sweep, unconditionally, so the graph every client actually reads self-
    // heals too.
    // The embedded mobile Node (IINPUBLIC_EMBEDDED_NODE=1) runs this same server bundle with
    // real on-disk Gun persistence (Radisk) — unlike the production relay, which is permanently
    // ephemeral (radisk:false, p2p-runtime.ts) and never actually exercises Radisk's disk-index
    // code at all. Running pruneStaleRoomMemberships() on every sweep tick crash-looped three
    // phones on 1.0.19: Radisk's own radix-tree implementation (node_modules/gun/lib/radix.js)
    // hit "Cannot create property '' on number" on this exact write's key
    // (chatrooms/global/users/<id>/stalePresenceExpired) during its own on-disk index rebuild at
    // boot — a Gun/Radisk internals bug this write pattern triggers, not a fatal case this repo's
    // code controls. Ghost-membership cleanup is only meaningful for the relay's shared graph
    // (what every browser's UI reads) in the first place — an embedded phone's local graph isn't
    // that shared roster — so skip the Gun-writing prune there entirely rather than risk
    // recreating the same corruption after a device's data is cleared.
    const sweepMs = Math.max(1000, Math.min(30_000, Math.floor((ROOM_MEMBERSHIP_TTL_SECONDS * 1000) / 3)));
    this.staleMemberCountSweepTimer = setInterval(() => {
      void this.sweepStaleMembersNow();
    }, sweepMs);
    this.staleMemberCountSweepTimer.unref?.();
  }

  /**
   * One stale-membership sweep (the periodic timer above calls this). Also exposed so E2E can run
   * a sweep on demand (`POST /api/test/chatrooms/sweep`) instead of waiting up to a full interval.
   */
  async sweepStaleMembersNow(): Promise<void> {
    const isEmbeddedNode = process.env.IINPUBLIC_EMBEDDED_NODE === '1';
    const work: Promise<unknown>[] = [];
    for (const chatroomId of this.fastActiveMembers.keys()) {
      this.getFastActiveMembers(chatroomId);
      if (isEmbeddedNode) continue;
      // Reconciliation re-asserts the durable store's active members into the ephemeral graph
      // browsers subscribe to; both are skipped on an embedded node (see the timer's comment).
      work.push(this.pruneStaleRoomMemberships(chatroomId).catch(() => undefined));
      work.push(this.reconcilePresenceFromDurableStore(chatroomId).catch(() => undefined));
    }
    await Promise.all(work);
  }

  /** See the sweep loop's own comment above for why this exists. Re-puts each durably-known
   *  active member into the ephemeral graph — an idempotent, harmless no-op when that member's
   *  original write already landed, and the actual fix when it didn't. */
  private async reconcilePresenceFromDurableStore(chatroomId: string): Promise<void> {
    if (!this.presenceStore) return;
    const members = await this.presenceStore.getActiveMembers(chatroomId);
    await Promise.all(
      members.map((durable) => {
        if (isTechSupportId(durable.userId)) return Promise.resolve();
        // The in-process roster is authoritative for anyone it currently knows: a durable read can
        // legitimately return an OLDER version of a record that was overwritten moments ago (radisk
        // serves the on-disk copy after newer in-memory writes), and re-asserting that into the graph
        // browsers subscribe to reverts a rename to the generated placeholder name — peers then
        // freeze that placeholder into match conversations / roster rows (07-tags-checkbox and
        // 15b failed on every repeat run for this reason). Durable data only fills in members the
        // in-memory roster no longer has, which is its actual purpose (restart / lost write).
        const live = this.fastActiveMembers.get(chatroomId)?.get(durable.userId);
        // OPEN-43: a member this process just pruned as stale stays pruned. The durable copy is
        // written fire-and-forget and can still carry the previous (fresh-looking) lastSeen; re-
        // asserting it would revive the member in every client's roster until the TTL lapsed.
        // A member who genuinely heartbeats again re-enters through upsertFastMember.
        const prunedAt = this.stalePrunedAt.get(chatroomId)?.get(durable.userId);
        if (!live && prunedAt !== undefined && Date.now() - prunedAt < ROOM_MEMBERSHIP_TTL_SECONDS * 1000) {
          return Promise.resolve();
        }
        const member = live
          ? {
              ...durable,
              stageName: live.stageName,
              ...(typeof live.isTraveler === 'boolean' ? { isTraveler: live.isTraveler } : {}),
              lastSeen: Date.parse(live.lastSeen) > Date.parse(durable.lastSeen) ? live.lastSeen : durable.lastSeen,
            }
          : durable;
        return this.gunService.putPath(['chatrooms', chatroomId, 'users', member.userId], member).catch(() => {
          /* best-effort — the next sweep tick tries again */
        });
      }),
    );
  }

  /** Fire-and-forget durable write, called alongside every ephemeral-graph presence write below
   *  — no-ops when no durable store was injected (unit tests constructing ChatroomManager
   *  directly). Never awaited by callers: the ephemeral write + reconciliation sweep already
   *  cover the case where this specific call is slow or fails. */
  private durableUpsertMember(chatroomId: string, member: PresenceMember): void {
    if (!this.presenceStore) return;
    void this.presenceStore.upsertMember(chatroomId, member).catch(() => {
      /* best-effort — reconcilePresenceFromDurableStore's next sweep tick tries again */
    });
  }

  private durableMarkLeft(chatroomId: string, userId: string, leftAt: string): void {
    if (!this.presenceStore) return;
    void this.presenceStore.markLeft(chatroomId, userId, leftAt).catch(() => {
      /* best-effort */
    });
  }

  /**
   * E2E only (`POST /api/test/clear-database`): purge every membership trace of the previous
   * spec. Two ghost sources survive a plain `gun._.graph = {}` wipe: (1) this in-memory map,
   * which keeps members "active" for ROOM_MEMBERSHIP_TTL_SECONDS (~3min) after their last
   * heartbeat; (2) Gun chain caches — the server's long-lived `chatrooms/<id>/users`
   * subscriptions hold each member node's last data, and `.once` reads re-materialize it
   * after the graph object is replaced. Explicitly nulling the member nodes we know about
   * overrides those caches. Without both steps, a finished spec's user inflates every
   * subsequent spec's headcount by one ("expected 2, got 3" ghost-membership failures).
   */
  resetForTesting(): void {
    // Gun chain caches can resurrect member nodes even after explicit null puts, so the
    // authoritative guard is a time fence: any member record whose lastSeen predates this
    // reset is a ghost from a previous spec and is ignored by every collector below. Live
    // users re-stamp lastSeen on join and every ~30s heartbeat, so they pass immediately.
    this.membersResetAt = Date.now();
    for (const [chatroomId, room] of this.fastActiveMembers.entries()) {
      for (const userId of room.keys()) {
        void this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], null);
        void this.gunService.putPath(['chatroomMembers', chatroomId, userId], null);
      }
    }
    this.fastActiveMembers.clear();
    for (const id of this.roomMetaCache.keys()) {
      void this.gunService.putPath(['chatroomMeta', id], null);
    }
    this.roomMetaCache.clear();
  }

  /** True when the record's lastSeen (or joinedAt) predates the last E2E reset — a ghost. */
  private predatesReset(data: unknown): boolean {
    if (!this.membersResetAt) return false;
    const raw = (data as { lastSeen?: unknown; joinedAt?: unknown } | null | undefined);
    const stamp = Date.parse(String(raw?.lastSeen ?? raw?.joinedAt ?? ''));
    return !Number.isFinite(stamp) || stamp < this.membersResetAt;
  }

  private upsertFastMember(
    chatroomId: string,
    userId: string,
    stageName?: string,
    lastSeen?: string,
    opts: { bypassResetFence?: boolean; isTraveler?: boolean } = {},
  ): void {
    if (isTechSupportId(userId)) return;
    // E2E reset fence: replayed member records from before a clear-database must never
    // re-enter the map. Exception: an explicit PATCH that deliberately backdates lastSeen
    // (the stale-membership prune specs inject staleness that way) bypasses the fence.
    if (!opts.bypassResetFence && lastSeen && this.predatesReset({ lastSeen })) return;
    this.stalePrunedAt.get(chatroomId)?.delete(userId);
    const room = this.fastActiveMembers.get(chatroomId) ?? new Map<string, ActiveRoomMember>();
    room.set(userId, {
      userId,
      stageName: stageName || userId,
      lastSeen: lastSeen || new Date().toISOString(),
      ...(typeof opts.isTraveler === 'boolean' ? { isTraveler: opts.isTraveler } : {}),
    });
    this.fastActiveMembers.set(chatroomId, room);
  }

  private removeFastMember(chatroomId: string, userId: string): void {
    const room = this.fastActiveMembers.get(chatroomId);
    if (!room) return;
    room.delete(userId);
    if (room.size === 0) this.fastActiveMembers.delete(chatroomId);
  }

  private getFastActiveMembers(chatroomId: string, now = new Date()): RoomMemberSummary[] {
    const room = this.fastActiveMembers.get(chatroomId);
    if (!room) return [];
    const members: RoomMemberSummary[] = [];
    let pruned = false;
    for (const [userId, member] of room) {
      if (this.roomMembershipIsStale({ isActive: true, lastSeen: member.lastSeen }, now)) {
        room.delete(userId);
        const prunedInRoom = this.stalePrunedAt.get(chatroomId) ?? new Map<string, number>();
        prunedInRoom.set(userId, now.getTime());
        this.stalePrunedAt.set(chatroomId, prunedInRoom);
        pruned = true;
        continue;
      }
      members.push({
        userId,
        stageName: member.stageName,
        ...(typeof member.isTraveler === 'boolean' ? { isTraveler: member.isTraveler } : {}),
      });
    }
    if (room.size === 0) this.fastActiveMembers.delete(chatroomId);
    // publishRoomMemberCount's aggregate (public/room-member-counts, what the client's room-list
    // header badge subscribes to) previously only got refreshed on an explicit leave or specific
    // fallback-path prunes — never here, even though this is where a member who simply stopped
    // heartbeating (no explicit leave) actually gets dropped. That let the published badge sit at
    // a stale, too-high count indefinitely (confirmed on real-device testing, 2026-08-09: "6
    // members total" badge vs. 4 in the live-fetched roster). Fire-and-forget republish so callers
    // of this synchronous method aren't blocked on it.
    if (pruned) {
      void this.publishRoomMemberCount(chatroomId).catch(() => {
        /* best-effort public badge */
      });
    }
    return members;
  }

  private async getPathWithRetry(
    path: string[],
    maxAttempts: number = 6,
    delayMs: number = 150,
    waitMs?: number,
    timeoutMs?: number,
  ): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const value = await this.gunService.getPath(path, waitMs, timeoutMs);
      if (value != null) return value;
      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return undefined;
  }

  async getAllChatrooms(): Promise<any[]> {
    const metaById = new Map<string, any>();
    // Gun mirror first (survives restarts) …
    const raw = await this.getPathWithRetry(['chatroomMeta'], 2, 100);
    if (raw && typeof raw === 'object') {
      for (const [id, rawMeta] of Object.entries(raw as Record<string, any>)) {
        if (!id || id.startsWith('_')) continue;
        // A `.once` on the root node returns children as Gun link stubs
        // ({'#': soul}), not hydrated objects — without a per-id read every
        // room's name degrades to its id. Hydrate stubs unless the in-process
        // cache (checked below) already has the room.
        let meta = rawMeta;
        if (
          (!meta || typeof meta !== 'object' || meta['#'] != null || meta.name == null) &&
          !this.roomMetaCache.has(id)
        ) {
          meta = await this.getPathWithRetry(['chatroomMeta', id], 1, 50);
        }
        if (!meta || typeof meta !== 'object' || meta['#'] != null) continue;
        metaById.set(id, withoutLegacyRoomAuthority(meta));
      }
    }
    // … then the authoritative in-process cache overrides the mirror.
    for (const [id, meta] of this.roomMetaCache.entries()) {
      metaById.set(id, withoutLegacyRoomAuthority(meta));
    }
    const list: any[] = [];
    for (const [id, meta] of metaById.entries()) {
      if (meta?.isActive === false) continue;
      list.push({
        id,
        name: meta?.name || id,
        type: meta?.type || 'location',
        description: meta?.description || '',
        createdBy: meta?.createdBy,
        createdAt: meta?.createdAt,
        isActive: meta?.isActive !== false,
        businessInfo: meta?.businessInfo,
        location: meta?.location,
      });
    }
    return list;
  }

  async getChatroom(chatroomId: string): Promise<any | null> {
    // In-process cache is authoritative; the Gun mirror covers restarts.
    const meta = this.roomMetaCache.get(chatroomId)
      ?? await this.getPathWithRetry(['chatroomMeta', chatroomId], 6, 150);
    if (!meta || typeof meta !== 'object') return null;
    if (!this.roomMetaCache.has(chatroomId)) this.roomMetaCache.set(chatroomId, meta);
    // Both totals come from the CRDT G-Counter (docs/TODO.md L1). The legacy visitCount/
    // uniqueVisitorCount scalar fallback (max(new, legacy)) was retired 2026-08-01: every
    // room's slot map is now seeded from those scalars once by migrateLegacyVisitScalar
    // (called from recordVisit), so the G-Counter alone is always authoritative — no
    // client or E2E fixture reads the legacy scalars directly (docs/TODO.md L1 audit).
    // TODO §L2: the pruned aggregate is folded in too, so a prune never changes what a
    // reader sees — only the per-user detail behind an old slot is gone, not the count.
    const [counterRaw, prunedRaw] = await Promise.all([
      this.gunService.getPath(visitCounterMapPath(chatroomId)).catch(() => null),
      this.gunService.getPath(prunedVisitAggregatePath(chatroomId)).catch(() => null),
    ]);
    const totals = visitTotalsWithPruned(readVisitCounterState(counterRaw), readPrunedVisitAggregate(prunedRaw));
    return {
      id: chatroomId,
      ...withoutLegacyRoomAuthority(meta),
      visitCount: totals.visitCount,
      uniqueVisitorCount: totals.uniqueVisitorCount,
    };
  }

  async createChatroom(params: {
    id?: string;
    name: string;
    type: 'business' | 'custom';
    createdBy: string;
    /** Creator's blurred ~1 km cell (`region_<lat>_<lng>`): the room is local to it. */
    anchorCell?: string;
    description?: string;
    businessInfo?: any;
    location?: ChatroomMapLocation;
    descriptor?: unknown;
  }): Promise<any> {
    // Room identity is stable and independent of the publisher. Publishing the descriptor makes
    // its author the first ordinary participant, not an owner or a permanent authority.
    // Custom rooms are local places: the anchor cell is encoded in the id so every peer places the
    // room under that cell's L4 tile in the room tree (src/shared/place-rooms.ts).
    const requestedTestId = process.env.NODE_ENV === 'test' ? String(params.id || '').trim() : '';
    const anchor = parseAnchorCell(String(params.anchorCell || ''));
    if (!requestedTestId && !anchor) {
      throw new Error('a local room needs the creator\'s blurred location cell (anchorCell)');
    }
    const descriptorVerification = params.descriptor
      ? await verifySignedPlaceDescriptor(params.descriptor)
      : null;
    if (params.descriptor && !descriptorVerification?.ok) {
      throw new Error(descriptorVerification?.reason || 'invalid signed place descriptor');
    }
    if (!descriptorVerification?.ok && process.env.NODE_ENV !== 'test') {
      throw new Error('a signed content-addressed place descriptor is required');
    }
    const signedDescriptor: SignedPlaceDescriptor | null = descriptorVerification?.ok
      ? descriptorVerification.descriptor
      : null;
    if (signedDescriptor && anchor) {
      const descriptorCell = `region_${Math.floor(signedDescriptor.location.latitude * 100) / 100}_${Math.floor(signedDescriptor.location.longitude * 100) / 100}`;
      if (descriptorCell !== anchor.cellId) {
        throw new Error('signed place location must lie inside the room\'s anchor cell');
      }
    }
    const id = requestedTestId || signedDescriptor?.id || placeRoomId(anchor!, portableSha256Hex([
      'iinpublic:room-id:v2',
      anchor!.cellId,
      randomBytes(32).toString('hex'),
      new Date().toISOString(),
    ].join(':')));
    const room = {
      id,
      name: signedDescriptor?.name || String(params.name || '').trim(),
      type: signedDescriptor?.placeType || params.type,
      description: signedDescriptor?.description || String(params.description || '').trim(),
      createdBy: params.createdBy,
      ...(signedDescriptor ? { creatorPub: signedDescriptor.creatorPub, descriptor: signedDescriptor } : {}),
      businessInfo: params.businessInfo,
      ...(anchor ? { anchorCell: anchor.cellId } : {}),
      // Public map pin: the (already blurred) anchor cell, unless a business pin was supplied.
      ...(signedDescriptor
        ? { location: signedDescriptor.location }
        : params.location
        ? { location: params.location }
        : anchor ? { location: { latitude: anchor.latitude, longitude: anchor.longitude } } : {}),
      createdAt: signedDescriptor?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };
    if (!room.name) {
      throw new Error('chatroom name is required');
    }
    this.roomMetaCache.set(id, room);
    await this.gunService.putPath(['chatrooms', id, 'meta'], room);
    await this.gunService.putPath(['chatroomMeta', id], room);
    if (signedDescriptor && anchor) {
      await Promise.all([
        this.gunService.putPath(['places', 'by-id', id, 'descriptor'], signedDescriptor),
        this.gunService.putPath(['places', 'by-map-cell', anchor.cellId, id, 'reference'], {
          id,
          descriptorCid: id.slice('place_'.length),
          createdAt: signedDescriptor.createdAt,
        }),
      ]);
    }

    return room;
  }

  async updateChatroom(
    chatroomId: string,
    actorUserId: string,
    updates: {
      name?: string;
      description?: string;
      isActive?: boolean;
      location?: ChatroomMapLocation | null;
    },
  ): Promise<any> {
    void chatroomId; void actorUserId; void updates;
    throw new Error('room descriptors are immutable; publish a new room descriptor');
  }

  async deleteChatroom(chatroomId: string, actorUserId: string): Promise<void> {
    void chatroomId; void actorUserId;
    throw new Error('rooms have no owner and cannot be deleted by a participant');
  }

  async getActiveMembersWithStageName(chatroomId: string): Promise<RoomMemberSummary[]> {
    const fastMembers = this.getFastActiveMembers(chatroomId);
    if (fastMembers.length > 0) return fastMembers;
    // Same embedded-node Radisk hazard as the sweep timer above — see its comment.
    const pruned = process.env.IINPUBLIC_EMBEDDED_NODE === '1'
      ? false
      : await this.pruneStaleRoomMemberships(chatroomId);
    const fromRoomUsers = await this.collectActiveMembersFromUsersNode(chatroomId);
    if (fromRoomUsers.length > 0) {
      if (pruned) void this.publishRoomMemberCountValue(chatroomId, fromRoomUsers.length);
      return fromRoomUsers;
    }
    const users = await this.getPathWithRetry(['chatroomMembers', chatroomId], 4, 80, 100, 150);
    if (!users || typeof users !== 'object') {
      if (pruned) void this.publishRoomMemberCountValue(chatroomId, 0);
      return [];
    }
    const members: RoomMemberSummary[] = [];
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_') || isTechSupportId(userId)) continue;
      if (!data || typeof data !== 'object' || (data as any).isActive !== true) continue;
      if (this.predatesReset(data)) continue;
      members.push({
        userId,
        stageName: String((data as any).stageName || userId),
        ...(typeof (data as any).isTraveler === 'boolean'
          ? { isTraveler: (data as any).isTraveler }
          : {}),
      });
    }
    if (pruned) void this.publishRoomMemberCountValue(chatroomId, members.length);
    return members;
  }

  private roomMembershipIsStale(data: unknown, now = new Date()): boolean {
    if (!data || typeof data !== 'object' || (data as { isActive?: boolean }).isActive !== true) {
      return false;
    }
    const raw = String(
      (data as { lastSeen?: unknown; joinedAt?: unknown }).lastSeen ||
        (data as { joinedAt?: unknown }).joinedAt ||
        '',
    );
    if (!raw) return false;
    const lastSeen = new Date(raw).getTime();
    if (!Number.isFinite(lastSeen)) return false;
    return now.getTime() - lastSeen > ROOM_MEMBERSHIP_TTL_SECONDS * 1000;
  }

  private async collectRoomMemberRecordsFromGunMap(
    path: string[],
    observeMs: number,
  ): Promise<Array<{ userId: string; data: any }>> {
    return new Promise((resolve) => {
      const gun = this.gunService.getGun();
      let ref: any = gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      const records: Array<{ userId: string; data: any }> = [];
      const seen = new Set<string>();
      const mapRef = ref.map();
      const finish = () => {
        try {
          mapRef.off();
        } catch {
          /* ignore */
        }
        resolve(records);
      };
      const timer = setTimeout(finish, observeMs);
      mapRef.on((data: unknown, key: string) => {
        if (!key || key.startsWith('_') || seen.has(key)) return;
        if (!data || typeof data !== 'object') return;
        seen.add(key);
        records.push({ userId: key, data });
      });
      timer.unref?.();
    });
  }

  private async collectRoomMemberRecords(
    path: string[],
  ): Promise<Array<{ userId: string; data: any }>> {
    const fromMap = await this.collectRoomMemberRecordsFromGunMap(path, 500);
    if (fromMap.length > 0) return fromMap;
    const users = await this.getPathWithRetry(path, 2, 80, 100, 150);
    if (!users || typeof users !== 'object') return [];
    return Object.entries(users as Record<string, any>)
      .filter(([userId, data]) => !!userId && !userId.startsWith('_') && !!data && typeof data === 'object')
      .map(([userId, data]) => ({ userId, data }));
  }

  private async pruneStaleRoomMemberships(chatroomId: string, now = new Date()): Promise<boolean> {
    const stale = new Set<string>();
    const recordGroups = await Promise.all([
      this.collectRoomMemberRecords(['chatrooms', chatroomId, 'users']),
      this.collectRoomMemberRecords(['chatroomMembers', chatroomId]),
    ]);
    for (const records of recordGroups) {
      for (const record of records) {
        if (this.roomMembershipIsStale(record.data, now)) stale.add(record.userId);
      }
    }
    if (stale.size === 0) return false;
    const leftData = {
      leftAt: now.toISOString(),
      isActive: false,
      stalePresenceExpired: true,
    };
    await Promise.all(
      [...stale].flatMap((userId) => [
        this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], leftData),
        this.gunService.putPath(['chatroomMembers', chatroomId, userId], leftData),
      ]),
    );
    return true;
  }

  /** Browser clients write `chatrooms/<id>/users`; API joins use `chatroomMembers`. Read both. */
  private async collectActiveMembersFromUsersNode(
    chatroomId: string,
  ): Promise<RoomMemberSummary[]> {
    const fromMap = await this.collectActiveMembersFromGunMap(['chatrooms', chatroomId, 'users'], 500);
    if (fromMap.length > 0) return fromMap;
    const users = await this.getPathWithRetry(['chatrooms', chatroomId, 'users'], 2, 80, 100, 150);
    if (!users || typeof users !== 'object') return [];
    const members: RoomMemberSummary[] = [];
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_') || isTechSupportId(userId)) continue;
      if (!data || typeof data !== 'object' || (data as any).isActive !== true) continue;
      if (this.predatesReset(data)) continue;
      members.push({
        userId,
        stageName: String((data as any).stageName || userId),
        ...(typeof (data as any).isTraveler === 'boolean'
          ? { isTraveler: (data as any).isTraveler }
          : {}),
      });
    }
    return members;
  }

  /** Gun child nodes (room members) require `.map()` — parent `.once()` often returns empty. */
  private collectActiveMembersFromGunMap(
    path: string[],
    observeMs: number,
  ): Promise<RoomMemberSummary[]> {
    return new Promise((resolve) => {
      const gun = this.gunService.getGun();
      let ref: any = gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      const members: RoomMemberSummary[] = [];
      const seen = new Set<string>();
      const mapRef = ref.map();
      const finish = () => {
        try {
          mapRef.off();
        } catch {
          /* ignore */
        }
        resolve(members);
      };
      const timer = setTimeout(finish, observeMs);
      mapRef.on((data: unknown, key: string) => {
        if (!key || key.startsWith('_') || isTechSupportId(key)) return;
        if (!data || typeof data !== 'object' || (data as { isActive?: boolean }).isActive !== true) return;
        if (this.predatesReset(data)) return;
        if (seen.has(key)) return;
        seen.add(key);
        members.push({
          userId: key,
          stageName: String((data as { stageName?: string }).stageName || key),
          ...(typeof (data as { isTraveler?: unknown }).isTraveler === 'boolean'
            ? { isTraveler: (data as { isTraveler: boolean }).isTraveler }
            : {}),
        });
      });
      timer.unref?.();
    });
  }

  async joinChatroom(chatroomId: string, userId: string, stageName?: string): Promise<void> {
    if (isTechSupportId(userId)) return;
    const existingMember = await this.gunService.getPath(['chatroomMembers', chatroomId, userId]).catch(() => null);
    if (existingMember?.isActive === true) return;
    const memberData = {
      joinedAt: new Date(),
      isActive: true,
      ...(stageName ? { stageName } : {}),
    };
    this.upsertFastMember(chatroomId, userId, stageName);
    await this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], {
      ...memberData,
    });
    await this.gunService.putPath(['chatroomMembers', chatroomId, userId], {
      ...memberData,
    });
    const current = await this.gunService.getPath(['chatrooms', chatroomId, 'headcount']);
    const headcount = Number(current) || 0;
    await this.gunService.putPath(['chatrooms', chatroomId, 'headcount'], headcount + 1);
    await this.recordVisit(chatroomId, userId);
    await this.publishRoomMemberCount(chatroomId);
  }

  async addMemberFast(
    chatroomId: string,
    userId: string,
    stageName?: string,
    isTraveler = false,
  ): Promise<void> {
    if (isTechSupportId(userId)) return;
    const requestStartedAt = Date.now();
    const nowIso = new Date().toISOString();
    const memberData = {
      joinedAt: new Date(),
      isActive: true,
      ...(stageName ? { stageName } : {}),
      isTraveler,
    };
    // Same out-of-order race touchMemberFast's isActive guard handles, for join instead of
    // touch: this join's own HTTP request can be slow enough (this method does several
    // sequential Gun writes below) that the *same client* leaves this room — a deliberate,
    // more recent action, e.g. a room switch's leaveChatroom firing moments after this join
    // request started — before this join's writes land. Re-check right before writing rather
    // than trusting the request-entry state: only skip when the recorded leave happened after
    // this specific request began, so a genuine sequential rejoin (leave, then a real new join
    // request) still succeeds normally. Checked before upsertFastMember too, so a skipped join
    // never leaves the in-memory fast-active map inconsistent with the Gun-persisted leave.
    const currentlyLeft = await this.gunService.getPath(['chatrooms', chatroomId, 'users', userId], 100, 150).catch(() => null);
    if (currentlyLeft?.isActive === false) {
      const leftAt = currentlyLeft?.leftAt ? Date.parse(String(currentlyLeft.leftAt)) : NaN;
      if (Number.isFinite(leftAt) && leftAt >= requestStartedAt) return;
    }
    this.upsertFastMember(chatroomId, userId, stageName, undefined, { isTraveler });
    await Promise.all([
      this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], memberData),
      this.gunService.putPath(['chatroomMembers', chatroomId, userId], memberData),
    ]);
    this.durableUpsertMember(chatroomId, {
      userId,
      stageName: stageName || userId,
      isActive: true,
      joinedAt: nowIso,
      lastSeen: nowIso,
      isTraveler,
    });
    // Publishing the public member count re-reads the whole room. On a cold isolated Gun the
    // read can race the writes we just issued and stall on the per-read timeout budget
    // (several seconds), which made the members API hang past its request deadline. The count
    // is an eventually-consistent badge, so fan it out without blocking the caller's response.
    void this.publishRoomMemberCount(chatroomId).catch(() => {
      /* best-effort public badge; never blocks membership writes */
    });
  }

  async touchMemberFast(
    chatroomId: string,
    userId: string,
    options: { stageName?: string; lastSeen?: string; isTraveler?: boolean } = {},
  ): Promise<void> {
    if (isTechSupportId(userId)) return;
    const now = new Date().toISOString();
    // This is the read behind the membership-heartbeat PATCH every connected client sends every
    // ~10-30s (web-chatroom-service.ts's startMembershipHeartbeat) — getPath's 2000ms/3000ms
    // defaults exist for letting a slow peer's write settle before trusting a read, which this
    // single-relay server has no peers to wait on. At the default wait, this pair of reads was
    // measured adding 2-6s to every heartbeat; user-service.ts already uses this same short-wait
    // override for its own request-path reads.
    const existing =
      (await this.gunService.getPath(['chatrooms', chatroomId, 'users', userId], 300, 500).catch(() => null)) ||
      (await this.gunService.getPath(['chatroomMembers', chatroomId, userId], 300, 500).catch(() => null)) ||
      {};
    // Out-of-order completion guard (stageName only): this method does an async Gun read
    // before writing, so two concurrent touches (e.g. a rename's correction PATCH racing a
    // slow, straggling heartbeat PATCH sent *before* the rename) can finish in the opposite
    // order they were sent in. Without this, whichever happens to *complete* last wins and can
    // silently stomp a newer, correct stageName with older data the request captured at send
    // time (confirmed via e2e: a boot-time heartbeat PATCH took 5s+ under load and landed after
    // the rename's own PATCH, reverting the display name back to the pre-rename placeholder).
    // `lastSeen` is a timestamp set at send time on the client, so it — not arrival order — is
    // the source of truth for "which update actually carries the newer name." lastSeen itself is
    // deliberately NOT guarded the same way: prune specs intentionally PATCH a backdated lastSeen
    // to simulate staleness, and that must still take effect (a stale-by-a-few-seconds lastSeen
    // from a losing race is harmless — the TTL window absorbs it).
    const incomingSeenAt = options.lastSeen ? Date.parse(options.lastSeen) : NaN;
    const existingSeenAt = existing?.lastSeen ? Date.parse(String(existing.lastSeen)) : NaN;
    const incomingStageNameIsStale =
      Number.isFinite(incomingSeenAt) && Number.isFinite(existingSeenAt) && incomingSeenAt < existingSeenAt;
    const effectiveStageName = incomingStageNameIsStale
      ? existing?.stageName
      : options.stageName || existing?.stageName;
    const effectiveIsTraveler = incomingStageNameIsStale
      ? existing?.isTraveler === true
      : typeof options.isTraveler === 'boolean'
        ? options.isTraveler
        : existing?.isTraveler === true;
    // A "touch" (this heartbeat PATCH) must never be what reactivates an already-left member —
    // only an explicit join (addMemberFast/joinChatroom) may do that. Without this guard, a
    // heartbeat beat() fired just before the user left races its own async Gun read/write
    // (300-500ms, see above) against leaveChatroom's isActive:false/leftAt write, and — whichever
    // completes last wins — can land *after* the leave and silently resurrect isActive:true.
    // Confirmed via e2e (01-login-two-users-headcount: headcount bounced from 2 back to 3 and
    // never recovered) and a raw Gun-write trace: the straggling touch's write landed ~300ms
    // after leaveChatroom's, well inside this method's own read-wait window. A timestamp
    // comparison (this touch's lastSeen vs. the recorded leftAt) was tried first, but Gun's HAM
    // state and the plain ISO fields can disagree by the time this async method resolves,
    // making an exact ordering comparison unreliable — checking `isActive` alone is both
    // simpler and correct: a genuinely-active member is never mid-leave when touched, and a
    // genuinely-rejoining member arrives through addMemberFast/joinChatroom, not this method.
    if (existing?.isActive === false) {
      return;
    }
    const memberData = {
      joinedAt: existing?.joinedAt || now,
      isActive: true,
      lastSeen: options.lastSeen || now,
      ...(effectiveStageName ? { stageName: String(effectiveStageName) } : {}),
      isTraveler: effectiveIsTraveler,
      userId,
    };
    this.upsertFastMember(
      chatroomId,
      userId,
      typeof memberData.stageName === 'string' ? memberData.stageName : userId,
      memberData.lastSeen,
      // A caller-provided lastSeen is a deliberate update (prune specs backdate it to force
      // staleness); only auto-stamped heartbeats stay subject to the reset fence.
      { bypassResetFence: Boolean(options.lastSeen), isTraveler: effectiveIsTraveler },
    );
    await Promise.all([
      this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], memberData),
      this.gunService.putPath(['chatroomMembers', chatroomId, userId], memberData),
    ]);
    this.durableUpsertMember(chatroomId, {
      userId,
      stageName: typeof memberData.stageName === 'string' ? memberData.stageName : userId,
      isActive: true,
      joinedAt: memberData.joinedAt,
      lastSeen: memberData.lastSeen,
      isTraveler: effectiveIsTraveler,
    });
  }

  /**
   * Record a room visit into the CRDT G-Counter (docs/TODO.md L1).
   *
   * Writes **only this user's slot** — there is no shared scalar to race on, so a
   * concurrent visit by another user can no longer overwrite this one. The previous
   * implementation read `visitCount` and wrote `visitCount + 1`, which lost an
   * increment whenever two joins interleaved, and double-counted whenever the browser
   * incremented the same scalar for the same visit.
   */
  private async recordVisit(chatroomId: string, userId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.migrateLegacyVisitScalar(chatroomId, now);
    const existing = readVisitSlot(
      userId,
      await this.gunService.getPath(visitCounterPath(chatroomId, userId)).catch(() => null),
    );
    await this.gunService.putPath(
      visitCounterPath(chatroomId, userId),
      incrementVisitSlot(existing, userId, now),
    );
    // Eventually-consistent public badge; summing slots on every room-list render is
    // O(members-ever), so publish an aggregate the same way member counts are published.
    void this.publishRoomVisitTotals(chatroomId).catch(() => {
      /* best-effort public badge */
    });
    // TODO §L2: fire-and-forget prune check — every visit is a natural checkpoint to
    // re-evaluate, same shape as the ledger's own maybeCreateCheckpoint (docs/TODO.md §S).
    void this.pruneVisitCounterIfNeeded(chatroomId).catch((err) => {
      console.warn('[ChatroomManager] visit-counter prune failed (non-fatal):', chatroomId, err);
    });
  }

  /**
   * TODO §L2: once a room's live visit-counter slot count exceeds
   * `DEFAULT_VISIT_COUNTER_MAX_SLOTS`, fold the oldest slots (by `lastVisitedAt`) into
   * the room's pruned aggregate and delete them — "checkpoint (fold) before delete",
   * the same ordering Section S's ledger pruning established, so a crash between the two
   * steps never loses a count (the aggregate write, once confirmed, makes the slot's
   * count safe to lose from the graph).
   */
  private async pruneVisitCounterIfNeeded(chatroomId: string): Promise<void> {
    const counterRaw = await this.gunService.getPath(visitCounterMapPath(chatroomId)).catch(() => null);
    const state = readVisitCounterState(counterRaw);
    const plan = planVisitCounterPrune(state);
    if (plan.slotsToPrune.length === 0) return;

    const prunedRaw = await this.gunService.getPath(prunedVisitAggregatePath(chatroomId)).catch(() => null);
    const updatedAggregate = foldSlotsIntoPrunedAggregate(readPrunedVisitAggregate(prunedRaw), plan.slotsToPrune);
    await this.gunService.putPath(prunedVisitAggregatePath(chatroomId), updatedAggregate);

    for (const slot of plan.slotsToPrune) {
      // eslint-disable-next-line no-await-in-loop
      await this.gunService.putPath(visitCounterPath(chatroomId, slot.userId), null);
    }
  }

  /**
   * One-time conversion of a pre-CRDT room (docs/TODO.md L1).
   *
   * Rooms that predate the G-Counter carry their whole history in the legacy `visitCount`
   * scalar. The historical per-user split is unrecoverable, so the total is parked in a single
   * synthetic slot — meaning `uniqueVisitorCount` reads as 1 for such a room until real
   * visitors arrive. That is a deliberate, documented loss of fidelity, preferred over either
   * resetting old rooms to zero or carrying the `max(new, legacy)` fallback forever.
   *
   * Idempotent: once the synthetic slot exists, this is a no-op.
   */
  private async migrateLegacyVisitScalar(chatroomId: string, now: string): Promise<void> {
    const alreadyMigrated = await this.gunService
      .getPath(visitCounterPath(chatroomId, LEGACY_VISIT_SLOT_ID))
      .catch(() => null);
    if (alreadyMigrated) return;

    const legacy = await this.gunService
      .getPath(['chatrooms', chatroomId, 'visitCount'])
      .catch(() => 0);
    const seeded = legacyMigrationState(legacy, now);
    const slot = seeded[LEGACY_VISIT_SLOT_ID];
    if (!slot) return;
    await this.gunService.putPath(visitCounterPath(chatroomId, LEGACY_VISIT_SLOT_ID), slot);
  }

  /**
   * Publish visit totals for cheap room-list rendering. The G-Counter (plus whatever has
   * already been folded into the pruned aggregate) stays the source of truth; this is a cache.
   */
  private async publishRoomVisitTotals(chatroomId: string): Promise<void> {
    const [raw, prunedRaw] = await Promise.all([
      this.gunService.getPath(visitCounterMapPath(chatroomId)).catch(() => null),
      this.gunService.getPath(prunedVisitAggregatePath(chatroomId)).catch(() => null),
    ]);
    const totals = visitTotalsWithPruned(readVisitCounterState(raw), readPrunedVisitAggregate(prunedRaw));
    await this.gunService.putPath(publishedVisitTotalsPath(chatroomId), {
      ...totals,
      updatedAt: new Date().toISOString(),
    });
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    const leftAtIso = new Date().toISOString();
    const leftData = {
      leftAt: new Date(),
      isActive: false
    };
    await this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], {
      ...leftData,
    });
    this.removeFastMember(chatroomId, userId);
    await this.gunService.putPath(['chatroomMembers', chatroomId, userId], {
      ...leftData,
    });
    this.durableMarkLeft(chatroomId, userId, leftAtIso);
    const current = await this.gunService.getPath(['chatrooms', chatroomId, 'headcount']);
    const headcount = Number(current) || 0;
    await this.gunService.putPath(['chatrooms', chatroomId, 'headcount'], Math.max(0, headcount - 1));
    // Eventually-consistent public badge; never block the leave response on its racy re-read.
    void this.publishRoomMemberCount(chatroomId).catch(() => {
      /* best-effort public badge */
    });
  }

  /**
   * Publish the server-observed active-member total for lightweight room-list badges.
   * This is deliberately public aggregate data: no member identities are exposed here.
   */
  private async publishRoomMemberCount(chatroomId: string): Promise<void> {
    const count = (await this.getActiveMembersWithStageName(chatroomId)).length;
    await this.publishRoomMemberCountValue(chatroomId, count);
  }

  private async publishRoomMemberCountValue(chatroomId: string, count: number): Promise<void> {
    await this.gunService.putPath(['public', 'room-member-counts', chatroomId], {
      count,
      updatedAt: new Date().toISOString(),
    });
  }

  async moveChatroom(userId: string, oldChatroomId: string, newChatroomId: string): Promise<void> {
    await this.leaveChatroom(oldChatroomId, userId);
    await this.joinChatroom(newChatroomId, userId);
  }

}
