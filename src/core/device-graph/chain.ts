/**
 * My device event chain (spec REQ-GRAPH-40): every event I write carries a `seq`, the hash of the
 * event before it (`prev`) and my signature over the rest (`sig`), and `ix/head` always names the
 * latest. The chain makes a tampered or dropped local event detectable (`verifyChain`, REQ-GRAPH-41)
 * and gives sync a total order of what I wrote.
 */
import { canonicalJson } from './keys';
import { portableSha256Hex } from '../../shared/portable-sha256';
import { linkSoul, type GraphNode, type NodeStore } from './node-store';
import type { graphSouls } from './talk-structure';

type Souls = ReturnType<typeof graphSouls>;

/** Who signs my chain: the host installs this at `graph.identity`. */
export type EventChainSigner = { sign(message: string): Promise<string>; pub: string };

export const chainHeadSoul = (souls: Souls) => souls.index('head');

/**
 * A signed checkpoint (REQ-GRAPH-46): before old events are trimmed away, the device signs
 * `{ seq, hash, when, counts }` for the chain head, chained to the checkpoint before it. The
 * removed prefix is summarized by this signed record, not lost silently.
 *
 * ADVERSARIAL TRUST BOUNDARY (what verification does and does not prove): the model assumes the
 * device's own signing key is safe and the store is tampered by someone WITHOUT it. Within that
 * model: a checkpoint cannot be forged (signature) or altered (sig + the prevCp walk); tampering
 * a still-stored post-checkpoint event is always caught; rolling ix/cp + ix/head back to an older
 * checkpoint is caught while post-checkpoint events remain in the day index (the head check).
 * Outside that model, by design: tampering with the TRIMMED prefix is accepted-undetectable —
 * that is what "summarized, not lost silently" means; and an attacker who can rewrite the day
 * index can censor post-checkpoint events so a rolled-back state verifies (any local hash chain
 * without an external witness shares this limit — the pair log's signed acks are the cross-check
 * against a second device).
 */
export type ChainCheckpoint = {
  seq: number; hash: string; when: number;
  counts: { events: number; days: number };
  prevCp?: { seq: number; hash: string };
  sig: string;
};

/** The store prefix every chain soul shares (derived the same way `chainHeadSoul` derives its). */
const chainPrefix = (souls: Souls) => souls.index('').replace(/ix\/$/, '');

/** A checkpoint node: `cp/<seq>` under the store prefix (not an index entry). */
export const checkpointSoul = (souls: Souls, seq: number) => `${chainPrefix(souls)}cp/${seq}`;

/** `ix/cp` names the newest checkpoint as `{ seq, hash }`, mirroring `ix/head`. */
export const checkpointIndexSoul = (souls: Souls) => souls.index('cp');

/** An event's hash: SHA-256 of its canonical JSON including `sig` (REQ-GRAPH-40). */
export const eventHash = (event: GraphNode): string => portableSha256Hex(canonicalJson(event));

/** The signed part: canonical fields with `sig` excluded. */
export const signedEventPart = (event: GraphNode): string =>
  canonicalJson(Object.fromEntries(Object.entries(event).filter(([k]) => k !== 'sig')));

// One in-flight chain append per store: the head read-modify-write must not interleave.
const locks = new WeakMap<NodeStore, Promise<void>>();
export function serialized<T>(store: NodeStore, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(store) ?? Promise.resolve()).then(fn);
  locks.set(store, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * Chain an event I write: fill seq/prev/sig from `ix/head` and advance the head, all under the
 * store lock. An event carrying `by` is the author's record I hold locally (a received Talk
 * version, a copied deletion, an answer to my Talk) — never chained by me; once the author
 * chains it, it arrives with their own seq and signature. An event that already carries a
 * numeric `seq` came from my other device — stored unchanged. Neither moves my head.
 * A corrupt head (non-finite or non-integer seq) throws rather than minting a bad event on top.
 * Crash window: a crash between the event put and the head put leaves the head one behind; that
 * is DETECTED by verifyChain ('gap'/'head'), not prevented.
 * `opts.ownBy` asserts the event's `by` is THIS device (my chat message, OPEN-110: the sender's
 * original carries `by` per §31.5 yet is written and chained here, never copied from a peer).
 */
export async function chainAndPut(store: NodeStore, souls: Souls, signer: EventChainSigner, event: GraphNode, put: (chained: GraphNode) => Promise<void>, opts?: { ownBy?: boolean }): Promise<void> {
  if (typeof event.seq === 'number' || (linkSoul(event.by) && !opts?.ownBy)) { await put(event); return; }
  await serialized(store, async () => {
    const head = await store.get(chainHeadSoul(souls));
    if (head != null && !(Number.isSafeInteger(head.seq) && Number(head.seq) >= 0))
      throw new Error('corrupt chain head');
    const seq = head == null ? 0 : Number(head.seq) + 1;
    const prev = typeof head?.hash === 'string' ? head.hash : '';
    const unsigned = { ...event, seq, prev };
    const chained = { ...unsigned, sig: await signer.sign(signedEventPart(unsigned)) };
    await put(chained);
    await store.put(chainHeadSoul(souls), { seq, hash: eventHash(chained) });
  });
}

