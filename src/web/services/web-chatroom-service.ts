import { GPSCoordinate } from '../../shared/types';
import { deriveBackendApiBaseFromLocation, WebGunService } from './web-gun-service';
import { CONFIG } from '../../shared/config';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { ChatroomCapacityController } from './chatroom-capacity-controller';
import { getAllChatroomIds } from '../../shared/chatroom-hierarchy';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_GLOBAL_ROOM_ID, techSupportRosterMember } from '../../shared/techsupport';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';
import {
  foldSlotsIntoPrunedAggregate,
  incrementVisitSlot,
  planVisitCounterPrune,
  readPrunedVisitAggregate,
  readVisitCounterState,
  readVisitSlot,
  visitTotalsWithPruned,
  type PrunedVisitAggregate,
  type VisitCounterSlot,
} from '../../shared/visit-counter';
import type { ChallengeGateConfig } from '../../shared/challenge-plugins';
import { getChallengePlugin } from '../../shared/challenge-plugins';

export class WebChatroomService {
  private currentChatroomId?: string;
  private activeMembersUnsubscribe?: () => void;
  private memberCountSubscriptions: Map<string, () => void> = new Map(); // Track subscriptions for cleanup
  private visitCountSubscriptions: Map<string, () => void> = new Map();
  private userLocations: Map<string, GPSCoordinate> = new Map(); // Track user locations for FIFO eviction
  /** Live map for the active subscribeToMembers listener — reused when reopening the same room so we never flash empty. */
  private activeMembersForList = new Map<
    string,
    { userId: string; stageName: string; lastSeen?: string; joinedAt?: string }
  >();
  private membersListDebounce: ReturnType<typeof setTimeout> | null = null;
  private membersListCallback?: (members: Array<{ userId: string; stageName: string }>) => void;
  private membersListenerRoomId: string | undefined = undefined;
  /**
   * Gun's `.map().on()` only re-fires a member's callback when THAT member's own node is
   * next written to (a new heartbeat, an explicit isActive:false on leave). A member who
   * stops heartbeating without ever sending that explicit leave signal — e.g. an app killed
   * mid-session, a test device that had its local storage cleared — never re-fires, so their
   * entry just sits in activeMembersForList forever once added, even long past the TTL: the
   * server's own in-memory roster prunes on every read (getFastActiveMembers), but this
   * client-side live view had no equivalent, which is how a stale peer accumulates into a
   * duplicate/ghost roster row a real, still-live peer only ever inserted once (confirmed via
   * real-device testing, 2026-08-09: two "chatroom-member-item" rows for the same display
   * name, only one of which the server's REST /api/chatrooms/:id/members endpoint agreed was
   * still live). Sweep the map on a timer, independent of any new Gun write, so a ghost ages
   * out client-side the same way it already does server-side.
   */
  private staleMembersSweepTimer: ReturnType<typeof setInterval> | null = null;
  private membershipHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private membershipHeartbeatKey: string | null = null;
  private membershipHeartbeatStageName: string | null = null;
  /** Set by the app to expose the CURRENT user's stage name to heartbeat beats (see beat()). */
  private membershipStageNameResolver: (() => string) | null = null;

  /**
   * Every room change (manual switch or eviction) runs through this one queue, so two moves can
   * never interleave. A manual switch is counted the instant it is REQUESTED (before it waits its
   * turn) so an eviction that has not started yet always sees it and stands down: manual wins.
   */
  private moveQueue: Promise<unknown> = Promise.resolve();
  private manualMovesPending = 0;

  /** FIFO capacity: notice-driven, self-eviction cascade (see chatroom-capacity-controller.ts). */
  private capacity: ChatroomCapacityController;

  constructor(private gunService: WebGunService) {
    this.capacity = new ChatroomCapacityController({
      getGun: () => this.gunService.getGun(),
      fifoEnabled: () => CONFIG.CHATROOM_ENABLE_FIFO,
      isHierarchyRoom: (roomId) => getAllChatroomIds().includes(roomId),
      isFreshMember: (memberData) => this.isFreshActiveMember(memberData),
      getCurrentRoom: () => this.currentChatroomId,
      getLocation: (userId) => this.userLocations.get(userId),
      getStageName: (userId) => this.membershipStageNameResolver?.() || this.membershipHeartbeatStageName || userId,
      moveForEviction: (from, userId, child, stageName, onMoved) =>
        this.moveForEviction(from, userId, child, stageName, onMoved),
    });
  }

  setMembershipStageNameResolver(resolver: () => string): void {
    this.membershipStageNameResolver = resolver;
  }

  private resolveApiBase(): string {
    if (typeof window === 'undefined') return 'https://127.0.0.1:8080';
    const { hostname, protocol, port } = window.location;
    return deriveBackendApiBaseFromLocation(protocol, hostname, port);
  }

  private isFreshActiveMember(memberData: any): boolean {
    if (!memberData || memberData.isActive !== true) return false;
    const rawSeen = memberData.lastSeen || memberData.joinedAt;
    if (!rawSeen) return true;
    const seenAt = Date.parse(String(rawSeen));
    if (!Number.isFinite(seenAt)) return true;
    return Date.now() - seenAt <= (ROOM_MEMBERSHIP_TTL_SECONDS + 5) * 1000;
  }

