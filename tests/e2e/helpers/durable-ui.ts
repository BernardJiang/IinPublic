import { expect, type Page, type Locator } from '@playwright/test';
import { E2E_ASSERT_TIMEOUT_MS } from './timing';

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

/** Poll the receiver-local exchange ledger until a title appears. */
export async function waitForPeerHistoryTitle(
  page: Page,
  _userId: string,
  peerId: string,
  title: string,
  timeout = E2E_ASSERT_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(
      () => page.evaluate((pid) => {
        const titles = new Set<string>();
        const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        Object.values(exchanges)
          .filter((entry: any) => String(entry?.peerId || '') === pid)
          .map((entry: any) => String(entry?.title || ''))
          .filter(Boolean)
          .forEach((entryTitle) => titles.add(entryTitle));

        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        const addTalkTitle = (talkId: unknown) => {
          const id = String(talkId || '').trim();
          if (!id || id === 'direct') return;
          const talk = myTalks[id];
          const talkTitle = String(talk?.title || talk?.fullTalk?.title || '').trim();
          if (talkTitle) titles.add(talkTitle);
        };
        Object.values(conversations)
          .filter((conversation: any) => String(conversation?.otherUserId || '') === pid)
          .forEach((conversation: any) => {
            addTalkTitle(conversation?.talkId);
            if (Array.isArray(conversation?.relatedTalkIds)) {
              conversation.relatedTalkIds.forEach(addTalkTitle);
            }
            if (typeof conversation?.relatedTalkIdsJson === 'string') {
              try {
                const parsed = JSON.parse(conversation.relatedTalkIdsJson);
                if (Array.isArray(parsed)) parsed.forEach(addTalkTitle);
              } catch {
                /* ignore malformed legacy metadata */
              }
            }
          });
        return Array.from(titles);
      }, peerId).catch(() => []),
      { message: `${title} should be in peer talk history`, timeout, intervals: [200, 500, 1000] },
    )
    .toContain(title);
}

/** Wait until contact detail finished loading (not Loading/Could not load). */
/**
 * After a contact/member ROW click (not the name — see contacts-view.ts's tap-target
 * split): the shared ⟨User⟩ layout opens directly, with no DM conversation step to
 * dismiss first (that's what a NAME click does instead — see `waitForContactDmReady`
 * below). The old contact-detail page is retired — redesign §5.
 */
export async function waitForContactDetailReady(page: Page, timeout = E2E_ASSERT_TIMEOUT_MS): Promise<void> {
  await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout });
  await expect
    .poll(
      async () => {
        const subtitle = (await page.locator('#peer-detail-subtitle').textContent()) || '';
        if (/loading|加载/i.test(subtitle)) return subtitle;
        const hasHistoryRow = await page.locator('.peer-history-item').first().isVisible().catch(() => false);
        const historyText = (await page.locator('#peer-talk-history-list').textContent()) || '';
        if (hasHistoryRow || historyText.trim().length > 0) return 'ready';
        return 'pending';
      },
      { timeout, intervals: [200, 400, 800] },
    )
    .toBe('ready');
}

/**
 * Click a contact/member row's NAME specifically (not the row generally) — the tap
 * target that lands on the DM conversation directly, with the shared ⟨User⟩ layout
 * underneath (contacts-view.ts's tap-target split; rule N2a still applies to name taps).
 * `row` is the `.contact-item`/member-row locator; this drills into its `.contact-item-name`.
 */
export async function clickContactNameForDm(row: Locator, timeout = E2E_ASSERT_TIMEOUT_MS): Promise<void> {
  await row.locator('.contact-item-name').click({ timeout });
}

/** After a contact NAME click: waits for the DM conversation overlay to be visible. */
export async function waitForContactDmReady(page: Page, timeout = E2E_ASSERT_TIMEOUT_MS): Promise<void> {
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout });
}
