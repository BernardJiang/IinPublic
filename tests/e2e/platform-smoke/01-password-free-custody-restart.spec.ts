/**
 * Browser custody v3 restart proof.
 *
 * A persistent Playwright profile is launched, completely closed, and launched again. This is
 * intentionally stronger than page.reload(): the CryptoKey must survive the browser process
 * releasing and reopening IndexedDB. The same spec runs in Chromium, WebKit, and Firefox via
 * `npm run test:e2e:custody-restart`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { webBaseURL } from '../helpers/ports';
import { gotoWebApp } from '../helpers/clear-database';

type CustodySnapshot = {
  pair: { pub: string; epub: string; priv: string; epriv: string };
  format: string;
  keyExtractable: boolean;
  keyAlgorithm: string;
  keyUsages: string[];
  exportRejected: boolean;
  legacyV1Present: boolean;
};

async function readCustodySnapshot(page: Page): Promise<CustodySnapshot> {
  return page.evaluate(async () => {
    const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
    if (!pair?.pub || !pair?.epub || !pair?.priv || !pair?.epriv) {
      throw new Error('Active SEA identity is unavailable');
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('iinpublic-identity-custody-v3', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<any>((resolve, reject) => {
      const transaction = database.transaction('custody', 'readonly');
      const request = transaction.objectStore('custody').get('active');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (!stored?.record || !stored?.wrappingKey) throw new Error('Browser custody v3 row is unavailable');
    let exportRejected = false;
    try {
      await crypto.subtle.exportKey('raw', stored.wrappingKey);
    } catch {
      exportRejected = true;
    }
    return {
      pair: { pub: pair.pub, epub: pair.epub, priv: pair.priv, epriv: pair.epriv },
      format: stored.record.format,
      keyExtractable: stored.wrappingKey.extractable,
      keyAlgorithm: stored.wrappingKey.algorithm.name,
      keyUsages: [...stored.wrappingKey.usages].sort(),
      exportRejected,
      legacyV1Present: localStorage.getItem('iinpublic_key_custody_v1') !== null,
    };
  });
}

async function launchProfile(
  browserType: BrowserType,
  profileDir: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browserType.launchPersistentContext(profileDir, { headless: true });
  await context.addInitScript(() => localStorage.setItem('iinpublic_walkthrough_seen', 'true'));
  const page = context.pages()[0] ?? await context.newPage();
  await gotoWebApp(page, webBaseURL(), 30_000);
  return { context, page };
}

test.describe('@smoke password-free custody v3 browser restart', () => {
  test('keeps a non-extractable key and the same identity across a browser restart', async ({ browserName }) => {
    const browserType = { chromium, firefox, webkit }[browserName];
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-custody-v3-'));
    let context: BrowserContext | undefined;
    try {
      ({ context } = await launchProfile(browserType, profileDir));
      const first = await readCustodySnapshot(context.pages()[0]);
      expect(first).toMatchObject({
        format: 'webcrypto-nonextractable-v3',
        keyExtractable: false,
        keyAlgorithm: 'AES-GCM',
        keyUsages: ['decrypt', 'encrypt'],
        exportRejected: true,
        legacyV1Present: false,
      });

      await context.pages()[0]
        .evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.())
        .catch(() => {});
      await context.close();
      context = undefined;

      ({ context } = await launchProfile(browserType, profileDir));
      const afterRestart = await readCustodySnapshot(context.pages()[0]);
      expect(afterRestart).toMatchObject({
        format: 'webcrypto-nonextractable-v3',
        keyExtractable: false,
        keyAlgorithm: 'AES-GCM',
        keyUsages: ['decrypt', 'encrypt'],
        exportRejected: true,
        legacyV1Present: false,
      });
      expect(afterRestart.pair).toEqual(first.pair);
    } finally {
      await context?.close().catch(() => {});
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
});
