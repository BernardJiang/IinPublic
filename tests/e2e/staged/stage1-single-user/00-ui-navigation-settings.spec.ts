/**
 * UI shell contract: five bottom tabs, merged Me answers, contextual stats, and Settings controls.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('UI navigation and settings shell', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('bottom navigation exposes Chatrooms, Contacts, Talks, Me, Settings only', async () => {
    const p = page!;
    await expect(p.locator('.bottom-nav .nav-label')).toHaveText([
      'Chatrooms',
      'Contacts',
      'Talks',
      'Me',
      'Settings',
    ]);
    await expect(p.locator('.nav-btn[data-view="answers"]')).toHaveCount(0);
    await expect(p.locator('.nav-btn[data-view="statistics"]')).toHaveCount(0);

    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#header-status')).toBeVisible();
    await expect(p.locator('#status-bar-text')).not.toContainText(/User.* in /);
    await expect(p.locator('#chatrooms-view > #status-bar')).toHaveCount(0);
    await expect(p.locator('#chatroom-action-bar')).toContainText('New Room');
    await expect(p.locator('#chatroom-action-bar')).toContainText('Return Home');
    await expect(p.locator('#chatroom-action-bar')).toContainText('Broadcast');
    await expect(p.locator('body')).not.toContainText('Uses talks from Talks OUT');
    await expect(p.locator('#return-home-btn')).toBeEnabled();
    await expect(p.locator('#chatrooms-stats-strip')).toHaveCount(0);
    await expect
      .poll(async () => {
        return p.locator('#broadcast-talk-btn').evaluate((button) => {
          const bar = document.getElementById('chatroom-action-bar')?.getBoundingClientRect();
          const rect = button.getBoundingClientRect();
          return {
            compact: rect.width < 180,
            sameRow: bar ? Math.abs(rect.top - bar.top) < 16 : false,
          };
        });
      })
      .toEqual({ compact: true, sameRow: true });
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect
      .poll(async () => {
        return p.locator('.chatroom-item[data-chatroom-id="global"]').evaluate((row) => {
          const style = window.getComputedStyle(row);
          return {
            active: row.classList.contains('current-room'),
            background: style.backgroundImage === 'none' ? style.backgroundColor : style.backgroundImage,
          };
        });
      })
      .toEqual({ active: false, background: 'rgb(255, 255, 255)' });
    await expect(p.locator('.chatroom-item.current-room[data-chatroom-id="asia"]')).toBeVisible();

    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#contacts-status-text')).toBeVisible();
    await expect(p.locator('#contacts-status-text')).toContainText('Contacts from exchanged talks');
    await expect(p.locator('#contacts-view .status-bar')).toHaveCount(0);
    await expect(p.locator('.contacts-action-bar')).toBeVisible();

    const replyFixture = Array.from({ length: 30 }, (_, index) => ({
      responseId: `reply-${index}`,
      talkId: `talk-${index % 3}`,
      title: `Source Talk ${index % 3}`,
      type: index % 2 === 0 ? 'flow' : 'survey',
      language: index % 2 === 0 ? 'en' : 'zh',
      responderId: `responder-${index % 5}`,
      responderName: `Responder ${index % 5}`,
      outcome: index % 3 === 0 ? 'match' : 'mismatch',
      answerMode: index % 4 === 0 ? 'auto' : 'manual',
      date: new Date(Date.UTC(2026, 4, 1, 0, index)).toISOString(),
      answers: [{ questionId: 'q1', answerId: 'a1', answerText: `Answer ${index}` }],
    }));
    await p.route('**/api/users/*/replies', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replyFixture) });
    });
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#talks-status-text')).toBeVisible();
    await expect(p.locator('#talks-status-text')).toContainText(/incoming|Incoming/);
    await expect(p.locator('#talks-view .status-bar')).toHaveCount(0);
    await expect(p.locator('.talks-action-bar')).toBeVisible();
    await expect(p.locator('#create-talk-btn-talks')).toHaveCount(0);
    await expect(p.locator('#talks-view')).not.toContainText('Create New Talk');
    await expect(p.locator('#talks-out-sort-order option[value="latest-reply"]')).toHaveText('Latest reply');
    await expect(p.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('Weighted performance');
    await expect(p.locator('#reply-filter-type')).toBeVisible();
    await expect(p.locator('#reply-filter-language')).toBeVisible();
    await expect(p.locator('#reply-group-order')).toBeVisible();
    await expect(p.locator('#creator-replies-summary')).toContainText('Showing 25 of 30');
    await expect(p.locator('.creator-reply-row')).toHaveCount(25);
    await p.locator('#reply-load-more').click();
    await expect(p.locator('.creator-reply-row')).toHaveCount(30);
    await p.locator('#reply-filter-language').selectOption('zh');
    await p.locator('#reply-group-order').selectOption('talk');
    await expect(p.locator('.creator-reply-row')).toHaveCount(15);
    await expect(p.locator('#creator-replies-active-filters')).toContainText('Language: zh');
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('creatorReplyFilterState')))
      .toContain('"language":"zh"');

    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#me-status-text')).toBeVisible();
    await expect(p.locator('#me-status-text')).toContainText('Answered question history');
    await expect(p.locator('#me-view .status-bar')).toHaveCount(0);
    await expect(p.locator('#me-view')).toBeVisible();
    await expect(p.locator('#answers-content')).toBeVisible();
    await expect(p.locator('.me-answer-filter')).toHaveText(['All', 'Auto', 'Manual', 'Conditional']);
    await expect(p.locator('#me-view')).not.toContainText('My Talks');
    await expect(p.locator('#me-view')).not.toContainText('My Answers');
    await expect(p.locator('#me-view')).not.toContainText('Conversations');
    await expect(p.locator('#copy-talk-autosave-checkbox')).toHaveCount(0);
    await expect(p.locator('#chatbot-enabled-checkbox')).toHaveCount(0);
    await expect(p.locator('#talk-filter-min-distance')).toHaveCount(0);

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#reply-filter-language')).toHaveValue('zh');
    await expect(p.locator('#reply-group-order')).toHaveValue('talk');
    await p.locator('#reply-clear-filters').click();
    await expect(p.locator('#creator-replies-summary')).toContainText('Showing 25 of 30');

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#settings-status-text')).toBeVisible();
    await expect(p.locator('#settings-status-text')).toContainText('Feature and filter controls');
    await expect(p.locator('#settings-view .status-bar')).toHaveCount(0);
    await expect(p.locator('.settings-action-bar')).toBeVisible();
    await expect(p.locator('#settings-view')).toBeVisible();
    await expect(p.locator('#settings-content')).toContainText('Languages');
    await expect(p.locator('#settings-stage-name-input')).toBeVisible();
    await expect(p.locator('#settings-headshot-select')).toBeVisible();
    await expect(p.locator('#settings-edit-stagename-btn')).toHaveCount(0);
    await expect(p.locator('#settings-edit-profile-btn')).toHaveCount(0);
    await expect(p.locator('#settings-copy-talk-autosave')).toBeVisible();
    await expect(p.locator('#settings-chatbot-enabled')).toBeVisible();
    await expect(p.locator('#settings-home-room')).toBeVisible();
    await expect(p.locator('#settings-grammar-filter')).toBeVisible();
    await expect(p.locator('#settings-dirty-words-filter')).toBeVisible();
    await expect(p.locator('#settings-sent-after')).toBeVisible();
    await expect(p.locator('#settings-content')).toContainText('readable sentence length');
    await expect(p.locator('#settings-content')).toContainText('English and Chinese moderation list');
    await expect(p.locator('#settings-credit-visible')).toBeVisible();
    await expect(p.locator('.settings-talk-filter-type')).toHaveCount(4);
    await expect(p.locator('#settings-ui-language')).toHaveValue('en');
    await p.locator('#settings-ui-language').selectOption('zh');
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('设置');
    await expect(p.locator('.nav-btn[data-view="talks"] .nav-label')).toHaveText('话题');
    await expect(p.locator('#settings-content')).toContainText('界面语言');
    await expect(p.locator('#settings-content')).toContainText('个人资料语言');
    await expect(p.locator('#settings-content')).toContainText('内容过滤');
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_ui_language')))
      .toBe('zh');
    await expect(p.locator('#settings-profile-languages')).toHaveValue('en');
    await p.reload();
    await p.waitForLoadState('load');
    await afterSync();
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('设置');
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#settings-ui-language')).toHaveValue('zh');
    await expect(p.locator('#settings-profile-languages')).toHaveValue('en');
    await expect(p.locator('#storage-inspector-flags')).toContainText('模式');
    await expect(p.locator('#storage-inspector-flags')).toContainText('本地节点');
    await expect(p.locator('#storage-inspector-flags')).toContainText('已禁用');
    await expect(p.locator('#storage-inspector-local-node')).toContainText('本地节点管理器');
    await expect(p.locator('#storage-inspector-sea-identity')).toContainText('SEA 身份保管');
    await expect(p.locator('#settings-storage-inspector')).toContainText('浏览器本地存储');
    await expect(p.locator('#settings-storage-inspector')).toContainText('服务器持久化路径');
    await expect(p.locator('#storage-inspector-server')).toContainText('当前成员映射');
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await expect(p.locator('.chatroom-item.current-room .current-room-badge')).toHaveText('当前');
    await p.locator('.chatroom-item.current-room').click();
    await afterNav();
    await expect(p.locator('#current-chatroom-status')).toContainText('位成员');
    await expect(p.locator('#back-to-chatrooms')).toHaveText('返回');
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      void ui.confirmBroadcastAudience([{
        talkId: 'preview-zh',
        title: 'Preview Talk',
        totalCandidates: 2,
        eligibleReceivers: 0,
        rejectedByCounts: { intake_language: 1, blocked_user: 1 },
      }]);
    });
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('检查广播接收对象');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('不接受该语言');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('已被用户屏蔽');
    await p.locator('[data-testid="broadcast-preamble-cancel"]').click();
    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#contacts-filter-relation option[value="all"]')).toHaveText('全部关系');
    await expect(p.locator('#contacts-sort-order option[value="weighted"]')).toHaveText('相关性得分');
    await expect(p.locator('#contacts-list')).toContainText('还没有联系人');
    await p.route('**/api/users/*/peers/localized-peer/relationship', async (route) => route.fulfill({
      json: {
        totalTalks: 1,
        sent: { talks: 1, matches: 1 },
        received: { talks: 0, matches: 0 },
        mutualMatchedTalks: 1,
        mutualTagCount: 0,
      },
    }));
    await p.route('**/api/users/localized-peer?**', async (route) => route.fulfill({
      json: { languages: ['zh'], interests: [{ name: '咖啡' }], profile: [] },
    }));
    await p.route('**/api/users/*/peers/localized-peer/talk-history', async (route) => route.fulfill({
      json: [{
        talkId: 'localized-peer-talk',
        title: 'Localized History',
        direction: 'sent',
        outcome: 'match',
        type: 'flow',
        date: new Date().toISOString(),
      }],
    }));
    await p.route('**/api/users/*/block-status/localized-peer', async (route) => route.fulfill({ json: {} }));
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.openPeerDetailForUser('localized-peer', 'Ming'));
    await expect(p.locator('#peer-detail-overlay')).toBeVisible();
    await expect(p.locator('#peer-detail-overlay')).toContainText('话题历史');
    await expect(p.locator('#peer-detail-overlay')).toContainText('公开资料');
    await expect(p.locator('#peer-detail-overlay')).toContainText('语言: 中文');
    await expect(p.locator('#peer-detail-overlay')).toContainText('交换的话题');
    await expect(p.locator('#peer-detail-overlay')).toContainText('流程');
    await expect(p.locator('#peer-send-talks-btn')).toContainText('发送我的话题');
    await expect(p.locator('#peer-dm-input')).toHaveAttribute('placeholder', '输入消息...');
    await p.locator('#back-from-peer-detail').click();
    await p.unroute('**/api/users/*/peers/localized-peer/relationship');
    await p.unroute('**/api/users/localized-peer?**');
    await p.unroute('**/api/users/*/peers/localized-peer/talk-history');
    await p.unroute('**/api/users/*/block-status/localized-peer');
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#creator-replies-panel')).toContainText('我的话题回复');
    await expect(p.locator('#reply-filter-query')).toHaveAttribute('placeholder', '昵称或话题');
    await expect(p.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('加权表现');
    await expect(p.locator('#creator-replies-summary')).toContainText('筛选回复');
    await expect(p.locator('#talks-stats-strip')).toContainText('统计：');
    await expect(p.locator('#talks-list')).toContainText('还没有话题');
    await p.evaluate(() => {
      localStorage.setItem('myTalks', JSON.stringify({
        localized_created: {
          talkId: 'localized_created',
          title: 'Localized Row',
          type: 'flow',
          language: 'en',
          role: 'created',
          timestamp: new Date().toISOString(),
          lastInteraction: new Date().toISOString(),
        },
      }));
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.displayTalksList();
    });
    const localizedRow = p.locator('.talk-list-item[data-talk-id="localized_created"]');
    await expect(localizedRow).toContainText('已创建');
    await expect(localizedRow.locator('.talk-badge-language')).toHaveText('英语');
    await expect(localizedRow.locator('.talk-badge-type')).toHaveText('流程');
    await expect(localizedRow).toContainText('有效期：永久');
    await expect(localizedRow).toContainText('位置：不限位置');
    await expect(localizedRow).toContainText('广播开启');
    await expect(p.locator('#talks-status-text')).toContainText('1 个发出');
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog());
    await expect(p.locator('#talk-editor-modal')).toContainText('创建话题');
    await expect(p.locator('#talk-editor-modal')).toContainText('话题标题');
    await expect(p.locator('#talk-editor-modal')).toContainText('我喜欢这个标签');
    await expect(p.locator('#talk-title')).toHaveAttribute('placeholder', '例如：咖啡、网球、工作');
    await expect(p.locator('#talk-language option[value="en"]')).toHaveText('英语');
    await expect(p.locator('#talk-language')).toHaveValue('zh');
    await p.locator('input[name="talk-type-radio"][value="flow"]').check();
    await expect(p.locator('#talk-editor-modal')).toContainText('问题（流程）');
    await expect(p.locator('.question-text').first()).toHaveAttribute('placeholder', '输入问题（例如：你喜欢咖啡吗？）');
    await expect(p.locator('.answer-next').first().locator('option[value="noticed"]')).toHaveText('注意到（匹配）');
    await p.locator('input[name="talk-type-radio"][value="route"]').check();
    await expect(p.locator('#talk-editor-modal')).toContainText('路线（分支图编辑器）');
    await expect(p.locator('.route-answer-kind').first()).toHaveText('匹配');
    await expect(p.locator('.route-answer-kind').nth(1)).toHaveText('忽略');
    await expect(p.locator('.route-question-text').first()).toHaveAttribute('placeholder', '问题（以 ? 结尾）');
    await expect(p.locator('.route-answer-text').first()).toHaveAttribute('placeholder', '答案内容（例如：是。）');
    await expect(p.locator('.route-answer-text').first()).toHaveValue('匹配。');
    await expect(p.locator('.route-add-child-btn').first()).toHaveText('+ 子问题');
    await p.locator('.route-add-child-btn').first().click();
    await expect(p.locator('.route-remove-question-btn')).toHaveText('移除问题');
    await expect(p.locator('.route-node[data-qid="q_1"] .route-answer-text').first()).toHaveValue('匹配。');
    await p.locator('#cancel-talk-btn').click();
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkResponseDialog({
      id: 'localization-response',
      title: 'Localized Prompt',
      type: 'flow',
      questions: [{
        id: 'q1',
        text: 'Choose one',
        answers: [{ id: 'a1', text: 'One', isMatch: true, isTerminal: true }],
      }],
    }, { skipAutoAnswer: true }));
    await expect(p.locator('#talk-response-modal')).toContainText('问题 1 共 1');
    await expect(p.locator('#talk-response-modal')).toContainText('自动');
    await expect(p.locator('#talk-response-modal')).toContainText('手动');
    await p.evaluate(() => document.getElementById('talk-response-modal')?.remove());
    await p.evaluate(() => localStorage.removeItem('myTalks'));
    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('.me-answer-filter[data-me-answer-filter="all"]')).toHaveText('全部');
    await expect(p.locator('.me-answer-filter[data-me-answer-filter="conditional"]')).toHaveText('条件');
    await expect(p.locator('#me-view-preferences-btn')).toHaveText('偏好设置');
    await expect(p.locator('#answers-content')).toContainText('你收到并回答的话题会显示在这里');
    await expect(p.locator('#answers-content')).toContainText('偏好设置');
    await p.evaluate(() => {
      localStorage.setItem('myAnswerHistory', JSON.stringify({
        localized_answer: {
          id: 'localized_answer',
          talkId: 'localized_answer_talk',
          title: 'Localized Answer',
          type: 'tag',
          outcome: 'match',
          answeredAt: new Date().toISOString(),
          senderIds: ['sender-1'],
          locationRadiusMiles: 5,
          items: [{
            questionId: 'q1',
            answerId: 'a1',
            prompt: 'Coffee',
            choice: 'Checked',
            kind: 'tag',
            contextPath: [],
            mode: 'manual',
          }],
        },
      }));
      localStorage.setItem('answerPreferences', JSON.stringify({
        localized_preference: {
          answerId: 'a1',
          answerText: 'Yes',
          mode: 'manual',
          questionText: 'Coffee?',
          timestamp: new Date().toISOString(),
        },
      }));
      localStorage.setItem('myTalks', JSON.stringify({
        localized_history: {
          talkId: 'localized_history',
          title: 'History Row',
          type: 'flow',
          role: 'created',
          disabled: false,
          lastInteraction: new Date().toISOString(),
        },
      }));
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      ui?.displayAnswersList();
    });
    await expect(p.locator('#answers-content')).toContainText('来自 1 位发送者');
    await expect(p.locator('#answers-content')).toContainText('5 英里以内');
    await expect(p.locator('#answers-content')).toContainText('已勾选');
    await expect(p.locator('#answers-content')).toContainText('手动');
    await expect(p.locator('#answers-content')).toContainText('标签');
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showPreferencesDialog());
    await expect(p.locator('#preferences-modal')).toContainText('我的回答');
    await expect(p.locator('#preferences-modal')).toContainText('最近回答：');
    await expect(p.locator('#preferences-modal')).toContainText('手动');
    await p.locator('#close-preferences-modal').click();
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showMyTalksDialog());
    await expect(p.locator('#my-talks-modal')).toContainText('我的话题');
    await expect(p.locator('#my-talks-modal')).toContainText('由我创建');
    await expect(p.locator('#my-talks-modal')).toContainText('流程');
    await expect(p.locator('#my-talks-modal')).toContainText('最近互动：');
    await expect(p.locator('#my-talks-modal')).toContainText('广播开启');
    await p.locator('#close-my-talks-modal').click();
    await p.evaluate(() => {
      localStorage.removeItem('myAnswerHistory');
      localStorage.removeItem('answerPreferences');
      localStorage.removeItem('myTalks');
    });
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await p.locator('#settings-ui-language').selectOption('en');
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('Settings');
    await p.locator('#settings-profile-languages').selectOption('zh');
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('Settings');
    await expect(p.locator('#settings-ui-language')).toHaveValue('en');
    await p.locator('#settings-profile-languages').selectOption('en');
    await p.locator('#settings-copy-talk-autosave').uncheck();
    await p.locator('#settings-chatbot-enabled').uncheck();
    await p.locator('.settings-filter-language-option[value="zh"]').check();
    await p.locator('#settings-grammar-filter').uncheck();
    await p.locator('#settings-dirty-words-filter').uncheck();
    await p.locator('#settings-custom-blocked').fill('alpha, beta');
    await expect
      .poll(async () => p.evaluate(() => {
        const filters = JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}');
        return {
          allowedLanguages: filters.allowedLanguages,
          requireGoodGrammar: filters.requireGoodGrammar,
          blockDirtyWords: filters.blockDirtyWords,
          customBlockedTerms: filters.customBlockedTerms,
          copyTalkAutoSave: localStorage.getItem('copyTalkAutoSave'),
          chatbotEnabled: localStorage.getItem('chatbotEnabled'),
        };
      }))
      .toEqual({
        allowedLanguages: ['en', 'zh'],
        requireGoodGrammar: false,
        blockDirtyWords: false,
        customBlockedTerms: ['alpha', 'beta'],
        copyTalkAutoSave: 'false',
        chatbotEnabled: 'false',
      });
    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#settings-copy-talk-autosave')).toBeHidden();
    await expect(p.locator('#settings-chatbot-enabled')).toBeHidden();
    await expect(p.locator('.settings-filter-language-option').first()).toBeHidden();
    await expect(p.locator('#settings-custom-blocked')).toBeHidden();
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#settings-copy-talk-autosave')).not.toBeChecked();
    await expect(p.locator('#settings-chatbot-enabled')).not.toBeChecked();
    await expect(p.locator('.settings-filter-language-option[value="en"]')).toBeChecked();
    await expect(p.locator('.settings-filter-language-option[value="zh"]')).toBeChecked();
    await expect(p.locator('#settings-grammar-filter')).not.toBeChecked();
    await expect(p.locator('#settings-dirty-words-filter')).not.toBeChecked();
    await expect(p.locator('#settings-custom-blocked')).toHaveValue('alpha, beta');
    await p.locator('#settings-sent-after').fill('2026-05-01T09:30');
    await expect
      .poll(async () => p.evaluate(() => JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').sentAfter))
      .toContain('2026-05-01T');
    await p.locator('#settings-min-distance').fill('51');
    await p.locator('#settings-max-distance').fill('50');
    await p.locator('#settings-max-distance').blur();
    await expect(p.locator('#settings-min-distance')).not.toHaveValue('51');

    await p.locator('#settings-home-room').selectOption('california');
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_travel_home')))
      .toBe('california');
    await expect(p.locator('#return-home-btn')).toBeEnabled();

    await p.locator('#settings-home-room').selectOption('global');
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_travel_home')))
      .toBe('global');
    await expect(p.locator('#return-home-btn')).toBeEnabled();
  });

  test('custom room creation opens the newly created room', async () => {
    const p = page!;
    const roomName = `Mesa College ${Date.now()}`;

    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await p.locator('#create-custom-chatroom-btn').click();
    await p.locator('#custom-room-name').fill(roomName);
    await p.locator('[data-testid="custom-room-submit-btn"]').click();

    await expect(p.locator('#current-chatroom-title')).toContainText(roomName, { timeout: 20_000 });

    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(p.locator('#chatroom-list')).toContainText(roomName);
  });

  test('auto-copy keeps answered talks in OUT and stores flat answer history', async () => {
    const p = page!;

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await p.locator('#settings-copy-talk-autosave').check();

    const result = await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager as any;
      const talk = {
        id: 'incoming_flat_history_1',
        title: 'Flat History Incoming Talk',
        type: 'flow',
        authorId: 'sender-flat-history',
        createdAt: '2026-05-14T12:00:00.000Z',
        locationRadiusMiles: 5,
        questions: [
          {
            id: 'q1',
            text: 'Preferred campus food?',
            answers: [
              { id: 'a1', text: 'Tacos', isMatch: true, counter: 2 },
              { id: 'a2', text: 'Pizza', isMatch: false },
            ],
          },
        ],
      };
      ui.completeTalk(talk, [{ questionId: 'q1', answerId: 'a1', answerText: 'Tacos', mode: 'manual' }], 'match');
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const history = JSON.parse(localStorage.getItem('myAnswerHistory') || '{}');
      const record = Object.values(history)[0] as any;
      return {
        role: myTalks.incoming_flat_history_1?.role,
        outTitle: myTalks.incoming_flat_history_1?.title,
        historyCount: Object.keys(history).length,
        record,
        serializedRecord: JSON.stringify(record),
      };
    });

    expect(result.role).toBe('copied');
    expect(result.outTitle).toBe('Flat History Incoming Talk');
    expect(result.historyCount).toBe(1);
    expect(result.record.title).toBe('Flat History Incoming Talk');
    expect(result.record.items).toEqual([
      expect.objectContaining({
        questionId: 'q1',
        answerId: 'a1',
        prompt: 'Preferred campus food?',
        choice: 'Tacos',
        kind: 'question',
      }),
    ]);
    expect(result.serializedRecord).not.toContain('"questions"');

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('.talk-list-item[data-role="copied"]').filter({ hasText: 'Flat History Incoming Talk' })).toBeVisible();

    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#answers-content')).toContainText('Preferred campus food?');
    await expect(p.locator('#answers-content')).toContainText('Tacos');

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await p.locator('#settings-copy-talk-autosave').uncheck();
    const disabledCopyResult = await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app.getApp().uiManager as any;
      const talk = {
        id: 'incoming_no_copy_2',
        title: 'History Only Incoming Talk',
        type: 'flow',
        authorId: 'sender-history-only',
        questions: [{
          id: 'q2',
          text: 'Keep in history only?',
          answers: [{ id: 'a2', text: 'Yes', isMatch: true }],
        }],
      };
      ui.completeTalk(talk, [{ questionId: 'q2', answerId: 'a2', answerText: 'Yes', mode: 'manual' }], 'match');
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const history = JSON.parse(localStorage.getItem('myAnswerHistory') || '{}');
      return {
        copiedRole: myTalks.incoming_no_copy_2?.role,
        historyTitles: Object.values(history).map((record: any) => record.title),
      };
    });
    expect(disabledCopyResult.copiedRole).toBe('answered');
    expect(disabledCopyResult.historyTitles).toContain('History Only Incoming Talk');
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('.talk-list-item[data-role="copied"]').filter({ hasText: 'History Only Incoming Talk' })).toHaveCount(0);
  });

  test('settings tolerates legacy string-valued profile and filter fields', async () => {
    const p = page!;
    await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager;
      ui.showMainInterface({
        id: 'legacy-user',
        stageName: 'Legacy User',
        profile: [],
        reputation: {
          questionsAnswered: 0,
          talksSent: 0,
          matchesFound: 0,
          friendsCount: 0,
          mutualFriendsCount: 0,
          likedCount: 0,
          dislikedCount: 0,
          starRating: 3,
          reviewCount: 0,
          ageVerified: false,
          ageVerificationVotes: 0,
          blockCount: 0,
          isHidden: false,
        },
        location: { region: 'region_37.77_-122.42', chatrooms: ['global'] },
        languages: 'en, zh',
        interests: [],
        createdAt: new Date(),
        lastActive: new Date(),
        talkFilters: {
          allowedLanguages: 'en, zh',
          requireGoodGrammar: true,
          blockDirtyWords: false,
          allowedTalkTypes: 'flow',
          customBlockedTerms: 'spam, scam',
        },
      });
    });

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('body')).not.toContainText('Oops! Something went wrong');
    await expect(p.locator('#settings-profile-languages')).toHaveValue('en');
    await expect
      .poll(() =>
        p.locator('#settings-filter-languages').evaluate((container) =>
          Array.from(container.querySelectorAll<HTMLInputElement>('.settings-filter-language-option:checked'))
            .map((option) => option.value)
            .sort()
            .join(','),
        ),
      )
      .toBe('en,zh');
    await expect(p.locator('#settings-custom-blocked')).toHaveValue('spam, scam');
  });

  test('broadcast history suppresses unchanged repeat room sends', async () => {
    const p = page!;
    const result = await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager as any;
      const talk = {
        id: 'repeat_talk_1',
        title: 'Repeat Guard',
        type: 'flow',
        role: 'created',
        lastInteraction: '2026-05-14T00:00:00.000Z',
        fullTalk: {
          id: 'repeat_talk_1',
          title: 'Repeat Guard',
          type: 'flow',
          questions: [{ id: 'q1', text: 'Repeat?', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }],
        },
      };
      localStorage.setItem('myTalks', JSON.stringify({ repeat_talk_1: talk }));
      const before = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      ui.recordBroadcastConversation('global', ['repeat_talk_1'], [{ userId: 'peer-1' }]);
      const afterSame = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      localStorage.setItem('myTalks', JSON.stringify({
        repeat_talk_1: { ...talk, lastInteraction: '2026-05-14T00:01:00.000Z' },
      }));
      const afterUpdate = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      return { before, afterSame, afterUpdate };
    });

    expect(result.before).toEqual(['repeat_talk_1']);
    expect(result.afterSame).toEqual([]);
    expect(result.afterUpdate).toEqual(['repeat_talk_1']);
  });
});
