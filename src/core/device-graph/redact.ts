/**
 * Redaction (spec §31.13, OPEN-108 slice 5): a deleted record's content is erased on request —
 * its content nodes are cleared, its event and the event's hash stay, so the chain still
 * verifies. "Cleared" is a field erase, not a removed soul: every field the node still holds is
 * overwritten with null (Gun merge semantics, as location-graph.ts sweep() erases gps points).
 * The event node (ev/<id>) itself is NEVER written, and neither are the content-addressed text
 * records (q/<key>, a/<hash>): those are shared across Talks, so clearing them would damage a
 * Talk that was not redacted.
 *
 * Two structural safety rules (code review, OPEN-108 slice 5):
 *   1. Prefix guards: only souls under this device's OWN `rev/` and `s/` prefixes are ever
 *      cleared. The guards make "never touches ev/<id> or shared q//a/ records" hold against any
 *      event, including a crafted one with a foreign `rev`/`gave` link — not just against the
 *      links today's writers happen to build.
 *   2. Shared content-addressed records are kept while any OTHER event still references them:
 *      s/<hash> is keyed by content (REQ-GRAPH-22), so a deleted answer and an identical live
 *      re-answer share one set; rev/<key> is shared between my version and a received Talk with
 *      an identical structure. Clearing through the redacted event would destroy the live one.
 *      The reference check scans the day index (all events) — conservative: when in doubt, the
 *      content stays; trimming reclaims it later.
 */
import { theirQuestionsSoul } from './answers';
import { answerQuestionsSoul } from './events';
import { readIndex } from './index-buckets';
import { linkSoul, type GraphNode, type NodeStore } from './node-store';
import type { graphSouls } from './talk-structure';

type Souls = ReturnType<typeof graphSouls>;

/** The field erase of a node that still holds something, or undefined when there is nothing to clear. */
const erase = (node: GraphNode | null): GraphNode | undefined => {
  if (!node) return undefined;
  const present = Object.keys(node).filter((key) => node[key] !== null && node[key] !== undefined);
  return present.length ? Object.fromEntries(present.map((key) => [key, null])) : undefined;
};

/**
 * Every soul one structure write owns (`writeTalkStructure`): `rev/<key>` and the nodes under it.
 * The walk follows links and the order/choices lists, tolerating nodes already cleared (a
 * repeated or resumed redaction). The shared q/<key> and a/<hash> text records are never under
 * `rev/<key>`, and the order/choices expansions build only `rev/<key>/q/…` souls, so a shared
 * text can never land in the result.
 */
export async function structureSouls(store: NodeStore, revSoul: string): Promise<string[]> {
  const seen = new Set<string>([revSoul]);
  const out: string[] = [];
  const queue = [revSoul];
  const visit = (soul: string) => { if (!seen.has(soul)) { seen.add(soul); queue.push(soul); } };
  while (queue.length) {
    const soul = queue.shift()!;
    out.push(soul);
    const node = await store.get(soul);
    if (!node) continue;
    for (const value of Object.values(node)) {
      const linked = linkSoul(value);
      if (linked && linked.startsWith(`${revSoul}/`)) visit(linked);
      // The order list holds question ids and a choices list answer ids, as plain strings; the
      // question and answer nodes themselves are not linked from anywhere.
      if (typeof value !== 'string') continue;
      if (soul === `${revSoul}/order`) visit(`${revSoul}/q/${encodeURIComponent(value)}`);
      else if (soul.endsWith('/choices')) visit(`${soul.slice(0, -'/choices'.length)}/a/${encodeURIComponent(value)}`);
    }
  }
  return out;
}

/**
 * Erase the content an event points to (spec §31.13):
 *   - an answer (`gave`): its `s/<hash>` root and every `s/<hash>/<context>` entry;
 *   - a Talk version (`rev`): every `rev/<key>` record of its structure;
 *   - the event's exact location (`gps/<eventId>`), unless `options.gps === false`.
 * Returns the souls that were cleared: empty when the event is missing or everything was cleared
 * already (redaction is idempotent). The event itself is never written.
 */
export async function redactEvent(
  store: NodeStore,
  souls: Souls,
  eventId: string,
  options: { gps?: boolean } = {},
): Promise<{ cleared: string[] }> {
  const event = await store.get(souls.event(eventId));
  if (!event) return { cleared: [] };
  const targets = new Set<string>();
  const gave = linkSoul(event.gave);
  const rev = linkSoul(event.rev);
  // Rule 1: only this device's own content prefixes are ever cleared (a crafted event with a
  // foreign `gave`/`rev` link — e.g. pointing at another ev/<id> — clears nothing).
  const ownGave = gave?.startsWith(souls.answerSet('')) ? gave : undefined;
  const ownRev = rev?.startsWith(souls.rev('')) ? rev : undefined;
  // Rule 2: content-addressed records another event still references are kept (a deleted answer
  // and its identical live re-answer share one s/<hash>; my version and a received Talk with an
  // identical structure share one rev/<key>). Any other event referencing the soul keeps it.
  let sharedGave = false;
  let sharedRev = false;
  if (ownGave || ownRev) {
    for (const entry of await readIndex(store, souls.index('day'))) {
      if (entry.key === eventId) continue;
      const other = await store.get(entry.target);
      if (!other) continue;
      if (ownGave && linkSoul(other.gave) === ownGave) sharedGave = true;
      if (ownRev && linkSoul(other.rev) === ownRev) sharedRev = true;
      if (sharedGave && sharedRev) break;
    }
  }
  if (ownGave && !sharedGave) {
    targets.add(ownGave);
    // The event's private sidecar lists the situations of the set (as answers.ts reads them).
    const sidecar = await store.get(event.by ? theirQuestionsSoul(souls, eventId) : answerQuestionsSoul(souls, eventId));
    for (const context of Object.keys(sidecar || {})) targets.add(`${ownGave}/${context}`);
  }
  if (ownRev && !sharedRev) for (const soul of await structureSouls(store, ownRev)) targets.add(soul);
  if (options.gps !== false) targets.add(`${souls.event('').slice(0, -'ev/'.length)}gps/${eventId}`);
  const cleared: string[] = [];
  const writes: Array<Promise<void>> = [];
  for (const soul of targets) {
    const clearing = erase(await store.get(soul));
    if (clearing) { cleared.push(soul); writes.push(store.put(soul, clearing)); }
  }
  await Promise.all(writes);
  return { cleared: cleared.sort() };
}
