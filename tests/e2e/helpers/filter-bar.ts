import { Page } from '@playwright/test';

/**
 * Below 768px the per-tab filter controls collapse behind a "Filters ▾" disclosure
 * (gui-redesign-plan §6 / resolved decisions). Specs that run at phone/640px widths
 * call this before touching filter controls; at desktop widths the toggle is hidden
 * and this is a no-op.
 *
 * @param toggleTestId one of: contacts-filter-toggle · talks-filter-toggle ·
 *                     replies-filter-toggle · me-filter-toggle
 */
export async function openCollapsedFilters(page: Page, toggleTestId: string): Promise<void> {
  const toggle = page.locator(`[data-testid="${toggleTestId}"]`);
  if (!(await toggle.isVisible().catch(() => false))) return;
  const expanded = await toggle.getAttribute('aria-expanded');
  if (expanded !== 'true') await toggle.click();
}
