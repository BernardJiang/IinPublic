import type { Page } from '@playwright/test';

/**
 * Resize the browser window so the content area (viewport) is fully visible.
 * Uses CDP Browser.setContentsSize to set the content size; Chromium resizes
 * the window to fit. Call after creating the first page in a context.
 * Only works with Chromium (Chrome/Edge).
 */
export async function ensureWindowFitsViewport(
  page: Page,
  contentWidth: number,
  contentHeight: number,
): Promise<void> {
  // CDP is a Chromium-only protocol. Mixed-browser runs should keep the viewport
  // supplied to browser.newContext() and avoid making a known-invalid API call.
  if (page.context().browser()?.browserType().name() !== 'chromium') return;

  try {
    const cdp = await page.context().newCDPSession(page);
    // getWindowForTarget uses the session's target when targetId is omitted
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setContentsSize', {
      windowId,
      width: contentWidth,
      height: contentHeight,
    });
  } catch (e) {
    console.warn('ensureWindowFitsViewport failed:', e);
  }
}
