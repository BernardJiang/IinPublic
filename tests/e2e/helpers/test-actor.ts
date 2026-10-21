import type { Page } from '@playwright/test';

export type TestActorRuntime = 'browser' | 'android-webview';

/**
 * The minimum surface a journey needs from one participant. New portable journeys should accept
 * this interface instead of launching Chromium directly. Browser contexts and Android WebViews
 * can then execute the same journey body while their providers own lifecycle details.
 */
export interface TestActor {
  id: string;
  runtime: TestActorRuntime;
  page: Page;
  background?: () => Promise<void>;
  foreground?: () => Promise<void>;
  restart?: () => Promise<void>;
  /** Cut or restore this participant's network (a phone's Wi-Fi; a browser context's network). */
  setOffline?: (offline: boolean) => Promise<void>;
}

export interface TestActorProvider {
  runtime: TestActorRuntime;
  capacity: number;
  acquire(id: string): Promise<TestActor>;
  close(): Promise<void>;
}
