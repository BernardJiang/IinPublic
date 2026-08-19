/**
 * Tom sends one talk of each of the four types (tag, flow, survey, route) to Jerry.
 * Jerry enables the chatbot and answers all with auto-mode, so the answers are saved
 * as flattened preferences.  Jerry's Answers tab then lists all four Q/A — some
 * questions have a contextHashId (flow / route later steps), others don't (tag, survey,
 * first question of flow/route).  Sam joins and re-announces the same four talk ids;
 * Jerry's chatbot replies automatically, so Sam stores bot-attributed match conversations with Jerry.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterNav } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { disposeE2eSessionList, launchBrowserGrid, shutdownBrowserGrid } from '../../helpers/many-browsers';
import {
  buildPositionalAnswerIdMap,
  buildRouteAnswerIdMap,
  completeTalksInAppByAnswerIds,
  createFlowOrSurveyTalkViaEditor,
  createRouteTalkViaEditor,
  createTagTalkViaEditor,
  talkQuestionsToUiSpec,
  talkRouteQuestionsToUiSpec,
} from '../../helpers/talk-demo-ui';
import {
  makeTagTalk,
  makeFlowTalk,
  makeSurveyTalk,
  makeRouteTalk,
} from '../../talks-matching/lib/four-types-talks';

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

/** Real UI-generated tag ids are always fixed (`processTalkForm`'s tag branch), regardless of
 *  the script-authored fixture's own ids. */
const TAG_ANSWER_ID_MAP: Record<string, string> = { a_tag_match: 'a_0_match', a_tag_ignore: 'a_0_ignore' };

test.describe('Talks matching — four talk types, Jerry chatbot auto-replies Sam', () => {
  test.setTimeout(120_000);

  let browsers: Browser[] = [];
  const sessions: Session[] = [];

  test.beforeAll(async () => {
    await clearGunForStage3Spec();
    browsers = await launchBrowserGrid(3);
  });

  test.afterAll(async () => {
    await disposeE2eSessionList(sessions);
    await shutdownBrowserGrid(browsers);
    await clearGunForStage3Spec();
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
    const jerryId = await jerry.page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(jerryId).toBeTruthy();
    await jerry.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(jerry.page, 'chatrooms');
    await afterSync();

    // Enable Jerry's chatbot BEFORE answering so auto-mode answers are saved as bot templates.
    await jerry.page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(jerry.page, SETTINGS_SECTION.talkBehavior);
    const chatbotCheckbox = jerry.page.locator('#settings-chatbot-enabled');
    if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
    await jerry.page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();

    // --- Tom creates all four talk types in OUT, each through the real Talk Editor; delivery is
    // covered by broadcast-focused specs. ---
    const tagTalk = makeTagTalk(runId);
    const flowTalk = makeFlowTalk(runId);
    const surveyTalk = makeSurveyTalk(runId);
    const routeTalk = makeRouteTalk(runId);

    const createdTag = await createTagTalkViaEditor(tom.page, { title: tagTalk.title });
    const createdFlow = await createFlowOrSurveyTalkViaEditor(tom.page, {
      title: flowTalk.title,
      type: 'flow',
      questions: talkQuestionsToUiSpec(flowTalk.questions),
    });
    const createdSurvey = await createFlowOrSurveyTalkViaEditor(tom.page, {
      title: surveyTalk.title,
      type: 'survey',
      questions: talkQuestionsToUiSpec(surveyTalk.questions),
    });
    const createdRoute = await createRouteTalkViaEditor(tom.page, {
      title: routeTalk.title,
      root: talkRouteQuestionsToUiSpec(routeTalk.questions),
    });

    // The real editor generates its own answer ids, independent of each fixture's own — map the
    // fixed answer ids `answerIdsFor` returns to the ones the created talk actually has.
    const idMapByKind: Record<TalkKind, Record<string, string>> = {
      tag: TAG_ANSWER_ID_MAP,
      flow: buildPositionalAnswerIdMap(flowTalk.questions),
      survey: buildPositionalAnswerIdMap(surveyTalk.questions),
      route: buildRouteAnswerIdMap(routeTalk.questions, createdRoute.talkData.questions),
    };

    const createdByKind = [
      { kind: 'tag' as const, ...createdTag },
      { kind: 'flow' as const, ...createdFlow },
      { kind: 'survey' as const, ...createdSurvey },
      { kind: 'route' as const, ...createdRoute },
    ];
    expect(createdByKind).toHaveLength(4);

    // --- Jerry auto-answers each talk through the app completion path. Auto mode is the key behavior under test. ---
    await completeTalksInAppByAnswerIds(
      jerry.page,
      createdByKind.map(({ kind, talkId, talkData }) => ({
        talkId,
        talkData,
        answerIds: answerIdsFor(kind).map((id) => idMapByKind[kind][id] ?? id),
        outcome: kind === 'survey' ? 'mismatch' : 'match',
        mode: 'auto',
      })),
    );

    // --- Jerry's Answers tab lists all four Q/A ---
    // Rows are merged by question (spec-defined questionId); the talk title text lives in
    // each row's collapsed details, revealed only via the tap-to-open-details popup — see
    // TODO §M-merge in answers-view.ts.
    await jerry.page.click('.nav-btn[data-view="me"]');
    await afterSync();
    for (const { title, talkId } of createdByKind) {
      const row = jerry.page.locator(`.answer-talk-item[data-talk-ids~="${talkId}"]`).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();
      await expect(jerry.page.locator('#item-details-popup').getByText(title).first()).toBeVisible({
        timeout: 10_000,
      });
      await jerry.page.click('#close-item-details-popup');
    }

    // --- Sam joins and re-announces each talk; Jerry's chatbot auto-replies ---
    const sam = await bootstrapUser(browsers[2]!, 'Sam', 'Sam');
    sessions.push({ label: 'Sam', context: sam.context, page: sam.page });
    const samIdentity = await sam.page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const pair = app?.gunService?.getStoredPair?.();
      return {
        id: String(app?.currentUser?.id || ''),
        name: String(app?.currentUser?.stageName || 'Sam'),
        epub: String(pair?.epub || ''),
      };
    });
    expect(samIdentity.id).toBeTruthy();
    expect(samIdentity.epub).toBeTruthy();
    await sam.page.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(sam.page, 'chatrooms');
    await afterSync();

    for (const { talkId, talkData } of createdByKind) {
      const samAuthoredTalk = {
        ...talkData,
        authorId: samIdentity.id,
        authorName: samIdentity.name,
        authorEpub: samIdentity.epub,
        senderEpub: samIdentity.epub,
      };
      await sam.page.evaluate(async ({ id, talk }: { id: string; talk: any }) => {
        const app = (window as unknown as { __iinpublic_app?: { getApp: () => any } }).__iinpublic_app?.getApp?.();
        if (!app?.announceTalkToRoom) throw new Error('announceTalkToRoom not found');
        await app.announceTalkToRoom(id, talk);
      }, { id: talkId, talk: samAuthoredTalk });
      await afterSync();
    }

    // Tag + flow + route define match answers; survey has none. So Sam expects at least one
    // bot-attributed Jerry conversation stored locally.
    await sam.page.waitForFunction((expectedJerryId) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      return Object.values(conversations).some(
        (conversation: any) => conversation?.otherUserId === expectedJerryId && conversation.respondedByBot === true,
      );
    }, jerryId, { timeout: 45_000 });
  });
});
