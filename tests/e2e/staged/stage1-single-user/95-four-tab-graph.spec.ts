import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { webBaseURL } from '../../helpers/ports';

// OPEN-94: all 12 directed tab pairs, through rendered contextual links rather than nav shortcuts.
test('four tabs traverse people, non-tag Talks, answers and historical Places without travelling', async ({ browser }) => {
  await clearGunForStage1Spec();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await expect(page.locator('.nav-btn[data-view="chatrooms"]')).toBeVisible();
    await page.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.uiManager.setNotificationsSuppressedForE2e(true);
      const at = new Date().toISOString();
      const flow = { id: 'graph-flow', title: 'Graph coffee plan', type: 'flow', authorId: app.currentUser.id, status: 'active', questions: [{ id: 'q', text: 'Coffee tomorrow?', answers: [{ id: 'yes', text: 'Yes' }] }] };
      const tag = { id: 'graph-tag', title: 'Graph hiking', type: 'tag', authorId: app.currentUser.id, status: 'active', questions: [{ id: 'q', text: 'Graph hiking', answers: [{ id: 'yes', text: 'Checked' }] }] };
      (window as any).__iinpublic_collection_edit('myTalks', { set: {
        [flow.id]: { title: flow.title, type: flow.type, role: 'created', timestamp: at, fullTalk: flow },
        [tag.id]: { title: tag.title, type: tag.type, role: 'created', timestamp: at, fullTalk: tag },
      } });
      (window as any).__iinpublic_collection_edit('myAnswerHistory', { set: {
        [flow.id]: { id: flow.id, talkId: flow.id, title: flow.title, type: 'flow', outcome: 'match', answeredAt: at, senderIds: ['graph-eve'], items: [{ questionId: 'q', answerId: 'yes', prompt: 'Coffee tomorrow?', choice: 'Yes', kind: 'question', contextPath: [] }] },
        [tag.id]: { id: tag.id, talkId: tag.id, title: tag.title, type: 'tag', outcome: 'match', answeredAt: at, senderIds: ['graph-bob'], items: [{ questionId: 'q', answerId: 'yes', prompt: 'Graph hiking', choice: 'Checked', kind: 'tag', booleanTag: true, contextPath: [] }] },
      } });
      app.recordLocalTalkExchange('graph-eve', 'Eve', flow.id, flow, 'match');
      app.recordLocalTalkExchange('graph-bob', 'Bob', tag.id, tag, 'match');
      const room = app.currentChatroomId;
      // Fixture history in an unlisted Place; restore the live audience without joining anywhere.
      try {
        app.currentChatroomId = 'place_40.71_-74.00_abcdefabcdef';
        app.recordLocalTalkExchange('graph-dan', 'Dan', tag.id, tag, 'match');
      } finally { app.currentChatroomId = room; }
      // Keep the synthetic peer in this GUI fixture when late real hub roster updates arrive.
      const updateMembers = app.uiManager.updateChatroomMembers.bind(app.uiManager);
      app.uiManager.updateChatroomMembers = (members: any[], userId: string) => updateMembers([
        ...members.filter((member) => member.userId !== 'graph-eve'),
        { userId: 'graph-eve', stageName: 'Eve' },
      ], userId);
      app.uiManager.updateChatroomMembers([{ userId: app.currentUser.id, stageName: app.currentUser.stageName }], app.currentUser.id);
    });
    const originalRoom = await page.evaluate(() => (window as any).__iinpublic_app.getApp().getCurrentChatroomId());
    const active = (view: string) => expect(page.locator(`.nav-btn[data-view="${view}"]`)).toHaveClass(/active/);
    const back = () => page.locator('#graph-back-btn').click();
    const list = page.locator('#chatroom-list');
    // Chatrooms → Me, Contacts. A person click must not create or open a conversation.
    await list.getByTestId('nearby-self-row').tap();
    await active('me');
    await back();
    await list.locator('[data-testid="nearby-person-row"][data-user-id="graph-eve"]').tap();
    await active('contacts');
    const peer = page.locator('#peer-detail-overlay');
    await expect(peer).toBeVisible();
    await peer.screenshot({ path: '/tmp/iinpublic-graph-peer-mobile.png' });
    await expect(page.locator('#conversation-detail-overlay')).toBeHidden();
    // Contacts → Talks: Eve exchanged only a Flow, no tags.
    await peer.getByTestId('peer-talks-link').click();
    await active('talks');
    await expect(page.locator('#talks-focus-chip')).toContainText('Eve');
    await expect(page.locator('#talks-list .talk-list-item[data-talk-id="graph-flow"]')).toBeVisible();
    await page.locator('#talks-list .talk-list-item[data-talk-id="graph-flow"]').screenshot({ path: '/tmp/iinpublic-graph-talk-mobile.png' });
    await expect(page.locator('#talks-list .talk-list-item[data-talk-id="graph-tag"]')).toHaveCount(0);
    await back();
    await expect(peer).toBeVisible();
    // Contacts → Me and Chatrooms, then restore the person page.
    await peer.getByTestId('graph-my-answers').click();
    await active('me');
    await expect(page.locator('#answers-list .answer-talk-item:visible')).toHaveCount(1);
    await back();
    await peer.getByTestId('answer-place').click();
    await active('chatrooms');
    const history = page.getByTestId('graph-place-panel');
    await expect(history).toBeVisible();
    await expect(page.locator('#broadcast-talk-btn')).toBeHidden();
    // Chatrooms → Talks, Contacts, Me through the history's contextual links.
    for (const [link, view] of [['place-talks', 'talks'], ['place-people', 'contacts'], ['graph-my-answers', 'me']]) {
      await history.getByTestId(link!).click();
      await active(view!);
      await back();
      await expect(history).toBeVisible();
    }
    await history.screenshot({ path: '/tmp/iinpublic-graph-place-mobile.png' });
    await back();
    await expect(peer).toBeVisible();
    await page.locator('#back-from-peer-detail').click();
    await active('chatrooms');
    // Talks → Contacts, Me, Chatrooms from a non-tag card, preserving its focused origin.
    await list.getByTestId('place-talks').click();
    await active('talks');
    const card = page.locator('#talks-list .talk-list-item[data-talk-id="graph-flow"]').first();
    for (const [link, view] of [['answer-people', 'contacts'], ['graph-my-answers', 'me'], ['answer-place', 'chatrooms']]) {
      await card.getByTestId(link!).click();
      await active(view!);
      await back();
      await expect(card).toBeVisible();
    }
    // Me → Contacts, Talks, Chatrooms from the same answered question.
    await card.getByTestId('graph-my-answers').click();
    const answer = page.locator('#answers-list .answer-talk-item:visible').filter({ hasText: 'Coffee tomorrow?' });
    for (const [link, view] of [['answer-people', 'contacts'], ['answer-talks', 'talks'], ['answer-place', 'chatrooms']]) {
      await answer.getByTestId(link!).click();
      await active(view!);
      await back();
      await expect(answer).toBeVisible();
    }
    // Every recorded tag Place is independently selectable, including one absent from room rows.
    await page.locator('.nav-btn[data-view="talks"]').click();
    const tag = page.locator('#talks-list .talk-list-item[data-talk-id="graph-tag"]');
    await expect(tag.getByTestId('answer-place')).toHaveCount(2);
    await tag.locator('[data-room-id="place_40.71_-74.00_abcdefabcdef"]').click();
    await expect(history).toHaveAttribute('data-room-id', 'place_40.71_-74.00_abcdefabcdef');
    await back();
    // Enter follows the focused child link, not the tag's answer/selection action.
    await tag.getByTestId('answer-tag-mark').focus();
    await page.keyboard.press('Enter');
    await active('me');
    await expect(page.locator('#me-focus-chip')).toContainText('Graph hiking');
    expect(await page.evaluate(() => (window as any).__iinpublic_app.getApp().getCurrentChatroomId())).toBe(originalRoom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context.close();
    await clearGunForStage1Spec();
  }
});
