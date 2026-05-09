/**
 * Multi-browser demo: company creates customer-satisfaction survey; 10 users respond;
 * company sees aggregate response counts on the OUT talk row.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../helpers/many-browsers';
import {
  answerSurveyByAnswerIds,
  emitCreateTalkFromCompanyPage,
  expectTalkResponsesLine,
  waitForOutgoingTalkRow,
} from '../helpers/talk-demo-ui';
import { makeSurveyTalk } from './lib/survey-customer-satisfaction';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Talks matching — survey customer satisfaction (multi-browser)', () => {
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

  test('company broadcasts survey; 10 users answer; stats show 10 responses', async () => {
    expect(browsers.length).toBe(11);
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
    await afterSync();

    for (let i = 1; i <= 10; i += 1) {
      const u = await bootstrapUser(browsers[i]!, `U${i}`, `User${i}`);
      sessions.push({ label: `U${i}`, context: u.context, page: u.page });
      await u.page.click('.chatroom-item:has-text("Global")');
      await waitForTabActive(u.page, 'chatrooms');
      await afterSync();
    }

    const { id: _id, ...base } = makeSurveyTalk('E2ECo');
    const talkPayload = { ...base, title };
    await emitCreateTalkFromCompanyPage(co, talkPayload, { minGunPeersExcludingSelf: 10 });
    const talkId = await waitForOutgoingTalkRow(co, title);

    for (let u = 0; u < 10; u += 1) {
      const staffId = `staff_${(u % 5) + 1}`;
      const svcId = u % 9 === 8 ? 'svc_9_10' : `svc_${(u % 8) + 1}`;
      const npsId = ['nps_yes', 'nps_maybe', 'nps_no'][u % 3]!;
      await answerSurveyByAnswerIds(sessions[u + 1]!.page, title, [staffId, svcId, npsId], talkId);
      await afterSync();
    }

    await expectTalkResponsesLine(co, title, 10);
  });
});
