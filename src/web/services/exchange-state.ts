/**
 * The GUI's view of who I already exchanged what with (OPEN-106 step 3), read from the device
 * core's graph (`graph.exchangeState`, `src/core/device-graph/exchanged.ts`) and kept in memory, so
 * the screens can ask at once: is this Talk still owed to this person, who else did I exchange it
 * with. The core decides what an offer actually sends (`graph.offer`); this view only shows it.
 */
import { exchangeAtoms, planOffer, type ExchangeAtom } from '../../core/device-graph/exchanged';
import type { ExchangeStateSnapshot } from '../../core/protocol';
import type { GunBridge } from './gun-bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Source = () => Promise<ExchangeStateSnapshot>;

let source: Source | null = null;
let state: ExchangeStateSnapshot = { peers: {}, talks: {} };
let exchangedSets = new Map<string, Set<string>>();
let answeredSets = new Map<string, Set<string>>();
let stopChanges: (() => void) | null = null;
let refreshing: Promise<void> | null = null;
let again = false;
const atomsCache = new Map<string, ExchangeAtom[]>();

const listeners = new Set<() => void>();

/** Called after the state was read again (a screen showing it redraws). Returns the unsubscribe. */
export function onExchangeStateChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: ExchangeStateSnapshot): void {
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  state = next;
  exchangedSets = new Map(Object.entries(next.peers).map(([peer, p]) => [peer, new Set(p.exchanged)]));
  answeredSets = new Map(Object.entries(next.peers).map(([peer, p]) => [peer, new Set(p.answered)]));
  if (changed) for (const listener of listeners) { try { listener(); } catch { /* a screen's redraw failing stops no other */ } }
}

function atomsOf(talk: any): ExchangeAtom[] {
  const key = JSON.stringify([talk?.type, talk?.questions]);
  let atoms = atomsCache.get(key);
  if (!atoms) {
    atoms = exchangeAtoms(talk);
    if (atomsCache.size > 500) atomsCache.clear();
    atomsCache.set(key, atoms);
  }
  return atoms;
}

/** Read the state again now (after an offer, an arrival or an answer); calls made meanwhile coalesce. */
export function refreshExchangeState(): Promise<void> {
  if (!source) return Promise.resolve();
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    try {
      do {
        again = false;
        setState(await source!());
      } while (again);
    } catch (error) {
      console.warn('[exchange-state] read failed:', error);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Where the state comes from; it is read now and whenever another tab changes it. */
export function connectExchangeState(read: Source, bridge?: GunBridge): Promise<void> {
  source = read;
  stopChanges?.();
  stopChanges = bridge?.onCoreCollectionChanged((collection) => {
    if (collection === 'exchangeState' || collection === '*') void refreshExchangeState();
  }) ?? null;
  return refreshExchangeState();
}

/**
 * Is my Talk still owed to this person: a version of it they do not have, or parts of it (a tag)
 * that never passed between us? The same rule the core's offer applies, without the send limit.
 */
export function talkOwedToPeer(peerId: string, appTalkId: string, talk: any): boolean {
  if (!talk) return true;
  const mine = state.talks[appTalkId];
  const had = exchangedSets.get(peerId);
  const plan = planOffer({
    versionId: mine?.versionId ?? '',
    sentVersion: mine?.sent[peerId],
    atoms: atomsOf(talk),
    has: (atom) => !!had?.has(atom),
  });
  return plan.send;
}

/**
 * The people I exchanged answers on this Talk's content with (I answered theirs, or they mine):
 * an answer on it passed between us (for a tag Talk, on one of its tags).
 */
export function coExchangedPeers(talk: any): string[] {
  const atoms = atomsOf(talk);
  if (!atoms.length) return [];
  return [...answeredSets.entries()].filter(([, answered]) => atoms.some((a) => answered.has(a.atom))).map(([peer]) => peer);
}

/** The snapshot, for e2e specs (`window.__iinpublic_exchange_state`). */
export function exchangeStateSnapshot(): ExchangeStateSnapshot {
  return state;
}

/** Tests of what the screens offer: count a Talk's parts as passed to this person (view only). */
export function markExchangedForTesting(peerId: string, talk: any): void {
  const set = exchangedSets.get(peerId) ?? new Set<string>();
  for (const atom of atomsOf(talk)) set.add(atom.atom);
  exchangedSets.set(peerId, set);
}

export function resetExchangeStateForTests(next: ExchangeStateSnapshot = { peers: {}, talks: {} }): void {
  stopChanges?.();
  stopChanges = null;
  source = null;
  atomsCache.clear();
  setState(next);
}
