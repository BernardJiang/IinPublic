/**
 * Multi-browser demo: job-seeker route — company broadcasts DAG; 10 users walk each branch; stats.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../helpers/many-browsers';
import {
  answerRouteByAnswerIds,
  emitCreateTalkFromCompanyPage,
  expectTalkResponsesLine,
  waitForOutgoingTalkRow,
} from '../helpers/talk-demo-ui';
import { getJobRouteScenarios, prepareValidatedJobRouteTalk } from './lib/route-job-seeking';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Talks matching — job seeker route (multi-browser)', () => {
  test.setTimeout(600_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunDatabases();
    browsers = await launchBrowserGrid(11);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunDatabases();
  });

  test('company broadcasts route; 10 users complete paths; stats show 10 responses', async () => {
    expect(browsers.length).toBe(11);
    await disposeE2eSessionList(sessions);
    await clearGunDatabases();

    const runId = Date.now();
    const title = `E2E Job Route ${runId}`;

    const company = await bootstrapUser(browsers[0]!, 'Company', 'HR Co');
    sessions.push({ label: 'Company', context: company.context, page: company.page });
    const { page: co } = company;
    await co.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(co, 'chatrooms');
    await afterSync();

    for (let i = 1; i <= 10; i += 1) {
      const u = await bootstrapUser(browsers[i]!, `U${i}`, `Seeker${i}`);
      sessions.push({ label: `U${i}`, context: u.context, page: u.page });
      await u.page.click('.chatroom-item:has-text("Global")');
      await waitForTabActive(u.page, 'chatrooms');
      await afterSync();
    }

    const raw = prepareValidatedJobRouteTalk();
    const { id: _drop, ...rest } = raw;
    await emitCreateTalkFromCompanyPage(co, { ...rest, title });
    const talkId = await waitForOutgoingTalkRow(co, title);

    const scenarios = getJobRouteScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(10);

    for (let u = 0; u < 10; u += 1) {
      const aids = scenarios[u]!.steps.map((s) => s.a);
      await answerRouteByAnswerIds(sessions[u + 1]!.page, title, aids, talkId);
      await afterSync();
    }

    await expectTalkResponsesLine(co, title, 10);
  });
});
