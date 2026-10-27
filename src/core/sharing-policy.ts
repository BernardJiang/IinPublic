/**
 * The device's sharing policy (OPEN-91 P2, docs/design/data-sharing-privacy-rules.md): which Gun
 * souls may leave the device. Installed as an `out` hook on every Gun instance the page creates, so
 * a private node is never sent to — or asked of — the hub, whatever code path writes it.
 *
 * Until every shared node lives under `pair/`, `room/` or `public/`, the rule is a list of private
 * namespaces rather than the design's default deny; each move into the core adds its namespace here.
 */

/** Namespaces that never leave the device. `pairs/` and `deliveryJournal/` are the old page-Gun homes
 *  of the sender's delivery records (now `local/` in the core); listed so an old code path cannot leak.
 *  `device-local/`, `nodes/` and `edges/` were the worker's own while it ran peerless (OPEN-91 P6:
 *  the web worker's Gun is now the page's and peers with the hub). */
export const PRIVATE_NAMESPACES = ['local', 'pairs', 'deliveryJournal', 'device-local', 'nodes', 'edges'] as const;

/** The owner's encrypted records in the worker: `users/<pub>/private/…`. */
const OWNER_PRIVATE_SOUL = /^users\/[^/]+\/private(\/|$)/;

export function soulLeavesDevice(soul: string): boolean {
  const text = String(soul);
  const first = text.split('/')[0];
  if ((PRIVATE_NAMESPACES as readonly string[]).includes(first)) return false;
  return !OWNER_PRIVATE_SOUL.test(text);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The part of an outgoing Gun message the policy allows, or null to drop it. A `put` keeps only its
 * shareable nodes; a `get` for a private soul is dropped (asking reveals interest); an ack keeps
 * only its status.
 */
export function filterOutgoingGunMessage(msg: any): any | null {
  if (!msg || typeof msg !== 'object') return msg;
  // An ack says whether a write landed; a storage adapter that answers with its data (a whole
  // radisk file, private records included) must not send that along.
  if (msg.ok !== undefined && msg.ok !== null && typeof msg.ok !== 'number' && typeof msg.ok !== 'boolean'
    && !(typeof msg.ok === 'object' && Object.keys(msg.ok).every((key) => typeof msg.ok[key] === 'number'))) {
    msg = { ...msg, ok: 1 };
  }
  if (msg.get && typeof msg.get['#'] === 'string' && !soulLeavesDevice(msg.get['#'])) return null;
  if (msg.put && typeof msg.put === 'object') {
    const souls = Object.keys(msg.put);
    const kept = souls.filter(soulLeavesDevice);
    if (kept.length === 0) return null;
    let changed = kept.length !== souls.length;
    const put: Record<string, any> = {};
    for (const soul of kept) {
      const node = withoutPrivateLinks(msg.put[soul]);
      if (node !== msg.put[soul]) changed = true;
      put[soul] = node;
    }
    return changed ? { ...msg, put } : msg;
  }
  return msg;
}

/** A shared node without its links to private nodes: a link alone tells the hub a private record exists. */
function withoutPrivateLinks(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const hidden = Object.keys(node).filter((key) => key !== '_' && node[key] && typeof node[key] === 'object'
    && typeof node[key]['#'] === 'string' && !soulLeavesDevice(node[key]['#']));
  if (hidden.length === 0) return node;
  const copy = { ...node };
  for (const key of hidden) delete copy[key];
  if (copy._ && typeof copy._ === 'object' && copy._['>'] && typeof copy._['>'] === 'object') {
    const state = { ...copy._['>'] };
    for (const key of hidden) delete state[key];
    copy._ = { ...copy._, '>': state };
  }
  return copy;
}

let installed = false;

/**
 * The policy on the mesh's `say`, the last step before a socket: Gun also sends there directly,
 * outside the `out` chain — on reconnect it re-asks a peer for every soul it is subscribed to, the
 * device's private ones included (gun.js `root.on('hi')`). A message the policy changed is sent as a
 * new one: the original's cached wire text (`_.raw`) would carry what was removed.
 */
export function guardMeshSay(mesh: any): void {
  if (!mesh || typeof mesh.say !== 'function' || mesh.sharingPolicy) return;
  const say = mesh.say;
  mesh.say = function (this: any, msg: any, peer: any) {
    const allowed = filterOutgoingGunMessage(msg);
    if (!allowed) return false;
    if (allowed === msg) return say.call(this, msg, peer);
    const { _: _meta, ...fresh } = allowed;
    return say.call(this, fresh, peer);
  };
  mesh.sharingPolicy = true;
}

/**
 * Registers the policy on Gun's `create` hook: global create hooks run before an instance's own, so
 * this `out` handler sits ahead of the mesh's `say` and sees every message before it is sent; the
 * mesh's `say` itself is guarded too (`guardMeshSay`). Local writes and reads are unaffected — Gun
 * stores and answers them before the `out` chain reaches here.
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
    // The mesh is made by Gun's 'opt' hook, which has run by now (a peer added later reuses it).
    guardMeshSay(root.opt?.mesh);
  });
}
