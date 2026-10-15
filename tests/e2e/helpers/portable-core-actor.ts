import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { PortableCoreContractReport } from '../../../src/shared/portable-core-contracts';
import type { TestActor } from './test-actor';

declare global {
  interface Window {
    __iinpublicPortableCoreTests?: {
      schemaVersion: 1;
      run: () => PortableCoreContractReport;
    };
  }
}

export async function installPortableCoreBundle(page: Page, bundlePath: string): Promise<void> {
  // addScriptTag({ path }) materializes an inline <script>, which the production WebView's
  // correct `script-src 'self'` policy rejects. Execute the local, harness-built IIFE through
  // the already-authenticated DevTools channel instead. This changes no app headers or runtime
  // CSP and is available only while Playwright is attached over adb/CDP.
  const source = await readFile(bundlePath, 'utf8');
  await page.evaluate(source);
  await page.waitForFunction(() => window.__iinpublicPortableCoreTests?.schemaVersion === 1);
}

export async function runPortableCoreOnActor(
  actor: Pick<TestActor, 'id' | 'runtime' | 'page'>,
  bundlePath: string,
): Promise<PortableCoreContractReport> {
  await installPortableCoreBundle(actor.page, bundlePath);
  const report = await actor.page.evaluate(() => window.__iinpublicPortableCoreTests!.run());
  if (report.failed > 0) {
    const failures = report.results
      .filter((result) => !result.passed)
      .map((result) => `${result.id}: ${result.error || 'failed'}`)
      .join('; ');
    throw new Error(`${actor.runtime} actor ${actor.id} failed portable core contracts: ${failures}`);
  }
  return report;
}
