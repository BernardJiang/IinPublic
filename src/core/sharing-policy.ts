/** Device Gun wire boundary (OPEN-91 P2). Unknown namespaces are local by default.
 * Legacy protocols have explicit compatibility rules until their writers migrate to public/pair/room.
 * See docs/design/data-sharing-privacy-rules.md for the remaining audience/subscription work. */

import { SharingInterests, installSharingInterests } from './sharing-interests';

export const PRIVATE_NAMESPACES = ['local', 'pairs', 'deliveryJournal', 'device-local', 'nodes', 'edges'] as const;

/** Existing wire protocols, not permission for arbitrary new top-level data. Keep this inventory
 * explicit: a new writer must choose its audience before it can replicate. */
export const LEGACY_SHARED_NAMESPACES = [
  // Public profiles, discovery, reputation and Place presence.
  'users', 'user-public-profile', 'user-talk-filters', 'user-tags', 'user-tags-delta', 'tag-index',
  'chatrooms', 'block-pairs', 'reputation-friend-marks', 'network-root-techsupport', 'p2p-peer-bindings', 'connectivity-bindings',
  // Existing conversation/signaling envelopes. Their metadata still needs the P2 namespace migration.
  'conversations', 'conversation-wakeups', 'p2p-signal', 'pairTalkResponses',
  // Signed identity linking and encrypted handoff protocols.
  'identity-links', 'identity-link-revocations', 'identity-link-requests', 'identity-epub', 'handoff', 'handoff-ack',
  // Mutual device-sync authorization and encrypted exchange (already relayed over HTTP too).
  'device-sync-authorization', 'device-sync-epub', 'device-sync-envelope', 'device-sync-ack',
  // Existing signed operator records and support inbox.
  'techsupport-inbox', 'techsupport-faq', 'techsupport-faq-entries', 'techsupport-delegates',
  'techsupport-delegate-revocations', 'techsupport-delegate-requests', 'techsupport-delegate-invites',
  'techsupport-recovery', 'techsupport-recovery-history',
] as const;
const sharedRoots = new Set<string>(['public', 'pair', 'room', 'g', ...LEGACY_SHARED_NAMESPACES]);
const OWNER_PRIVATE_SOUL = /^users\/[^/]+\/private(?:\/|$)/;
const LEGACY_CONTACT_SOUL = /^users\/[^/]+\/knownPeople(?:\/|$)/;
const LEGACY_FULL_PROFILE_FIELD = /^user-public-profile\/[^/]+\/fullProfileJson$/;
// SEA signs these nodes but signing does not hide the owner's answer memory.
const SIGNED_PRIVATE_SOUL = /^~[^/]+\/(?:private|answers\/private)(?:\/|$)/;

export function soulLeavesDevice(soul: string): boolean {
  if (typeof soul !== 'string' || !soul || OWNER_PRIVATE_SOUL.test(soul)
    || LEGACY_CONTACT_SOUL.test(soul) || LEGACY_FULL_PROFILE_FIELD.test(soul)
    || SIGNED_PRIVATE_SOUL.test(soul)) return false;
  const first = soul.split('/')[0];
  return sharedRoots.has(first) || (first.startsWith('~') && first.length > 1);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SharingPolicyViolation = 'namespace' | 'query' | 'plaintext' | 'malformed' | 'unsolicited' | 'audience';
type Report = (reason: SharingPolicyViolation) => void;

/** Validate SEA's encrypted envelope, never confuse a SEA signature with ciphertext.
 * This is a format gate; only the recipient can authenticate/decrypt the ciphertext. */
export function isSeaCiphertext(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('SEA{')) return false;
  try {
    const parsed = JSON.parse(value.slice(3));
    const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    return Object.keys(parsed).sort().join(',') === 'ct,iv,s'
      && ['ct', 'iv', 's'].every((key) => typeof parsed[key] === 'string' && parsed[key].length > 0 && base64.test(parsed[key]))
      && parsed.ct.length >= 24 && parsed.iv.length >= 16 && parsed.s.length >= 12;
  } catch { return false; }
}

function linkSoul(value: any): string | undefined {
  if (value && typeof value === 'object' && typeof value['#'] === 'string') return value['#'];
  // SEA-signed links are serialized envelopes; filtering only object links leaks private paths.
  if (typeof value === 'string') {
    try {
      const signed = JSON.parse(value.startsWith('SEA{') ? value.slice(3) : value);
      if (typeof signed?.s === 'string' && signed?.m && typeof signed.m['#'] === 'string') return signed.m['#'];
      // Current Gun SEA packs signed graph fields as { ':': value, '~': signature }.
      if (typeof signed?.['~'] === 'string' && typeof signed?.[':']?.['#'] === 'string') return signed[':']['#'];
    } catch { /* scalar, not a signed link */ }
  }
  return undefined;
}

