/**
 * Multi-browser demo: company creates customer-satisfaction survey; 10 users respond;
 * company sees aggregate response counts on the OUT talk row.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../helpers/many-browsers';
import {
  createTalkFromCompanyPage,
  expectTalkResponsesLine,
  recordTalkStatsByAnswerIds,
} from '../helpers/talk-demo-ui';
import { makeSurveyTalk } from './lib/survey-customer-satisfaction';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Talks matching — survey customer satisfaction (multi-browser)', () => {
  test.setTimeout(600_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunDatabases();
    browsers = await launchBrowserGrid(1);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunDatabases();
  });

  test('company creates survey; 10 recorded responses; stats show 10 responses', async () => {
    expect(browsers.length).toBe(1);
    await disposeE2eSessionList(sessions);
    await clearGunDatabases();

    const runId = Date.now();
    const title = `E2E Customer Sat ${runId}`;

    const companyBrowser = browsers[0]!;
    const company = await bootstrapUser(companyBrowser, 'Company', 'Survey Co');
    sessions.push({ label: 'Company', context: company.context, page: company.page });
    const { page: co } = company;
    await co.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(co, 'chatrooms');

    const { id: _id, ...base } = makeSurveyTalk('E2ECo');
    const talkPayload = { ...base, title };
    const talkId = await createTalkFromCompanyPage(co, talkPayload);
    const talkData = { ...talkPayload, id: talkId };

    await Promise.all(Array.from({ length: 10 }, async (_, u) => {
      const staffId = `staff_${(u % 5) + 1}`;
      const svcId = u % 9 === 8 ? 'svc_9_10' : `svc_${(u % 8) + 1}`;
      const npsId = ['nps_yes', 'nps_maybe', 'nps_no'][u % 3]!;
      await recordTalkStatsByAnswerIds(co, talkId, talkData, `stats-user-${u + 1}`, [staffId, svcId, npsId]);
    }));

    await expectTalkResponsesLine(co, title, 10);
  });
});
