import { CONFIG } from '../../shared/config';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import {
  PROMOTE_BELOW_OTHERS,
  evictionDestination,
  parentHasHeadroom,
  promotionBlockedUntil,
  promotionTarget,
  pruneEvictionHistory,
  type EvictionRecord,
  type RoutingAnchor,
} from '../../shared/room-routing';
import {
  capacityNoticeCoordinator,
  isNoticeForStay,
  overflowMembers,
  type CapacityMember,
  type EvictionNotice,
} from '../../shared/chatroom-capacity';
import {
  SPLIT_FRONTIER_PATH,
  SPLIT_FRONTIER_MAX_JUMP,
  freshFrontierIndex,
  splitBaseId,
  splitIndex,
  splitRoomId,
} from '../../shared/chatroom-split';

/** How long after the last member-list change before the room is re-checked (throttle window). */
const RECONCILE_DELAY_MS = 1500;
const FRONTIER_READ_TIMEOUT_MS = 700;
const PROMOTION_COUNT_TIMEOUT_MS = 8_000;

export interface ChatroomCapacityDeps {
  getGun: () => any;
  fifoEnabled: () => boolean;
  /** Active global protocol-epoch capacity; never a room metadata value. */
  getCapacity?: () => number;
  /** Same freshness rule the roster uses (drops members whose heartbeat has expired). */
  isFreshMember: (memberData: any) => boolean;
  getCurrentRoom: () => string | undefined;
  /** Confirmed GPS position, else the user's chosen home tile, else none (room-routing.ts). */
  getAnchor: (userId: string) => RoutingAnchor;
  /**
   * False while the current room is the user's own choice (a manual switch or travel): they are
   * never moved up out of it automatically. Defaults to true.
   */
  canAutoPromote?: (roomId: string) => boolean;
  /** Active ordinary members (no TechSupport) of another room, for the promotion headroom check. */
  countActiveMembers?: (roomId: string) => Promise<number>;
  /** Persisted eviction history for the promotion cooldown (loop guard). */
  readEvictionHistory?: () => EvictionRecord[];
  writeEvictionHistory?: (history: EvictionRecord[]) => void;
  /** Promotion state for the UI: waiting on a cooldown/headroom, or cleared (null). */
  onPromotionStatus?: (status: { target: string; blockedUntil: number } | null) => void;
  now?: () => number;
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
 * referee, and moves members of thin rooms back up (docs/design/room-tree-routing.md).
 *
 *  - Down: every room uses FIFO. The oldest overflow member moves ONE layer down the tile tree
 *    toward their GPS position or chosen home tile (Global → L1 → … → L4); a room with no child for
 *    them (L4, their home tile, custom, `_part_N`, the non-geographic Global overflow) splits into
 *    its own `_part_N` family. Global without any anchor overflows to the Global overflow family.
 *  - Up: when the room has fewer than PROMOTE_BELOW_OTHERS other members for the dwell time, the
 *    room above has headroom (≤ C − 10%), and no eviction cooldown blocks it, the member moves up.
 *    The cooldown (15 min, doubling per repeat, cap 4 h) stops evict → promote → evict loops.
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
  private promoteTimer: ReturnType<typeof setInterval> | null = null;
  private underflowSince: number | undefined;
  private promoteJitterMs = 0;
  private promoting = false;
  private lastPromotionWait = '';
  private subscriptionGeneration = 0;

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

    // Gun's `off()` on a `map().on()` does not stop callbacks immediately: late callbacks from the
    // PREVIOUS room's subscription would land in this room's member map (an evictee then sees the
    // old room's members as company and is never promoted; counts are wrong for eviction too).
    // Each subscription only writes while it is still the current one.
    const generation = ++this.subscriptionGeneration;
    const isCurrent = () => generation === this.subscriptionGeneration && this.roomId === roomId;
    const memberSub = room.get('users').map().on((data: any, key: string) => {
      if (!isCurrent()) return;
      if (!data || typeof data !== 'object' || key === TECHSUPPORT_ROOT_USER_ID) this.members.delete(key);
      else this.members.set(key, data);
      this.scheduleReconcile();
    });
    this.offMembers = () => memberSub.off();

