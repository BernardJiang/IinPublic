import { chromium, expect } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport } from '../../helpers/bootstrap-canonical';
import { createTalkFromCompanyPage } from '../../helpers/talk-demo-ui';
import { afterNav, afterSync, headless } from '../../helpers/timing';
import type { Talk } from '../../../../src/shared/types';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

type TechSupportTalk = Talk & {
  selfAnswers: Array<{ questionId: string; answerId: string }>;
};

function techSupportFourTalks(runId: number): TechSupportTalk[] {
  return [
    {
      id: `techsupport-stage0-tag-${runId}`,
      title: `TechSupport food tag ${runId}`,
      authorId: 'techsupport',
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
          text: 'TechSupport food tag?',
          answers: [
            { id: 'a_food_yes', text: 'Interested.', isMatch: true, isTerminal: true },
            { id: 'a_food_no', text: 'Not interested.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
      selfAnswers: [{ questionId: 'q_food_tag', answerId: 'a_food_yes' }],
    },
    {
      id: `techsupport-stage0-flow-${runId}`,
      title: `TechSupport tennis flow ${runId}`,
      authorId: 'techsupport',
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
          text: 'TechSupport tennis partner?',
          answers: [
            { id: 'a_tennis_yes', text: 'Yes, tennis.', isMatch: true, isTerminal: true },
            { id: 'a_tennis_no', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
      selfAnswers: [{ questionId: 'q_tennis', answerId: 'a_tennis_yes' }],
    },
    {
      id: `techsupport-stage0-survey-${runId}`,
      title: `TechSupport food survey ${runId}`,
      authorId: 'techsupport',
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
          text: 'TechSupport survey cuisine?',
          isAggregatable: true,
          answers: [
            { id: 'a_chinese', text: 'Chinese food', isTerminal: true, counter: 0 },
            { id: 'a_italian', text: 'Italian food', isTerminal: true, counter: 0 },
          ],
        },
      ],
      selfAnswers: [{ questionId: 'q_foodies', answerId: 'a_chinese' }],
    },
    {
      id: `techsupport-stage0-route-${runId}`,
      title: `TechSupport job route ${runId}`,
      authorId: 'techsupport',
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
          text: 'TechSupport job searching?',
          answers: [
            { id: 'a_job_yes', text: 'Yes.', nextQuestionId: 'q_engineering' },
            { id: 'a_job_no', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
        {
          id: 'q_engineering',
          text: 'TechSupport engineering roles?',
          contextPath: [{ questionId: 'q_job', answerId: 'a_job_yes' }],
          answers: [
            { id: 'a_engineering_yes', text: 'Yes, engineering.', isMatch: true, isTerminal: true },
            { id: 'a_engineering_no', text: 'No.', isIgnore: true, isTerminal: true },
          ],
        },
      ],
      selfAnswers: [
        { questionId: 'q_job', answerId: 'a_job_yes' },
        { questionId: 'q_engineering', answerId: 'a_engineering_yes' },
      ],
    },
  ];
}

test.describe('Stage 0 — TechSupport creates four talk types', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('TechSupport creates tag, flow, survey, and route talks and verifies Me answers', async () => {
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0'] });
    const { context, page } = await bootstrapTechSupport(browser, 'TechSupport Four Talks');
    const talks = techSupportFourTalks(Date.now());

    for (const talk of talks) {
      await createTalkFromCompanyPage(page, talk);
      await afterSync();
    }

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(page.locator('#answers-content')).toBeVisible();

    for (const talk of talks) {
      await expect(page.locator('#answers-content')).toContainText(talk.title);
      // The route talk self-answers two questions, so it renders two `.answer-talk-item` rows
      // sharing the same source-talk title — `.first()` just confirms at least one rendered;
      // per-question content is asserted separately below via `expectedAnswerRows`.
      await expect(
        page.locator(`#answers-content .answer-talk-item.talk-type-${talk.type}`).filter({ hasText: talk.title }).first(),
      ).toBeVisible();
    }

    const expectedAnswerRows = [
      ['TechSupport food tag?', 'Checked'],
      ['TechSupport tennis partner?', 'Yes, tennis.'],
      ['TechSupport survey cuisine?', 'Chinese food'],
      ['TechSupport job searching?', 'Yes.'],
      ['TechSupport engineering roles?', 'Yes, engineering.'],
    ];

    for (const [question, answer] of expectedAnswerRows) {
      const row = page.locator('#answers-content .answer-outcome-item').filter({ hasText: question }).filter({ hasText: answer });
      await expect(row.first()).toBeVisible();
    }
    const routeChildRow = page.locator('#answers-content .answer-outcome-item')
      .filter({ hasText: 'TechSupport engineering roles?' });
    await expect(routeChildRow).toContainText('Context path:');
    await expect(routeChildRow).toContainText('TechSupport job searching? -> Yes.');
    await expect(routeChildRow).not.toContainText('q_job -> a_job_yes');

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const records = JSON.parse(localStorage.getItem('myQuestionAnswers') || '{}');
            return Object.values(records).filter((record: any) =>
              String(record?.questionText || '').startsWith('TechSupport '),
            ).length;
          }),
        { timeout: 15_000 },
      )
      .toBe(expectedAnswerRows.length);

    await afterSync();
    await context.close();
    await browser.close();
  });
});
