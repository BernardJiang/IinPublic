/** @jest-environment node */

import {
  forgetGraphTalks,
  graphContactPeers,
  graphConversationsForView,
  graphTalksForView,
  resetGraphTabSnapshotForTests,
  setGraphTabSnapshot,
} from '../../web/services/graph-tab-projection';

afterEach(resetGraphTabSnapshotForTests);

it('projects graph-owned Talk bodies, conversation membership and Contact people over local UI state', () => {
  setGraphTabSnapshot({
    generatedAt: 30,
    talks: [{
      talkId: 'talk-1', versionId: 'version-2', versionHistory: ['version-2', 'talk-1'],
      talk: { title: 'New title', type: 'flow', language: 'en', updatedAt: 20, active: true, questions: [] },
    }],
    conversations: [{
      conversationId: 'conv-1', otherUserId: 'zoe', startedAt: 10, lastWhen: 25,
      lastEventId: 'message-2', lastMessage: 'newest', talkIds: ['talk-1'],
    }],
    people: [{
      userId: 'zoe', lastWhen: 25, conversationIds: ['conv-1'], exchanged: 3, answered: 2,
      history: [{ eventId: 'answer-1', when: 24, kind: 'answer', byUserId: 'zoe', talkId: 'talk-1' }],
    }],
    nearbyScopes: [],
  });

  // The app's row wins (the snapshot is read after the graph applied it); the graph fills gaps.
  expect(graphTalksForView({
    'talk-1': { title: 'Edited title', fullTalk: { title: 'Edited title' }, disabled: true },
  })['talk-1']).toMatchObject({
    title: 'Edited title', disabled: true, role: 'created',
    fullTalk: { title: 'Edited title', graphVersionId: 'version-2', graphVersionHistory: ['version-2', 'talk-1'] },
  });
  // A row an earlier build stripped to display state, or none: the graph supplies the Talk.
  expect(graphTalksForView({ 'talk-1': { senders: ['zoe'] } })['talk-1']).toMatchObject({
    title: 'New title', disabled: false, senders: ['zoe'], fullTalk: { title: 'New title', graphVersionId: 'version-2' },
  });
  expect(graphTalksForView({})['talk-1']).toMatchObject({ title: 'New title', role: 'created' });
  // The newer last message wins; the app's state and Talks stay.
  expect(graphConversationsForView({
    'conv-1': { otherUserId: 'zoe', otherUserName: 'Zoe', lastMessage: 'stale', lastMessageTime: new Date(5).toISOString(), unreadCount: 2, relatedTalkIds: ['talk-0'] },
  })['conv-1']).toMatchObject({
    otherUserId: 'zoe', otherUserName: 'Zoe', lastMessage: 'newest', unreadCount: 2,
    graphLastEventId: 'message-2', relatedTalkIds: ['talk-0', 'talk-1'],
  });
  expect(graphConversationsForView({
    'conv-1': { otherUserId: 'zoe', status: 'withdrawn', lastMessage: 'They deleted their answer', lastMessageTime: new Date(40).toISOString() },
  })['conv-1']).toMatchObject({ status: 'withdrawn', lastMessage: 'They deleted their answer' });
  expect(graphContactPeers()).toEqual([expect.objectContaining({
    peerId: 'zoe', lastInteractionAt: new Date(25).toISOString(),
    stats: expect.objectContaining({ totalTalks: 1, mutualMatchedTalks: 1 }),
  })]);
});

it('a person known only through a support channel is not a Contact (the built-in TechSupport row stands for it)', () => {
  setGraphTabSnapshot({
    generatedAt: 30,
    talks: [],
    conversations: [],
    people: [
      // e2e stage5 HR route: TechSupport's greeting conversation made a second, "Stranger" TechSupport row.
      { userId: 'iinpublic-root-techsupport', lastWhen: 20, conversationIds: ['conv_support_x'], exchanged: 0, answered: 0, history: [] },
      { userId: 'zoe', lastWhen: 25, conversationIds: ['conv_support_zoe', 'conv-1'], exchanged: 0, answered: 0, history: [] },
    ],
    nearbyScopes: [],
  });
  const peers = graphContactPeers({ ignoreConversationIds: new Set(['conv_support_x', 'conv_support_zoe']) });
  expect(peers.map((peer) => [peer.peerId, peer.stats.mutualMatchedTalks])).toEqual([['zoe', 1]]);
});

it('a copied Talk is one row under the app id, and a Talk the app removed stays gone (e2e 37, 80, 82)', () => {
  setGraphTabSnapshot({
    generatedAt: 30,
    talks: [
      { talkId: 'graph-copy', appTalkId: 'coex-x', versionId: 'graph-copy', versionHistory: ['graph-copy'], talk: { title: 'Copy', type: 'flow' } },
      { talkId: 'graph-route', versionId: 'graph-route', versionHistory: ['graph-route'], talk: { title: 'Route', type: 'route' } },
    ],
    conversations: [], people: [], nearbyScopes: [],
  });
  const view = graphTalksForView({ 'coex-x': { talkId: 'coex-x', title: 'Copy', role: 'created', fullTalk: { id: 'coex-x', title: 'Copy' } } });
  expect(Object.keys(view).sort()).toEqual(['coex-x', 'graph-route']);
  expect(view['coex-x'].fullTalk).toMatchObject({ id: 'coex-x', graphTalkId: 'graph-copy' });

  forgetGraphTalks(['graph-route']);
  expect(Object.keys(graphTalksForView({}))).toEqual(['coex-x']);
  // Still listed by the next snapshot (the deletion not applied yet): still hidden.
  setGraphTabSnapshot({ generatedAt: 31, talks: [{ talkId: 'graph-route', versionId: 'graph-route', versionHistory: ['graph-route'], talk: { title: 'Route' } }], conversations: [], people: [], nearbyScopes: [] });
  expect(graphTalksForView({})).toEqual({});
});
