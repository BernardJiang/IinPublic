/**
 * UI shell contract: five bottom tabs, merged Me answers, contextual stats, and Settings controls.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { gotoWebApp, injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, reloadAppReady } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, backToSettingsMenu, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('UI navigation and settings shell', () => {
  test.describe.configure({ retries: 0 });
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('bottom navigation exposes Chatrooms, Contacts, Talks, Me, Settings only', async () => {
    const p = page!;
    await expect(p.locator('.bottom-nav .nav-btn .nav-label')).toHaveText([
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
    // AppBar icon buttons (redesign §2): the old #chatroom-action-bar row is gone.
    await expect(p.locator('#chatroom-action-bar')).toHaveCount(0);
    await expect(p.locator('#top-header #create-custom-chatroom-btn')).toBeVisible();
    await expect(p.locator('#create-custom-chatroom-btn')).toHaveAttribute('title', 'New Room');
    await expect(p.locator('#top-header #return-home-btn')).toBeVisible();
    await expect(p.locator('#top-header #broadcast-talk-btn')).toBeVisible();
    await expect(p.locator('#broadcast-talk-btn .app-bar-btn-icon')).toHaveText('📣');
    await expect(p.locator('body')).not.toContainText('Uses talks from Talks OUT');
    await expect(p.locator('#return-home-btn')).toBeEnabled();
    await expect(p.locator('#chatrooms-stats-strip')).toHaveCount(0);
    const duplicateVisitCheck = await p.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const read = () => app.uiManager.chatroomVisitCounts.get('global')?.visitCount || 0;
      const before = read();
      await app.chatroomService.switchChatroom(app.currentUser.id, 'global', app.currentUser.stageName);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const mid = read();
      await app.chatroomService.switchChatroom(app.currentUser.id, 'global', app.currentUser.stageName);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { before, mid, after: read() };
    });
    expect(duplicateVisitCheck.before).toBeGreaterThan(0);
    expect(duplicateVisitCheck.mid).toBe(duplicateVisitCheck.before);
    expect(duplicateVisitCheck.after).toBe(duplicateVisitCheck.before);
    await expect
      .poll(async () => {
        return p.locator('#broadcast-talk-btn').evaluate((button) => {
          const bar = document.getElementById('top-header')?.getBoundingClientRect();
          const rect = button.getBoundingClientRect();
          return {
            compact: rect.width < 180,
            sameRow: bar ? rect.top >= bar.top && rect.bottom <= bar.bottom + 1 : false,
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
    // The row-count header line now merges into the stats strip (§AA) instead of a
    // separate #contacts-status-text element.
    await expect(p.locator('#contacts-stats-strip')).toBeVisible();
    await expect(p.locator('#contacts-stats-strip')).toContainText('0 contacts from exchanged talks');
    await expect(p.locator('#contacts-view .status-bar')).toHaveCount(0);
    await expect(p.locator('.contacts-action-bar')).toBeVisible();

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#talks-stats-strip')).toBeVisible();
    await expect(p.locator('#talks-stats-strip')).toContainText(/incoming|Incoming/);
    await expect(p.locator('#talks-view .status-bar')).toHaveCount(0);
    await expect(p.locator('.talks-action-bar')).toBeVisible();
    await expect(p.locator('#create-talk-btn-talks')).toHaveCount(0);
    await expect(p.locator('#talks-view')).not.toContainText('Create New Talk');
    await expect(p.locator('#talks-out-sort-order option[value="latest-reply"]')).toHaveText('Latest reply');
    await expect(p.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('Weighted performance');
    // TODO §M1: "Replies To My Talks" panel is hidden for now.
    await expect(p.locator('#creator-replies-panel')).toBeHidden();

    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#me-status-text')).toBeVisible();
    await expect(p.locator('#me-status-text')).toContainText('Answered question history');
    await expect(p.locator('#me-view .status-bar')).toHaveCount(0);
    await expect(p.locator('#me-view')).toBeVisible();
    await expect(p.locator('#answers-content')).toBeVisible();
    await expect(p.locator('.me-talk-type-filter')).toHaveText(['Tag', 'Flow', 'Survey', 'Route']);
    await expect(p.locator('.me-tag-state-checkbox')).toHaveCount(3);
    await expect(p.locator('#me-view')).not.toContainText('My Talks');
    await expect(p.locator('#me-view')).not.toContainText('My Answers');
    await expect(p.locator('#me-view')).not.toContainText('Conversations');
    await expect(p.locator('#me-view')).not.toContainText('Credit');
    await expect(p.locator('#me-view')).not.toContainText('Profile');
    await expect(p.locator('#copy-talk-autosave-checkbox')).toHaveCount(0);
    await expect(p.locator('#chatbot-enabled-checkbox')).toHaveCount(0);
    await expect(p.locator('#talk-filter-min-distance')).toHaveCount(0);

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#header-title')).toBeEmpty();
    await expect(p.locator('#settings-status-text')).toBeVisible();
    await expect(p.locator('#settings-status-text')).toContainText('Feature and filter controls');
    await expect(p.locator('#settings-view .status-bar')).toHaveCount(0);
    // Settings actions live in the AppBar now (redesign §1): 📍 refresh-location icon.
    await expect(p.locator('#top-header #settings-refresh-location-btn')).toBeVisible();
    await expect(p.locator('#settings-view')).toBeVisible();
    await expect(p.locator('#settings-content')).toContainText('Languages');

    await openSettingsSection(p, SETTINGS_SECTION.profile);
    await expect(p.locator('#settings-stage-name-input')).toBeVisible();
    await expect(p.locator('#settings-headshot-select')).toBeVisible();
    await expect(p.locator('#settings-edit-stagename-btn')).toHaveCount(0);
    await expect(p.locator('#settings-edit-profile-btn')).toBeVisible();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.credit);
    await expect(p.locator('#settings-content')).toContainText('Credit');
    await expect(p.locator('#settings-credit-visible')).toBeVisible();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.talkBehavior);
    await expect(p.locator('#settings-copy-talk-autosave')).toBeVisible();
    await expect(p.locator('#settings-chatbot-enabled')).toBeVisible();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.distanceHome);
    await expect(p.locator('#settings-home-room')).toBeVisible();
    await expect(p.locator('#settings-sent-after')).toBeVisible();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await expect(p.locator('#settings-grammar-filter')).toBeVisible();
    await expect(p.locator('#settings-dirty-words-filter')).toBeVisible();
    await expect(p.locator('#settings-content')).toContainText('readable sentence length');
    await expect(p.locator('#settings-content')).toContainText('English and Chinese moderation list');
    await expect(p.locator('.settings-talk-filter-type')).toHaveCount(4);
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.languages);
    await expect(p.locator('#settings-ui-language')).toHaveValue('en');
    await expect(p.locator('#settings-default-talk-language')).toHaveValue('en');
    await p.locator('#settings-ui-language').selectOption('zh');
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('设置');
    await expect(p.locator('.nav-btn[data-view="talks"] .nav-label')).toHaveText('话题');
    await expect(p.locator('#settings-content')).toContainText('界面语言');
    await expect(p.locator('#settings-content')).toContainText('个人资料语言');
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_ui_language')))
      .toBe('zh');
    await expect(p.locator('#settings-profile-languages')).toHaveValue('en');
    await backToSettingsMenu(p);
    await expect(p.locator('#settings-content')).toContainText('内容过滤');

    await reloadAppReady(p);
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.languages);
    await expect(p.locator('#settings-ui-language')).toHaveValue('zh');
    await expect(p.locator('#settings-profile-languages')).toHaveValue('en');
    await expect(p.locator('#settings-default-talk-language')).toHaveValue('zh');
    await p.locator('#settings-default-talk-language').selectOption('en');
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_default_talk_language')))
      .toBe('en');
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.storageInspector);
    await expect(p.locator('#storage-inspector-flags')).toContainText('模式');
    await expect(p.locator('#storage-inspector-flags')).toContainText('本地节点');
    await expect(p.locator('#storage-inspector-flags')).toContainText('已禁用');
    await expect(p.locator('#storage-inspector-runtime-features')).toContainText('传输回退');
    // P2P-messaging Phase 1: ordinary DMs are direct-p2p only, so the conversation
    // transport advertises no fallback (`fallback: null`) → inspector shows 无 (none).
    await expect(p.locator('#storage-inspector-runtime-features')).toContainText('无');
    await expect(p.locator('#storage-inspector-runtime-features')).toContainText('支持引导');
    await expect(p.locator('#storage-inspector-runtime-features')).toContainText('活动');
    await expect(p.locator('#storage-inspector-app-state')).toContainText('TechSupport 根身份');
    await expect(p.locator('#storage-inspector-app-state')).toContainText('支持频道');
    await expect(p.locator('#storage-inspector-app-state')).toContainText('接收话题语言');
    await expect(p.locator('#storage-inspector-app-state')).toContainText('新话题默认语言');
    await expect(p.locator('#storage-inspector-app-state')).toContainText('英语');
    await expect(p.locator('#storage-inspector-room-visits')).toContainText('房间访问 / 独立访客');
    await expect(p.locator('#storage-inspector-local-node')).toContainText('本地节点管理器');
    await expect(p.locator('#storage-inspector-sea-identity')).toContainText('SEA 身份保管');
    await expect(p.locator('#settings-storage-inspector')).toContainText('浏览器本地存储');
    await expect(p.locator('#settings-storage-inspector')).toContainText('服务器持久化路径');
    await expect(p.locator('#storage-inspector-server')).toContainText('当前成员映射');
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.distanceHome);
    await p.locator('#settings-max-distance').fill('5');
    await p.locator('#settings-max-distance').press('Tab');
    await p.locator('#settings-min-distance').fill('10');
    await p.locator('#settings-min-distance').press('Tab');
    await expect(p.locator('.notification').filter({ hasText: '最小距离不能大于最大距离。' })).toBeVisible();
    await p.locator('.notification').filter({ hasText: '最小距离不能大于最大距离。' }).click();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.profile);
    await p.locator('#settings-stage-name-input').fill('a');
    await p.locator('#settings-stage-name-input').press('Tab');
    await expect(p.locator('#settings-stage-name-error')).toHaveText('昵称至少需要 3 个字符。');
    await expect(p.locator('.notification').filter({ hasText: '昵称至少需要 3 个字符。' })).toBeVisible();
    await p.locator('.notification').filter({ hasText: '昵称至少需要 3 个字符。' }).click();
    await p.locator('#settings-photo-input').setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(p.locator('.notification').filter({ hasText: '请选择 PNG、JPEG、WebP 或 GIF 图片。' })).toBeVisible();
    await p.locator('.notification').filter({ hasText: '请选择 PNG、JPEG、WebP 或 GIF 图片。' }).click();
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await expect(p.locator('.chatroom-item.current-room .current-room-badge')).toHaveText('当前');
    await p.locator('.chatroom-item.current-room').click();
    await afterNav();
    await expect(p.locator('#current-chatroom-status')).toContainText('位成员');
    // Back is an icon now; the translation lives on its tooltip.
    await expect(p.locator('#back-to-chatrooms')).toHaveAttribute('title', '返回');
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await p.locator('#create-custom-chatroom-btn').click();
    const createRoomModal = p.locator('#create-custom-chatroom-form').locator('xpath=..');
    await expect(createRoomModal).toContainText('新建聊天室');
    await expect(createRoomModal).toContainText('创建社区或商业房间');
    await expect(p.locator('#custom-room-type option[value="custom"]')).toHaveText('社区 / 自定义');
    await expect(p.locator('#custom-room-type option[value="business"]')).toHaveText('商业');
    await expect(p.locator('#custom-room-capacity')).toHaveAttribute('placeholder', '默认 50');
    await expect(p.locator('[data-testid="custom-room-submit-btn"]')).toHaveText('创建');
    await p.locator('#cancel-custom-room-btn').click();
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      void ui.showRenameCustomChatroomDialog('演示房间');
    });
    const renameRoomModal = p.locator('#rename-custom-chatroom-form').locator('xpath=..');
    await expect(renameRoomModal).toContainText('重命名房间');
    await expect(renameRoomModal).toContainText('当前：演示房间');
    await expect(p.locator('#rename-custom-room-name')).toHaveValue('演示房间');
    await expect(p.locator('#cancel-rename-room-btn')).toHaveText('取消');
    await p.locator('#cancel-rename-room-btn').click();
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      void ui.confirmBroadcastAudience([{
        talkId: 'preview-zh',
        title: 'Preview Talk',
        totalCandidates: 2,
        eligibleReceivers: 1,
        rejectedByCounts: { intake_language: 1, blocked_user: 1 },
        eligibleReceiverNames: ['Ming'],
        rejectedReceiverDetails: [{ name: 'Lin', rejectedBy: ['intake_language', 'blocked_user'] }],
        supportExcludedCount: 1,
      }]);
    });
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('检查广播接收对象');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('不接受该语言');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('已被用户屏蔽');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('接收对象：Ming');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('已跳过：Lin');
    await expect(p.locator('[data-testid="broadcast-preamble-modal"]')).toContainText('TechSupport 支持频道不参与普通广播');
    await p.locator('[data-testid="broadcast-preamble-cancel"]').click();
    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#contacts-filter-relation option[value="all"]')).toHaveText('全部关系');
    await expect(p.locator('#contacts-sort-order option[value="weighted"]')).toHaveText('相关性得分');
    const supportContact = p.locator('#contacts-list .contact-support-item');
    await expect(supportContact).toContainText('TechSupport');
    // TODO §M5: the row is compact now — "内置" comes from the pinned badge (the old dedicated
    // "内置支持联系人" line was dropped as redundant with it), and mute state is a small inline
    // icon, not a full-sentence line.
    await expect(supportContact).toContainText('内置');
    await expect(supportContact.locator('.techsupport-mute-indicator')).toHaveAttribute('data-support-muted', 'false');
    await p.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      await app.gunService.put('user-public-profile/localized-peer', {
        languagesJson: JSON.stringify(['zh']),
        interestsJson: JSON.stringify([{ name: '咖啡' }]),
        profileJson: '[]',
      });
      localStorage.setItem('localTalkExchanges', JSON.stringify({
        'localized-peer::localized-peer-talk': {
          peerId: 'localized-peer',
          peerName: 'Ming',
          responseId: 'localized-peer-response',
        talkId: 'localized-peer-talk',
        title: 'Localized History',
        direction: 'sent',
        outcome: 'match',
        type: 'flow',
          language: 'zh',
        date: new Date().toISOString(),
        },
      }));
    });
    await p.route('**/api/users/*/block-status/localized-peer', async (route) => route.fulfill({ json: {} }));
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.openPeerDetailForUser('localized-peer', 'Ming'));
    await expect(p.locator('#peer-detail-overlay')).toBeVisible();
    await expect(p.locator('#peer-detail-overlay')).toContainText('话题历史');
    await expect(p.locator('#peer-detail-overlay')).toContainText('公开资料');
    await expect(p.locator('#peer-detail-overlay')).toContainText('语言: 中文');
    await expect(p.locator('#peer-detail-overlay')).toContainText('交换的话题');
    await expect(p.locator('#peer-detail-overlay')).toContainText('流程');
    await expect(p.locator('.peer-transport-status')).toContainText('频道传输');
    await expect(p.locator('.peer-transport-status')).toContainText('直接 P2P');
    await expect(p.locator('.peer-transport-fallback')).toContainText('尚未报告回退原因');
    await expect(p.locator('.peer-transport-health')).toContainText('尚未记录已送达的消息');
    await expect(p.locator('#peer-send-talks-btn')).toContainText('发送我的话题');
    await expect(p.locator('#peer-dm-input')).toHaveAttribute('placeholder', '输入消息...');
    await p.locator('#back-from-peer-detail').click();
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      ui?.showNotification(ui.formatAgeVoteSubmitted(), 'success');
      ui?.showNotification(ui.formatUserBlockChanged(true), 'success');
      ui?.showNotification(ui.formatUserBlockChanged(false), 'success');
      ui?.showNotification(ui.formatMatchToStartConversation(), 'info');
    });
    await expect(p.locator('.notification').filter({ hasText: '已提交年龄验证担保。' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '已屏蔽该用户，话题投递现已停用。' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '已取消屏蔽该用户。' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '请先通过话题与该用户匹配，再开始对话！' })).toBeVisible();
    await p.evaluate(() => {
      document.querySelectorAll('.notification').forEach((notification) => notification.remove());
    });
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      const conversationId = 'localized_support_conversation';
      (window as any).__localizedPreviousConversations = localStorage.getItem('myConversations');
      ui?.addNewConversation?.({
        conversationId,
        otherUserId: 'iinpublic-root-techsupport',
        otherUserName: 'TechSupport',
        supportChannel: true,
        transportMode: 'star-gun',
      });
      // K2 (docs/TODO.md): the stored greeting text is already rendered in its write-time
      // locale — there is no runtime re-localization, so this fixture supplies the Chinese
      // text directly rather than relying on a regex re-localizer that no longer exists.
      const greetingText = '欢迎来到 IinPublic，Ming。如需帮助，TechSupport 随时为你服务。';
      ui?.updateConversationMessage?.(
        conversationId,
        greetingText,
        new Date().toISOString(),
      );
      ui?.showConversationDetail?.(conversationId);
      ui?.displayConversationMessages?.(conversationId, [{
        text: greetingText,
        timestamp: new Date().toISOString(),
        isOwnMessage: false,
      }]);
    });
    await expect(p.locator('.notification').filter({ hasText: 'TechSupport 支持频道已就绪。' })).toBeVisible();
    await expect(p.locator('#conversation-detail-overlay')).toBeVisible();
    await expect(p.locator('#back-from-conversation')).toContainText('返回');
    await expect(p.locator('#conversation-status')).toHaveText('在线');
    await expect(p.locator('#conversation-transport-status')).toContainText('传输方式: 兼容星型同步');
    await expect(p.locator('#conversation-fallback-status')).toContainText('当前未启用传输回退');
    await expect(p.locator('#conversation-health-status')).toContainText('最近确认通信');
    await expect(p.locator('#conversation-message-input')).toHaveAttribute('placeholder', '输入消息...');
    await expect(p.locator('#send-conversation-message')).toHaveText('发送');
    await expect(p.locator('#conversation-messages')).toContainText('欢迎来到 IinPublic，Ming');
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      ui?.showNotification(ui.formatAnswerProcessFailed('测试失败'), 'error');
      ui?.showNotification(ui.formatNotInChatroom(), 'error');
      ui?.showNotification(ui.formatMessageSent(), 'success');
      ui?.showNotification(ui.formatMessageSendFailed('网络故障'), 'error');
      ui?.showNotification(ui.formatConversationLoadFailed('网络故障'), 'error');
    });
    await expect(p.locator('.notification').filter({ hasText: '无法处理回答：测试失败' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '当前不在聊天室中。' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '消息已发送！' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '无法发送消息：网络故障' })).toBeVisible();
    await expect(p.locator('.notification').filter({ hasText: '无法加载对话：网络故障' })).toBeVisible();
    await p.evaluate(() => {
      document.querySelectorAll('.notification').forEach((notification) => notification.remove());
    });
    await p.locator('#back-from-conversation').click();
    await p.evaluate(() => {
      const previous = (window as any).__localizedPreviousConversations;
      if (previous === null) localStorage.removeItem('myConversations');
      else localStorage.setItem('myConversations', previous);
      delete (window as any).__localizedPreviousConversations;
    });
    await p.unroute('**/api/users/*/peers/localized-peer/relationship');
    await p.unroute('**/api/users/localized-peer?**');
    await p.unroute('**/api/users/*/peers/localized-peer/talk-history');
    await p.unroute('**/api/users/*/block-status/localized-peer');
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#creator-replies-panel')).toContainText('我的话题回复');
    await expect(p.locator('#reply-filter-query')).toHaveAttribute('placeholder', '昵称或话题');
    await expect(p.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('加权表现');
    await expect(p.locator('#reply-filter-language option[value="zh"]')).toHaveText('中文');
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
    await expect(localizedRow.locator('.talk-badge-type')).toContainText('流程');
    await expect(localizedRow).toContainText('有效期：永久');
    await expect(localizedRow).toContainText('位置：不限位置');
    // The broadcast toggle is a real checkbox now — its localized label lives in the
    // wrapping badge's title attribute, not visible text.
    await expect(localizedRow.locator('.talk-icon-badge')).toHaveAttribute('title', '广播开启');
    await expect(p.locator('#talks-stats-strip')).toContainText('1 个发出');
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog());
    await expect(p.locator('#talk-editor-modal')).toContainText('创建话题');
    await expect(p.locator('#talk-editor-modal')).toContainText('话题标题');
    await expect(p.locator('#talk-editor-modal')).toContainText('我喜欢这个标签');
    await expect(p.locator('#talk-title')).toHaveAttribute('placeholder', '例如：咖啡、网球、工作');
    await expect(p.locator('#talk-language option[value="en"]')).toHaveText('英语');
    await expect(p.locator('#talk-language')).toHaveValue('en');
    await p.evaluate(() => {
      document.getElementById('talk-editor-form')?.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(p.locator('#talk-validation-errors')).toContainText('无法保存，请修正：');
    await expect(p.locator('#talk-validation-errors')).toContainText('必须输入标签关键词');
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
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkCompletion('localized', 'match'));
    await expect(p.locator('.notification').filter({ hasText: '话题完成结果：匹配' })).toBeVisible();
    await p.locator('.notification').filter({ hasText: '话题完成结果：匹配' }).click();
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      ui?.showNotification(ui.formatTalkMatched('Ming', '测试话题'), 'success');
    });
    const localizedMatchToast = p.locator('.notification').filter({ hasText: '匹配！Ming 在“测试话题”中注意到了你' });
    await expect(localizedMatchToast).toHaveAttribute('data-match-notification', 'true');
    await localizedMatchToast.click();
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
    await expect(p.locator('.me-talk-type-filter')).toHaveText(['标签', '流程', '问卷', '路线']);
    await expect(p.locator('#me-tag-state-filter-label')).toHaveText('标签状态');
    await expect(p.locator('#me-view')).not.toContainText('信用');
    await expect(p.locator('#me-view')).not.toContainText('资料');

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.profile);
    await expect(p.locator('#settings-content')).toContainText('昵称');
    await expect(p.locator('#settings-stage-name-input')).toBeVisible();
    await expect(p.locator('#settings-content')).toContainText('每项问答的可见范围');
    await expect(p.locator('#settings-content')).toContainText('语言: 英语');
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.credit);
    await expect(p.locator('#settings-content')).toContainText('信用');
    await expect(p.locator('#settings-content')).toContainText('来自其他用户互动的只读信誉摘要');
    await expect(p.locator('#settings-content')).toContainText('评价');
    await expect(p.locator('#settings-content')).toContainText('星级');
    await expect(p.locator('#settings-content')).toContainText('匹配数');
    await expect(p.locator('#settings-content')).toContainText('年龄已验证');
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.profile);
    await p.locator('#settings-edit-profile-btn').click();
    await expect(p.locator('#edit-profile-form')).toContainText('头像');
    await expect(p.locator('#edit-profile-form')).toContainText('输入兴趣的默认分类');
    await expect(p.locator('#edit-profile-form')).toContainText('资料项目');
    await expect(p.locator('#profile-languages-input')).toHaveCount(0);
    await expect(p.locator('.profile-language-option[value="en"]')).toBeChecked();
    await expect(p.locator('.profile-language-option[value="zh"]').locator('xpath=..')).toContainText('中文');
    await p.locator('.profile-language-option[value="zh"]').check();
    await expect(p.locator('#profile-interest-category-default option[value="community"]')).toHaveText('社区');
    await expect(p.locator('.profile-visibility-select').first().locator('option[value="public"]')).toHaveText('所有人');
    await p.locator('#add-profile-qa-btn').click();
    await expect(p.locator('.profile-question-input').last()).toHaveAttribute('placeholder', '问题');
    await expect(p.locator('.remove-profile-qa-btn').last()).toHaveText('移除');
    await expect(p.locator('#save-profile-btn')).toHaveText('保存资料');
    await p.locator('#save-profile-btn').click();
    await expect(p.locator('#settings-content')).toContainText('语言: 英语, 中文');
    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#answers-content')).toContainText('你收到并回答的话题会显示在这里');
    await p.evaluate(() => {
      localStorage.setItem('myAnswerHistory', JSON.stringify({
        support_message_leak: {
          id: 'support_message_leak',
          talkId: 'support_message_leak',
          title: 'Welcome to IinPublic, Ming. TechSupport is here if you need help.',
          type: 'flow',
          language: 'en',
          supportMessage: true,
          supportChannel: true,
          outcome: 'mismatch',
          answeredAt: new Date().toISOString(),
          senderIds: ['iinpublic-root-techsupport'],
          items: [{
            questionId: 'support',
            answerId: 'welcome',
            prompt: 'Welcome',
            choice: 'Support',
            kind: 'question',
            contextPath: [],
            mode: 'manual',
          }],
        },
        localized_answer: {
          id: 'localized_answer',
          talkId: 'localized_answer_talk',
          title: 'Localized Answer',
          type: 'tag',
          language: 'en',
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
          language: 'en',
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
    await expect(p.locator('#answers-content .answer-language-badge')).toHaveText('英语');
    await expect(p.locator('#answers-content')).not.toContainText('Welcome to IinPublic');
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showPreferencesDialog());
    await expect(p.locator('#preferences-modal')).toContainText('我的回答');
    await expect(p.locator('#preferences-modal')).toContainText('最近回答：');
    await expect(p.locator('#preferences-modal')).toContainText('手动');
    await expect(p.locator('#preferences-modal .mode-select option')).toHaveText([
      '手动',
      '临时自动回答',
      '永久自动回答',
      '跳过此问题',
    ]);
    await p.locator('#preferences-modal .mode-select').selectOption('suppressed');
    await expect(p.locator('.notification').filter({ hasText: '之后将自动跳过此问题' })).toBeVisible();
    await expect
      .poll(() => p.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('exactChatbotMemory') || '{}');
        const memories = Object.values(state.users?.local || {}) as Array<any>;
        return memories[0]?.summary?.mode || '';
      }))
      .toBe('SUPPRESSED');
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
    await openSettingsSection(p, SETTINGS_SECTION.languages);
    await p.locator('#settings-ui-language').selectOption('en');
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('Settings');
    await p.locator('#settings-profile-languages').selectOption('zh');
    await expect(p.locator('.nav-btn[data-view="settings"] .nav-label')).toHaveText('Settings');
    await expect(p.locator('#settings-ui-language')).toHaveValue('en');
    await p.locator('#settings-profile-languages').selectOption('en');
    await p.locator('.settings-filter-language-option[value="zh"]').check();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.talkBehavior);
    await p.locator('#settings-copy-talk-autosave').uncheck();
    await p.locator('#settings-chatbot-enabled').uncheck();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await p.locator('#settings-grammar-filter').uncheck();
    await p.locator('#settings-dirty-words-filter').uncheck();
    await p.locator('#settings-custom-blocked').fill('alpha, beta');
    await backToSettingsMenu(p);

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

    await openSettingsSection(p, SETTINGS_SECTION.talkBehavior);
    await expect(p.locator('#settings-copy-talk-autosave')).not.toBeChecked();
    await expect(p.locator('#settings-chatbot-enabled')).not.toBeChecked();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.languages);
    await expect(p.locator('.settings-filter-language-option[value="en"]')).toBeChecked();
    await expect(p.locator('.settings-filter-language-option[value="zh"]')).toBeChecked();
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await expect(p.locator('#settings-grammar-filter')).not.toBeChecked();
    await expect(p.locator('#settings-dirty-words-filter')).not.toBeChecked();
    await expect(p.locator('#settings-custom-blocked')).toHaveValue('alpha, beta');
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.distanceHome);
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
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    await expect(p.locator('#return-home-btn')).toBeEnabled();
  });

  test('custom room creation opens the newly created room', async () => {
    const p = page!;
    const roomName = `Mesa College ${Date.now()}`;
    const description = 'Coffee, study, and campus events';
    const headline = 'Open late for students';

    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await p.locator('#create-custom-chatroom-btn').click();
    await p.locator('#custom-room-type').selectOption('business');
    await p.locator('#custom-room-business-headline').fill(headline);
    await p.locator('#custom-room-name').fill(roomName);
    await p.locator('#custom-room-description').fill(description);
    await p.locator('#custom-room-capacity').fill('120');
    await p.locator('[data-testid="custom-room-submit-btn"]').click();

    await expect
      .poll(
        async () =>
          p.evaluate((name) => {
            const ui = (window as any).__iinpublic_app.getApp().uiManager as any;
            return ui.getCustomChatroomIds()
              .map((id: string) => ui.getCustomChatroomMeta(id))
              .find((room: any) => room?.name === name)?.id || '';
          }, roomName),
        { timeout: 20_000, message: 'custom room metadata should be available after submit' },
      )
      .not.toBe('');
    const createdRoomId = await p.evaluate((name) => {
      const ui = (window as any).__iinpublic_app.getApp().uiManager as any;
      return ui.getCustomChatroomIds()
        .map((id: string) => ui.getCustomChatroomMeta(id))
        .find((room: any) => room?.name === name)?.id || '';
    }, roomName);

    await p.evaluate((chatroomId) => {
      const ui = (window as any).__iinpublic_app.getApp().uiManager as any;
      ui.showChatroomDetail(chatroomId);
    }, createdRoomId);
    await expect(p.locator('#current-chatroom-title')).toContainText(roomName, { timeout: 10_000 });
    await expect
      .poll(
        async () =>
          p.evaluate((chatroomId) => {
            const ui = (window as any).__iinpublic_app.getApp().uiManager as any;
            const meta = ui.getCustomChatroomMeta(chatroomId);
            return {
              description: meta?.description || '',
              headline: meta?.businessInfo?.headline || '',
            };
          }, createdRoomId),
        { timeout: 10_000 },
      )
      .toEqual({ description, headline });
  });

  test('auto-copy keeps answered talks in OUT and stores flat answer history', async () => {
    const p = page!;

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.talkBehavior);
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
    await openSettingsSection(p, SETTINGS_SECTION.talkBehavior);
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

  test('Me filters outcome and sorts answer history; Talks keeps unanswered IN above answered history', async () => {
    const p = page!;
    await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager as any;
      localStorage.setItem('myAnswerHistory', JSON.stringify({
        oldMismatch: {
          id: 'oldMismatch', talkId: 'answered-old', title: 'Older mismatch', type: 'flow', language: 'en',
          outcome: 'mismatch', answeredAt: '2026-01-02T12:00:00.000Z', senderIds: ['sender-a'],
          items: [{ questionId: 'q1', answerId: 'a1', prompt: 'Old question?', choice: 'No', kind: 'question', contextPath: [] }],
        },
        newMatch: {
          id: 'newMatch', talkId: 'answered-new', title: 'Newest match', type: 'tag', language: 'en',
          outcome: 'match', answeredAt: '2026-02-02T12:00:00.000Z', senderIds: ['sender-b'],
          items: [{ questionId: 'q2', answerId: 'a2', prompt: 'New question?', choice: 'Yes', kind: 'question', contextPath: [] }],
        },
      }));
      localStorage.setItem('myTalks', JSON.stringify({
        'answered-old': {
          talkId: 'answered-old', title: 'Older mismatch', type: 'flow', role: 'answered',
          outcome: 'mismatch',
          lastInteraction: '2026-02-02T00:00:00.000Z',
          fullTalk: { id: 'answered-old', title: 'Older mismatch', type: 'flow', questions: [] },
        },
      }));
    });

    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#answers-list .answer-talk-item')).toHaveCount(2);
    await p.locator('#me-outcome-filter').selectOption('match');
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toHaveCount(1);
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toContainText('Newest match');
    await p.locator('#me-outcome-filter').selectOption('all');
    await p.locator('#me-answer-sort').selectOption('answered-asc');
    await expect(p.locator('#answers-list .answer-talk-item').first()).toContainText('Older mismatch');
    await p.locator('#me-answer-filter').fill('yes');
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toHaveCount(1);
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toContainText('Newest match');
    await p.locator('#me-answer-filter').fill('');
    await p.locator('#me-answer-date-from').fill('2026-01-01');
    await p.locator('#me-answer-date-to').fill('2026-01-31');
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toHaveCount(1);
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toContainText('Older mismatch');
    await p.locator('#me-clear-filters').click();
    await expect(p.locator('#answers-list .answer-talk-item:visible')).toHaveCount(2);
    await expect(p.locator('#me-answer-sort')).toHaveValue('answered-desc');

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    // The Talks tab click emits `needIncomingTalkClusters`, whose async local-Gun refresh
    // REPLACES the UI cluster snapshot (applyIncomingTalkClusters). Inject the UI-only
    // cluster only after that refresh settles so it cannot be clobbered (flaky under load).
    await p.evaluate(async () => {
      const app = (window as any).__iinpublic_app.getApp();
      await app.syncIncomingClustersFromServer();
      const ui = app.uiManager as any;
      ui.setIncomingTalkClusters([{
        identityKey: 'fresh-incoming', title: 'Fresh incoming', type: 'flow', isAnswered: false,
        latestTalkId: 'fresh-incoming', updatedAt: '2026-01-15T00:00:00.000Z', senders: { sender: { senderName: 'Sender' } },
        latestTalk: { id: 'fresh-incoming', title: 'Fresh incoming', type: 'flow', authorId: 'sender', questions: [] },
      }]);
      ui.displayTalksList();
    });
    const incoming = p.locator('.talk-list-item[data-role="incoming"]');
    await expect(incoming).toHaveCount(2);
    await expect(incoming.first()).toContainText('Fresh incoming');
    await expect(incoming.nth(1)).toContainText('Older mismatch');
    await expect(incoming.nth(1)).toHaveClass(/talk-incoming-answered/);
    await p.locator('#talks-filter-outcome').selectOption('mismatch');
    await expect(p.locator('.talk-list-item[data-role="incoming"]:visible')).toHaveCount(1);
    await expect(p.locator('.talk-list-item[data-role="incoming"]:visible')).toContainText('Older mismatch');
    await p.locator('#talks-filter-outcome').selectOption('all');
    await p.locator('#talks-filter-date-from').fill('2026-02-01');
    await expect(p.locator('.talk-list-item[data-role="incoming"]:visible')).toHaveCount(1);
    await expect(p.locator('.talk-list-item[data-role="incoming"]:visible')).toContainText('Older mismatch');
  });

  test('chatbot room-entry auto-send emits only pending talks and does not replay recorded delivery', async () => {
    const p = page!;
    const result = await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager as any;
      const userId = app.getCurrentUser().id;
      const fullTalk = { id: 'autoOut', title: 'Automatic room entry talk', type: 'flow', questions: [{ id: 'q', text: 'Ready?', answers: [] }] };
      localStorage.setItem('myTalks', JSON.stringify({
        autoOut: {
          talkId: 'autoOut', title: 'Automatic room entry talk', type: 'flow', role: 'created',
          lastInteraction: '2026-06-20T00:00:00.000Z',
          fullTalk,
        },
      }));
      ui.setCurrentChatroomId('global');
      ui.updateChatroomMembers([{ userId: 'peer-auto', stageName: 'Auto Peer' }], userId);
      const emitted: any[] = [];
      ui.on('broadcastTalk', (event: any) => emitted.push(event));
      ui.broadcastPendingTalksOnRoomEntry();
      const first = emitted.map((event) => ({ automatic: event.automatic, talkIds: event.talkIds, memberIds: event.members.map((m: any) => m.userId) }));
      // docs/TODO.md §W Gap 2: simulate "already sent" via the unified ledger mechanism —
      // the same write deliverTalkToReceiversOverMesh itself does on a real send.
      app.markTalkSentToPeerForE2e({ peerId: 'peer-auto', talkId: 'autoOut', talkData: fullTalk });
      ui.broadcastPendingTalksOnRoomEntry();
      const emittedCountAfterNoReplay = emitted.length;
      // A metadata-only touch (no content change) must NOT un-suppress — ledger suppression
      // is content-hash keyed, unlike the old revision-key scheme it replaced.
      const talksMetaTouch = JSON.parse(localStorage.getItem('myTalks') || '{}');
      talksMetaTouch.autoOut.lastInteraction = '2026-06-21T00:00:00.000Z';
      localStorage.setItem('myTalks', JSON.stringify(talksMetaTouch));
      ui.broadcastPendingTalksOnRoomEntry();
      const emittedCountAfterMetaTouch = emitted.length;
      // A genuine content change (different question text → different identityKey) must
      // un-suppress.
      const talksContentChange = JSON.parse(localStorage.getItem('myTalks') || '{}');
      talksContentChange.autoOut.fullTalk.questions[0].text = 'Ready now?';
      localStorage.setItem('myTalks', JSON.stringify(talksContentChange));
      ui.broadcastPendingTalksOnRoomEntry();
      return {
        first,
        emittedCountAfterNoReplay,
        emittedCountAfterMetaTouch,
        emittedCountAfterContentChange: emitted.length,
        revised: emitted[1]?.talkIds || [],
      };
    });

    expect(result.first).toEqual([{
      automatic: true,
      talkIds: ['autoOut'],
      memberIds: ['peer-auto'],
    }]);
    expect(result.emittedCountAfterNoReplay).toBe(1);
    expect(result.emittedCountAfterMetaTouch).toBe(1);
    expect(result.emittedCountAfterContentChange).toBe(2);
    expect(result.revised).toEqual(['autoOut']);
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

    await openSettingsSection(p, SETTINGS_SECTION.languages);
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
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await expect(p.locator('#settings-custom-blocked')).toHaveValue('spam, scam');
  });

  test('broadcast history (ledger-based, §W Gap 2) suppresses unchanged repeat room sends', async () => {
    const p = page!;
    const result = await p.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const ui = app.uiManager as any;
      const fullTalk = {
        id: 'repeat_talk_1',
        title: 'Repeat Guard',
        type: 'flow',
        questions: [{ id: 'q1', text: 'Repeat?', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }],
      };
      const talk = {
        id: 'repeat_talk_1',
        title: 'Repeat Guard',
        type: 'flow',
        role: 'created',
        lastInteraction: '2026-05-14T00:00:00.000Z',
        fullTalk,
      };
      localStorage.setItem('myTalks', JSON.stringify({ repeat_talk_1: talk }));
      const before = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      app.markTalkSentToPeerForE2e({ peerId: 'peer-1', talkId: 'repeat_talk_1', talkData: fullTalk });
      const afterSame = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      // Metadata-only touch (lastInteraction) — same content, must stay suppressed.
      localStorage.setItem('myTalks', JSON.stringify({
        repeat_talk_1: { ...talk, lastInteraction: '2026-05-14T00:01:00.000Z' },
      }));
      const afterMetaTouch = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      // Genuine content change — different identityKey, must un-suppress.
      const revisedFullTalk = { ...fullTalk, questions: [{ id: 'q1', text: 'Repeat again?', answers: [{ id: 'a1', text: 'Yes', isMatch: true }] }] };
      localStorage.setItem('myTalks', JSON.stringify({
        repeat_talk_1: { ...talk, fullTalk: revisedFullTalk },
      }));
      const afterContentChange = ui.getUnsentBroadcastTalkIds('global', ['peer-1']);
      return { before, afterSame, afterMetaTouch, afterContentChange };
    });

    expect(result.before).toEqual(['repeat_talk_1']);
    expect(result.afterSame).toEqual([]);
    expect(result.afterMetaTouch).toEqual([]);
    expect(result.afterContentChange).toEqual(['repeat_talk_1']);
  });

  test('route responses preview the selected branch and resume saved progress', async () => {
    const p = page!;
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkResponseDialog({
      id: 'route-response-draft',
      title: 'Route draft',
      type: 'route',
      questions: [
        {
          id: 'q1',
          text: 'Start here?',
          answers: [{ id: 'go', text: 'Continue', nextQuestionId: 'q2' }],
        },
        {
          id: 'q2',
          text: 'Resumed question?',
          answers: [{ id: 'finish', text: 'Finish', isTerminal: true }],
        },
      ],
    }, { skipAutoAnswer: true }));

    await p.locator('.choice-radio[data-answer-id="go"][data-mode="manual"]').check();
    await expect(p.locator('[data-testid="route-branch-preview"]')).toContainText('This leads to: Resumed question?');
    await p.locator('[data-testid="route-branch-continue"]').click();
    await expect(p.locator('#talk-response-modal')).toContainText('Question 2 of 2');
    await p.locator('[data-testid="close-response-btn"]').click();

    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkResponseDialog({
      id: 'route-response-draft',
      title: 'Route draft',
      type: 'route',
      questions: [
        {
          id: 'q1',
          text: 'Start here?',
          answers: [{ id: 'go', text: 'Continue', nextQuestionId: 'q2' }],
        },
        {
          id: 'q2',
          text: 'Resumed question?',
          answers: [{ id: 'finish', text: 'Finish', isTerminal: true }],
        },
      ],
    }, { skipAutoAnswer: true }));
    await expect(p.locator('#talk-response-modal')).toContainText('Question 2 of 2');
    await p.locator('[data-testid="close-response-btn"]').click();
  });
});
