/**
 * Click sweep under a stalled hub (docs/testing/gui-responsiveness-test-plan.md §3).
 *
 * For each surface (a tab, a Settings section, the app bar on that tab) every visible control is
 * clicked once from the same starting screen, with every request to the hub held forever. Each
 * click must produce a visible reaction within UI_RESPONSE_DEADLINE_MS and the main thread must
 * never stall for UI_FREEZE_GAP_MS. A control that cannot be clicked at all (covered by an
 * overlay) is reported too — to the user that is the same dead button.
 *
 * Failures are collected per surface and reported together, so one run lists every dead control.
 * Controls already listed in KNOWN_FINDINGS (docs/testing/gui-responsiveness-audit.md) are
 * reported but do not fail the run; a known control that now responds fails it, so the list is
 * kept honest when a finding is fixed.
 *
 *   SWEEP_HUB=stall|fail|healthy  network condition (default stall)
 *   SWEEP_ONLY=<key part>[,...]   only matching controls, for bisecting
 *   SWEEP_VERBOSE=1               print how every control reacted
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { afterSync } from '../helpers/timing';
import { webAppURLStableChatroom } from '../helpers/ports';
import { dismissNotificationOverlays } from '../helpers/durable-ui';
import { openSettingsSection, backToSettingsMenu, SETTINGS_SECTION } from '../helpers/settings-nav';
import {
  formatSweepFailures,
  installMainThreadProbe,
  failHub,
  stallHub,
  sweepClickables,
  type HubFaultHandle,
  type SweepReport,
} from '../helpers/ui-responsiveness';

type View = 'chatrooms' | 'contacts' | 'talks' | 'me' | 'settings';
const VIEWS: View[] = ['chatrooms', 'contacts', 'talks', 'me', 'settings'];
const ONLY = (process.env.SWEEP_ONLY || '').split(',').map((part) => part.trim()).filter(Boolean);
const HUB = (process.env.SWEEP_HUB || 'stall') as 'stall' | 'fail' | 'healthy';

/**
 * Open findings, by control key → audit id, with the hub conditions they show under (measured
 * 2026-10-30). `hubs[0]` is where the finding reproduces reliably; only there does a control
 * that now responds fail the run as "fixed" — elsewhere it is timing-dependent (e.g. New Room
 * takes ~1.6 s even against a healthy local hub).
 */
const KNOWN_FINDINGS: Record<string, { id: string; hubs: Array<typeof HUB> }> = {
  // All sweep findings (F3, F4, F10, F11, F14, F15) were fixed on 2026-10-30; F12 was a harness
  // false alarm (focus moving into a filter field is a reaction).
};

/** Split a report into new failures (fail the run) and known ones (reported only). */
function judge(reports: SweepReport[]): { unexpected: string; known: string[]; nowFixed: string[] } {
  const known: string[] = [];
  const failedKeys = new Set<string>();
  const unexpected: SweepReport[] = reports.map((report) => ({
    ...report,
    failures: report.failures.filter((failure) => {
      failedKeys.add(failure.key);
      const finding = KNOWN_FINDINGS[failure.key];
      if (finding?.hubs.includes(HUB)) {
        known.push(`${finding.id} [${failure.surface}] ${failure.reason}: "${failure.label}" — ${failure.detail}`);
        return false;
      }
      return true;
    }),
  }));
  const clickedKeys = new Set(reports.flatMap((report) => report.responses.map((line) => line.split(' — ')[0])));
  const nowFixed = Object.entries(KNOWN_FINDINGS)
    .filter(([key, finding]) => finding.hubs[0] === HUB && clickedKeys.has(key) && !failedKeys.has(key))
    .map(([key, finding]) => `${finding.id} (${key}) now responds — remove it from KNOWN_FINDINGS`);
  return { unexpected: formatSweepFailures(unexpected), known, nowFixed };
}

