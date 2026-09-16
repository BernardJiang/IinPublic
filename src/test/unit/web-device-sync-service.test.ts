/**
 * Integration-style coverage for WebDeviceSyncService: wires the WP5 device-sync protocol
 * (previously built but never called outside its own unit tests) end to end between two
 * simulated devices sharing one in-memory Gun graph, following web-ledger-service.test.ts's
 * FakeGunNode pattern (real SEA crypto runs fine under Jest's node environment) — extended with a
 * genuine live `.on()` so the authorization-watch and envelope-receive subscriptions this service
 * depends on behave like real Gun, not just a snapshot replay.
 */
import Gun from 'gun';
import 'gun/sea';
import { WebDeviceSyncService } from '../../web/services/web-device-sync-service';
import type { WebGunService } from '../../web/services/web-gun-service';
import type { GunPair } from '../../web/services/gun-bridge';

const SEA = (Gun as any).SEA;

// These tests drive real SEA crypto and real setTimeout-based ack polling through up to 15
// retries; Jest's 5s default can be exceeded under full-suite parallel load (many worker
// processes contending for CPU). 20s keeps genuine convergence tests from flaking without
// masking an actually-hung test (which would still exceed even this).
jest.setTimeout(40_000);

class FakeGunNode {
  private children = new Map<string, FakeGunNode>();
  private value: Record<string, unknown> | null | undefined = undefined;
  private listeners: Array<(data: any) => void> = [];

  get(key: string): FakeGunNode {
    let child = this.children.get(key);
    if (!child) {
      child = new FakeGunNode();
      this.children.set(key, child);
    }
    return child;
  }

  put(data: Record<string, unknown> | null, callback?: (ack: Record<string, unknown>) => void): void {
    if (data === null || !(this.value && typeof this.value === 'object')) {
      this.value = data;
    } else {
      this.value = { ...this.value, ...data };
    }
    if (callback) callback({});
    for (const listener of this.listeners) listener(this.value);
  }

  once(callback: (data: any) => void): void {
    callback(this.value ?? undefined);
  }

  on(callback: (data: any) => void): void {
    this.listeners.push(callback);
    if (this.value !== undefined) callback(this.value);
  }

  off(): void {
    this.listeners = [];
  }
}

class FakeGunStore {
  private root: FakeGunNode;
  constructor(private pair: GunPair, sharedRoot?: FakeGunNode) {
    this.root = sharedRoot ?? new FakeGunNode();
  }
  async put(key: string, value: any): Promise<void> {
    this.root.get(key).put(value);
  }
  async get(key: string): Promise<any> {
    let result: any;
    this.root.get(key).once((data) => { result = data; });
    return result ?? null;
  }
  subscribe(key: string, callback: (data: any) => void): () => void {
    this.root.get(key).on(callback);
    return () => this.root.get(key).off();
  }
  getStoredPair(): GunPair | null {
    return this.pair;
  }
  getGun(): FakeGunNode {
    return this.root;
  }
}

