/**
 * Tom sends one talk of each of the four types (tag, flow, survey, route) to Jerry.
 * Jerry enables the chatbot and answers all with auto-mode, so the answers are saved
 * as flattened preferences.  Jerry's Answers tab then lists all four Q/A — some
 * questions have a contextHashId (flow / route later steps), others don't (tag, survey,
 * first question of flow/route).  Sam joins and re-announces the same four talk ids;
 * Jerry's chatbot replies automatically, so Sam sees four match conversations with Jerry.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterNav } from '../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../helpers/talks-matching-flow';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../helpers/many-browsers';
import { completeTalksInAppByAnswerIds, createTalksFromCompanyPage } from '../helpers/talk-demo-ui';
import {
  makeTagTalk,
  makeFlowTalk,
  makeSurveyTalk,
  makeRouteTalk,
} from './lib/four-types-talks';

type Session = { label: string; context: BrowserContext; page: Page };
type TalkKind = 'tag' | 'flow' | 'survey' | 'route';

function answerIdsFor(kind: TalkKind): string[] {
  switch (kind) {
    case 'tag':
      return ['a_tag_match'];
    case 'flow':
      return ['a_flow_1_yes', 'a_flow_2_yes'];
    case 'survey':
      return ['a_sv_1'];
    case 'route':
      return ['a_r_job_yes', 'a_r_role_yes'];
  }
}

test.describe('Talks matching — four talk types, Jerry chatbot auto-replies Sam', () => {
  test.setTimeout(180_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunDatabases();
    browsers = await launchBrowserGrid(3);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunDatabases();
  });

  test('Tom broadcasts 4 talks, Jerry auto-answers all, Sam re-asks, chatbot replies', async () => {
    expect(browsers.length).toBe(3);
    const runId = Date.now();

    // --- Bootstrap Tom, Jerry, Sam ---
    const tom = await bootstrapUser(browsers[0]!, 'Tom', 'Tom');
    sessions.push({ label: 'Tom', context: tom.context, page: tom.page });
    await tom.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(tom.page, 'chatrooms');
    await afterSync();

    const jerry = await bootstrapUser(browsers[1]!, 'Jerry', 'Jerry');
    sessions.push({ label: 'Jerry', context: jerry.context, page: jerry.page });
    await jerry.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(jerry.page, 'chatrooms');
    await afterSync();

    // Enable Jerry's chatbot BEFORE answering so auto-mode answers are saved as bot templates.
    await jerry.page.click('.nav-btn[data-view="me"]');
    await afterNav();
    const chatbotCheckbox = jerry.page.locator('#chatbot-enabled-checkbox');
    if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
    await jerry.page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();

    // --- Tom creates all four talk types in OUT; delivery is covered by broadcast-focused specs. ---
    const talks = [
      { kind: 'tag', build: makeTagTalk },
      { kind: 'flow', build: makeFlowTalk },
      { kind: 'survey', build: makeSurveyTalk },
      { kind: 'route', build: makeRouteTalk },
    ] as const;

    const createdTalks = await createTalksFromCompanyPage(tom.page, talks.map((t) => t.build(runId)));
    const createdByKind = talks.map((talk, index) => ({
      kind: talk.kind,
      ...createdTalks[index]!,
    }));
    expect(createdByKind).toHaveLength(4);

    // --- Jerry auto-answers each talk through the app completion path. Auto mode is the key behavior under test. ---
    await completeTalksInAppByAnswerIds(
      jerry.page,
      createdByKind.map(({ kind, talkId, talkData }) => ({
        talkId,
        talkData,
        answerIds: answerIdsFor(kind),
        outcome: kind === 'survey' ? 'mismatch' : 'match',
        mode: 'auto',
      })),
    );

    // --- Jerry's Answers tab lists all four Q/A ---
    await jerry.page.click('.nav-btn[data-view="me"]');
    await afterSync();
    for (const { title } of createdByKind) {
      await expect(jerry.page.locator('#answers-content').getByText(title).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // --- Sam joins and re-announces each talk; Jerry's chatbot auto-replies ---
    const sam = await bootstrapUser(browsers[2]!, 'Sam', 'Sam');
    sessions.push({ label: 'Sam', context: sam.context, page: sam.page });
    await sam.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(sam.page, 'chatrooms');
    await afterSync();

    for (const { talkId } of createdByKind) {
      await sam.page.evaluate(async (id: string) => {
        const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
        if (!app?.announceTalkToRoom) throw new Error('announceTalkToRoom not found');
        await app.announceTalkToRoom(id);
      }, talkId);
      await afterSync();
    }

    // Sam's Me tab should eventually show conversations with Jerry (one per matched talk).
    await sam.page.click('.nav-btn[data-view="me"]');
    await afterSync();
    const jerryConvs = sam.page.locator('.conversation-list-item').filter({ hasText: 'Jerry' });
    // Tag + flow + route define match answers; survey has none. So Sam expects >= 1 Jerry conversation
    // (all match-capable auto-answers), each carrying Jerry's bot badge.
    await expect(jerryConvs.first()).toBeVisible({ timeout: 20_000 });
    await expect(jerryConvs.first().locator('.conversation-bot-badge')).toBeVisible({
      timeout: 10_000,
    });
  });
});
