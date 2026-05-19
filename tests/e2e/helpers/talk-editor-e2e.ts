import { expect, type Page } from '@playwright/test';

/** Talk editor uses visible radios; hidden #talk-type select does not update the form alone. */
export async function selectTalkEditorType(
  page: Page,
  type: 'flow' | 'tag' | 'survey' | 'route',
): Promise<void> {
  await page.locator(`input[name="talk-type-radio"][value="${type}"]`).check();
  await expect(page.locator('#talk-type')).toHaveValue(type);
}
