/**
 * "Already answered" by Talk content (OPEN-106): which Talk holds my answer to a Talk with this
 * content, so the same Talk from several senders is one row answered once. Derived, not stored a
 * second time: an entry of My Talks with `completedAnswers`, then each Talk the device graph says I
 * answered (`graph-answer-history.ts`), which keeps a Talk answered after its copy is removed from
 * my list. The old `answeredTalkByContent` collection is erased at start (`collection.eraseRetired`).
 */
import { computeTalkIdFromTalkData } from '../../shared/cid';
import { myTalksView } from '../services/core-views';
import { getTalkContentKey } from './answer-history-storage';
import { graphAnsweredBodies } from './graph-answer-history';

let cache: { revision: string; map: Record<string, string> } | null = null;

function build(graphBodies: ReadonlyMap<string, Record<string, any>>): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (talkId: string, talk: any) => {
    const keys: string[] = [];
    try { keys.push(getTalkContentKey(talk)); } catch { /* a body without questions */ }
    try { keys.push(computeTalkIdFromTalkData(talk)); } catch { /* the content key only */ }
    // The first Talk holding an answer to this content keeps it (completion reuses that entry).
    for (const key of keys) if (key && !(key in out)) out[key] = talkId;
  };
  for (const [talkId, entry] of Object.entries(myTalksView.all()) as Array<[string, any]>) {
    if (entry?.fullTalk && Array.isArray(entry?.completedAnswers) && entry.completedAnswers.length > 0) add(talkId, entry.fullTalk);
  }
  for (const [talkId, talk] of graphBodies) add(talkId, talk);
  return out;
}

/** Content key or content id → the My Talks entry holding my answer (a copy: change it freely). */
export function answeredTalkIdsByContent(): Record<string, string> {
  const graph = graphAnsweredBodies();
  const revision = `${myTalksView.revision()}:${graph.revision}`;
  if (!cache || cache.revision !== revision) cache = { revision, map: build(graph.bodies) };
  return { ...cache.map };
}

/** The Talk answered for this content key or id, if any. */
export function getAnsweredTalkId(contentId: string): string | undefined {
  return answeredTalkIdsByContent()[contentId];
}

export function resetAnsweredTalksForTests(): void {
  cache = null;
}
