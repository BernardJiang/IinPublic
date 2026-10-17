import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { PortableCoreContractReport } from '../../../src/shared/portable-core-contracts';
import type { PortableJestReport } from '../../../src/test/support/portable-jest/runtime';

export type { PortableJestReport };
import type { TestActor } from './test-actor';

declare global {
  interface Window {
    __iinpublicPortableCoreTests?: {
      schemaVersion: 1;
      run: () => PortableCoreContractReport;
    };
    __iinpublicPortableJest?: {
      schemaVersion: 1;
      run: () => Promise<PortableJestReport>;
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

/**
 * Run the unit files bundled by scripts/build-portable-core-test-bundle.mjs in the actor's page,
 * through the same DevTools channel as the contracts. Failures are returned, not thrown, so the
 * caller can report every one.
 */
export async function runPortableJestOnActor(
  actor: Pick<TestActor, 'id' | 'runtime' | 'page'>,
  bundlePath: string,
): Promise<PortableJestReport> {
  const source = await readFile(bundlePath, 'utf8');
  await actor.page.evaluate(source);
  await actor.page.waitForFunction(() => window.__iinpublicPortableJest?.schemaVersion === 1);
  return actor.page.evaluate(() => window.__iinpublicPortableJest!.run());
}
