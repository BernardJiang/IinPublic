/**
 * Multi-browser demo: restaurant survey — company broadcasts; 10 users answer; stats.
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
import { makeRestaurantSurvey } from './lib/survey-restaurants';

type Session = { label: string; context: BrowserContext; page: Page };

const burger = ['bg_mc', 'bg_kfc', 'bg_wen', 'bg_ot'] as const;
const fries = ['fr_md', 'fr_kfc', 'fr_ino', 'fr_ot'] as const;
const pizza = ['pz_ph', 'pz_gh', 'pz_dom', 'pz_ot'] as const;

test.describe('Talks matching — restaurant survey (multi-browser)', () => {
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

  test('company broadcasts restaurant survey; 10 users answer; stats show 10 responses', async () => {
    expect(browsers.length).toBe(11);
    await disposeE2eSessionList(sessions);
    await clearGunDatabases();

    const runId = Date.now();
    const title = `E2E Restaurants ${runId}`;

    const company = await bootstrapUser(browsers[0]!, 'Company', 'Food Co');
    sessions.push({ label: 'Company', context: company.context, page: company.page });
    const { page: co } = company;
    await co.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(co, 'chatrooms');
    await afterSync();

    for (let i = 1; i <= 10; i += 1) {
      const u = await bootstrapUser(browsers[i]!, `U${i}`, `Diner${i}`);
      sessions.push({ label: `U${i}`, context: u.context, page: u.page });
      await u.page.click('.chatroom-item:has-text("Global")');
      await waitForTabActive(u.page, 'chatrooms');
      await afterSync();
    }

    const { id: _id, ...base } = makeRestaurantSurvey();
    await emitCreateTalkFromCompanyPage(co, { ...base, title }, { minGunPeersExcludingSelf: 10 });
    const talkId = await waitForOutgoingTalkRow(co, title);

    for (let u = 0; u < 10; u += 1) {
      const ids = [burger[u % 4]!, fries[(u + 1) % 4]!, pizza[(u + 2) % 4]!];
      await answerSurveyByAnswerIds(sessions[u + 1]!.page, title, ids, talkId);
      await afterSync();
    }

    await expectTalkResponsesLine(co, title, 10);
  });
});
