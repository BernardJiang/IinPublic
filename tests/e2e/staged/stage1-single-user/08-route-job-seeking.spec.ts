/**
 * Job-seeker route stats — company creates a DAG; 10 normalized branch paths are recorded.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  createTalkFromCompanyPage,
  expectTalkResponsesLine,
  recordTalkStatsByAnswerIds,
} from '../../helpers/talk-demo-ui';
import { getJobRouteScenarios, prepareValidatedJobRouteTalk } from '../../talks-matching/lib/route-job-seeking';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Talks matching — job seeker route (multi-browser)', () => {
  test.setTimeout(120_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browsers = await launchBrowserGrid(1);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await maybeClearGunDatabases();
  });

  test('company creates route; 10 recorded paths; stats show 10 responses', async () => {
    expect(browsers.length).toBe(1);
    await disposeE2eSessionList(sessions);
    await maybeClearGunDatabases();

    const runId = Date.now();
    const title = `E2E Job Route ${runId}`;

    const company = await bootstrapUser(browsers[0]!, 'Company', 'HR Co');
    sessions.push({ label: 'Company', context: company.context, page: company.page });
    const { page: co } = company;
    await co.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(co, 'chatrooms');

    const raw = prepareValidatedJobRouteTalk();
    const { id: _drop, ...rest } = raw;
    const talkPayload = { ...rest, title };
    const talkId = await createTalkFromCompanyPage(co, talkPayload);
    const talkData = { ...talkPayload, id: talkId };

    const scenarios = getJobRouteScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(10);

    await Promise.all(Array.from({ length: 10 }, async (_, u) => {
      const aids = scenarios[u]!.steps.map((s) => s.a);
      await recordTalkStatsByAnswerIds(co, talkId, talkData, `stats-seeker-${u + 1}`, aids);
    }));

    await expectTalkResponsesLine(co, title, 10);
  });
});
