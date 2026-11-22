/** Local read capabilities for the Gun network boundary. A peer cannot grant these by sending
 * a GET: only this device's chain API creates them. Local storage needs no capability. */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Interest = { path: string; descendants: boolean; expires: number; chain: any; callback: (...args: any[]) => any };

/**
 * Every Gun read on this device leaves an interest here (a `once` keeps a 30 s lease for late
 * replies), and every field of every incoming Gun message is checked against them. On a phone
 * that is hundreds of reads a second during an exchange, so both checks use indexes by path, and
 * expired leases leave from the front of an insertion-ordered queue. A scan of every lease per
 * read and per field kept a phone's node at 100 % CPU (five-phone starter tags, 2026-11-21).
 */
export class SharingInterests {
  private readonly entries = new Set<Interest>();
  /** Interests on exactly this path (any kind). */
  private readonly byPath = new Map<string, Set<Interest>>();
  /** Interests that accept this path's whole subtree (`.map()`). */
  private readonly subtreeByPath = new Map<string, number>();
  /** How many interests lie strictly below each path: an ancestor carries the link to them. */
  private readonly below = new Map<string, number>();
  /** One-time leases in the order they were taken; their expiry grows in the same order. */
  private readonly leases: Interest[] = [];
  private leaseHead = 0;
  constructor(private readonly now: () => number = Date.now) {}

  add(chain: any, callback: (...args: any[]) => any, once: boolean): () => void {
    const parts: string[] = [];
    let descendants = false;
    for (let at = chain?._; at && at !== at.root; at = at.back) {
      if (typeof at.get === 'string') parts.unshift(at.get);
      else descendants = true; // .map() adds a chain without a key
      if (at.soul) break;
    }
    const path = parts.join('/');
    if (!path) return () => {};
    this.prune();
    const entry: Interest = { path, descendants, expires: once ? this.now() + 30_000 : Infinity, chain, callback };
    this.insert(entry);
    if (once) this.leases.push(entry);
    return () => { this.remove(entry); };
  }

  cancelCallback(callback: (...args: any[]) => any): void {
    for (const entry of this.entries) if (entry.callback === callback) this.remove(entry);
  }

  cancelChain(chain: any): void {
    for (const entry of this.entries) {
      for (let at = entry.chain?._; at && at !== at.root; at = at.back) {
        if (at === chain?._) { this.remove(entry); break; }
      }
    }
  }

  /** Exact reads accept the requested record; maps accept their subtree. Ancestors carry only
   * the links needed to resolve the requested path, not siblings from a relay's bulk response. */
  acceptsField(soul: string, field: string): boolean {
    this.prune();
    if (this.byPath.has(soul)) return true;
    // A map's subtree: some interest with descendants on a path the soul lies under.
    for (let i = soul.indexOf('/'); i >= 0; i = soul.indexOf('/', i + 1)) {
      if (this.subtreeByPath.has(soul.slice(0, i))) return true;
    }
    // An ancestor: the field is the next step towards something asked for below it.
    if (field.includes('/')) return false;
    const child = `${soul}/${field}`;
    return this.byPath.has(child) || this.below.has(child);
  }

  private insert(entry: Interest): void {
    this.entries.add(entry);
    let same = this.byPath.get(entry.path);
    if (!same) this.byPath.set(entry.path, same = new Set());
    same.add(entry);
    if (entry.descendants) this.subtreeByPath.set(entry.path, (this.subtreeByPath.get(entry.path) ?? 0) + 1);
    for (let i = entry.path.indexOf('/'); i >= 0; i = entry.path.indexOf('/', i + 1)) {
      const prefix = entry.path.slice(0, i);
      this.below.set(prefix, (this.below.get(prefix) ?? 0) + 1);
    }
  }

  private remove(entry: Interest): void {
    if (!this.entries.delete(entry)) return;
    const same = this.byPath.get(entry.path);
    same?.delete(entry);
    if (same && !same.size) this.byPath.delete(entry.path);
    if (entry.descendants) decrement(this.subtreeByPath, entry.path);
    for (let i = entry.path.indexOf('/'); i >= 0; i = entry.path.indexOf('/', i + 1)) decrement(this.below, entry.path.slice(0, i));
  }

  private prune(): void {
    const now = this.now();
    while (this.leaseHead < this.leases.length && this.leases[this.leaseHead]!.expires <= now) {
      this.remove(this.leases[this.leaseHead]!);
      this.leaseHead += 1;
    }
    if (this.leaseHead > 1024 && this.leaseHead * 2 > this.leases.length) {
      this.leases.splice(0, this.leaseHead);
      this.leaseHead = 0;
    }
  }
}

function decrement(counts: Map<string, number>, key: string): void {
  const left = (counts.get(key) ?? 0) - 1;
  if (left > 0) counts.set(key, left);
  else counts.delete(key);
}

function interests(chain: any): SharingInterests | undefined {
  return chain?._?.root?.opt?.mesh?.sharingPolicy?.interests;
}

/** RPC subscriptions may be cancelled before their first event; then there is no Gun event.off
 * yet. Revoke the capability immediately rather than retaining it until data happens to arrive. */
export function cancelSharingRead(gun: any, callback: (...args: any[]) => any): void {
  interests(gun)?.cancelCallback(callback);
}

const installed = new WeakSet<object>();
export function installSharingInterests(Gun: any): void {
  if (installed.has(Gun) || !Gun?.chain) return;
  installed.add(Gun);
  const on = Gun.chain.on;
  Gun.chain.on = function (this: any, callback: any, ...args: any[]) {
    const policy = interests(this);
    if (!policy || typeof callback !== 'function') return on.call(this, callback, ...args);
    const release = policy.add(this, callback, false);
    const seen = new WeakSet<object>();
    const wrapped = function (this: any, data: any, key: any, msg: any, event: any) {
      if (event?.off && !seen.has(event)) {
        seen.add(event);
        const off = event.off;
        event.off = function (this: any, ...offArgs: any[]) { release(); return off.apply(this, offArgs); };
      }
      return callback.call(this, data, key, msg, event);
    };
    try { return on.call(this, wrapped, ...args); } catch (error) { release(); throw error; }
  };
  const once = Gun.chain.once;
  Gun.chain.once = function (this: any, callback: any, ...args: any[]) {
    const policy = interests(this);
    if (!policy || typeof callback !== 'function') return once.call(this, callback, ...args);
    const release = policy.add(this, callback, true);
    // Gun may call once with a cache miss before its network response. Keep a bounded lease
    // for late replies (and every child of map().once), so a retry can use the populated cache.
    const wrapped = function (this: any, ...values: any[]) { return callback.apply(this, values); };
    try { return once.call(this, wrapped, ...args); } catch (error) { release(); throw error; }
  };
  const off = Gun.chain.off;
  Gun.chain.off = function (this: any, ...args: any[]) {
    interests(this)?.cancelChain(this);
    return off.apply(this, args);
  };
}
