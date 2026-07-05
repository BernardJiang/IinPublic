import { computeTalkIdFromTalkData } from '../shared/cid';
import { setMyTalks, type MyTalkMap } from './ui/my-talks-storage';
import { deriveBackendApiBaseFromLocation } from './services/web-gun-service';

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

type StageSeedName = 'stage-zero' | 'empty' | 'user1' | 'user2-match' | 'user3-network';

function buildApiBase(): string {
  const { hostname, protocol, port } = window.location;
  return deriveBackendApiBaseFromLocation(protocol, hostname, port);
}

async function clearServerGunGraph(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/test/clear-database`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Poll until the dev Gun server is up, then wipe its in-memory graph (stage-zero / empty). */
export async function waitForDevServerGunClear(maxWaitMs = 20000): Promise<void> {
  const base = buildApiBase();
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    try {
      const health = await fetch(`${base}/health`);
      if (health.ok) {
        const cleared = await clearServerGunGraph(base);
        if (cleared) {
          console.log('🧹 Cleared dev server Gun graph for stage-zero');
        }
        return;
      }
    } catch {
      /* server still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn('⚠️ Dev Gun server not reachable; restart dev:stage-zero if headcounts look stale');
}

export function clearClientGunChatrooms(gun: any): void {
  if (!gun) return;
  gun.get('chatrooms').put({});
}

/** Wipe server graph + client chatrooms branch (use after boot when stale sync is detected). */
export async function purgeDevStageZeroGraph(
  base: string,
  gun: any,
  opts?: { clearServer?: boolean },
): Promise<void> {
  if (opts?.clearServer !== false) {
    await clearServerGunGraph(base);
  }
  clearClientGunChatrooms(gun);
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

/** P0 step 7: server talk delivery removed — incoming cluster is seeded into client UI state only. */
function registerIncomingLocal(app: any, talk: StageTalk, sender: StageUser): void {
  const cluster = {
    identityKey: talk.id,
    latestTalkId: talk.id,
    title: talk.title,
    type: talk.type,
    updatedAt: new Date().toISOString(),
    isAnswered: false,
    senders: {
      [sender.id]: { senderId: sender.id, senderName: sender.stageName, lastTalkId: talk.id },
    },
    talkIds: { [talk.id]: new Date().toISOString() },
  };
  const existing: any[] = Array.isArray(app?.uiManager?.incomingTalkClusters)
    ? app.uiManager.incomingTalkClusters
    : [];
  app?.uiManager?.setIncomingTalkClusters?.([...existing, cluster]);
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

  // P0 step 7: server talk delivery removed — seed incoming clusters locally.
  registerIncomingLocal(app, jordanTalk, jordan);

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

  // P0 step 7: server talk delivery removed — seed incoming clusters locally.
  registerIncomingLocal(app, jordanTalk, jordan);
  registerIncomingLocal(app, caseyTalk, casey);

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
  refreshUi(app);
}

export async function applyDevStageSeed(app: any, stageName: string): Promise<void> {
  const stage = (stageName || '').trim() as StageSeedName;
  if (!stage) return;

  const supported = new Set<StageSeedName>(['stage-zero', 'empty', 'user1', 'user2-match', 'user3-network']);
  if (!supported.has(stage)) return;

  clearStageLocalState();
  const base = buildApiBase();

  if (stage === 'stage-zero' || stage === 'empty') {
    clearClientGunChatrooms(app.gunService?.getGun?.());
    setCurrentUserDecorations(app, { stageName: 'Adam', knownPeople: [] });
    if (app.currentUser?.id && app.userService?.updateStageName) {
      await app.userService.updateStageName(app.currentUser.id, 'Adam');
    }
    try {
      if (typeof app.reloadChatroomMemberCountsAfterStageClear === 'function') {
        await app.reloadChatroomMemberCountsAfterStageClear();
      } else {
        seedChatroomMembers(app, []);
      }
    } catch (err) {
      console.warn('[stage-zero] reload headcounts failed, using seed fallback:', err);
      seedChatroomMembers(app, []);
    }
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
