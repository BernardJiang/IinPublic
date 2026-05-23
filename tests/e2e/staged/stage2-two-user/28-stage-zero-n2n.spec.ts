import { type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { createTalksFromCompanyPage } from '../../helpers/talk-demo-ui';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import type { Talk } from '../../../../src/shared/types';

function talkSet(owner: string, runId: number): Talk[] {
  return [
    {
      id: `stage-tag-${owner}-${runId}`,
      title: `${owner} food tag ${runId}`,
      authorId: owner,
      type: 'tag',
      language: 'en',
      isAdult: false,
      tags: [{ id: 'food', name: 'food', category: 'other', popularity: 0 }],
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
      questions: [
        {
          id: 'q_food_tag',
          text: 'Food',
          answers: [
            { id: 'a_food_yes', text: 'Interested.', isMatch: true, isTerminal: true },
            { id: 'a_food_no', text: 'Not interested.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    },
    {
      id: `stage-flow-${owner}-${runId}`,
      title: `${owner} tennis partner flow ${runId}`,
      authorId: owner,
      type: 'flow',
      language: 'en',
      isAdult: false,
      tags: [{ id: 'tennis', name: 'tennis', category: 'community', popularity: 0 }],
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
      questions: [
        {
          id: 'q_tennis',
          text: 'Seeking tennis partner?',
          answers: [
            { id: 'a_tennis_yes', text: 'Yes, let us play.', isMatch: true, isTerminal: true },
            { id: 'a_tennis_no', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    },
    {
      id: `stage-survey-${owner}-${runId}`,
      title: `${owner} foodie survey ${runId}`,
      authorId: owner,
      type: 'survey',
      language: 'en',
      isAdult: false,
      tags: [{ id: 'foodies', name: 'foodies', category: 'other', popularity: 0 }],
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
      questions: [
        {
          id: 'q_foodies',
          text: 'How do you like Chinese food and Italian food?',
          isAggregatable: true,
          answers: [
            { id: 'a_chinese', text: 'Chinese food', isTerminal: true, counter: 0 },
            { id: 'a_italian', text: 'Italian food', isTerminal: true, counter: 0 },
          ],
        },
      ],
    },
    {
      id: `stage-route-${owner}-${runId}`,
      title: `${owner} job searching route ${runId}`,
      authorId: owner,
      type: 'route',
      language: 'en',
      isAdult: false,
      tags: [{ id: 'jobs', name: 'jobs', category: 'jobs', popularity: 0 }],
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
      questions: [
        {
          id: 'q_job',
          text: 'Are you job searching?',
          answers: [
            { id: 'a_job_yes', text: 'Yes.', nextQuestionId: 'q_engineering' },
            { id: 'a_job_no', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_engineering',
          text: 'Looking for engineering roles?',
          contextPath: [{ questionId: 'q_job', answerId: 'a_job_yes' }],
          answers: [
            { id: 'a_engineering_yes', text: 'Yes, engineering.', isMatch: true, isTerminal: true },
            { id: 'a_engineering_no', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
    },
  ];
}

async function openFreshPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await injectIdbClear(page);
  await page.goto(webBaseURL());
  await page.waitForLoadState('load');
  await afterLoad();
  return page;
}

async function configureFirstUser(page: Page, name: string, homeRoom: string): Promise<void> {
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await page.fill('#settings-stage-name-input', name);
  await page.locator('#settings-stage-name-input').blur();
  await page.selectOption('#settings-headshot-select', '🎾');
  await page.selectOption('#settings-profile-languages', 'en');
  await afterSync();
  await page.locator('.settings-filter-language-option[value="en"]').setChecked(true);
  await page.locator('.settings-filter-language-option[value="zh"]').setChecked(true);
  await page.fill('#settings-min-distance', '1');
  await page.fill('#settings-max-distance', '50');
  await page.locator('#settings-grammar-filter').check();
  await page.locator('#settings-dirty-words-filter').check();
  await page.locator('#settings-copy-talk-autosave').check();
  await page.locator('#settings-chatbot-enabled').check();
  await page.selectOption('#settings-home-room', homeRoom);
  await page.locator('.settings-filter-language-option[value="zh"]').dispatchEvent('change');
  await afterSync();
}

test.describe('Stage zero N2N smoke', () => {
  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    await clearGunForStage2Spec();
  });

  test('stage zero Adam configures profile, creates four talks, travels home to San Diego, and persists room on login', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 1 });
    const page = await openFreshPage(context);
    const runId = Date.now();

    await configureFirstUser(page, 'Adam', 'san-diego');

    await expect(page.locator('#settings-stage-name-input')).toHaveValue('Adam');
    await expect(page.locator('#settings-profile-languages')).toHaveValue('en');
    await expect
      .poll(
        () =>
          page.locator('#settings-filter-languages').evaluate((container) =>
            Array.from(container.querySelectorAll<HTMLInputElement>('.settings-filter-language-option:checked'))
              .map((option) => option.value)
              .sort()
              .join(','),
          ),
        { timeout: 45_000 },
      )
      .toBe('en,zh');
    await expect(page.locator('#settings-min-distance')).toHaveValue('1');
    await expect(page.locator('#settings-max-distance')).toHaveValue('50');
    await expect(page.locator('#settings-grammar-filter')).toBeChecked();
    await expect(page.locator('#settings-dirty-words-filter')).toBeChecked();
    await expect(page.locator('#settings-copy-talk-autosave')).toBeChecked();
    await expect(page.locator('#settings-chatbot-enabled')).toBeChecked();

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(page.locator('[data-testid="user-stage-name"]')).toContainText('Adam');
    await expect(page.locator('.answer-outcome-item')).toHaveCount(0);
    await expect(page.locator('#answers-content')).toContainText("Talks you've received and answered will appear here.");

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await expect(page.locator('#talks-list')).toContainText('No talks yet');

    await createTalksFromCompanyPage(page, talkSet('Adam', runId));
    await expect(page.locator('.talk-list-item[data-role="created"]')).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.talk-list-item[data-talk-type="tag"]')).toHaveCount(1);
    await expect(page.locator('.talk-list-item[data-talk-type="flow"]')).toHaveCount(1);
    await expect(page.locator('.talk-list-item[data-talk-type="survey"]')).toHaveCount(1);
    await expect(page.locator('.talk-list-item[data-talk-type="route"]')).toHaveCount(1);

    await page.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    await expect(page.locator('#contacts-list .contact-item')).toHaveCount(0);

    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await expect(page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount')).toContainText('2');
    for (const roomId of ['north-america', 'usa', 'california', 'san-diego']) {
      await page.click(`.chatroom-item[data-chatroom-id="${roomId}"]`);
      await expect
        .poll(
          () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''),
          { timeout: 15_000 },
        )
        .toBe(roomId);
      await page.click('#back-to-chatrooms');
      await afterSync();
    }
    await expect(page.locator('.chatroom-item.current-room[data-chatroom-id="san-diego"]')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('load');
    await afterLoad();
    await expect(page.locator('#status-bar-text')).toContainText('San Diego', { timeout: 45_000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context.close();
  });
});
