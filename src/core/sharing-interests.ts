/** Local read capabilities for the Gun network boundary. A peer cannot grant these by sending
 * a GET: only this device's chain API creates them. Local storage needs no capability. */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Interest = { path: string; descendants: boolean; expires: number; chain: any; callback: (...args: any[]) => any };
export class SharingInterests {
  private readonly entries = new Set<Interest>();
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
    const entry = { path, descendants, expires: once ? this.now() + 30_000 : Infinity, chain, callback };
    this.entries.add(entry);
    return () => { this.entries.delete(entry); };
  }

  cancelCallback(callback: (...args: any[]) => any): void {
    for (const entry of this.entries) if (entry.callback === callback) this.entries.delete(entry);
  }

  cancelChain(chain: any): void {
    for (const entry of this.entries) {
      for (let at = entry.chain?._; at && at !== at.root; at = at.back) {
        if (at === chain?._) { this.entries.delete(entry); break; }
      }
    }
  }

  /** Exact reads accept the requested record; maps accept their subtree. Ancestors carry only
   * the links needed to resolve the requested path, not siblings from a relay's bulk response. */
  acceptsField(soul: string, field: string): boolean {
    this.prune();
    for (const entry of this.entries) {
      if (entry.path === soul || (entry.descendants && soul.startsWith(`${entry.path}/`))) return true;
      if (entry.path.startsWith(`${soul}/`) && entry.path.slice(soul.length + 1).split('/')[0] === field) return true;
    }
    return false;
  }

  private prune(): void {
    const now = this.now();
    for (const entry of this.entries) if (entry.expires <= now) this.entries.delete(entry);
  }
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
