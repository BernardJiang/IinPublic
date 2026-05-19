import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {
  isStagePipeline,
  loadStageSnapshot,
  saveStageSnapshot,
  saveStage2AdamJoinBaseline,
} from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport, bootstrapCanonicalUser, saveUserStorageState } from '../../helpers/bootstrap-canonical';
import { ADAM } from '../../helpers/canonical-users';
import { afterNav, afterSync } from '../../helpers/timing';
import { createSimpleFlowTalkAndBroadcast } from '../../helpers/stage-talk-exchange';
import { expectToastSoft } from '../../helpers/soft-toast';
import {
  openIncomingTalkModal,
  waitForIncomingTalkClusterOnServer,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { waitForServerConversationBetween } from '../../helpers/conversation-e2e';
import { headless } from '../../helpers/timing';
import fs from 'fs';
import { stageStoragePath } from '../../helpers/e2e-stage-pipeline';

const STAGE2_TALK_TITLE = 'Stage2 Adam Hello';

test.describe('Stage 2 — Adam joins TechSupport', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('load stage1, Adam enters network, exchanges a match talk, save stage2', async () => {
    await loadStageSnapshot('stage1');
    for (const key of ['adam', 'techsupport'] as const) {
      const p = stageStoragePath('stage2', key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const browser = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=1280,800'] });
    const tech = await bootstrapTechSupport(browser, 'TechSupport');
    // Fresh Adam (do not restore stage2 storage — stale files break match with stage1 graph).
    const adam = await bootstrapCanonicalUser(browser, 'Adam', ADAM);
    await tech.page.click('.chatroom-item[data-chatroom-id="global"]');
    await adam.page.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();

    await createSimpleFlowTalkAndBroadcast(tech.page, STAGE2_TALK_TITLE, 'Want to connect?');
    await waitForIncomingTalkClusterOnServer(adam.page, STAGE2_TALK_TITLE);
    await openIncomingTalkModal(adam.page, STAGE2_TALK_TITLE);
    await adam.page.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(adam.page);
    await afterSync();
    const adamId = await adam.page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const techId = await tech.page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    for (const p of [tech.page, adam.page]) {
      await p.click('.nav-btn[data-view="me"]');
      await waitForTabActive(p, 'me');
      await afterNav();
    }
    await waitForServerConversationBetween(tech.page, techId, adamId);
    await waitForServerConversationBetween(adam.page, adamId, techId);
    await expectToastSoft(tech.page, /match/i, { label: 'Match toast (optional)' });

    await saveUserStorageState(tech.context, 'stage2', 'techsupport');
    await saveUserStorageState(adam.context, 'stage2', 'adam');
    await saveStageSnapshot('stage2');
    await saveStage2AdamJoinBaseline();
    await tech.context.close();
    await adam.context.close();
    await browser.close();
  });
});

