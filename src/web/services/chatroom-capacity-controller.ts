import { CONFIG } from '../../shared/config';
import type { GPSCoordinate } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { findAppropriateChildChatroom } from '../../shared/location-to-chatroom';
import {
  ROOM_CAPACITY_PATH,
  capacityOwner,
  isNoticeForStay,
  overflowMembers,
  parseRoomCapacity,
  type CapacityMember,
  type EvictionNotice,
  type RoomCapacityRecord,
} from '../../shared/chatroom-capacity';

/** How long after the last member-list change before the room is re-checked (throttle window). */
const RECONCILE_DELAY_MS = 1500;
const CAPACITY_READ_TIMEOUT_MS = 700;

export interface ChatroomCapacityDeps {
  getGun: () => any;
  fifoEnabled: () => boolean;
  /** Same freshness rule the roster uses (drops members whose heartbeat has expired). */
  isFreshMember: (memberData: any) => boolean;
  getCurrentRoom: () => string | undefined;
  getLocation: (userId: string) => GPSCoordinate | undefined;
  getStageName: (userId: string) => string;
  /**
   * Atomically move `userId` from `from` to `child` as an eviction. Resolves false (and changes
   * nothing) when a manual room switch is pending/won, or the user is no longer in `from`.
   */
  moveForEviction: (
    from: string,
    userId: string,
    child: string,
    stageName: string,
    onMoved?: (roomId: string) => void,
  ) => Promise<boolean>;
}

/**
 * Keeps a room at or under its capacity without any referee, cascading down the hierarchy:
 *
 *  - Every member watches its room's member list. The NEWEST member (deterministic, see
 *    shared/chatroom-capacity.ts) is the room's "owner": when the room is over capacity it
 *    writes an eviction NOTICE for each overflow member (one record per author, so no two
 *    peers ever write the same key).
 *  - An overflow member reacts to a notice addressed to its current stay by moving ITSELF to
 *    the child room for its own location. It ignores the notice if it has already left the room
 *    (e.g. it is switching rooms by hand), so a notice never races a manual move.
 *  - The move is an ordinary join, so the same check runs in the child room — the overflow
 *    ripples down until no room is over capacity.
 */
export class ChatroomCapacityController {
  private capacityCache = new Map<string, number>();
  private roomId: string | undefined;
  private userId: string | undefined;
  private onMoved: ((roomId: string) => void) | undefined;
  private members = new Map<string, any>();
  private offMembers: (() => void) | undefined;
  private offNotices: (() => void) | undefined;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private notified = new Set<string>();
  private handled = new Set<string>();
  private evicting = false;

  constructor(private deps: ChatroomCapacityDeps) {}

  /** Start (or re-point) watching `roomId`. Calling again for the same room only updates `onMoved`. */
  start(roomId: string, userId: string, onMoved?: (roomId: string) => void): void {
    if (this.roomId === roomId && this.userId === userId && this.offMembers) {
      this.onMoved = onMoved ?? this.onMoved;
      return;
    }
    this.stop();
    if (!this.deps.fifoEnabled() || userId === TECHSUPPORT_ROOT_USER_ID) return;
    this.roomId = roomId;
    this.userId = userId;
    this.onMoved = onMoved;
    const gun = this.deps.getGun();
    const room = gun.get('chatrooms').get(roomId);

    const memberSub = room.get('users').map().on((data: any, key: string) => {
      if (!data || typeof data !== 'object' || key === TECHSUPPORT_ROOT_USER_ID) this.members.delete(key);
      else this.members.set(key, data);
      this.scheduleReconcile();
    });
    this.offMembers = () => memberSub.off();

    const noticeSub = room.get('evictions').get(userId).map().on((notice: any) => {
      void this.handleNotice(roomId, userId, notice);
    });
    this.offNotices = () => noticeSub.off();

    // Check once soon after joining even if no other member record ever changes.
    this.scheduleReconcile();
  }

