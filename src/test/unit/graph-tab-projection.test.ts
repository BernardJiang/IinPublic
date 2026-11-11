/** @jest-environment node */

import {
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

  expect(graphTalksForView({
    'talk-1': { title: 'Stale title', fullTalk: { title: 'Stale title' }, disabled: true },
  })['talk-1']).toMatchObject({
    title: 'New title', disabled: false, role: 'created',
    fullTalk: { title: 'New title', graphVersionId: 'version-2', graphVersionHistory: ['version-2', 'talk-1'] },
  });
  expect(graphConversationsForView({
    'conv-1': { otherUserId: 'wrong', otherUserName: 'Zoe', lastMessage: 'stale', unreadCount: 2 },
  })['conv-1']).toMatchObject({
    otherUserId: 'zoe', otherUserName: 'Zoe', lastMessage: 'newest', unreadCount: 2,
    graphLastEventId: 'message-2',
  });
  expect(graphContactPeers()).toEqual([expect.objectContaining({
    peerId: 'zoe', lastInteractionAt: new Date(25).toISOString(),
    stats: expect.objectContaining({ totalTalks: 1, mutualMatchedTalks: 1 }),
  })]);
});
