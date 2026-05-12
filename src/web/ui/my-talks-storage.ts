export type MyTalkRole = 'created' | 'answered' | 'copied';

export type MyTalkEntry = {
  talkId: string;
  title: string;
  type: string;
  timestamp: string;
  role: MyTalkRole;
  fullTalk?: any;
  completedAnswers?: Array<{
    questionId: string;
    answerId: string;
    answerText?: string;
    mode?: string;
  }> | undefined;
  outcome?: 'match' | 'mismatch' | undefined;
  disabled?: boolean | undefined;
  expiresAt?: number | undefined;
  locationRadiusMiles?: number | undefined;
  senders?: string[] | undefined;
  lastInteraction?: string | undefined;
};

export type MyTalkMap = Record<string, MyTalkEntry>;

export function getMyTalks(): MyTalkMap {
  try {
    const stored = localStorage.getItem('myTalks');
    return stored ? (JSON.parse(stored) as MyTalkMap) : {};
  } catch {
    return {};
  }
}

export function setMyTalks(myTalks: MyTalkMap): void {
  localStorage.setItem('myTalks', JSON.stringify(myTalks));
}

export function clearMyTalks(): void {
  localStorage.removeItem('myTalks');
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