describe('WebDeviceSyncService (K7-adjacent WP5 wiring)', () => {
  let alicePair: GunPair;
  let bobPair: GunPair;
  let sharedRoot: FakeGunNode;
  let aliceGun: FakeGunStore;
  let bobGun: FakeGunStore;
  let alice: WebDeviceSyncService;
  let bob: WebDeviceSyncService;

  beforeAll(async () => {
    [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as GunPair[];
  });

  beforeEach(() => {
    // WebDeviceSyncCustodyStore/OutboxStore use the real global localStorage (not an injected
    // Storage) — alicePair/bobPair are fixed for the whole file, so their derived storage keys
    // are identical across tests; without clearing, a later test's "fresh" store silently
    // inherits an earlier test's persisted custody/outbox state.
    localStorage.clear();
    sharedRoot = new FakeGunNode();
    aliceGun = new FakeGunStore(alicePair, sharedRoot);
    bobGun = new FakeGunStore(bobPair, sharedRoot);
    alice = new WebDeviceSyncService(aliceGun as unknown as WebGunService);
    bob = new WebDeviceSyncService(bobGun as unknown as WebGunService);
  });

  it('starts inactive and moves to pending once this device enables sync', async () => {
    expect(alice.peerState(bobPair.pub)).toBe('inactive');
    await alice.enableSyncWithPeer(bobPair.pub);
    expect(alice.peerState(bobPair.pub)).toBe('pending');
  });

  /** Both sides' authorization-watch subscription fires the mutual-activation check
   * asynchronously (fire-and-forget off a Gun callback) — a couple of microtask flushes are
   * enough for `peerState()` to observe 'syncing' (set at the start of `activatePeer`, before any
   * network round trip), but delivery must be driven deterministically via explicit `tick()`
   * calls rather than raced against the same background chain's own real-time ack polling. */
  async function flushMicrotasks(): Promise<void> {
    // Real SEA/Node crypto callbacks cross macrotask boundaries, not just microtasks — a handful
    // of real setTimeout(0) yields reliably drains the background activation chain in a way a
    // pure Promise.resolve() microtask loop does not.
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it('activates mutual sync on both sides once each has enabled it for the other', async () => {
    await alice.enableSyncWithPeer(bobPair.pub);
    await bob.enableSyncWithPeer(alicePair.pub);
    await flushMicrotasks();

    expect(alice.peerState(bobPair.pub)).toBe('syncing');
    expect(bob.peerState(alicePair.pub)).toBe('syncing');
  });

  /** The snapshot-bootstrap race (which side's authorization/epub publish another device's
   * listener observes first is genuinely nondeterministic, same as it would be over real Gun) can
   * make a single tick's bootstrap attempt fail once before the retry succeeds — same as
   * production, where the periodic loop just tries again. Retrying here a bounded number of times
   * mirrors that, rather than asserting a specific number of ticks. */
  /**
   * SEA.pair() is random, so which of alice/bob actually sorts first (and is therefore the
   * snapshot-bootstrap initiator — see activatePeer's tie-break) varies run to run; ticking only
   * one side would silently no-op on roughly half of all runs. Ticking both is also exactly what
   * a real periodic sync loop does — every device ticks itself regardless of role. Generous retry
   * budget: under full-suite parallel load (many worker processes sharing the machine's CPU for
   * real SEA crypto + real setTimeout-based ack polling), convergence can legitimately need more
   * than a couple of rounds — same as production's periodic retry, just compressed here.
   */
  async function tickBothUntilConverged(): Promise<void> {
    for (let i = 0; i < 15; i += 1) {
      await alice.tick();
      await bob.tick();
    }
  }

  it('delivers a preferences change from one device to the other and applies it', async () => {
    const bobApplied: unknown[] = [];
    bob.setHandlers({
      onPreferencesApplied: (filters) => bobApplied.push(filters),
      onConflict: async () => null,
    });

    await alice.enableSyncWithPeer(bobPair.pub);
    await bob.enableSyncWithPeer(alicePair.pub);
    await flushMicrotasks();
    expect(alice.peerState(bobPair.pub)).toBe('syncing');
    expect(bob.peerState(alicePair.pub)).toBe('syncing');

    // Drive the outbox bootstrap (whichever side sorts first is the snapshot initiator) and the
    // resulting delta flush deterministically instead of racing the background activation chain.
    await tickBothUntilConverged();
    await alice.enqueuePreferencesChange(alicePair.pub, { maxDistanceKm: 42 } as any);
    await tickBothUntilConverged();

    expect(bobApplied).toContainEqual({ maxDistanceKm: 42 });
  });

  it('does not echo an incoming preferences change back to its origin', async () => {
    const aliceApplied: unknown[] = [];
    const bobApplied: unknown[] = [];
    alice.setHandlers({ onPreferencesApplied: (f) => aliceApplied.push(f), onConflict: async () => null });
    bob.setHandlers({ onPreferencesApplied: (f) => bobApplied.push(f), onConflict: async () => null });

    await alice.enableSyncWithPeer(bobPair.pub);
    await bob.enableSyncWithPeer(alicePair.pub);
    await flushMicrotasks();

    await tickBothUntilConverged();
    await alice.enqueuePreferencesChange(alicePair.pub, { maxDistanceKm: 7 } as any);
    await tickBothUntilConverged();

    expect(bobApplied).toContainEqual({ maxDistanceKm: 7 });
    // Bob's own reapply-from-custody path must not re-enqueue this back toward Alice.
    await bob.tick();
    expect(aliceApplied).toHaveLength(0);
  });
});
