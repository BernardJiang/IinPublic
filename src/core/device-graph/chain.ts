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
 */
export async function chainAndPut(store: NodeStore, souls: Souls, signer: EventChainSigner, event: GraphNode, put: (chained: GraphNode) => Promise<void>): Promise<void> {
  if (typeof event.seq === 'number' || linkSoul(event.by)) { await put(event); return; }
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

export type ChainVerification = { checked: number; ok: boolean; firstBadSeq?: number; reason?: 'gap' | 'prev' | 'sig' | 'head' };

/**
 * Verify my chain (REQ-GRAPH-41 walk; checkpoint support lands with OPEN-109). Reads every event
 * via readEvents (the day index), keeps mine (numeric seq, my deviceId), sorts by seq and checks
 * contiguity from 0, each prev, each signature, and the head. First bad seq reported; never rewrites.
 * Assumes one chain per store+prefix: events are deviceId-keyed, and two DeviceGraph instances over
 * the same store+prefix interleave on a single head.
 */
export async function verifyChain(
  store: NodeStore,
  souls: Souls,
  crypto: { verify(signature: string, message: string, pub: string): Promise<boolean> },
  me: { pub: string; deviceId: string },
  readEvents: () => Promise<Array<{ id: string; event: GraphNode }>>,
): Promise<ChainVerification> {
  const mine = (await readEvents())
    .filter(({ event }) => typeof event.seq === 'number' && event.device === me.deviceId)
    .sort((a, b) => Number(a.event.seq) - Number(b.event.seq));
  let prevHash = '';
  for (let expect = 0; expect < mine.length; expect++) {
    const { event } = mine[expect]!;
    const seq = Number(event.seq);
    if (seq !== expect) return { checked: expect, ok: false, firstBadSeq: expect, reason: 'gap' };
    if (String(event.prev ?? '') !== prevHash) return { checked: expect, ok: false, firstBadSeq: seq, reason: 'prev' };
    if (typeof event.sig !== 'string' || !(await crypto.verify(event.sig, signedEventPart(event), me.pub)))
      return { checked: expect, ok: false, firstBadSeq: seq, reason: 'sig' };
    prevHash = eventHash(event);
  }
  const head = await store.get(chainHeadSoul(souls));
  if (mine.length === 0) {
    // All my events stripped (or the day index wiped) must not pass while the head still names a seq.
    if (head != null && Number.isFinite(Number(head.seq)) && Number(head.seq) >= 0)
      return { checked: 0, ok: false, firstBadSeq: 0, reason: 'head' };
    return { checked: 0, ok: true };
  }
  if (Number(head?.seq) !== mine.length - 1 || String(head?.hash) !== prevHash)
    return { checked: mine.length, ok: false, firstBadSeq: mine.length - 1, reason: 'head' };
  return { checked: mine.length, ok: true };
}
