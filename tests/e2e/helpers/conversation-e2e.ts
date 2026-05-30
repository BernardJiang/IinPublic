import { expect, type Page } from '@playwright/test';
import { gunBaseURL } from './ports';

async function fetchUserConversations(
  page: Page,
  userId: string,
): Promise<Array<{ conversationId?: string; otherUserId?: string; otherUserName?: string }>> {
  const res = await page.request.get(
    `${gunBaseURL()}/api/test/user-conversations/${encodeURIComponent(userId)}`,
  );
  if (!res.ok()) return [];
  const body = (await res.json()) as { conversations?: Array<{ conversationId?: string; otherUserId?: string }> };
  return body.conversations ?? [];
}

export async function getConversationIdBetween(
  page: Page,
  userId: string,
  otherUserId: string,
  timeoutMs = 30_000,
): Promise<string> {
  let conversationId = '';
  await expect
    .poll(async () => {
      const hit = (await fetchUserConversations(page, userId)).find((c) => c?.otherUserId === otherUserId);
      conversationId = hit?.conversationId ?? '';
      return conversationId;
    }, { timeout: timeoutMs, message: `conversation id between ${userId} and ${otherUserId}` })
    .not.toBe('');
  return conversationId;
}

/** Durable match check via server conversations map (localStorage can lag). */
export async function waitForServerConversationBetween(
  page: Page,
  userId: string,
  otherUserId: string,
  timeoutMs = 120_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const list = await fetchUserConversations(page, userId);
        return list.some((c) => c?.otherUserId === otherUserId);
      },
      { timeout: timeoutMs, message: `Server conversation between ${userId} and ${otherUserId}` },
    )
    .toBe(true);
}

/** Open Me conversation overlay when Gun→localStorage sync lags behind server match. */
export async function openConversationViaServer(
  page: Page,
  userId: string,
  otherUserName: string,
  otherUserId: string,
): Promise<void> {
  await waitForServerConversationBetween(page, userId, otherUserId);
  const conversationId = await getConversationIdBetween(page, userId, otherUserId);
  await page.evaluate(
    ({ cid, name, oid }) => {
      const ui = (window as unknown as { __iinpublic_app?: { getApp: () => { uiManager?: { showConversationDetail?: (id: string) => void } } } })
        .__iinpublic_app?.getApp?.()?.uiManager;
      const raw = localStorage.getItem('myConversations');
      const conversations = raw ? JSON.parse(raw) : {};
      conversations[cid] = {
        ...(conversations[cid] || {}),
        otherUserId: oid,
        otherUserName: name,
      };
      localStorage.setItem('myConversations', JSON.stringify(conversations));
      ui?.showConversationDetail?.(cid);
    },
    { cid: conversationId, name: otherUserName, oid: otherUserId },
  );
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
}