/** A changed payload must not reuse Gun's cached serialization/hash. Preserve routing metadata
 * (especially via), so a filtered remote message is not reflected back to its sender. */
function changedMessage(msg: any, changes: any): any {
  const { _: oldMeta, '##': _hash, ...rest } = msg;
  const fresh = { ...rest, ...changes };
  if (oldMeta) {
    const { raw: _raw, $put: _put, ...routing } = oldMeta;
    if (Object.keys(routing).length) fresh._ = Object.assign(function () { /* Gun metadata */ }, routing);
  }
  return fresh;
}

function allowedRead(get: any): boolean {
  // No wildcard/range query may evade the namespace rule. Current app reads use exact souls.
  const soul = get?.['#'];
  if (typeof soul !== 'string' || !soulLeavesDevice(soul)) return false;
  const field = get['.'];
  return typeof field !== 'string' || soulLeavesDevice(`${soul}/${field}`);
}

function encryptedNode(soul: string, node: any): boolean {
  const parts = soul.split('/');
  // Device graph souls (spec §31.9): every value is ciphertext, and nothing links anywhere.
  if (parts[0] === 'g') return Object.entries(node).every(([key, value]) => key === '_' || value === null || isSeaCiphertext(value));
  if (parts[0] !== 'pair' && parts[0] !== 'room') return true;
  return Object.entries(node).every(([key, value]) => {
    if (key === '_') return true;
    if (value === null) return true; // deletion
    const target = linkSoul(value);
    // Index links stay under this exact audience; no links to public or another pair/room.
    if (target) return target.startsWith(`${soul}/`);
    return parts.length >= 2 && !!parts[1] && isSeaCiphertext(value);
  });
}

/** Same namespace/content rules apply in both directions. On input this runs at mesh.hear.one,
 * before Gun's universe handler can merge a remote put or answer a remote private get. Local
 * storage reads/writes never traverse that boundary and remain available. */
export function filterOutgoingGunMessage(msg: any, report?: Report): any | null {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { report?.('malformed'); return null; }
  if (msg.ok !== undefined && msg.ok !== null && typeof msg.ok !== 'number' && typeof msg.ok !== 'boolean'
    && !(typeof msg.ok === 'object' && Object.keys(msg.ok).every((key) => typeof msg.ok[key] === 'number'))) {
    msg = changedMessage(msg, { ok: 1 });
  }
  if (msg.get && !allowedRead(msg.get)) { report?.('query'); return null; }
  if (msg.put !== undefined) {
    if (!msg.put || typeof msg.put !== 'object' || Array.isArray(msg.put)) { report?.('malformed'); return null; }
    let changed = false;
    const put: Record<string, any> = Object.create(null);
    for (const [soul, raw] of Object.entries<any>(msg.put)) {
      if (!soulLeavesDevice(soul)) { changed = true; report?.('namespace'); continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw._?.['#'] !== undefined && raw._['#'] !== soul)) {
        changed = true; report?.('malformed'); continue;
      }
      if (!encryptedNode(soul, raw)) { changed = true; report?.('plaintext'); continue; }
      const hidden = Object.keys(raw).filter((key) => key !== '_'
        && (!soulLeavesDevice(`${soul}/${key}`) || (linkSoul(raw[key]) !== undefined && !soulLeavesDevice(linkSoul(raw[key])!))));
      let node = raw;
      if (hidden.length) {
        changed = true;
        report?.('namespace');
        node = { ...raw };
        for (const key of hidden) delete node[key];
        if (node._?.['>']) {
          const state = { ...node._['>'] };
          for (const key of hidden) delete state[key];
          node._ = { ...node._, '>': state };
        }
      }
      put[soul] = node;
    }
    if (!Object.keys(put).length) return null;
    return changed ? changedMessage(msg, { put }) : msg;
  }
  return msg;
}

const transientSignalSoul = (soul: string): boolean =>
  soul === 'p2p-signal' || soul.startsWith('p2p-signal/');

