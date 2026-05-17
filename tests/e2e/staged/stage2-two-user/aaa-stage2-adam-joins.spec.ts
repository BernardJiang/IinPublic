import { chromium } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline, loadStageSnapshot, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport, bootstrapAdam, saveUserStorageState } from '../../helpers/bootstrap-canonical';
import { afterSync } from '../../helpers/timing';
import { createSimpleFlowTalkAndBroadcast } from '../../helpers/stage-talk-exchange';
import { assertStatusChecks } from '../../helpers/e2e-status-checks';
import { expectToastSoft } from '../../helpers/soft-toast';
import { waitForIncomingTalkClusterOnServer } from '../../helpers/talks-matching-flow';
import { fetchTalkData, submitTalkResponseByAnswerIds } from '../../helpers/talk-demo-ui';
import { gunBaseURL } from '../../helpers/ports';
import { headless } from '../../helpers/timing';

const STAGE2_TALK_TITLE = 'Stage2 Adam Hello';

test.describe('Stage 2 — Adam joins TechSupport', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('load stage1, Adam enters network, exchanges a match talk, save stage2', async () => {
    await loadStageSnapshot('stage1');
    const browser = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=1280,800'] });
    const tech = await bootstrapTechSupport(browser, 'TechSupport');
    const adam = await bootstrapAdam(browser, 'Adam');
    await tech.page.click('.chatroom-item[data-chatroom-id="global"]');
    await adam.page.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();

    await createSimpleFlowTalkAndBroadcast(tech.page, STAGE2_TALK_TITLE, 'Want to connect?');
    await waitForIncomingTalkClusterOnServer(adam.page, STAGE2_TALK_TITLE);
    const adamId = await adam.page.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const incomingRes = await adam.page.request.get(
      `${gunBaseURL()}/api/users/${encodeURIComponent(adamId)}/incoming-talks`,
    );
    const incoming = (await incomingRes.json()) as { talkIds?: Record<string, unknown> }[];
    const firstTalkId = Object.keys(incoming?.[0]?.talkIds || {}).find((k) => !k.startsWith('_')) || '';
    const talkData = await fetchTalkData(adam.page, firstTalkId);
    await submitTalkResponseByAnswerIds(adam.page, firstTalkId, talkData, ['yes']);
    await afterSync();
    await assertStatusChecks(tech.page, [{ kind: 'statusBarMatchesAtLeast', count: 1 }]);
    await expectToastSoft(tech.page, /match/i, { label: 'Match toast (optional)' });

    await saveUserStorageState(tech.context, 'stage2', 'techsupport');
    await saveUserStorageState(adam.context, 'stage2', 'adam');
    await saveStageSnapshot('stage2');
    await tech.context.close();
    await adam.context.close();
    await browser.close();
  });
});