/**
 * Write a signed checkpoint at the current chain head (REQ-GRAPH-46), under the same store lock as
 * `chainAndPut` so no event can be chained between the head read and the checkpoint write. The
 * checkpoint signs `{ seq, hash, when, counts }` and chains to the previous checkpoint (`prevCp`),
 * so a whole removed prefix is summarized by a signed record instead of being lost silently.
 * Throws 'no chain head' when nothing was ever chained, and 'checkpoint already at head' when the
 * newest checkpoint already covers the head — checkpoints only ever move forward.
 */
export async function writeCheckpoint(
  store: NodeStore,
  souls: Souls,
  signer: EventChainSigner,
  opts?: { now?: () => number; counts?: { events: number; days: number } },
): Promise<ChainCheckpoint> {
  return serialized(store, async () => {
    const head = await store.get(chainHeadSoul(souls));
    if (head == null || !Number.isSafeInteger(Number(head.seq)) || Number(head.seq) < 0)
      throw new Error('no chain head');
    const prevCp = await store.get(checkpointIndexSoul(souls));
    if (prevCp != null && Number(prevCp.seq) === Number(head.seq))
      throw new Error('checkpoint already at head');
    const unsigned = {
      seq: Number(head.seq), hash: String(head.hash), when: (opts?.now ?? Date.now)(),
      counts: opts?.counts ?? { events: Number(head.seq) + 1, days: 0 },
      // prevCp links by the checkpoint's own hash (as ix/cp recorded it), chaining checkpoints.
      ...(prevCp != null ? { prevCp: { seq: Number(prevCp.seq), hash: String(prevCp.hash) } } : {}),
    };
    const cp: ChainCheckpoint = { ...unsigned, sig: await signer.sign(canonicalJson(unsigned)) };
    await store.put(checkpointSoul(souls, cp.seq), cp as unknown as GraphNode);
    await store.put(checkpointIndexSoul(souls), { seq: cp.seq, hash: eventHash(cp as unknown as GraphNode) });
    return cp;
  });
}

export type ChainVerification = { checked: number; ok: boolean; firstBadSeq?: number;
  reason?: 'gap' | 'prev' | 'sig' | 'head' | 'cp';
  /** The first seq verified this walk: cp.seq + 1 with a checkpoint, 0 without (REQ-GRAPH-46). */
  fromSeq: number };

/**
 * Verify my chain (REQ-GRAPH-41 walk; checkpoint-scoped per REQ-GRAPH-46). Reads every event
 * via readEvents (the day index), keeps mine (numeric seq, my deviceId), sorts by seq and checks
 * contiguity, each prev, each signature, and the head. First bad seq reported; never rewrites.
 * Assumes one chain per store+prefix: events are deviceId-keyed, and two DeviceGraph instances over
 * the same store+prefix interleave on a single head.
 *
 * Checkpoint scoping (REQ-GRAPH-46, OPEN-109): when `ix/cp` names a checkpoint, its signature is
 * verified first (reason 'cp' on any break), the checkpoint chain is followed back over `prevCp`
 * links while the older `cp/<seq>` nodes still exist (they may eventually be trimmed — stopping
 * there is fine), and the event at `cp.seq` is hash-checked only if it is still stored. Events with
 * `seq <= cp.seq` are then summarized by the signed checkpoint rather than re-verified, so the walk
 * covers only `seq > cp.seq`, expecting the first one's `prev` to be the checkpoint hash. `checked`
 * counts post-checkpoint events and `fromSeq` reports where the walk started.
 *
 * Portable (REQ-GRAPH-41 "a phone and a browser verify the same chain"): hashing and signing run
 * on `portableSha256Hex`/`portable-ecdsa` — pure JS, no Node natives, no ICU — and `canonicalJson`
 * orders keys with code-unit `<`/`>`, never `localeCompare`, so every platform hashes the same
 * chain to the same bytes.
 */