/**
 * A Wi-Fi Direct group owner is also the only Gun rendezvous between its clients. In that one
 * role, a signaling write for client B is deliberately unsolicited from the owner's point of
 * view: the owner has no WebRTC session for that pair, but must still relay the transient record
 * to B's subscription. Ordinary device nodes keep the strict local-interest rule.
 */
export function filterIncomingGunMessage(
  msg: any,
  report?: Report,
  interests?: SharingInterests,
  relayTransientSignals = false,
): any | null {
  const allowed = filterOutgoingGunMessage(msg, report);
  if (!allowed?.put || !interests) return allowed;
  const put: Record<string, any> = Object.create(null);
  let changed = false;
  for (const [soul, node] of Object.entries<any>(allowed.put)) {
    const keys = Object.keys(node).filter((key) => key !== '_');
    const kept = relayTransientSignals && transientSignalSoul(soul)
      ? keys
      : keys.filter((key) => interests.acceptsField(soul, key));
    if (kept.length === keys.length && keys.length) { put[soul] = node; continue; }
    changed = true;
    report?.('unsolicited');
    if (!kept.length) continue;
    put[soul] = Object.fromEntries(kept.map((key) => [key, node[key]]));
    if (node._) put[soul]._ = { ...node._, '>': Object.fromEntries(kept.map((key) => [key, node._['>']?.[key]])) };
  }
  return !Object.keys(put).length ? null : changed ? changedMessage(allowed, { put }) : allowed;
}

const restrictedAudience = (soul: unknown): boolean => typeof soul === 'string' && /^(?:pair|room)(?:\/|$)/.test(soul);

/** Until a direct Gun peer has an authenticated audience binding, pair/room traffic uses only
 * explicitly configured relays. Discovering a LAN peer or receiving its GET grants no access.
 * Public records cannot smuggle pair/room paths through object or signed links either. */
export function filterPeerAudience(msg: any, relay: boolean, report?: Report): any | null {
  if (relay) return msg;
  if (restrictedAudience(msg.get?.['#'])) { report?.('audience'); return null; }
  if (!msg.put) return msg;
  let changed = false;
  const put: Record<string, any> = Object.create(null);
  for (const [soul, raw] of Object.entries<any>(msg.put)) {
    if (restrictedAudience(soul)) { changed = true; report?.('audience'); continue; }
    const hidden = Object.keys(raw).filter((key) => key !== '_' && restrictedAudience(linkSoul(raw[key])));
    if (!hidden.length) { put[soul] = raw; continue; }
    changed = true;
    report?.('audience');
    const node = { ...raw };
    for (const key of hidden) delete node[key];
    if (node._?.['>']) {
      const state = { ...node._['>'] };
      for (const key of hidden) delete state[key];
      node._ = { ...node._, '>': state };
    }
    if (Object.keys(node).some((key) => key !== '_')) put[soul] = node;
  }
  return !Object.keys(put).length ? null : changed ? changedMessage(msg, { put }) : msg;
}

/** Who may receive or send which graph soul (`src/core/device-graph/sync/audience.ts`). */
export type GraphAudiencePolicy = {
  mayReceive(peerUserId: string, soul: string): boolean;
  mayAccept(peerUserId: string, soul: string): boolean;
};

const isGraph = (soul: unknown): boolean => typeof soul === 'string' && (soul === 'g' || soul.startsWith('g/'));

function withoutSouls(msg: any, put: Record<string, any>, removed: boolean): any | null {
  if (!removed) return msg;
  return Object.keys(put).length ? changedMessage(msg, { put }) : null;
}

/**
 * The device graph's audience rule (REQ-GRAPH-32): graph souls (`g/…`) never go to or come from a
 * relay or any peer but a direct graph link, and a graph link carries graph souls only, each to or
 * from the one person allowed. `outgoing` is what I send to `peer`; otherwise what I heard from it.
 */
