import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { gunBaseURL } from './ports';
import {
  parseStatusBarMatchCount,
  waitForStatusBarMatchCountAtLeast,
  waitForStatusBarMatchCountAtMost,
  dismissNotificationOverlays,
} from './durable-ui';

export type StatusCheck =
  | { kind: 'statusBarRoom'; substring: string }
  | { kind: 'statusBarMatchesAtLeast'; count: number }
  | { kind: 'statusBarMatchesAtMost'; count: number }
  | { kind: 'navActive'; view: 'chatrooms' | 'talks' | 'contacts' | 'me' | 'settings' }
  | { kind: 'headerStageName'; name: string }
  | { kind: 'chatroomHeadcount'; roomId: string; count: number }
  | { kind: 'conversationCountAtLeast'; count: number }
  | { kind: 'incomingTalkTitle'; titleSubstring: string };

/**
 * Durable UI checks for staged tests. Toasts are not used here — use soft-toast helpers separately.
 */
export async function assertStatusChecks(page: Page, checks: StatusCheck[]): Promise<void> {
  for (const check of checks) {
    switch (check.kind) {
      case 'statusBarRoom':
        await expect
          .poll(async () => (await page.locator('#status-bar-text').textContent()) || '', { timeout: 30_000 })
          .toContain(check.substring);
        break;
      case 'statusBarMatchesAtLeast':
        await waitForStatusBarMatchCountAtLeast(page, check.count);
        break;
      case 'statusBarMatchesAtMost':
        await waitForStatusBarMatchCountAtMost(page, check.count);
        break;
      case 'navActive':
        await expect(page.locator(`.nav-btn[data-view="${check.view}"].active`)).toBeVisible({ timeout: 15_000 });
        break;
      case 'headerStageName':
        await expect(page.locator('[data-testid="user-stage-name"]')).toContainText(check.name, { timeout: 15_000 });
        break;
      case 'chatroomHeadcount': {
        const item = page.locator(`.chatroom-item[data-chatroom-id="${check.roomId}"]`);
        await expect(item).toBeVisible({ timeout: 30_000 });
        await expect(item).toContainText(String(check.count), { timeout: 30_000 });
        break;
      }
      case 'conversationCountAtLeast': {
        const n = await page.evaluate(() => {
          try {
            const raw = localStorage.getItem('myConversations');
            return raw ? Object.keys(JSON.parse(raw)).length : 0;
          } catch {
            return 0;
          }
        });
        expect(n).toBeGreaterThanOrEqual(check.count);
        break;
      }
      case 'incomingTalkTitle':
        await expect
          .poll(async () => {
            const uid = await page.evaluate(() =>
              String(
                (
                  window as unknown as {
                    __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
                  }
                ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
              ),
            );
            if (!uid) return false;
            const res = await page.request.get(
              `${gunBaseURL()}/api/users/${encodeURIComponent(uid)}/incoming-talks`,
              { headers: { 'Cache-Control': 'no-cache' } },
            );
            if (!res.ok()) return false;
            const clusters: unknown = await res.json();
            if (!Array.isArray(clusters)) return false;
            const needle = check.titleSubstring.toLowerCase();
            return clusters.some((c) => String((c as { title?: string })?.title || '').toLowerCase().includes(needle));
          }, { timeout: 60_000 })
          .toBe(true);
        break;
      default:
        break;
    }
  }
  await dismissNotificationOverlays(page);
}

export { parseStatusBarMatchCount, waitForStatusBarMatchCountAtLeast, waitForStatusBarMatchCountAtMost };
