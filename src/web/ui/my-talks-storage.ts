import { myTalksView } from '../services/core-views';

export type MyTalkRole = 'created' | 'answered' | 'copied' | 'ignored';

export type MyTalkEntry = {
  talkId: string;
  title: string;
  type: string;
  language?: string;
  timestamp: string;
  role: MyTalkRole;
  /** Restored when an already-retained talk is moved out of the Ignored list. */
  roleBeforeIgnore?: Exclude<MyTalkRole, 'ignored'> | undefined;
  fullTalk?: any;
  completedAnswers?: Array<{
    questionId: string;
    answerId: string;
    answerText?: string;
    mode?: string;
  }> | undefined;
  outcome?: 'match' | 'mismatch' | undefined;
  /** Set when the receiver's chatbot answered with no user action; cleared by a manual answer. */
  answeredBy?: 'chatbot' | undefined;
  disabled?: boolean | undefined;
  expiresAt?: number | undefined;
  locationRadiusMiles?: number | undefined;
  collectionImportance?: 'important' | 'must-have' | undefined;
  senders?: string[] | undefined;
  lastInteraction?: string | undefined;
};

export type MyTalkMap = Record<string, MyTalkEntry>;

/**
 * My Talks live in the device core (OPEN-91 P3, `core-views.ts`). Callers edit the returned map
 * and hand it back to `setMyTalks`, so this is a copy: the view keeps its own entries.
 */
export function getMyTalks(): MyTalkMap {
  return JSON.parse(JSON.stringify(myTalksView.all())) as MyTalkMap;
}

/** Replaces My Talks with this map; only what changed is written. */
export function setMyTalks(myTalks: MyTalkMap): void {
  const current = myTalksView.all();
  const changed = Object.fromEntries(Object.entries(myTalks)
    .filter(([talkId, entry]) => JSON.stringify(current[talkId]) !== JSON.stringify(entry)));
  myTalksView.set(JSON.parse(JSON.stringify(changed)) as MyTalkMap);
  myTalksView.remove(Object.keys(current).filter((talkId) => !(talkId in myTalks)));
}

export function clearMyTalks(): void {
  myTalksView.remove(Object.keys(myTalksView.all()));
}

export function upsertMyTalk(talkId: string, value: MyTalkEntry): MyTalkMap {
  const myTalks = getMyTalks();
  myTalks[talkId] = value;
  setMyTalks(myTalks);
  return myTalks;
}

export function patchMyTalk(talkId: string, patch: Partial<MyTalkEntry>): MyTalkMap {
  const myTalks = getMyTalks();
  if (!myTalks[talkId]) return myTalks;
  myTalks[talkId] = {
    ...myTalks[talkId],
    ...patch,
  };
  setMyTalks(myTalks);
  return myTalks;
}

export function deleteMyTalkEntry(talkId: string): MyTalkMap {
  const myTalks = getMyTalks();
  if (!(talkId in myTalks)) return myTalks;
  delete myTalks[talkId];
  setMyTalks(myTalks);
  return myTalks;
}