export function filterGraphAudience(msg: any, peer: any, outgoing: boolean, audience: GraphAudiencePolicy | undefined, report?: Report): any | null {
  const graphPeer: string | undefined = typeof peer?.graphUserId === 'string' ? peer.graphUserId : undefined;
  if (!graphPeer) {
    if (isGraph(msg.get?.['#'])) { report?.('audience'); return null; }
    if (!msg.put) return msg;
    const put: Record<string, any> = Object.create(null);
    let removed = false;
    for (const [soul, node] of Object.entries<any>(msg.put)) {
      if (isGraph(soul)) { removed = true; report?.('audience'); } else put[soul] = node;
    }
    return withoutSouls(msg, put, removed);
  }
  // A graph link: acknowledgements pass; anything else must be a graph soul for this person.
  if (!msg.get && !msg.put) return msg;
  if (msg.get) {
    const soul = msg.get['#'];
    // Outgoing: I ask only for their souls. Incoming: they ask only for mine granted to them.
    const ok = typeof soul === 'string' && !!audience && (outgoing ? audience.mayAccept(graphPeer, soul) : audience.mayReceive(graphPeer, soul));
    if (!ok) { report?.('audience'); return null; }
    return msg;
  }
  const put: Record<string, any> = Object.create(null);
  let removed = false;
  for (const [soul, node] of Object.entries<any>(msg.put)) {
    // Outgoing puts are only my granted souls; incoming only theirs (nobody writes into my part).
    const ok = isGraph(soul) && (outgoing ? !!audience?.mayReceive(graphPeer, soul) : !!audience?.mayAccept(graphPeer, soul));
    if (ok) put[soul] = node; else { removed = true; report?.('audience'); }
  }
  return withoutSouls(msg, put, removed);
}

/** Counters contain no souls, identities or payloads. */
export function guardMeshSay(mesh: any, root?: any): void {
  if (!mesh || typeof mesh.say !== 'function' || mesh.sharingPolicy) return;
  const violations: Record<SharingPolicyViolation, number> = { namespace: 0, query: 0, plaintext: 0, malformed: 0, unsolicited: 0, audience: 0 };
  const report: Report = (reason) => { violations[reason]++; };
  const interests = new SharingInterests();
  const say = mesh.say;
  mesh.say = function (this: any, msg: any, peer: any) {
    let allowed = filterOutgoingGunMessage(msg, report);
    if (!allowed) return false;
    // Gun resolves reply destinations inside say, bypassing its public per-peer recursion.
    // Resolve the same local routing entry first so cached replies cannot skip this gate.
    if (!peer && allowed['@']) {
      const route = root?.dup?.s?.[allowed['@']];
      peer = route?.via || route?.it?._?.via || (mesh.last?.['#'] === allowed['@'] ? mesh.leap : undefined);
      if (!peer) allowed = filterPeerAudience(allowed, false, report);
      if (!peer && allowed) allowed = filterGraphAudience(allowed, undefined, true, root?.opt?.graphAudience, report);
    }
    // A broadcast (no peer) comes back through here once per peer; filter each of those.
    if (allowed && peer) allowed = filterGraphAudience(allowed, peer, true, root?.opt?.graphAudience, report);
    if (allowed && peer?.id && !peer.graphUserId) {
      const url = peer.url;
      const relay = typeof url === 'string' && Array.isArray(root?.opt?.sharingRelayPeers)
        && root.opt.sharingRelayPeers.includes(url) && root.opt.peers?.[url] === peer;
      allowed = filterPeerAudience(allowed, relay, report);
    }
    // Broadcasts recurse through mesh.say once for each concrete peer, after serialization.
    return allowed ? say.call(this, allowed, peer) : false;
  };
  // An ordinary root.on('in') hook is too late: Gun registers universe before create hooks.
  // All socket messages, including batched frames, pass through this parsed-message boundary.
  if (typeof mesh.hear?.one === 'function') {
    const hear = mesh.hear.one;
    mesh.hear.one = function (this: any, msg: any, peer: any, ...rest: any[]) {
      const audienceChecked = msg && typeof msg === 'object' ? filterGraphAudience(msg, peer, false, root?.opt?.graphAudience, report) : msg;
      if (!audienceChecked) return;
      const allowed = filterIncomingGunMessage(
        audienceChecked,
        report,
        interests,
        root?.opt?.relayTransientSignals === true,
      );
      if (allowed) return hear.call(this, allowed, peer, ...rest);
    };
  }
  mesh.sharingPolicy = { violations, interests };
}

let installed = false;
export function installSharingPolicy(Gun: any): void {
  if (installed || !Gun?.on) return;
  installed = true;
  installSharingInterests(Gun);
  Gun.on('create', function (this: any, root: any) {
    root.on('out', function (this: any, msg: any) {
      const allowed = filterOutgoingGunMessage(msg, (reason) => {
        const counts = root.opt?.mesh?.sharingPolicy?.violations;
        if (counts) counts[reason]++;
      });
      if (allowed) this.to.next(allowed);
    });
    this.to.next(root);
    guardMeshSay(root.opt?.mesh, root);
  });
}
