import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { gunBaseURL } from './ports';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';
import { fetchUserConversations } from './conversation-e2e';

/** Parse "· 3 matches" from `#status-bar-text`; 0 if no match segment. */
export function parseStatusBarMatchCount(text: string): number {
  const m = text.match(/·\s*(\d+)\s+match(?:es)?/i);
  return m ? parseInt(m[1], 10) : 0;
}

/** Wait until the status bar reports at least `min` matches (durable; avoids Match! toasts). */
export async function waitForStatusBarMatchCountAtLeast(
  page: Page,
  min: number,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        parseStatusBarMatchCount((await page.locator('#status-bar-text').textContent()) || ''),
      { timeout, message: `status bar should show ≥ ${min} match(es)` },
    )
    .toBeGreaterThanOrEqual(min);
}

/** Wait until the status bar reports at most `max` matches (0 = no "· N match" segment). */
export async function waitForStatusBarMatchCountAtMost(
  page: Page,
  max: number,
  timeout = 20_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        parseStatusBarMatchCount((await page.locator('#status-bar-text').textContent()) || ''),
      { timeout, message: `status bar should show ≤ ${max} match(es)` },
    )
    .toBeLessThanOrEqual(max);
}

/** Remove `.notification` nodes so they do not block clicks (not an assertion). */
export async function dismissNotificationOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.notification').forEach((el) => el.remove());
  });
}

/** Poll peer talk-history API until a title appears (durable before opening contact detail). */
export async function waitForPeerHistoryTitle(
  page: Page,
  userId: string,
  peerId: string,
  title: string,
  timeout = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  const request: APIRequestContext = page.context().request;
  await expect
    .poll(
      async () => {
        const localTitles = await page
          .evaluate(async ({ uid, pid }) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const conversations =
              typeof app?.conversationService?.getUserConversationsSnapshot === 'function'
                ? await app.conversationService.getUserConversationsSnapshot(uid)
                : [];
            const localRaw = localStorage.getItem('myConversations');
            const localMap = localRaw ? JSON.parse(localRaw) : {};
            const localConversations = Object.entries(localMap).map(([conversationId, value]) => ({
              ...(value as any),
              conversationId,
            }));
            const talkIds = [...localConversations, ...conversations]
              .filter((conv: any) => conv?.otherUserId === pid && conv?.talkId)
              .map((conv: any) => String(conv.talkId));
            const gun = app?.gunService?.getGun?.();
            if (!gun || talkIds.length === 0) return [];
            const titles = await Promise.all(
              Array.from(new Set(talkIds)).map(
                (talkId) =>
                  new Promise<string>((resolve) => {
                    gun.get(`talks/${talkId}`).once((raw: any) => {
                      let talk = raw;
                      if (raw?.data && typeof raw.data === 'string') {
                        try {
                          talk = JSON.parse(raw.data);
                        } catch {
                          talk = raw;
                        }
                      }
                      resolve(String(talk?.title || ''));
                    });
                    setTimeout(() => resolve(''), 500);
                  }),
              ),
            );
            return titles.filter(Boolean);
          }, { uid: userId, pid: peerId })
          .catch(() => []);
        if (localTitles.length > 0) return localTitles;

        const localConversations = await fetchUserConversations(page, userId).catch(() => []);
        const matchingTalkIds = localConversations
          .filter((conv) => conv?.otherUserId === peerId && conv?.talkId)
          .map((conv) => String(conv.talkId));
        if (matchingTalkIds.includes(title)) return [title];

        const res = await request.get(
          `${gunBaseURL()}/api/users/${encodeURIComponent(userId)}/peers/${encodeURIComponent(peerId)}/talk-history`,
          { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
        );
        if (!res.ok()) return [];
        const history = (await res.json()) as Array<{ title?: string }>;
        return history.map((item) => String(item.title || ''));
      },
      { message: `${title} should be in peer talk history`, timeout, intervals: [200, 500, 1000] },
    )
    .toContain(title);
}

/** Wait until contact detail finished loading (not Loading/Could not load). */
export async function waitForContactDetailReady(page: Page, timeout = E2E_ASSERT_TIMEOUT_MS): Promise<void> {
  await expect
    .poll(
      async () => {
        const matchesText = (await page.locator('#contact-detail-matches').textContent()) || '';
        if (/loading/i.test(matchesText) || /could not load/i.test(matchesText)) return matchesText;
        const hasTalkRow = await page.locator('.contact-talk-item').first().isVisible().catch(() => false);
        const talksText = (await page.locator('#contact-talks-list').textContent()) || '';
        if (hasTalkRow || /no talks/i.test(talksText) || /talk/i.test(matchesText)) return 'ready';
        return matchesText || 'pending';
      },
      { timeout, intervals: [200, 400, 800] },
    )
    .toBe('ready');
}
