import { computeTalkIdFromTalkData } from '../shared/talk-content-id';
import { setMyTalks, type MyTalkMap } from './ui/my-talks-storage';

type StageUser = {
  id: string;
  stageName: string;
};

type StageTalk = {
  id: string;
  title: string;
  type: 'flow';
  authorId: string;
  createdAt: string;
  questions: Array<{
    id: string;
    text: string;
    answers: Array<{
      id: string;
      text: string;
      next: 'noticed' | 'ignore';
    }>;
  }>;
};

type StageAnswer = {
  questionId: string;
  answerId: string;
  answerText: string;
};

type StageSeedName = 'empty' | 'user1' | 'user2-match' | 'user3-network';

function buildApiBase(): string {
  const { hostname, protocol, port } = window.location;
  const webPort = Number(port);
  if (Number.isFinite(webPort) && webPort >= 3001) {
    return `${protocol}//${hostname}:${webPort - 3001 + 8080}`;
  }
  return `${protocol}//${hostname}:8080`;
}

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function buildFlowTalk(authorId: string, title: string, questionText: string, yesText: string, noText = 'No thanks.'): StageTalk {
  const talk: StageTalk = {
    id: '',
    title,
    type: 'flow',
    authorId,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: `${title.toLowerCase().replace(/\W+/g, '-')}-q1`,
        text: questionText,
        answers: [
          { id: 'yes', text: yesText, next: 'noticed' },
          { id: 'no', text: noText, next: 'ignore' },
        ],
      },
    ],
  };
  talk.id = computeTalkIdFromTalkData(talk);
  return talk;
}

async function createServerUser(base: string, stageName: string): Promise<StageUser> {
  const response = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stageName, profile: [], languages: ['en'], interests: [] }),
  });
  if (!response.ok) throw new Error(`Could not create stage user ${stageName}`);
  const user = await response.json();
  return { id: user.id, stageName: user.stageName };
}

async function registerIncoming(base: string, talk: StageTalk, sender: StageUser, receiver: StageUser): Promise<void> {
  await fetch(`${base}/api/talks/${encodeURIComponent(talk.id)}/received`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receiverId: receiver.id,
      receiverName: receiver.stageName,
      senderId: sender.id,
      senderName: sender.stageName,
      talkData: talk,
    }),
  });
}

