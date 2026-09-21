import { CONFIG } from '../../shared/config';
import type { GPSCoordinate } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { findAppropriateChildChatroom } from '../../shared/location-to-chatroom';
import {
  capacityOwner,
  isNoticeForStay,
  overflowMembers,
  splitOverflowMembers,
  type CapacityMember,
  type EvictionNotice,
} from '../../shared/chatroom-capacity';
import {
  SPLIT_FRONTIER_PATH,
  freshFrontierIndex,
  splitBaseId,
  splitIndex,
  splitRoomId,
} from '../../shared/chatroom-split';

/** How long after the last member-list change before the room is re-checked (throttle window). */
const RECONCILE_DELAY_MS = 1500;
const FRONTIER_READ_TIMEOUT_MS = 700;

export interface ChatroomCapacityDeps {
  getGun: () => any;
  fifoEnabled: () => boolean;
  /** True for rooms in the location hierarchy (they have a child room); false for custom/split rooms. */
  isHierarchyRoom: (roomId: string) => boolean;
  /** Same freshness rule the roster uses (drops members whose heartbeat has expired). */
  isFreshMember: (memberData: any) => boolean;
  getCurrentRoom: () => string | undefined;
  getLocation: (userId: string) => GPSCoordinate | undefined;
  getStageName: (userId: string) => string;
  /**
   * Atomically move `userId` from `from` to `child`. Resolves false (and changes nothing) when a
   * manual room switch is pending/won, or the user is no longer in `from`.
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
 * Keeps every room at or under the ONE unified capacity (CONFIG.CHATROOM_MAX_CAPACITY) without any
 * referee. Two overflow rules, chosen from the room id alone so every peer agrees:
 *
 *  - Hierarchy rooms (Global, continents, cities...): FIFO down the tree. The room's NEWEST member
 *    is its "owner" and writes an eviction NOTICE for each overflow (oldest) member — one record
 *    per author, so no two peers ever write the same key. The evictee moves ITSELF to the child
 *    room for its own location, ignoring the notice if it has already left (a manual move wins).
 *  - Rooms with no child (custom rooms, the deepest regional room): the newest `n - capacity`
 *    members each move THEMSELVES on to the next numbered room (`x_part_2`, `_part_3`...). Nobody
 *    already inside is disturbed, and no notice is needed.
 *
 * Either way the move is an ordinary join, so the same check runs in the destination room and the
 * overflow ripples on until no room is over capacity.
 */
export class ChatroomCapacityController {
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
    const room = this.deps.getGun().get('chatrooms').get(roomId);

    const memberSub = room.get('users').map().on((data: any, key: string) => {
      if (!data || typeof data !== 'object' || key === TECHSUPPORT_ROOT_USER_ID) this.members.delete(key);
      else this.members.set(key, data);
      this.scheduleReconcile();
    });
    this.offMembers = () => memberSub.off();

    if (this.deps.isHierarchyRoom(roomId)) {
      const noticeSub = room.get('evictions').get(userId).map().on((notice: any) => {
        void this.handleNotice(roomId, userId, notice);
      });
      this.offNotices = () => noticeSub.off();
    }

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

  private async reconcile(): Promise<void> {
    const roomId = this.roomId;
    const userId = this.userId;
    if (!roomId || !userId) return;
    const members = this.activeMembers();
    // Not visible in our own list yet: wait for our own record to arrive before judging.
    if (!members.some((m) => m.userId === userId)) return;
    const capacity = CONFIG.CHATROOM_MAX_CAPACITY;

    if (!this.deps.isHierarchyRoom(roomId)) {
      await this.reconcileSplitRoom(roomId, userId, members, capacity);
      return;
    }

    if (capacityOwner(members) !== userId) return;
    for (const member of overflowMembers(members, capacity)) {
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

  /** A room with no child: if I am among the newest overflow members, move myself to the next numbered room. */
  private async reconcileSplitRoom(roomId: string, userId: string, members: CapacityMember[], capacity: number): Promise<void> {
    if (!splitOverflowMembers(members, capacity).some((m) => m.userId === userId)) return;
    if (this.evicting || this.deps.getCurrentRoom() !== roomId) return;
    const target = await this.chooseSplitTarget(roomId);
    await this.relocate(roomId, userId, target);
  }

  /**
   * Next numbered room for an overflow newcomer: at least the next number, but jump straight to the
   * recent frontier (highest room opened) so a crowd does not walk through every full room in turn.
   * The frontier is only a hint — correctness comes from the overflow rule in each room.
   */
  private async chooseSplitTarget(roomId: string): Promise<string> {
    const base = splitBaseId(roomId);
    const node = this.deps.getGun().get(SPLIT_FRONTIER_PATH).get(base);
    const record = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), FRONTIER_READ_TIMEOUT_MS);
      node.once((data: any) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
    const index = Math.max(splitIndex(roomId) + 1, freshFrontierIndex(record, Date.now()));
    node.put({ index, at: new Date().toISOString() });
    return splitRoomId(base, index);
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
    await this.relocate(roomId, userId, child);
  }

  /** Move myself out of `roomId` into `child` (atomic in the service; manual moves win). */
  private async relocate(roomId: string, userId: string, child: string): Promise<void> {
    if (this.evicting || this.deps.getCurrentRoom() !== roomId) return;
    this.evicting = true;
    const onMoved = this.onMoved;
    try {
      console.log(`🚪 Over capacity: moving ${userId} from ${roomId} to ${child}`);
      const moved = await this.deps.moveForEviction(roomId, userId, child, this.deps.getStageName(userId), onMoved);
      // The join into `child` started this controller there, which cascades if it is full too.
      if (moved) onMoved?.(child);
    } finally {
      this.evicting = false;
    }
  }
}