    const noticeSub = room.get('evictions').get(userId).map().on((notice: any, authorKey: string) => {
      if (!isCurrent()) return;
      void this.handleNotice(roomId, userId, notice, authorKey);
    });
    this.offNotices = () => noticeSub.off();

    // Check once soon after joining even if no other member record ever changes.
    this.scheduleReconcile();

    this.underflowSince = undefined;
    this.promoteJitterMs = Math.floor(Math.random() * (CONFIG.CHATROOM_PROMOTE_JITTER_MS + 1));
    const checkEvery = Math.min(15_000, Math.max(500, Math.floor(CONFIG.CHATROOM_PROMOTE_DWELL_MS / 3)));
    this.promoteTimer = setInterval(() => void this.considerPromotion(), checkEvery);
  }

  /** Stop watching. When `roomId` is given, only stops if that is the room being watched. */
  stop(roomId?: string): void {
    if (roomId && this.roomId !== roomId) return;
    this.subscriptionGeneration += 1;
    this.offMembers?.();
    this.offNotices?.();
    this.offMembers = undefined;
    this.offNotices = undefined;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    if (this.promoteTimer) clearInterval(this.promoteTimer);
    this.promoteTimer = null;
    this.underflowSince = undefined;
    this.deps.onPromotionStatus?.(null);
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
    const capacity = Math.max(1, Math.floor(this.deps.getCapacity?.() ?? CONFIG.CHATROOM_MAX_CAPACITY));
    const overflow = overflowMembers(members, capacity);

    // Capacity is a locally-derived rule, not authority granted by a notice writer. If this peer
    // can already prove from its own current view that it belongs in overflow, move directly.
    // The monotonic partial-view property in chatroom-capacity.ts makes this safe.
    if (overflow.some((member) => member.userId === userId)) {
      await this.selfEvict(roomId, userId);
      return;
    }

    if (capacityNoticeCoordinator(members) !== userId) return;
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
    const currentIndex = splitIndex(roomId);
    const hintedIndex = freshFrontierIndex(record, Date.now());
    const boundedHint = Math.min(hintedIndex, currentIndex + SPLIT_FRONTIER_MAX_JUMP);
    const index = Math.max(currentIndex + 1, boundedHint);
    node.put({ index, at: new Date().toISOString() });
    return splitRoomId(base, index);
  }

  private async handleNotice(roomId: string, userId: string, notice: any, authorKey: string): Promise<void> {
    if (!notice || typeof notice !== 'object') return;
    const mine = this.members.get(userId);
    if (!isNoticeForStay(notice, mine?.joinedAt)) return;
    if (String(notice.by || '') !== String(authorKey || '')) return;
    const members = this.activeMembers();
    const capacity = Math.max(1, Math.floor(this.deps.getCapacity?.() ?? CONFIG.CHATROOM_MAX_CAPACITY));
    if (Number(notice.capacity) !== capacity) return;
    if (capacityNoticeCoordinator(members) !== notice.by) return;
    if (!overflowMembers(members, capacity).some((member) =>
      member.userId === userId && member.joinedAt === mine?.joinedAt)) return;
    const stayKey = `${roomId}:${notice.evicteeJoinedAt}`;
    if (this.handled.has(stayKey)) return;
    this.handled.add(stayKey);
    await this.selfEvict(roomId, userId);
  }

  private async selfEvict(roomId: string, userId: string): Promise<void> {
    if (this.evicting) return;
    // Already leaving/left by hand: the notice no longer applies.
    if (this.deps.getCurrentRoom() !== roomId) return;
    const destination = evictionDestination(roomId, this.deps.getAnchor(userId));
    const child = destination.kind === 'room' ? destination.roomId : await this.chooseSplitTarget(roomId);
    if (!child) {
      console.warn(`⚠️  Eviction notice for ${roomId} but no child room is available for ${userId}; staying`);
      return;
    }
    const moved = await this.relocate(roomId, userId, child, 'Over capacity');
    if (moved) this.recordEviction(roomId);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private recordEviction(fromRoom: string): void {
    if (!this.deps.readEvictionHistory || !this.deps.writeEvictionHistory) return;
    const now = this.now();
    this.deps.writeEvictionHistory(pruneEvictionHistory([...this.deps.readEvictionHistory(), { room: fromRoom, at: now }], now));
  }

  /**
   * Underflow: move up one step when this room has been too thin for the dwell time, the room above
   * has headroom, and no eviction cooldown blocks it (docs/design/room-tree-routing.md §4).
   */
  private async considerPromotion(): Promise<void> {
    const roomId = this.roomId;
    const userId = this.userId;
    if (!roomId || !userId || this.evicting || this.promoting) return;
    if (this.deps.getCurrentRoom() !== roomId) {
      this.logPromotionWait(`service is in ${this.deps.getCurrentRoom()}, not ${roomId}`);
      return;
    }
    if (this.deps.canAutoPromote && !this.deps.canAutoPromote(roomId)) {
      this.logPromotionWait('room was chosen by hand');
      return;
    }
    const target = promotionTarget(roomId);
    if (!target || !this.deps.countActiveMembers) return;
    const members = this.activeMembers();
    if (!members.some((member) => member.userId === userId)) {
      this.logPromotionWait(`own presence not fresh in ${roomId} (${this.members.size} records)`);
      return;
    }
    const now = this.now();
    if (members.length - 1 >= PROMOTE_BELOW_OTHERS) {
      this.underflowSince = undefined;
      this.deps.onPromotionStatus?.(null);
      return;
    }
    this.underflowSince ??= now;
    if (now - this.underflowSince < CONFIG.CHATROOM_PROMOTE_DWELL_MS + this.promoteJitterMs) return;

    const history = this.deps.readEvictionHistory?.() ?? [];
    const blockedUntil = promotionBlockedUntil(target, history, now, CONFIG.CHATROOM_EVICTION_COOLDOWN_MS);
    if (blockedUntil) {
      this.logPromotionWait(`cooldown until ${new Date(blockedUntil).toISOString()} before ${target}`);
      this.deps.onPromotionStatus?.({ target, blockedUntil });
      return;
    }
    this.promoting = true;
    try {
      const capacity = Math.max(1, Math.floor(this.deps.getCapacity?.() ?? CONFIG.CHATROOM_MAX_CAPACITY));
      // A hung or failed count must never wedge promotion: treat it as unknown and retry next tick.
      const aboveCount = await Promise.race([
        this.deps.countActiveMembers(target).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PROMOTION_COUNT_TIMEOUT_MS)),
      ]);
      if (aboveCount === null) {
        this.logPromotionWait(`could not count ${target}`);
        return;
      }
      if (!parentHasHeadroom(aboveCount, capacity)) {
        this.logPromotionWait(`${target} has ${aboveCount}/${capacity} (needs headroom)`);
        this.deps.onPromotionStatus?.({ target, blockedUntil: 0 });
        return;
      }
      if (this.roomId !== roomId || this.deps.getCurrentRoom() !== roomId) return;
      this.deps.onPromotionStatus?.(null);
      await this.relocate(roomId, userId, target, `Too few members (${members.length - 1} others)`);
    } finally {
      this.promoting = false;
    }
  }

  private logPromotionWait(reason: string): void {
    if (reason === this.lastPromotionWait) return;
    this.lastPromotionWait = reason;
    console.log(`⏳ Thin room ${this.roomId}: not moving up yet — ${reason}`);
  }

  /** Move myself out of `roomId` into `target` (atomic in the service; manual moves win). */
  private async relocate(roomId: string, userId: string, target: string, reason: string): Promise<boolean> {
    if (this.evicting || this.deps.getCurrentRoom() !== roomId) return false;
    this.evicting = true;
    const onMoved = this.onMoved;
    try {
      console.log(`🚪 ${reason}: moving ${userId} from ${roomId} to ${target}`);
      const moved = await this.deps.moveForEviction(roomId, userId, target, this.deps.getStageName(userId), onMoved);
      // The join into `target` started this controller there, which cascades if it is full too.
      if (moved) onMoved?.(target);
      return moved;
    } finally {
      this.evicting = false;
    }
  }
}
