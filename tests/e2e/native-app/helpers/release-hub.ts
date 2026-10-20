/**
 * A hub with the release chatroom capacity on the Mac's LAN address, and phones prepared to create
 * Places against it, configured like the release hub. A fresh install has no contacts, so the contact minimum
 * for creating a Place is lifted through the E2E query parameter. Used by native-app/33 and /38.
 */
import { expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { bootstrapNativeWindow } from './native-app';
import type { AndroidUser } from './native-app-android';
import { waitForAppReady } from '../../helpers/timing';
import { currentRoomId } from '../../phone-path/phone-path-helpers';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
export const RELEASE_HUB_LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10 };

export async function startReleaseCapacityHub(port: number): Promise<ChildProcess> {
  const env = { ...process.env, E2E_GUN_MEMORY_ONLY: '1', PORT: String(port) };
  delete env.CHATROOM_MAX_CAPACITY;
  delete env.CHATROOM_ENABLE_FIFO;
  const hub = spawn(process.execPath, [path.join(repoRoot, 'dist', 'server', 'server', 'index.js')], { cwd: repoRoot, env, stdio: 'ignore' });
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 60_000, message: 'release-capacity hub did not start' }).toBe(true);
  return hub;
}

/** Confirm the phone's location the way a GPS fix does, then let the WebView reload with the
 *  contact minimum lifted (a fresh install has no contacts; the gate has its own spec). */
export async function preparePlacePhone(user: AndroidUser, label: string, location = RELEASE_HUB_LOCATION): Promise<void> {
  await bootstrapNativeWindow(user.window, label, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000, pinStableLocation: false });
  // Wait for the reload itself before probing the page: a probe during the navigation throws
  // "Execution context was destroyed", which ends the poll instead of retrying it.
  await Promise.all([
    user.window.waitForURL(/e2e_place_min_contacts=0/, { timeout: 60_000 }),
    user.window.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('e2e_place_min_contacts', '0');
      window.location.replace(url.toString());
    }).catch(() => undefined),
  ]);
  await user.window.waitForLoadState('domcontentloaded');
  await waitForAppReady(user.window, 150_000);
  await user.window.evaluate(async (location) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    await app.updateLocationAndMaybeSwitch({ ...location, timestamp: new Date() });
  }, location);
  await expect.poll(() => currentRoomId(user.window), { timeout: 60_000 }).toMatch(/^nearby-v3$/);
}
