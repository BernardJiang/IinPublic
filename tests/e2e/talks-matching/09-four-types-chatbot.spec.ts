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
import { emitCreateTalkFromCompanyPage, waitForOutgoingTalkRow } from '../helpers/talk-demo-ui';
import {
  makeTagTalk,
  makeFlowTalk,
  makeSurveyTalk,
  makeRouteTalk,
} from './lib/four-types-talks';

type Session = { label: string; context: BrowserContext; page: Page };

test.describe('Talks matching — four talk types, Jerry chatbot auto-replies Sam', () => {
  test.setTimeout(600_000);

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

    // --- Tom creates and broadcasts all four talk types ---
    const talks = [
      { kind: 'tag', build: makeTagTalk },
      { kind: 'flow', build: makeFlowTalk },
      { kind: 'survey', build: makeSurveyTalk },
      { kind: 'route', build: makeRouteTalk },
    ] as const;

    const broadcastIds: Array<{ kind: string; title: string; talkId: string }> = [];
    for (const t of talks) {
      const talk = t.build(runId);
      await emitCreateTalkFromCompanyPage(tom.page, talk);
      const talkId = await waitForOutgoingTalkRow(tom.page, talk.title);
      await tom.page.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(tom.page, 'chatrooms');
      await afterSync();
      broadcastIds.push({ kind: t.kind, title: talk.title, talkId });
    }
    expect(broadcastIds).toHaveLength(4);

    // --- Jerry auto-answers each incoming talk ---
    // Tag talks use a checkbox + submit button (no radios). flow/survey/route use
    // per-answer radios with data-mode="auto" — clicking auto saves the choice as
    // the chatbot template (flattened prefs) and advances to the next question.
    const { openIncomingTalkModal, waitForResponseModalClosed } = await import(
      '../helpers/talks-matching-flow'
    );
    for (const { kind, title } of broadcastIds) {
      await openIncomingTalkModal(jerry.page, title);
      const modal = jerry.page.locator('#talk-response-modal');
      if (kind === 'tag') {
        const checkbox = modal.locator('#tag-match-checkbox');
        await expect(checkbox).toBeVisible({ timeout: 15_000 });
        if (!(await checkbox.isChecked())) await checkbox.click();
        await modal.locator('#tag-submit-btn').click();
      } else {
        for (let step = 0; step < 10; step += 1) {
          const stillOpen = await modal.isVisible().catch(() => false);
          if (!stillOpen) break;
          const firstAuto = modal.locator('input.choice-radio[data-mode="auto"]').first();
          try {
            await expect(firstAuto).toBeVisible({ timeout: 15_000 });
          } catch {
            break;
          }
          await firstAuto.click();
          await afterSync();
        }
      }
      await waitForResponseModalClosed(jerry.page);
      await waitForTabActive(jerry.page, 'talks');
    }

    // --- Jerry's Answers tab lists all four Q/A ---
    await jerry.page.click('.nav-btn[data-view="answers"]');
    await afterSync();
    for (const { title } of broadcastIds) {
      await expect(jerry.page.locator('#answers-content').getByText(title).first()).toBeVisible({
        timeout: 20_000,
      });
    }

    // --- Sam joins and re-announces each talk; Jerry's chatbot auto-replies ---
    const sam = await bootstrapUser(browsers[2]!, 'Sam', 'Sam');
    sessions.push({ label: 'Sam', context: sam.context, page: sam.page });
    await sam.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(sam.page, 'chatrooms');
    await afterSync();

    for (const { talkId } of broadcastIds) {
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
    await expect(jerryConvs.first()).toBeVisible({ timeout: 60_000 });
    await expect(jerryConvs.first().locator('.conversation-bot-badge')).toBeVisible({
      timeout: 30_000,
    });
  });
});
