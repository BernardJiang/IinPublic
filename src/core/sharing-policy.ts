/**
 * The device's sharing policy (OPEN-91 P2, docs/design/data-sharing-privacy-rules.md): which Gun
 * souls may leave the device. Installed as an `out` hook on every Gun instance the page creates, so
 * a private node is never sent to — or asked of — the hub, whatever code path writes it.
 *
 * Until every shared node lives under `pair/`, `room/` or `public/`, the rule is a list of private
 * namespaces rather than the design's default deny; each move into the core adds its namespace here.
 */

/** Namespaces that never leave the device. `pairs/` and `deliveryJournal/` are the old page-Gun homes
 *  of the sender's delivery records (now `local/` in the core); listed so an old code path cannot leak. */
export const PRIVATE_NAMESPACES = ['local', 'pairs', 'deliveryJournal'] as const;

export function soulLeavesDevice(soul: string): boolean {
  const first = String(soul).split('/')[0];
  return !(PRIVATE_NAMESPACES as readonly string[]).includes(first);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The part of an outgoing Gun message the policy allows, or null to drop it. A `put` keeps only its
 * shareable nodes; a `get` for a private soul is dropped (asking reveals interest).
 */
export function filterOutgoingGunMessage(msg: any): any | null {
  if (!msg || typeof msg !== 'object') return msg;
  if (msg.get && typeof msg.get['#'] === 'string' && !soulLeavesDevice(msg.get['#'])) return null;
  if (msg.put && typeof msg.put === 'object') {
    const souls = Object.keys(msg.put);
    const kept = souls.filter(soulLeavesDevice);
    if (kept.length === souls.length) return msg;
    if (kept.length === 0) return null;
    return { ...msg, put: Object.fromEntries(kept.map((soul) => [soul, msg.put[soul]])) };
  }
  return msg;
}

let installed = false;

/**
 * Registers the policy on Gun's `create` hook: global create hooks run before an instance's own, so
 * this `out` handler sits ahead of the mesh's `say` and sees every message before it is sent. Local
 * writes and reads are unaffected — Gun stores and answers them before the `out` chain reaches here.
 */
export function installSharingPolicy(Gun: any): void {
  if (installed || !Gun?.on) return;
  installed = true;
  Gun.on('create', function (this: any, root: any) {
    // Registered before passing `root` on, so it precedes every handler a later create hook adds.
    root.on('out', function (this: any, msg: any) {
      const allowed = filterOutgoingGunMessage(msg);
      if (allowed) this.to.next(allowed);
    });
    this.to.next(root);
  });
}
