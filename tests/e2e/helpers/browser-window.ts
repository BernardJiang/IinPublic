import type { CDPSession, Page } from '@playwright/test';

export interface BrowserWindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BrowserWindowPlacement {
  windowId: number;
  bounds: BrowserWindowBounds;
}

async function windowIdForPage(cdp: CDPSession): Promise<number> {
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  const { windowId } = await cdp.send('Browser.getWindowForTarget', {
    targetId: targetInfo.targetId,
  });
  return windowId;
}

/**
 * Read the physical desktop work area rather than `window.screen`, which Playwright replaces with
 * the BrowserContext's emulated viewport. The maximize/read/restore sequence works through the
 * same Chromium window-management API used by the demo and does not depend on a host OS command.
 */
export async function getBrowserWindowWorkArea(
  page: Page,
): Promise<BrowserWindowBounds | undefined> {
  if (page.context().browser()?.browserType().name() !== 'chromium') return undefined;

  let cdp: CDPSession | undefined;
  try {
    cdp = await page.context().newCDPSession(page);
    const windowId = await windowIdForPage(cdp);
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
    await page.waitForTimeout(250);
    const maximized = await cdp.send('Browser.getWindowBounds', { windowId });
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' },
    });

    const { left, top, width, height } = maximized.bounds;
    if (left === undefined || top === undefined || width === undefined || height === undefined) {
      return undefined;
    }
    return { left, top, width, height };
  } finally {
    await cdp?.detach().catch(() => {});
  }
}

/** Position and size one headed Chromium window for multi-user visual demos. */
export async function setBrowserWindowBounds(
  page: Page,
  bounds: BrowserWindowBounds,
): Promise<BrowserWindowPlacement | undefined> {
  if (page.context().browser()?.browserType().name() !== 'chromium') return undefined;

  let cdp: CDPSession | undefined;
  try {
    cdp = await page.context().newCDPSession(page);
    // Omitting targetId can resolve the same active Chrome window for every BrowserContext.
    // Resolve this page's target explicitly so multi-user demos position the intended window.
    const windowId = await windowIdForPage(cdp);
    await cdp.send('Browser.setWindowBounds', { windowId, bounds });
    const actual = await cdp.send('Browser.getWindowBounds', { windowId });
    return {
      windowId,
      bounds: {
        left: actual.bounds.left ?? bounds.left,
        top: actual.bounds.top ?? bounds.top,
        width: actual.bounds.width ?? bounds.width,
        height: actual.bounds.height ?? bounds.height,
      },
    };
  } finally {
    await cdp?.detach().catch(() => {});
  }
}

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
    await cdp.detach();
  } catch (e) {
    console.warn('ensureWindowFitsViewport failed:', e);
  }
}
