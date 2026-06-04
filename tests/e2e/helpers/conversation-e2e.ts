import { expect, type Page } from '@playwright/test';
import { gunBaseURL } from './ports';

type ConversationSnapshot = {
  conversationId?: string;
  otherUserId?: string;
  otherUserName?: string;
  talkId?: string;
  transportMode?: string;
};

async function fetchLocalUserConversations(page: Page, userId: string): Promise<ConversationSnapshot[]> {
  return page.evaluate(async (uid) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const localRaw = localStorage.getItem('myConversations');
    const localMap = localRaw ? JSON.parse(localRaw) : {};
    const localItems = Object.entries(localMap).map(([conversationId, value]) => ({
      ...(value as any),
      conversationId,
    }));

    const snapshot =
      typeof app?.conversationService?.getUserConversationsSnapshot === 'function'
        ? await app.conversationService.getUserConversationsSnapshot(uid)
        : [];

    const merged = new Map<string, any>();
    for (const conv of [...localItems, ...snapshot]) {
      const cid = conv?.conversationId;
      if (!cid || !conv?.otherUserId) continue;
      merged.set(cid, { ...merged.get(cid), ...conv });
    }
    return Array.from(merged.values());
  }, userId);
}

export async function fetchUserConversations(
  page: Page,
  userId: string,
): Promise<ConversationSnapshot[]> {
  const local = await fetchLocalUserConversations(page, userId).catch(() => []);
  if (local.length > 0) return local;

  const res = await page.request.get(
    `${gunBaseURL()}/api/test/user-conversations/${encodeURIComponent(userId)}`,
  );
  if (!res.ok()) return [];
  const body = (await res.json()) as { conversations?: ConversationSnapshot[] };
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

/** Durable match check via local/Gun conversations, with legacy REST fallback. */
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
      { timeout: timeoutMs, message: `conversation between ${userId} and ${otherUserId}` },
    )
    .toBe(true);
}

/** Open Me conversation overlay once the pair-local conversation exists. */
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
      const ui = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
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
