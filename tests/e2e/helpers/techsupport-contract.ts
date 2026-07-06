import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../src/shared/techsupport';

type CurrentUserIdentity = {
  id: string;
  stageName: string;
};

async function readCurrentUserIdentity(page: Page): Promise<CurrentUserIdentity> {
  return page.evaluate(() => {
    const currentUser = (window as any).__iinpublic_app?.getApp?.()?.currentUser || {};
    return {
      id: String(currentUser.id || ''),
      stageName: String(currentUser.stageName || ''),
    };
  });
}

export async function expectCurrentUserIsTechSupportRoot(page: Page): Promise<void> {
  await expect
    .poll(() => readCurrentUserIdentity(page), { timeout: 15_000 })
    .toEqual({
      id: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
    });
}

export async function expectCurrentUserIsOrdinaryUser(
  page: Page,
  expectedStageName?: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const user = await readCurrentUserIdentity(page);
      return {
        hasId: user.id.length > 0,
        isRoot: user.id === TECHSUPPORT_ROOT_USER_ID,
        stageName: user.stageName,
      };
    }, { timeout: 15_000 })
    .toEqual({
      hasId: true,
      isRoot: false,
      stageName: expectedStageName || expect.any(String),
    });
}
