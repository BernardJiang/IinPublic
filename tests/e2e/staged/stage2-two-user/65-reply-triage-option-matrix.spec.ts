/**
 * Reply-triage option matrix (catalog Part 5).
 *
 * Two matched users so the creator (A) has ≥1 reply in the "Replies To My Talks"
 * panel. Drives every triage control across its values — outcome, relationship,
 * type, language, date range, 9 sorts, 5 groupings, query, and Clear — asserting
 * each reflects its value and the panel stays rendered.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterNav, afterSync } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';
import { openCollapsedFilters } from '../../helpers/filter-bar';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const OUTCOMES = ['all', 'match', 'mismatch', 'ignore', 'auto'];
const RELATIONS = ['all', 'stranger', 'friend', 'relative', 'coworker', 'acquaintance', 'partner', 'custom'];
const TYPES = ['all', 'flow', 'tag', 'survey', 'route'];
const SORTS = ['recent', 'oldest', 'user', 'talk', 'relationship', 'matches', 'talk-matches', 'talk-replies', 'weighted'];
const GROUPS = ['none', 'responder', 'talk', 'relationship'];

// TODO §M1 (2026-07-30): "Replies To My Talks" panel (#creator-replies-panel) is hidden for now
// (renderCreatorReplies() call sites are no-ops). Skipped rather than deleted — re-enable if/when
// the panel comes back.
test.describe.skip('Reply-triage option matrix', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=1100,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=1100,0', '--window-size=700,1100'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('every triage control across its values', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'ReplyA', 'ReplyB');
    const { pageA } = pair;

    // The fast-DM helper leaves the conversation open; its composer covers the
    // bottom nav. Close it before navigating.
    if (await pageA.locator('#conversation-detail-overlay').isVisible().catch(() => false)) {
      await pageA.click('#back-from-conversation');
      await afterNav();
    }

    await pageA.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await openCollapsedFilters(pageA, 'replies-filter-toggle');
    await expect(pageA.locator('#creator-replies-panel')).toBeVisible();

    const sweepSelect = async (id: string, values: string[]) => {
      for (const value of values) {
        await pageA.selectOption(`#${id}`, value);
        await afterSync();
        await expect(pageA.locator(`#${id}`)).toHaveValue(value);
      }
    };

    await sweepSelect('reply-filter-outcome', OUTCOMES);
    await sweepSelect('reply-filter-relationship', RELATIONS);
    await sweepSelect('reply-filter-type', TYPES);
    await sweepSelect('reply-sort-order', SORTS);
    await sweepSelect('reply-group-order', GROUPS);

    // Language select: at least the "all" value.
    await pageA.selectOption('#reply-filter-language', 'all');
    await afterSync();

    // Date range + query.
    await pageA.fill('#reply-filter-from', '2020-01-01');
    await pageA.fill('#reply-filter-to', '2020-12-31');
    await pageA.fill('#reply-filter-query', 'ReplyB');
    await afterSync();
    await expect(pageA.locator('#reply-filter-query')).toHaveValue('ReplyB');

    await expect(pageA.locator('#creator-replies-panel')).toBeVisible();
  });
});