  /** Stop watching. When `roomId` is given, only stops if that is the room being watched. */
  stop(roomId?: string): void {
    if (roomId && this.roomId !== roomId) return;
    this.offMembers?.();
    this.offNotices?.();
    this.offMembers = undefined;
    this.offNotices = undefined;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    this.members.clear();
    this.roomId = undefined;
    this.userId = undefined;
    this.onMoved = undefined;
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcile();
    }, RECONCILE_DELAY_MS);
  }

  private activeMembers(): CapacityMember[] {
    const out: CapacityMember[] = [];
    for (const [userId, data] of this.members) {
      if (data.isActive === true && this.deps.isFreshMember(data)) {
        out.push({ userId, joinedAt: String(data.joinedAt || '') });
      }
    }
    return out;
  }

  /** The room's capacity: its stored record, else write ours (first writer wins) and use that. */
  async resolveCapacity(roomId: string, userId: string): Promise<number> {
    const cached = this.capacityCache.get(roomId);
    if (cached) return cached;
    const node = this.deps.getGun().get(ROOM_CAPACITY_PATH).get(roomId);
    const stored = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), CAPACITY_READ_TIMEOUT_MS);
      node.once((data: any) => {
        clearTimeout(timer);
        resolve(parseRoomCapacity(data?.capacity));
      });
    });
    if (stored) {
      this.capacityCache.set(roomId, stored);
      return stored;
    }
    const capacity = CONFIG.CHATROOM_MAX_CAPACITY;
    const record: RoomCapacityRecord = { capacity, setBy: userId, setAt: new Date().toISOString() };
    node.put(record);
    this.capacityCache.set(roomId, capacity);
    return capacity;
  }

  private async reconcile(): Promise<void> {
    const roomId = this.roomId;
    const userId = this.userId;
    if (!roomId || !userId) return;
    const members = this.activeMembers();
    // Not visible in our own list yet: wait for our own record to arrive before judging.
    if (!members.some((m) => m.userId === userId)) return;
    if (capacityOwner(members) !== userId) return;

    const capacity = await this.resolveCapacity(roomId, userId);
    if (this.roomId !== roomId) return;
    const overflow = overflowMembers(this.activeMembers(), capacity);
    for (const member of overflow) {
      if (member.userId === userId) continue;
      const key = `${roomId}:${member.userId}:${member.joinedAt}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      const notice: EvictionNotice = {
        by: userId,
        at: new Date().toISOString(),
        capacity,
        evicteeJoinedAt: member.joinedAt,
      };
      this.deps.getGun().get('chatrooms').get(roomId).get('evictions').get(member.userId).get(userId).put(notice);
    }
  }

  private async handleNotice(roomId: string, userId: string, notice: any): Promise<void> {
    if (!notice || typeof notice !== 'object') return;
    const mine = this.members.get(userId);
    if (!isNoticeForStay(notice, mine?.joinedAt)) return;
    const stayKey = `${roomId}:${notice.evicteeJoinedAt}`;
    if (this.handled.has(stayKey)) return;
    this.handled.add(stayKey);
    await this.selfEvict(roomId, userId);
  }

  private async selfEvict(roomId: string, userId: string): Promise<void> {
    if (this.evicting) return;
    // Already leaving/left by hand: the notice no longer applies.
    if (this.deps.getCurrentRoom() !== roomId) return;
    const location = this.deps.getLocation(userId);
    const child = location ? findAppropriateChildChatroom(roomId, location) : null;
    if (!child) {
      console.warn(`⚠️  Eviction notice for ${roomId} but no child room is available for ${userId}; staying`);
      return;
    }
    this.evicting = true;
    const onMoved = this.onMoved;
    try {
      console.log(`🚪 Eviction notice: moving ${userId} from ${roomId} to ${child}`);
      const moved = await this.deps.moveForEviction(roomId, userId, child, this.deps.getStageName(userId), onMoved);
      // The join into `child` started this controller there, which cascades if it is full too.
      if (moved) onMoved?.(child);
    } finally {
      this.evicting = false;
    }
  }
}
