/**
 * Phase D2 — localization proof: switch App UI to Chinese, traverse main tabs, reload, restore English.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, reloadAppReady } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, backToSettingsMenu, SETTINGS_SECTION } from '../../helpers/settings-nav';

const ZH_NAV = ['聊天室', '联系人', '话题', '我的', '设置'] as const;
const EN_NAV = ['Chatrooms', 'Contacts', 'Talks', 'Me', 'Settings'] as const;

async function switchUiLanguage(page: Page, code: 'zh' | 'en'): Promise<void> {
  await page.locator('.nav-btn[data-view="settings"]').click();
  await afterNav();
  await openSettingsSection(page, SETTINGS_SECTION.languages);
  await page.locator('#settings-ui-language').selectOption(code);
  await afterSync();
}

test.describe('Chinese UI localization traversal (D2)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
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

  test('switches to Chinese across tabs, persists on reload, and restores English', async () => {
    const p = page!;
    await switchUiLanguage(p, 'zh');
    await expect(p.locator('.bottom-nav .nav-btn .nav-label')).toHaveText([...ZH_NAV]);
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_ui_language')))
      .toBe('zh');

    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await expect(p.locator('#create-custom-chatroom-btn')).toHaveAttribute('title', '新建房间');
    await expect(p.locator('#broadcast-talk-btn')).toHaveAttribute('title', '广播');
    await expect(p.locator('#top-header #return-home-btn')).toBeVisible();

    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#contacts-filter-relation option[value="all"]')).toHaveText('全部关系');
    await expect(p.locator('#contacts-sort-order option[value="recent"]')).toHaveText('最近');

    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#creator-replies-panel')).toContainText('我的话题回复');
    await expect(p.locator('#reply-filter-query')).toHaveAttribute('placeholder', '昵称或话题');
    await expect(p.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('加权表现');
    await expect(p.locator('#reply-filter-language option[value="zh"]')).toHaveText('中文');
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog());
    await expect(p.locator('#talk-editor-modal')).toContainText('创建话题');
    await expect(p.locator('#talk-language option[value="zh"]')).toHaveText('中文');
    await p.locator('#cancel-talk-btn').click();

    await p.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await expect(p.locator('#me-talk-type-filter-label')).toHaveText('话题类型');
    await expect(p.locator('.me-talk-type-filter')).toHaveText(['标签', '流程', '问卷', '路线']);
    await expect(p.locator('#me-tag-state-filter-label')).toHaveText('标签状态');

    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.languages);
    await expect(p.locator('#settings-content')).toContainText('界面语言');
    await expect(p.locator('#settings-content')).toContainText('个人资料语言');
    await expect(p.locator('#settings-ui-language')).toHaveValue('zh');
    await backToSettingsMenu(p);

    await openSettingsSection(p, SETTINGS_SECTION.contentFilters);
    await expect(p.locator('#settings-grammar-filter')).toBeVisible();

    await reloadAppReady(p);
    await expect(p.locator('.bottom-nav .nav-btn .nav-label')).toHaveText([...ZH_NAV]);
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_ui_language')))
      .toBe('zh');

    await switchUiLanguage(p, 'en');
    await expect(p.locator('.bottom-nav .nav-btn .nav-label')).toHaveText([...EN_NAV]);
    await expect
      .poll(async () => p.evaluate(() => localStorage.getItem('iinpublic_ui_language')))
      .toBe('en');
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#reply-filter-language option[value="zh"]')).toHaveText('Chinese');
  });
});