/** Back to a tab's top-level screen with nothing open over it. */
async function resetTo(page: Page, view: View, settingsSection?: string): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  // Test-only cleanup between clicks: a dialog a previous control opened is not under test here.
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay, .notification, .item-details-popup').forEach((element) => element.remove());
    document.getElementById('app-bar-overflow-menu')?.style.setProperty('display', 'none');
  });
  for (const back of ['#back-from-conversation', '#back-from-media', '#back-from-peer-detail']) {
    const button = page.locator(back);
    if (await button.isVisible().catch(() => false)) await button.click({ timeout: 1_000 }).catch(() => undefined);
  }
  await page.locator(`.nav-btn[data-view="${view}"]`).click({ timeout: 2_000 });
  const drillBack = { chatrooms: '#back-to-chatrooms', contacts: '#back-to-contacts-list' } as Record<string, string>;
  const back = drillBack[view] ? page.locator(drillBack[view]) : null;
  if (back && (await back.isVisible().catch(() => false))) await back.click({ timeout: 1_000 }).catch(() => undefined);
  if (view === 'settings') {
    // The menu or a section's Back button appears once Settings has rendered.
    await page.locator('#settings-menu-container:visible, #back-to-settings-menu:visible').first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    if (settingsSection) await openSettingsSection(page, settingsSection);
    else await backToSettingsMenu(page);
  }
  await dismissNotificationOverlays(page);
}

test.describe('GUI responsiveness: click sweep with the hub stalled', () => {
  test.describe.configure({ timeout: 15 * 60_000 });

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let fault: HubFaultHandle | undefined;
  const reports: SweepReport[] = [];

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    // Browser dialogs (alert/confirm) count as a reaction; dismiss them so the sweep continues.
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
    page.on('popup', (popup) => void popup.close().catch(() => undefined));
    await injectIdbClear(page);
    await installMainThreadProbe(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterSync();
    if (HUB === 'stall') fault = await stallHub(page);
    if (HUB === 'fail') fault = await failHub(page);
  });

  test.afterAll(async () => {
    await fault?.clear().catch(() => undefined);
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
    const { unexpected, known, nowFixed } = judge(reports);
    console.log(`\nGUI sweep (hub: ${HUB}) — ${reports.reduce((n, r) => n + r.clicked, 0)} controls clicked`);
    if (unexpected) console.log(`New dead controls:\n${unexpected}`);
    if (known.length) console.log(`Known findings still open:\n${known.join('\n')}`);
    if (nowFixed.length) console.log(`Fixed since listed:\n${nowFixed.join('\n')}`);
    for (const report of reports) {
      console.log(`[${report.surface}] discovered ${report.discovered.length}, clicked ${report.clicked}`);
      if (process.env.SWEEP_VERBOSE) for (const line of report.responses) console.log(`    ${line}`);
      for (const slow of report.slow) console.log(`[${report.surface}] slow ${slow.latencyMs} ms: "${slow.label}" (${slow.key})`);
    }
  });

  for (const view of VIEWS) {
    test(`every control on the ${view} tab and its app bar responds`, async () => {
      const p = page!;
      const shared = { restore: () => resetTo(p, view), ...(ONLY.length ? { only: ONLY } : {}) };
      const panel = await sweepClickables(p, { surface: `${view}/panel`, scope: `#${view}-view`, ...shared });
      const appBar = await sweepClickables(p, {
        surface: `${view}/app-bar`,
        scope: '#top-header',
        // Bottom-nav and back buttons are covered by the navigation tests; the overflow toggle
        // is swept with the panel that shows it.
        deny: ['.nav-btn'],
        ...shared,
      });
      reports.push(panel, appBar);
      expect(panel.clicked + appBar.clicked, `no controls found on ${view}`).toBeGreaterThan(0);
      const verdict = judge([panel, appBar]);
      expect.soft(verdict.unexpected, `dead controls on ${view}`).toBe('');
      expect.soft(verdict.nowFixed, `known findings fixed on ${view}`).toEqual([]);
    });
  }

  for (const [name, sectionId] of Object.entries(SETTINGS_SECTION)) {
    test(`every control in Settings → ${name} responds`, async () => {
      const p = page!;
      await resetTo(p, 'settings');
      const present = await p.locator(`.settings-jump-menu-item[data-target="${sectionId}"]`).count();
      test.skip(present === 0, `Settings → ${name} is not offered to this user`);
      const report = await sweepClickables(p, {
        surface: `settings/${name}`,
        scope: `#${sectionId}`,
        restore: () => resetTo(p, 'settings', sectionId),
        ...(ONLY.length ? { only: ONLY } : {}),
      });
      reports.push(report);
      const verdict = judge([report]);
      expect.soft(verdict.unexpected, `dead controls in Settings → ${name}`).toBe('');
      expect.soft(verdict.nowFixed, `known findings fixed in Settings → ${name}`).toEqual([]);
    });
  }
});
