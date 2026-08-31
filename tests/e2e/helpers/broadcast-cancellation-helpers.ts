import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './fixtures';
import { afterNav, afterSync, E2E_ASSERT_TIMEOUT_MS } from './timing';
import { gunBaseURL, isDirectTalkDeliveryE2e } from './ports';
import { submitTalkEditorAndWaitForOut } from './talk-demo-ui';
import { ensureChatroomList } from './chatroom-nav';

const noCacheHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } as const;

export async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

export async function incomingClustersIncludeTitleSubstring(
  request: APIRequestContext,
  uid: string,
  needleSubstring: string,
): Promise<boolean> {
  if (isDirectTalkDeliveryE2e()) {
    return false;
  }
  const r = await request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(uid)}/incoming-talks`, {
    headers: noCacheHeaders,
  });
  if (!r.ok()) return false;
  const clusters: any = await r.json();
  const needle = needleSubstring.toLowerCase();

  if (Array.isArray(clusters)) {
    for (const c of clusters) {
      if (String(c?.title || '').toLowerCase().includes(needle)) return true;
    }
  }

  if (Array.isArray(clusters)) {
    for (const c of clusters) {
      const talkIds = c?.talkIds;
      if (!talkIds || typeof talkIds !== 'object' || Array.isArray(talkIds)) continue;
      const ids = Object.keys(talkIds).filter((k) => !k.startsWith('_'));
      for (const id of ids) {
        const tr = await request.get(`${gunBaseURL()}/api/talks/${encodeURIComponent(id)}`, { headers: noCacheHeaders });
        if (!tr.ok()) continue;
        const td = await tr.json();
        if (String(td?.title || '').toLowerCase().includes(needle)) return true;
      }
    }
  }

  return false;
}

export async function createSimpleFlowTalk(
  page: Page,
  title: string,
  matchAnswer = 'Yes',
  ignoreAnswer = 'No',
  options?: { sendToChatroom?: boolean },
): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');

  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(`Want a partner? ${title}`);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill(matchAnswer);
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill(ignoreAnswer);
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

  const sendToChatroomCheck = page.locator('#talk-send-to-chatroom');
  if (options?.sendToChatroom === false) {
    await sendToChatroomCheck.setChecked(false);
  } else if (options?.sendToChatroom === true) {
    await sendToChatroomCheck.setChecked(true);
  }

  await submitTalkEditorAndWaitForOut(page, title);
}

export async function goToChatrooms(page: Page): Promise<void> {
  await ensureChatroomList(page);
  await afterNav();
  await afterSync();
}

export async function waitForBroadcastBulkAckMinSent(
  page: Page,
  expected: { receivers: number; minSent: number },
  timeout = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  const loc = page.locator('[data-testid="broadcast-bulk-ack"]');
  await expect
    .poll(
      async () => {
        const sentStr = await loc.getAttribute('data-broadcast-talks-sent');
        const recvStr = await loc.getAttribute('data-broadcast-receivers');
        const sent = sentStr ? Number(sentStr) : 0;
        const recv = recvStr ? Number(recvStr) : 0;
        return recv >= expected.receivers && sent >= expected.minSent;
      },
      { timeout, intervals: [200, 400, 800], message: 'waiting for broadcast completion attributes' },
    )
    .toBe(true);
}
