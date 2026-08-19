/**
 * Restaurant survey stats — company creates the talk; 10 normalized responses are recorded.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  buildPositionalAnswerIdMap,
  createFlowOrSurveyTalkViaEditor,
  expectTalkResponsesLine,
  recordTalkStatsByAnswerIds,
  talkQuestionsToUiSpec,
} from '../../helpers/talk-demo-ui';
import { makeRestaurantSurvey } from '../../talks-matching/lib/survey-restaurants';

type Session = { label: string; context: BrowserContext; page: Page };

const burger = ['bg_mc', 'bg_kfc', 'bg_wen', 'bg_ot'] as const;
const fries = ['fr_md', 'fr_kfc', 'fr_ino', 'fr_ot'] as const;
const pizza = ['pz_ph', 'pz_gh', 'pz_dom', 'pz_ot'] as const;

test.describe('Talks matching — restaurant survey (multi-browser)', () => {
  test.setTimeout(120_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browsers = await launchBrowserGrid(1);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunForStage1Spec();
  });

  test('company creates restaurant survey; 10 recorded responses; stats show 10 responses', async () => {
    expect(browsers.length).toBe(1);
    await disposeE2eSessionList(sessions);
    await clearGunForStage1Spec();

    const runId = Date.now();
    const title = `E2E Restaurants ${runId}`;

    const company = await bootstrapUser(browsers[0]!, 'Company', 'Food Co');
    sessions.push({ label: 'Company', context: company.context, page: company.page });
    const { page: co } = company;
    await co.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(co, 'chatrooms');

    const original = makeRestaurantSurvey();
    const created = await createFlowOrSurveyTalkViaEditor(co, {
      title,
      type: 'survey',
      questions: talkQuestionsToUiSpec(original.questions),
    });
    const idMap = buildPositionalAnswerIdMap(original.questions);

    await Promise.all(Array.from({ length: 10 }, async (_, u) => {
      const ids = [burger[u % 4]!, fries[(u + 1) % 4]!, pizza[(u + 2) % 4]!].map((id) => idMap[id] ?? id);
      await recordTalkStatsByAnswerIds(co, created.talkId, created.talkData, `stats-diner-${u + 1}`, ids);
    }));

    await expectTalkResponsesLine(co, title, 10);
  });
});