async function submitResponse(
  base: string,
  talk: StageTalk,
  responder: StageUser,
  answers: StageAnswer[],
): Promise<void> {
  await fetch(`${base}/api/talks/${encodeURIComponent(talk.id)}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      talkId: talk.id,
      responderId: responder.id,
      responderName: responder.stageName,
      answers,
      talkData: talk,
    }),
  });
}

function saveConversationForCurrentUser(other: StageUser, talk: StageTalk, respondedByBot = false): void {
  const current = JSON.parse(localStorage.getItem('myConversations') || '{}');
  const sorted = [other.id, localStorage.getItem('iinpublic_user_id') || ''].sort();
  const conversationId = `conv_${sorted[0]}_${sorted[1]}_${talk.id}`;
  current[conversationId] = {
    conversationId,
    otherUserId: other.id,
    otherUserName: other.stageName,
    talkId: talk.id,
    createdAt: new Date().toISOString(),
    respondedByBot,
  };
  localStorage.setItem('myConversations', JSON.stringify(current));
}

function setStageMyTalks(talks: MyTalkMap): void {
  setMyTalks(talks);
}

function clearStageLocalState(): void {
  setMyTalks({});
  localStorage.setItem('myConversations', '{}');
  localStorage.removeItem('answeredTalkByContent');
}

function refreshUi(app: any): void {
  app.uiManager.showMainInterface(app.currentUser);
  app.uiManager.setIncomingTalkClusters(app.uiManager.incomingTalkClusters || []);
  app.uiManager.displayTalksList();
  app.uiManager.displayAnswersList();
  app.uiManager.displayContactsList();
}

function setCurrentUserDecorations(app: any, updates: { stageName?: string; knownPeople?: any[] }): void {
  if (!app.currentUser) return;
  if (updates.stageName) app.currentUser.stageName = updates.stageName;
  if (updates.knownPeople) app.currentUser.knownPeople = updates.knownPeople;
}

function seedChatroomMembers(app: any, peers: StageUser[]): void {
  const me = app.currentUser;
  if (!me) return;
  const currentChatroomId = app.currentChatroomId || 'global';
  const gun = app.gunService?.getGun?.();
  const allMembers = [{ userId: me.id, stageName: me.stageName }, ...peers.map((peer) => ({ userId: peer.id, stageName: peer.stageName }))];
  if (gun) {
    for (const member of allMembers) {
      gun.get('chatrooms').get(currentChatroomId).get('users').get(member.userId).put({
        userId: member.userId,
        stageName: member.stageName,
        joinedAt: new Date().toISOString(),
      });
    }
  }
  app.uiManager.updateChatroomMembers(allMembers, me.id);
  app.uiManager.setChatroomMemberCount(currentChatroomId, allMembers.length);
}

async function seedUser1(app: any, base: string): Promise<void> {
  const me: StageUser = { id: app.currentUser.id, stageName: 'StageSolo' };
  setCurrentUserDecorations(app, { stageName: me.stageName, knownPeople: [] });

  const talks = [
    buildFlowTalk(me.id, 'Coffee Walk', 'Want to grab coffee after work?', 'Yes, coffee sounds good.'),
    buildFlowTalk(me.id, 'Weekend Tennis', 'Tennis on Saturday morning?', 'Yes, lets play.'),
    buildFlowTalk(me.id, 'Book Swap', 'Want to swap books this week?', 'Yes, bring one over.'),
  ];

  const myTalks: MyTalkMap = {};
  talks.forEach((talk, index) => {
    myTalks[talk.id] = {
      talkId: talk.id,
      title: talk.title,
      type: talk.type,
      timestamp: iso(120 - index * 20),
      role: 'created',
      fullTalk: talk,
      disabled: false,
      lastInteraction: iso(120 - index * 20),
    };
  });
  setStageMyTalks(myTalks);
  seedChatroomMembers(app, []);
  refreshUi(app);
  void base;
}

async function seedUser2Match(app: any, base: string): Promise<void> {
  const me: StageUser = { id: app.currentUser.id, stageName: 'StageAlex' };
  const jordan = await createServerUser(base, 'Jordan');
  setCurrentUserDecorations(app, {
    stageName: me.stageName,
    knownPeople: [{ userId: jordan.id, label: 'friend', nickname: 'J', addedAt: new Date() }],
  });

  const myTalk = buildFlowTalk(me.id, 'Lunch Break', 'Lunch together tomorrow?', 'Yes, lunch works.');
  const jordanTalk = buildFlowTalk(jordan.id, 'Board Game Night', 'Board games tonight?', 'Yes, count me in.');

  await registerIncoming(base, myTalk, me, jordan);
  await submitResponse(base, myTalk, jordan, [
    { questionId: myTalk.questions[0].id, answerId: 'yes', answerText: 'Yes, lunch works.' },
  ]);
  await registerIncoming(base, jordanTalk, jordan, me);
  await submitResponse(base, jordanTalk, me, [
    { questionId: jordanTalk.questions[0].id, answerId: 'no', answerText: 'No thanks.' },
  ]);

  setStageMyTalks({
    [myTalk.id]: {
      talkId: myTalk.id,
      title: myTalk.title,
      type: myTalk.type,
      timestamp: iso(90),
      role: 'created',
      fullTalk: myTalk,
      disabled: false,
      lastInteraction: iso(15),
    },
    [jordanTalk.id]: {
      talkId: jordanTalk.id,
      title: jordanTalk.title,
      type: jordanTalk.type,
      timestamp: iso(40),
      role: 'answered',
      fullTalk: jordanTalk,
      completedAnswers: [{ questionId: jordanTalk.questions[0].id, answerId: 'no', answerText: 'No thanks.' }],
      outcome: 'mismatch',
      senders: [jordan.id],
      lastInteraction: iso(12),
    },
  });
  saveConversationForCurrentUser(jordan, myTalk);
  seedChatroomMembers(app, [jordan]);
  app.uiManager.setIncomingTalkClusters([
    {
      identityKey: jordanTalk.id,
      latestTalkId: jordanTalk.id,
      title: jordanTalk.title,
      type: jordanTalk.type,
      updatedAt: iso(20),
      isAnswered: true,
      senders: {
        [jordan.id]: { senderId: jordan.id, senderName: jordan.stageName, lastTalkId: jordanTalk.id },
      },
      talkIds: { [jordanTalk.id]: iso(20) },
    },
  ]);
  refreshUi(app);
}

async function seedUser3Network(app: any, base: string): Promise<void> {
  const me: StageUser = { id: app.currentUser.id, stageName: 'StageMorgan' };
  const jordan = await createServerUser(base, 'Jordan');
  const casey = await createServerUser(base, 'Casey');
  setCurrentUserDecorations(app, {
    stageName: me.stageName,
    knownPeople: [
      { userId: jordan.id, label: 'friend', nickname: 'J', addedAt: new Date() },
      { userId: casey.id, label: 'coworker', nickname: 'Case', addedAt: new Date() },
    ],
  });

  const myTalkA = buildFlowTalk(me.id, 'Morning Run', 'Run before work tomorrow?', 'Yes, lets run.');
  const myTalkB = buildFlowTalk(me.id, 'Music Swap', 'Swap playlists this week?', 'Yes, send yours.');
  const jordanTalk = buildFlowTalk(jordan.id, 'Tag: Tennis', 'Tennis this weekend?', 'Yes, lets play.');
  const caseyTalk = buildFlowTalk(casey.id, 'Road Trip', 'Road trip next month?', 'Yes, I am in.');

  await registerIncoming(base, myTalkA, me, jordan);
  await submitResponse(base, myTalkA, jordan, [
    { questionId: myTalkA.questions[0].id, answerId: 'yes', answerText: 'Yes, lets run.' },
  ]);
  await registerIncoming(base, myTalkB, me, casey);
  await submitResponse(base, myTalkB, casey, [
    { questionId: myTalkB.questions[0].id, answerId: 'no', answerText: 'No thanks.' },
  ]);
  await registerIncoming(base, jordanTalk, jordan, me);
  await submitResponse(base, jordanTalk, me, [
    { questionId: jordanTalk.questions[0].id, answerId: 'yes', answerText: 'Yes, lets play.' },
  ]);
  await registerIncoming(base, caseyTalk, casey, me);
  await submitResponse(base, caseyTalk, me, [
    { questionId: caseyTalk.questions[0].id, answerId: 'no', answerText: 'No thanks.' },
  ]);

  setStageMyTalks({
    [myTalkA.id]: {
      talkId: myTalkA.id,
      title: myTalkA.title,
      type: myTalkA.type,
      timestamp: iso(80),
      role: 'created',
      fullTalk: myTalkA,
      disabled: false,
      lastInteraction: iso(18),
    },
    [myTalkB.id]: {
      talkId: myTalkB.id,
      title: myTalkB.title,
      type: myTalkB.type,
      timestamp: iso(70),
      role: 'created',
      fullTalk: myTalkB,
      disabled: false,
      lastInteraction: iso(25),
    },
    [jordanTalk.id]: {
      talkId: jordanTalk.id,
      title: jordanTalk.title,
      type: jordanTalk.type,
      timestamp: iso(30),
      role: 'answered',
      fullTalk: jordanTalk,
      completedAnswers: [{ questionId: jordanTalk.questions[0].id, answerId: 'yes', answerText: 'Yes, lets play.' }],
      outcome: 'match',
      senders: [jordan.id],
      lastInteraction: iso(10),
    },
    [caseyTalk.id]: {
      talkId: caseyTalk.id,
      title: caseyTalk.title,
      type: caseyTalk.type,
      timestamp: iso(20),
      role: 'answered',
      fullTalk: caseyTalk,
      completedAnswers: [{ questionId: caseyTalk.questions[0].id, answerId: 'no', answerText: 'No thanks.' }],
      outcome: 'mismatch',
      senders: [casey.id],
      lastInteraction: iso(8),
    },
  });
  saveConversationForCurrentUser(jordan, myTalkA);
  seedChatroomMembers(app, [jordan, casey]);
  app.uiManager.setIncomingTalkClusters([
    {
      identityKey: jordanTalk.id,
      latestTalkId: jordanTalk.id,
      title: jordanTalk.title,
      type: jordanTalk.type,
      updatedAt: iso(16),
      isAnswered: true,
      senders: {
        [jordan.id]: { senderId: jordan.id, senderName: jordan.stageName, lastTalkId: jordanTalk.id },
      },
      talkIds: { [jordanTalk.id]: iso(16) },
    },
    {
      identityKey: caseyTalk.id,
      latestTalkId: caseyTalk.id,
      title: caseyTalk.title,
      type: caseyTalk.type,
      updatedAt: iso(14),
      isAnswered: true,
      senders: {
        [casey.id]: { senderId: casey.id, senderName: casey.stageName, lastTalkId: caseyTalk.id },
      },
      talkIds: { [caseyTalk.id]: iso(14) },
    },
  ]);
  refreshUi(app);
}

export async function applyDevStageSeed(app: any, stageName: string): Promise<void> {
  const stage = (stageName || '').trim() as StageSeedName;
  if (!stage) return;

  const supported = new Set<StageSeedName>(['empty', 'user1', 'user2-match', 'user3-network']);
  if (!supported.has(stage)) return;

  clearStageLocalState();
  const base = buildApiBase();

  if (stage === 'empty') {
    setCurrentUserDecorations(app, { stageName: 'StageEmpty', knownPeople: [] });
    seedChatroomMembers(app, []);
    refreshUi(app);
    return;
  }

  if (stage === 'user1') {
    await seedUser1(app, base);
    return;
  }

  if (stage === 'user2-match') {
    await seedUser2Match(app, base);
    return;
  }

  await seedUser3Network(app, base);
}