export async function verifyChain(
  store: NodeStore,
  souls: Souls,
  crypto: { verify(signature: string, message: string, pub: string): Promise<boolean> },
  me: { pub: string; deviceId: string },
  readEvents: () => Promise<Array<{ id: string; event: GraphNode }>>,
): Promise<ChainVerification> {
  const cpBreak = (seq: number, fromSeq: number, checked = 0): ChainVerification =>
    ({ checked, ok: false, firstBadSeq: seq, reason: 'cp', fromSeq });

  // A checkpoint's `counts`/`prevCp` are nested objects; a Gun-backed store holds each as a
  // sub-node link. Resolve that one level so the checkpoint hashes and verifies as the nested
  // record that was signed (an in-memory store holds the object itself: nothing to resolve).
  const readCheckpoint = async (soul: string): Promise<GraphNode | null> => {
    const node = await store.get(soul);
    if (!node) return null;
    const out: GraphNode = { ...node };
    for (const field of ['counts', 'prevCp'] as const) {
      const sub = linkSoul(node[field]);
      if (sub) {
        const resolved = await store.get(sub);
        if (resolved) out[field] = resolved as unknown as GraphNode[string];
      }
    }
    return out;
  };

  // Checkpoint scoping: trust the newest signed checkpoint for everything at or below its seq.
  let cp: GraphNode | null = null;
  let fromSeq = 0;
  const cpIndex = await store.get(checkpointIndexSoul(souls));
  if (cpIndex != null) {
    const cpSeq = Number(cpIndex.seq);
    cp = await readCheckpoint(checkpointSoul(souls, cpSeq));
    if (cp == null) return cpBreak(cpSeq, 0);
    if (typeof cp.sig !== 'string' || !(await crypto.verify(cp.sig, signedEventPart(cp), me.pub)))
      return cpBreak(cpSeq, 0);
    // Follow the checkpoint chain back: each prevCp must name an existing, correctly signed,
    // correctly hashed older checkpoint; a missing older checkpoint just ends the walk back.
    let link = cp.prevCp as { seq?: unknown; hash?: unknown } | undefined;
    while (link && typeof link.seq === 'number' && typeof link.hash === 'string') {
      const older = await readCheckpoint(checkpointSoul(souls, link.seq));
      if (older == null) break; // older checkpoints may eventually be trimmed — stop there
      if (typeof older.sig !== 'string' || !(await crypto.verify(older.sig, signedEventPart(older), me.pub)))
        return cpBreak(link.seq, 0);
      if (eventHash(older) !== link.hash) return cpBreak(link.seq, 0);
      link = older.prevCp as { seq?: unknown; hash?: unknown } | undefined;
    }
    fromSeq = cpSeq + 1;
  }

  const mine = (await readEvents())
    .filter(({ event }) => typeof event.seq === 'number' && event.device === me.deviceId)
    .sort((a, b) => Number(a.event.seq) - Number(b.event.seq));

  let prevHash = '';
  let tail: Array<{ id: string; event: GraphNode }> = mine;
  if (cp != null) {
    const cpSeq = Number(cp.seq);
    // The checkpoint hash must still match the event it summarizes, if that event is stored.
    const cpEvent = mine.find(({ event }) => Number(event.seq) === cpSeq);
    if (cpEvent && eventHash(cpEvent.event) !== String(cp.hash)) return cpBreak(cpSeq, fromSeq);
    tail = mine.filter(({ event }) => Number(event.seq) > cpSeq);
    prevHash = String(cp.hash);
  }
  for (let i = 0; i < tail.length; i++) {
    const { event } = tail[i]!;
    const seq = Number(event.seq);
    const expect = fromSeq + i;
    if (seq !== expect) return { checked: i, ok: false, firstBadSeq: expect, reason: 'gap', fromSeq };
    if (String(event.prev ?? '') !== prevHash) return { checked: i, ok: false, firstBadSeq: seq, reason: 'prev', fromSeq };
    if (typeof event.sig !== 'string' || !(await crypto.verify(event.sig, signedEventPart(event), me.pub)))
      return { checked: i, ok: false, firstBadSeq: seq, reason: 'sig', fromSeq };
    prevHash = eventHash(event);
  }
  const head = await store.get(chainHeadSoul(souls));
  if (tail.length === 0) {
    if (cp != null) {
      // Everything trimmed up to the checkpoint: the head must rest on it.
      if (Number(head?.seq) !== Number(cp.seq) || String(head?.hash) !== String(cp.hash))
        return { checked: 0, ok: false, firstBadSeq: Number(cp.seq), reason: 'head', fromSeq };
      return { checked: 0, ok: true, fromSeq };
    }
    // All my events stripped (or the day index wiped) must not pass while the head still names a seq.
    if (head != null && Number.isFinite(Number(head.seq)) && Number(head.seq) >= 0)
      return { checked: 0, ok: false, firstBadSeq: 0, reason: 'head', fromSeq };
    return { checked: 0, ok: true, fromSeq };
  }
  const lastSeq = fromSeq + tail.length - 1;
  if (Number(head?.seq) !== lastSeq || String(head?.hash) !== prevHash)
    return { checked: tail.length, ok: false, firstBadSeq: lastSeq, reason: 'head', fromSeq };
  return { checked: tail.length, ok: true, fromSeq };
}