  /** A member record with a parseable lastSeen that is genuinely past the TTL window. */
  private isDefinitelyStale(memberData: any): boolean {
    const rawSeen = memberData?.lastSeen || memberData?.joinedAt;
    if (!rawSeen) return false;
    const seenAt = Date.parse(String(rawSeen));
    if (!Number.isFinite(seenAt)) return false;
    return Date.now() - seenAt > (ROOM_MEMBERSHIP_TTL_SECONDS + 5) * 1000;
  }

  /** Fast member snapshot from server Gun (reads chatrooms/<id>/users). */
  async fetchMemberIdsFromServer(chatroomId: string): Promise<string[]> {
    const controller = new AbortController();
    const timeoutMs = typeof process !== 'undefined' && process.env.DISABLE_HMR === 'true' ? 2_500 : 5_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(
        `${this.resolveApiBase()}/api/chatrooms/${encodeURIComponent(chatroomId)}/members`,
        { cache: 'no-store', signal: controller.signal },
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ userId?: string }>;
      return Array.isArray(rows) ? rows.map((r) => String(r.userId || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async findOptimalChatroom(location: GPSCoordinate): Promise<string> {
    const chatroomPath = getLocationChatroomPath(location);
    const chatroomId = chatroomPath[chatroomPath.length - 1] || CONFIG.GLOBAL_CHATROOM_ID;
    console.log(`🔍 Finding hierarchical chatroom: ${chatroomPath.join(' → ')} -> ${chatroomId}`);
    return chatroomId;
  }

  /**
   * Find the optimal chatroom for a user based on location and last chatroom
   *
   * Logic:
   * 1. New user: Always start at Global
   * 2. Re-entering user with lastChatroomId:
   *    - If last room is empty (0 users), move up to parent
   *    - If last room has capacity, rejoin it
   *    - If last room is full, will trigger FIFO in joinChatroom
   *
   * @param location User's GPS location
   * @param userId User's unique identifier
   * @param lastChatroomId Optional last chatroom from localStorage
   */
  async findOptimalChatroomHierarchical(
    location: GPSCoordinate,
    userId: string,
    lastChatroomId?: string,
  ): Promise<string> {
    console.log(`🔍 Finding optimal chatroom for user ${userId}`);
    console.log(`  Location: ${location.latitude}, ${location.longitude}`);
    console.log(`  Last chatroom: ${lastChatroomId || 'none (new user)'}`);

    // Store user location for FIFO eviction
    this.userLocations.set(userId, location);

    // If no last chatroom, start at Global
    if (!lastChatroomId) {
      console.log(`  → New user, starting at Global`);
      return CONFIG.GLOBAL_CHATROOM_ID;
    }

    // Re-entering user: always rejoin last room (even if empty)
    // This preserves the user's room assignment, especially important for evicted users
    // Re-entry no longer branches on the live count, so do not block startup on a Gun read.
    // The member-count subscription hydrates the displayed status after the room is visible.
    console.log(`  → Re-entering last room: ${lastChatroomId}`);

    // If it's at capacity, FIFO will be enforced in joinChatroom()
    return lastChatroomId;
  }

  async joinChatroom(
    chatroomId: string,
    userId: string,
    stageName?: string,
    onMoved?: (newChatroomId: string) => void,
  ): Promise<void> {
    this.currentChatroomId = chatroomId;

    // Get user's location from the local map
    const userLocation = this.userLocations.get(userId);
    console.log(`🗺️  User location from Map:`, userLocation);

    const userData: any = {
      joinedAt: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      userId: userId,
      stageName: stageName || userId, // Use stageName if provided, otherwise fall back to userId
    };

    console.log(`👥 Joining chatroom: ${chatroomId} as user: ${userId}`);
    console.log(`📝 User data:`, userData);

    // Use Gun's graph structure properly
    const gun = this.gunService.getGun();
    const alreadyActive = await new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 700);
      gun.get('chatrooms').get(chatroomId).get('users').get(userId).once((data: any) => {
        clearTimeout(timeoutId);
        // A record whose heartbeat has lapsed is a previous stay: rejoining is a NEW join (fresh
        // joinedAt), so a returning user is a newcomer, not the room's oldest member.
        resolve(data?.isActive === true && this.isFreshActiveMember(data));
      });
    });
    if (alreadyActive) {
      this.watchForEviction(userId, chatroomId, onMoved);
      await this.syncJoinWithServer(chatroomId, userId, userData.stageName);
      await this.recordRoomVisit(chatroomId, userId);
      this.startMembershipHeartbeat(chatroomId, userId, userData.stageName);
      console.log(`✅ Already active in chatroom, rerecording visit: ${chatroomId}`);
      return;
    }

    // Write user to database and wait for completion (with retry logic).
    // Short per-attempt budget, matching WebGunService.put()'s convention for the same
    // unreliable-ack problem: a relay-only production hub gives a lone browser no real ack to
    // wait for, so 3s x 3 attempts was mostly dead time before this became non-fatal below.
    const writeUserWithRetry = async (maxRetries: number = 3): Promise<void> => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error('User data write timeout'));
            }, 800); // matches WebGunService.put()'s fast-timeout convention

            gun
              .get('chatrooms')
              .get(chatroomId)
              .get('users')
              .get(userId)
              .put(userData, (ack: any) => {
                clearTimeout(timeoutId);
                if (ack.err) {
                  console.error(
                    `❌ [Attempt ${attempt}/${maxRetries}] Failed to write user data:`,
                    ack.err,
                  );
                  reject(new Error(ack.err));
                } else {
                  console.log(
                    `✅ Successfully wrote user data to Gun.js for chatroom: ${chatroomId}`,
                  );
                  resolve();
                }
              });
          });

          // Success! Return
          return;
        } catch (error) {
          if (attempt === maxRetries) {
            // A bare ack timeout here is not proof the write failed — it's proof the relay
            // didn't answer in time. Production runs as a relay-only hub with no application
            // radata (RELAY_ONLY_HUB, p2p-runtime.ts): a lone browser's put NEVER gets a real
            // network ack from the relay itself, only from a genuine second peer if one is
            // meshed in. The local Gun graph already has this write regardless of whether an
            // ack ever arrives, so throwing here used to strand every solo user's very first
            // room join on "Failed to initialize the app" (same class of bug fixed for
            // WebGunService.put/putPrivate — see that commit). Continue optimistically instead.
            console.warn(`Gun chatroom-join write ack timed out after ${maxRetries} attempts, continuing optimistically:`, error);
            return;
          } else {
            // Wait before retry (exponential backoff)
            const delayMs = attempt * 150;
            console.log(`   Retrying user data write in ${delayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
    };

    await writeUserWithRetry();
    await this.syncJoinWithServer(chatroomId, userId, userData.stageName);
    await this.recordRoomVisit(chatroomId, userId);

    // Store location in a dedicated path for reliable retrieval
    // This is non-blocking - if it fails, we still allow the user to join
    if (userLocation) {
      console.log(`📍 Storing location in dedicated path for user ${userId}`);

      // Helper function to attempt location write with retry
      const writeLocationWithRetry = async (maxRetries: number = 3): Promise<void> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error('Location write timeout'));
              }, 2000); // 2 second timeout per attempt

              gun
                .get('chatrooms')
                .get(chatroomId)
                .get('locations')
                .get(userId)
                .put(
                  {
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,
                    accuracy: userLocation.accuracy,
                    timestamp: userLocation.timestamp.toISOString(),
                  },
                  (ack: any) => {
                    clearTimeout(timeoutId);
                    if (ack.err) {
                      console.error(
                        `❌ [Attempt ${attempt}/${maxRetries}] Failed to write location:`,
                        ack.err,
                      );
                      reject(new Error(ack.err));
                    } else {
                      console.log(`✅ Successfully wrote location for user ${userId}`);
                      resolve();
                    }
                  },
                );
            });

            // Success! Break out of retry loop
            return;
          } catch (error) {
            if (attempt === maxRetries) {
              // Final attempt failed - log warning but don't throw
              console.warn(
                `⚠️  Location write failed after ${maxRetries} attempts. Continuing without location storage.`,
              );
              console.warn(`   This may affect FIFO eviction routing for user ${userId}`);
            } else {
              // Wait before retry (exponential backoff)
              const delayMs = attempt * 500;
              console.log(`   Retrying in ${delayMs}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
        }
      };

      // Fire and don't wait - make it non-blocking
      writeLocationWithRetry().catch((err) => {
        console.warn(`⚠️  Background location write encountered error:`, err);
      });

      // Give it a brief moment to complete (but don't block on it)
      await new Promise((resolve) => setTimeout(resolve, 100));
    } else {
      console.log(`⚠️  No location in Map for user ${userId}`);
    }

    // Brief pause for Gun peer propagation.
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Capacity: watch this room's roster (the newest member sends eviction notices) and our own
    // notices (we move ourselves down when told to) — see ChatroomCapacityController.
    this.watchForEviction(userId, chatroomId, onMoved);
    this.startMembershipHeartbeat(chatroomId, userId, userData.stageName);

    console.log(`✅ Successfully joined chatroom: ${chatroomId}`);
  }

  /**
   * Rename support: the membership heartbeat re-puts the member record every ~30s with the
   * stage name captured when the heartbeat started — without this restart, a rename's
   * one-time member write gets clobbered back to the OLD name on the next beat, so peers'
   * rosters (and everything that resolves peer names from them) stay permanently stale.
   * startMembershipHeartbeat is a no-op when the name is unchanged and restarts otherwise.
   */
  refreshMembershipStageName(chatroomId: string, userId: string, stageName: string): void {
    this.startMembershipHeartbeat(chatroomId, userId, stageName);
  }

  private startMembershipHeartbeat(chatroomId: string, userId: string, stageName: string): void {
    const key = `${chatroomId}:${userId}`;
    if (
      this.membershipHeartbeatKey === key &&
      this.membershipHeartbeatTimer &&
      this.membershipHeartbeatStageName === stageName
    ) {
      return;
    }
    this.stopMembershipHeartbeat();
    this.membershipHeartbeatKey = key;
    this.membershipHeartbeatStageName = stageName;
    const beat = () => {
      // Read the LIVE stage name on every beat. A snapshot captured at heartbeat start goes
      // stale when a rename races the room join (join completes after the rename and starts
      // the heartbeat with the pre-rename name) — the beats then clobber the renamed member
      // record back to the old name every ~30s, and peers' rosters never see the new name.
      const liveName = this.membershipStageNameResolver?.() || stageName;
      const now = new Date().toISOString();
      // Carry this member's public keys in the roster record: peers who need to encrypt
      // FOR us (epub — talk-body mailbox posting, pair offers) or open a signed mesh
      // session TO us (pub — WebRTC neighbor formation) then have the key material inline
      // and never depend on a presence/public-record lookup, which fails under
      // simultaneous-boot load. Both are public material.
      const pair = this.gunService.getStoredPair?.();
      const epub = pair?.epub;
      const pub = pair?.pub;
      if (!epub || !pub) {
        // Diagnostic (2026-08-09 real-device investigation): a member whose heartbeat never
        // carries epub/pub never becomes a WebRTC/mailbox candidate for anyone (peers can't
        // encrypt for them or open a signed mesh session) — this is the exact, silent failure
        // mode being chased, so surface it loudly instead of the usual best-effort silence.
        console.warn(
          `⚠️ [heartbeat-diag] beat() for ${userId} has NO ${!epub && !pub ? 'epub/pub' : !epub ? 'epub' : 'pub'} ` +
            `— getStoredPair() returned: hasPair=${!!pair} hasPub=${!!pub} hasEpub=${!!epub}`,
        );
      }
      this.gunService
        .getGun()
        .get('chatrooms')
        .get(chatroomId)
        .get('users')
        .get(userId)
        .put({
          isActive: true,
          lastSeen: now,
          userId,
          stageName: liveName,
          ...(epub ? { epub } : {}),
          ...(pub ? { pub } : {}),
        });
      void this.syncMembershipHeartbeatWithServer(chatroomId, userId, liveName, now);
    };
    beat();
    const heartbeatMs = Math.max(1000, Math.min(30_000, Math.floor((ROOM_MEMBERSHIP_TTL_SECONDS * 1000) / 3)));
    this.membershipHeartbeatTimer = setInterval(beat, heartbeatMs);
  }

  private async syncMembershipHeartbeatWithServer(
    chatroomId: string,
    userId: string,
    stageName: string,
    lastSeen: string,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4_000);
    try {
      await fetch(
        `${this.resolveApiBase()}/api/chatrooms/${encodeURIComponent(chatroomId)}/members/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageName, lastSeen }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      console.warn('syncMembershipHeartbeatWithServer failed (non-fatal):', error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private stopMembershipHeartbeat(chatroomId?: string, userId?: string): void {
    if (chatroomId && userId && this.membershipHeartbeatKey !== `${chatroomId}:${userId}`) return;
    if (this.membershipHeartbeatTimer) {
      clearInterval(this.membershipHeartbeatTimer);
      this.membershipHeartbeatTimer = null;
    }
    this.membershipHeartbeatKey = null;
    this.membershipHeartbeatStageName = null;
  }

  /** Register join on server index so GET /members is immediate (not Gun-map lag). */
  private async syncJoinWithServer(chatroomId: string, userId: string, stageName?: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4_000);
    try {
      await fetch(`${this.resolveApiBase()}/api/chatrooms/${encodeURIComponent(chatroomId)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, stageName: stageName || userId }),
        signal: controller.signal,
      });
    } catch (error) {
      console.warn('syncJoinWithServer failed (non-fatal):', error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Remove the server/relay fast-index row as well as the peer's Gun record. */
  private async syncLeaveWithServer(chatroomId: string, userId: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4_000);
    try {
      await fetch(
        `${this.resolveApiBase()}/api/chatrooms/${encodeURIComponent(chatroomId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE', signal: controller.signal },
      );
    } catch (error) {
      // Offline-first leave still persists in the local Gun graph. A later
      // heartbeat cannot resurrect it because stopMembershipHeartbeat ran first.
      console.warn('syncLeaveWithServer failed (non-fatal):', error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Record a room visit into the CRDT G-Counter (docs/TODO.md L1).
   *
   * Writes **only this user's slot**. Replaces three problems in one change:
   *   - the shared `visitCount` / `uniqueVisitorCount` read-modify-write, which lost
   *     increments whenever two joins interleaved;
   *   - double counting, because the server incremented the same scalars for the same visit;
   *   - the unbounded `visits/<visitEventId>` node written on every single visit.
   *
   * A slow or failed read is now harmless: it can only produce a LOWER slot value, and
   * merge keeps the higher one — where the old 700 ms default-to-0 wrote 1 over a real total.
   */
  private async recordRoomVisit(chatroomId: string, userId: string): Promise<void> {
    const gun = this.gunService.getGun();
    const now = new Date().toISOString();
    const slotRef = gun.get('chatrooms').get(chatroomId).get('visitCounter').get(userId);
    const existing = await new Promise<VisitCounterSlot | null>((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), 700);
      slotRef.once((data: any) => {
        clearTimeout(timeoutId);
        resolve(readVisitSlot(userId, data));
      });
    });
    slotRef.put(incrementVisitSlot(existing, userId, now));
    // TODO §L2: fire-and-forget prune check, mirrored from the server's own recordVisit —
    // "trim occurs on device side" (Bernard, 2026-08-01): every Gun peer, browser included,
    // evaluates and prunes its own local graph. No relay-is-authoritative special case.
    void this.pruneVisitCounterIfNeeded(chatroomId).catch((err) => {
      console.warn('[WebChatroomService] visit-counter prune failed (non-fatal):', chatroomId, err);
    });
  }

  // readNumericRoomMetric was removed with the shared-scalar counters (docs/TODO.md L1).
  // Its 700 ms default-to-0 was bug #3: a slow read wrote 1 over a real total.

  /**
   * TODO §L2: once a room's live visit-counter slot count exceeds
   * `DEFAULT_VISIT_COUNTER_MAX_SLOTS`, fold the oldest slots (by `lastVisitedAt`) into the
   * room's pruned aggregate and delete them. Mirrors `ChatroomManager.pruneVisitCounterIfNeeded`
   * on the server exactly — same shared pure functions, same fold-before-delete ordering —
   * because under the P2P model there is no single authoritative pruner; every device (server
   * included) prunes its own local Gun graph independently.
   */
  private async pruneVisitCounterIfNeeded(chatroomId: string): Promise<void> {
    const gun = this.gunService.getGun();
    const counterRef = gun.get('chatrooms').get(chatroomId).get('visitCounter');
    // `.map().once()` is the established one-shot full-child-map read in this file (see
    // subscribeToRoomMembership's checkCapacityAndEvict) — a parent `.once()` on a Gun child
    // map is unreliable, so children are collected individually within a sync window.
    const slots: Record<string, unknown> = {};
    await new Promise<void>((resolve) => {
      counterRef.map().once((value: any, key: string) => {
        if (key) slots[key] = value;
      });
      setTimeout(resolve, 600);
    });

    const plan = planVisitCounterPrune(readVisitCounterState(slots));
    if (plan.slotsToPrune.length === 0) return;

    const prunedRef = gun.get('chatrooms').get(chatroomId).get('visitCounterPruned');
    const existingPruned = await new Promise<PrunedVisitAggregate | null>((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), 700);
      prunedRef.once((data: any) => {
        clearTimeout(timeoutId);
        resolve(data ?? null);
      });
    });
    const updatedAggregate = foldSlotsIntoPrunedAggregate(
      readPrunedVisitAggregate(existingPruned),
      plan.slotsToPrune,
    );
    prunedRef.put(updatedAggregate);

    for (const slot of plan.slotsToPrune) {
      counterRef.get(slot.userId).put(null);
    }
  }

  /** Start the capacity watch for this room: roster (as owner) and our own eviction notices. */
  private watchForEviction(
    userId: string,
    currentChatroomId: string,
    onMoved?: (newChatroomId: string) => void,
  ): void {
    this.capacity.start(currentChatroomId, userId, onMoved);
  }

  /**
   * Set up eviction watcher for a chatroom (public method for use after manual room switches)
   */
  setupEvictionWatcher(
    userId: string,
    chatroomId: string,
    onMoved?: (newChatroomId: string) => void,
  ): void {
    this.watchForEviction(userId, chatroomId, onMoved);
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    console.log(`🚪 Leaving chatroom: ${chatroomId} as user: ${userId}`);
    this.stopMembershipHeartbeat(chatroomId, userId);
    this.capacity.stop(chatroomId);

    const gun = this.gunService.getGun();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeoutId = setTimeout(finish, 1500);
      gun
        .get('chatrooms')
        .get(chatroomId)
        .get('users')
        .get(userId)
        .put(
          {
            leftAt: new Date().toISOString(),
            isActive: false,
          },
          () => {
            clearTimeout(timeoutId);
            finish();
          },
        );
    });
    await this.syncLeaveWithServer(chatroomId, userId);
    console.log(`✅ Initiated leave for chatroom: ${chatroomId}`);
  }

  private runMove<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.moveQueue.then(operation, operation);
    this.moveQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Manual room switch. Atomic with respect to every other move: it waits for any move already
   * running, always wins over an eviction that has not started, and puts the user back in the room
   * they came from if the new join fails, so nobody is left in no room.
   */
  async switchChatroom(userId: string, newChatroomId: string, stageName?: string): Promise<void> {
    this.manualMovesPending += 1;
    try {
      await this.runMove(async () => {
        const from = this.currentChatroomId;
        // A same-room switch is a no-op, not a revisit: joinChatroom()'s alreadyActive
        // fast path re-records a visit unconditionally (needed for the page-reload case,
        // where a fresh service instance has no currentChatroomId to compare against).
        if (from === newChatroomId) return;
        if (from) await this.leaveChatroom(from, userId);
        try {
          await this.joinChatroom(newChatroomId, userId, stageName);
        } catch (error) {
          if (from) await this.joinChatroom(from, userId, stageName).catch(() => undefined);
          throw error;
        }
      });
    } finally {
      this.manualMovesPending -= 1;
    }
  }

  /**
   * Eviction move, run by the evictee itself. Returns false without changing anything when a manual
   * switch is pending (manual wins) or the user is no longer in `from`.
   */
  private async moveForEviction(
    from: string,
    userId: string,
    child: string,
    stageName: string,
    onMoved?: (roomId: string) => void,
  ): Promise<boolean> {
    if (this.manualMovesPending > 0) return false;
    return this.runMove(async () => {
      if (this.manualMovesPending > 0 || this.currentChatroomId !== from) return false;
      await this.leaveChatroom(from, userId);
      const gun = this.gunService.getGun();
      gun.get('chatrooms').get(from).get('users').get(userId).put({ movedTo: child });
      gun.get('chatrooms').get(from).get('locations').get(userId).put(null);
      try {
        await this.joinChatroom(child, userId, stageName, onMoved);
      } catch (error) {
        console.warn(`Eviction join into ${child} failed; returning ${userId} to ${from}`, error);
        await this.joinChatroom(from, userId, stageName, onMoved).catch(() => undefined);
        return false;
      }
      return true;
    });
  }

  /**
   * Snapshot active user ids for a room. Uses a short `map().on` observation window so cold pages
   * do not depend on a parent `.once()` snapshot, which is unreliable for Gun child user nodes.
   */
  private async observeActiveMemberIds(
    chatroomId: string,
    observeMs = 400,
    options: { includeTechSupport?: boolean } = {},
  ): Promise<string[]> {
    try {
      const gun = this.gunService.getGun();
      const activeYes = new Set<string>();

      return await new Promise((resolve) => {
        let settled = false;
        const finish = (ids: string[]) => {
          if (settled) return;
          settled = true;
          try {
            off.off();
          } catch {
            /* Gun peer */
          }
          resolve(ids);
        };

        const off = gun
          .get('chatrooms')
          .get(chatroomId)
          .get('users')
          .map()
          .on((memberData: any, userId: string) => {
            if (userId.startsWith('_') || (!options.includeTechSupport && userId === TECHSUPPORT_ROOT_USER_ID)) return;
            if (this.isFreshActiveMember(memberData)) {
              activeYes.add(userId);
            } else {
              activeYes.delete(userId);
            }
          });

        setTimeout(() => finish([...activeYes]), observeMs);
      });
    } catch (error) {
      console.error('Error getting active members:', error);
      return [];
    }
  }

  /**
   * Snapshot active user ids for a room. Uses a short `map().on` observation window so we do not
   * resolve on the first partial replica (e.g. only the sender) before peers replicate — the old
   * `.once` + "resolve as soon as length > 0" path often dropped other members and yielded 0
   * broadcast receivers while the UI already listed them.
   */
  async getActiveMembers(chatroomId: string): Promise<string[]> {
    const fromServer = await this.fetchMemberIdsFromServer(chatroomId);
    if (fromServer.length > 0) return fromServer;
    return this.observeActiveMemberIds(chatroomId, 800);
  }

  /**
   * K1 item 1 (docs/TODO.md): Global always has a floor of one built-in TechSupport member,
   * synthesized from compiled constants — no round-trip, no dependence on a browser having
   * bootstrapped it. Injected only when no real `TECHSUPPORT_ROOT_USER_ID` entry is already in
   * the map (a real seeded row, K1 item 2, always wins and is never double-counted).
   */
  private rosterWithTechSupportFloor(
    chatroomId: string,
    members: Array<{ userId: string; stageName: string; joinedAt?: string | Date; epub?: string; pub?: string }>,
  ): Array<{ userId: string; stageName: string; joinedAt?: string | Date; epub?: string; pub?: string }> {
    if (chatroomId !== TECHSUPPORT_GLOBAL_ROOM_ID) return members;
    if (members.some((m) => m.userId === TECHSUPPORT_ROOT_USER_ID)) return members;
    return [...members, techSupportRosterMember()];
  }

  subscribeToMembers(
    chatroomId: string,
    callback: (members: Array<{ userId: string; stageName: string; joinedAt?: string | Date; epub?: string; pub?: string }>) => void,
  ): void {
    this.membersListCallback = callback;

    // Reopening the same chatroom: keep Gun .map() state and only swap the callback + push a snapshot.
    // Replacing the subscription used to clear the map; the first debounced tick was often [] and wiped
    // broadcast receiver lists (server IN registration) while the UI still showed other users.
    if (this.membersListenerRoomId === chatroomId && this.activeMembersUnsubscribe) {
      queueMicrotask(() => {
        if (this.membersListCallback === callback && chatroomId === this.membersListenerRoomId) {
          callback(this.rosterWithTechSupportFloor(chatroomId, Array.from(this.activeMembersForList.values())));
        }
      });
      return;
    }

    if (this.activeMembersUnsubscribe) {
      this.activeMembersUnsubscribe();
    }
    this.membersListenerRoomId = chatroomId;
    this.activeMembersForList.clear();
    if (this.membersListDebounce) {
      clearTimeout(this.membersListDebounce);
      this.membersListDebounce = null;
    }

    const gun = this.gunService.getGun();

    const off = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .on((memberData: any, userId: string) => {
        if (userId.startsWith('_')) return;
        // Gun's .off() (called by activeMembersUnsubscribe when switching rooms, below) stops
        // *future* subscriptions but cannot cancel an event already in flight — a message for
        // this closure's room that was queued before the switch can still be delivered after
        // `chatroomId` has stopped being the active room. Without this guard, that stale event
        // still mutated the single shared activeMembersForList map (only the *debounced
        // notification* below was gated on membersListenerRoomId, not the map write itself),
        // silently injecting a member from the room just left into the room just entered — e.g.
        // a peer from Global surviving into a just-opened hierarchy room's roster and being
        // counted as a receiver there (confirmed via e2e: 00h-chatroom-hierarchy-broadcast,
        // 2026-08-10). A room switch already clears the map and re-subscribes fresh, so any event
        // for a room that is no longer current is definitionally stale.
        if (chatroomId !== this.membersListenerRoomId) return;

        if (this.isFreshActiveMember(memberData)) {
          this.activeMembersForList.set(userId, {
            userId,
            stageName: memberData.stageName || userId,
            ...(memberData.lastSeen ? { lastSeen: memberData.lastSeen } : {}),
            ...(memberData.joinedAt ? { joinedAt: memberData.joinedAt } : {}),
            ...(typeof memberData.epub === 'string' && memberData.epub ? { epub: memberData.epub } : {}),
            ...(typeof memberData.pub === 'string' && memberData.pub ? { pub: memberData.pub } : {}),
          });
        } else if (memberData && (memberData.isActive === false || this.isDefinitelyStale(memberData))) {
          // Only remove on a definite signal (explicitly inactive, or a genuinely old lastSeen).
          // Gun's .map().on() transiently emits null/partial records mid-sync; deleting on those
          // made the roster flicker ("comes and goes"). Keep the last-known-good entry instead.
          this.activeMembersForList.delete(userId);
        }

        if (this.membersListDebounce) clearTimeout(this.membersListDebounce);
        this.membersListDebounce = setTimeout(() => {
          if (chatroomId === this.membersListenerRoomId && this.membersListCallback) {
            this.membersListCallback(
              this.rosterWithTechSupportFloor(chatroomId, Array.from(this.activeMembersForList.values())),
            );
          }
        }, 150);
      });

    // See staleMembersSweepTimer's own doc comment: without this, a member who stops
    // heartbeating without an explicit leave signal never re-triggers Gun's .map().on()
    // callback and so is never re-evaluated for staleness, sitting in the roster forever.
    if (this.staleMembersSweepTimer) clearInterval(this.staleMembersSweepTimer);
    const sweepMs = Math.max(1000, Math.min(30_000, Math.floor((ROOM_MEMBERSHIP_TTL_SECONDS * 1000) / 3)));
    this.staleMembersSweepTimer = setInterval(() => {
      if (chatroomId !== this.membersListenerRoomId) return;
      let changed = false;
      for (const [id, member] of this.activeMembersForList.entries()) {
        // TechSupport is never evicted from a room (decision K1-3) — matches the server's
        // own independent immunity check in getFastActiveMembers.
        if (id === TECHSUPPORT_ROOT_USER_ID) continue;
        if (this.isDefinitelyStale({ lastSeen: member.lastSeen, joinedAt: member.joinedAt })) {
          this.activeMembersForList.delete(id);
          changed = true;
        }
      }
      if (changed && this.membersListCallback) {
        this.membersListCallback(
          this.rosterWithTechSupportFloor(chatroomId, Array.from(this.activeMembersForList.values())),
        );
      }
    }, sweepMs);

    this.activeMembersUnsubscribe = () => {
      off.off();
      this.membersListenerRoomId = undefined;
      this.activeMembersForList.clear();
      if (this.membersListDebounce) {
        clearTimeout(this.membersListDebounce);
        this.membersListDebounce = null;
      }
      if (this.staleMembersSweepTimer) {
        clearInterval(this.staleMembersSweepTimer);
        this.staleMembersSweepTimer = null;
      }
    };
  }

  getCurrentChatroomId(): string | undefined {
    return this.currentChatroomId;
  }

  // ─── Zone-B Challenge Plugin Configuration (FR-CPF-04) ────────────────────

  /**
   * Store per-chatroom plugin configuration in zone-B (~{ownerPub}/private/chatroom-config/<chatroomId>/challengePlugins).
   * This allows chatroom owners to enable/disable plugins without server restart.
   *
   * @param chatroomId The chatroom identifier
   * @param pluginIds Array of plugin IDs to enable for this chatroom
   */
  async setChallengeConfig(chatroomId: string, pluginIds: string[]): Promise<void> {
    const path = `chatroom-config/${chatroomId}/challengePlugins`;
    // Gun cannot store nested arrays; serialize as JSON string per CLAUDE.md pattern
    const data = {
      pluginIdsJson: JSON.stringify(pluginIds),
      updatedAt: new Date().toISOString(),
    };
    await this.gunService.putPrivate(path, data);
  }

  /**
   * Read and resolve per-chatroom challenge plugin configuration from zone-B.
   * Returns a ChallengeGateConfig ready for runChallengeGate, or null if no config exists.
   *
   * @param chatroomId The chatroom identifier
   * @returns ChallengeGateConfig | null
   */
  async getChallengeConfig(chatroomId: string): Promise<ChallengeGateConfig | null> {
    try {
      const path = `chatroom-config/${chatroomId}/challengePlugins`;
      const data = await this.gunService.getPrivate(path);
      if (!data || typeof data !== 'object') return null;

      let pluginIds: string[] = [];
      if (typeof data.pluginIdsJson === 'string') {
        try {
          pluginIds = JSON.parse(data.pluginIdsJson);
        } catch {
          return null;
        }
      }

      if (!Array.isArray(pluginIds) || pluginIds.length === 0) return null;

      // Resolve plugin instances from the registry
      const plugins = pluginIds
        .map((id) => getChallengePlugin(id))
        .filter((p) => p !== undefined) as any[];

      if (plugins.length === 0) return null;

      return {
        plugins,
        semantics: 'all', // Default to AND semantics; could be extended to store in config
      };
    } catch {
      // Graph lag or auth issue; no config available
      return null;
    }
  }

  /**
   * Get the member count for a specific chatroom (without subscribing)
   * This is useful for displaying member counts in chatroom lists
   */
  async getMemberCount(chatroomId: string): Promise<number> {
    const activeMemberIds = await this.observeActiveMemberIds(chatroomId, 1400, { includeTechSupport: true });
    // K1 item 1: Global's count floor of 1 does not depend on any Gun row existing yet.
    if (chatroomId === TECHSUPPORT_GLOBAL_ROOM_ID && !activeMemberIds.includes(TECHSUPPORT_ROOT_USER_ID)) {
      return activeMemberIds.length + 1;
    }
    return activeMemberIds.length;
  }

  /**
   * Subscribe to member count updates for a specific chatroom
   * Calls the callback whenever the member count changes
   */
  subscribeToMemberCount(chatroomId: string, callback: (count: number) => void): void {
    // Unsubscribe from previous subscription for this chatroom if exists
    const existingUnsubscribe = this.memberCountSubscriptions.get(chatroomId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    console.log(`👂 Subscribing to member count for chatroom: ${chatroomId}`);
    const gun = this.gunService.getGun();

    // The server publishes this aggregate alongside its presence updates.  Reading it
    // avoids a separate HTTP request and does not disclose the room's member list.
    const publicCountRef = gun
      .get('public')
      .get('room-member-counts')
      .get(chatroomId);
    const publicCountOff = publicCountRef.on((value: unknown) => {
      const count = Number((value as { count?: unknown } | null)?.count);
      if (Number.isFinite(count) && count >= 0) callback(count);
    });

    // Track active members for this chatroom
    const activeMembers = new Map<string, any>();
    let updateTimeout: NodeJS.Timeout | null = null;
    let subscriptionCancelled = false;
    let seedHydrated = false;
    let pendingLiveEmit = false;

    const emitCount = () => {
      let count = 0;
      let sawFreshTechSupport = false;
      for (const [id, data] of activeMembers) {
        if (this.isFreshActiveMember(data)) {
          count++;
          if (id === TECHSUPPORT_ROOT_USER_ID) sawFreshTechSupport = true;
        }
      }
      // K1 item 1: Global's count floor of 1 does not depend on any Gun row existing (or
      // reading fresh) yet — TechSupport is always in the room whether or not its device is
      // currently reachable (liveness is a separate signal, K1 item 3).
      if (chatroomId === TECHSUPPORT_GLOBAL_ROOM_ID && !sawFreshTechSupport) count++;

      console.log(`📊 Member count update for ${chatroomId}: ${count} members`);
      callback(count);
    };

    // Seed the count through the same child-node observation path used by detail/broadcast logic.
    // This prevents the first Chatrooms screen from rendering every room as 0 until a detail view
    // happens to force that room's member list to load.
    void this.observeActiveMemberIds(chatroomId, 1400, { includeTechSupport: true }).then((memberIds) => {
      if (subscriptionCancelled) return;
      for (const userId of memberIds) {
        if (!activeMembers.has(userId)) {
          activeMembers.set(userId, { isActive: true });
        }
      }
      seedHydrated = true;
      emitCount();
      if (pendingLiveEmit) {
        pendingLiveEmit = false;
        emitCount();
      }
    });

    // Subscribe to each individual user's data using map().on()
    const off = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .on((memberData: any, userId: string) => {
        // Skip Gun.js metadata
        if (userId.startsWith('_')) return;

        // Update our tracking map
        if (!this.isFreshActiveMember(memberData)) {
          activeMembers.delete(userId);
        } else {
          activeMembers.set(userId, memberData);
        }

        // Debounce the count update to avoid excessive recalculations
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          if (!seedHydrated) {
            pendingLiveEmit = true;
            return;
          }
          emitCount();
        }, 100); // 100ms debounce
      });

    // A member who goes offline just stops heartbeating: Gun never fires for that, so re-check
    // freshness on a timer and drop them from the count once their heartbeat has lapsed.
    const staleSweep = setInterval(() => {
      let removed = false;
      for (const [id, data] of activeMembers) {
        if (!this.isFreshActiveMember(data)) {
          activeMembers.delete(id);
          removed = true;
        }
      }
      if (removed && seedHydrated) emitCount();
    }, 30_000);

    // Store unsubscribe function
    this.memberCountSubscriptions.set(chatroomId, () => {
      subscriptionCancelled = true;
      clearInterval(staleSweep);
      if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
      }
      off.off();
      publicCountOff?.off?.();
    });
  }

  subscribeToVisitCounts(
    chatroomId: string,
    callback: (counts: { visitCount: number; uniqueVisitorCount: number }) => void,
  ): void {
    const existingUnsubscribe = this.visitCountSubscriptions.get(chatroomId);
    if (existingUnsubscribe) existingUnsubscribe();
    const gun = this.gunService.getGun();
    // Both badges now come from one CRDT map (docs/TODO.md L1): total = sum of slots,
    // unique = number of non-zero slots. `.map()` is required — a parent `.once()` on a
    // Gun child map usually comes back empty. TODO §L2: also fold in the pruned aggregate,
    // so a device-side prune never makes this badge appear to shrink.
    const slots: Record<string, unknown> = {};
    let pruned: unknown = null;
    const emit = () => callback(visitTotalsWithPruned(readVisitCounterState(slots), readPrunedVisitAggregate(pruned)));
    const offSlots = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('visitCounter')
      .map()
      .on((value: any, key: string) => {
        if (!key) return;
        slots[key] = value;
        emit();
      });
    const offPruned = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('visitCounterPruned')
      .on((value: any) => {
        pruned = value;
        emit();
      });
    this.visitCountSubscriptions.set(chatroomId, () => {
      offSlots?.off?.();
      offPruned?.off?.();
    });
  }

  /**
   * Unsubscribe from all member count subscriptions
   */
  unsubscribeAllMemberCounts(): void {
    this.memberCountSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.memberCountSubscriptions.clear();
    this.visitCountSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.visitCountSubscriptions.clear();
  }
}
