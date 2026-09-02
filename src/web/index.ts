import './styles/main.css';
import { IinPublicApp } from './app/app';
import { applyDevStageSeed } from './dev-stage-seeds';
import { isDevStageZeroResolved, isDevTechSupportDriver, resolveDevStageSeed } from './dev-stage-env';
import { TECHSUPPORT_ROOT_USER_ID } from '../shared/techsupport';
import { LocationPrivacy } from '../shared/location';
import { GPSCoordinate } from '../shared/types';
import { IDENTITY_CUSTODY_DATABASE_NAME } from './services/identity-custody-store';
import { getCachedLocation, setCachedLocation } from './services/location-cache';

const STAGE_ZERO_BOOT_KEY = 'iinpublic_stage_zero_boot';

class WebApp {
  private app: IinPublicApp;

  constructor() {
    this.app = new IinPublicApp();

    // Expose IMMEDIATELY for E2E testing (before any async operations)
    (window as any).__iinpublic_app = this;
    console.log('🔧 Exposed __iinpublic_app to window for E2E testing');
  }

  // Expose app for E2E testing
  getApp(): IinPublicApp {
    return this.app;
  }

  cleanup(): void {
    this.app.manualCleanup();
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing IinPublic Web App');
      const stageSeed = resolveDevStageSeed();
      if (stageSeed) {
        console.log(`🧪 Dev stage seed: ${stageSeed}`);
      }
      if (isDevStageZeroResolved()) {
        if (!sessionStorage.getItem(STAGE_ZERO_BOOT_KEY)) {
          await this.clearBrowserStageState();
          sessionStorage.setItem(STAGE_ZERO_BOOT_KEY, '1');
          console.log('🧪 stage-zero: cleared browser storage — reloading once for a clean Gun/IDB boot');
          window.location.reload();
          return;
        }
        sessionStorage.removeItem(STAGE_ZERO_BOOT_KEY);
        // K3 (docs/TODO.md): plain `stage-zero`/`empty` no longer auto-logs the browser in as
        // TechSupport root — K1 already decoupled the headcount floor from the browser being
        // root (the relay boot seed + the client's compiled-constant floor cover it), so a
        // clean dev boot is now an ordinary user (headcount 2: the dev user + built-in
        // TechSupport). To act AS TechSupport with a real signing identity, run
        // `npm run dev:techsupport` instead. dev:multi's `?devRole=techsupport` driver window is
        // unaffected — it still logs in as root (without a real keypair) so a human can answer
        // other users as TechSupport in that flow.
        if (isDevTechSupportDriver()) {
          localStorage.setItem('iinpublic_user_id', TECHSUPPORT_ROOT_USER_ID);
        }
        // Server was just restarted by dev:stage-zero (empty graph). Skip clear-database here —
        // wiping gun._.graph immediately before the browser connects causes Gun puts to hang
        // without ack ("Gun.js put operation timed out").
        console.warn(
          '🧪 stage-zero: close other localhost:3001 tabs or they will re-sync old Gun data into this server',
        );
      }

      // FOR TESTING: Use a fixed location so all users end up in same chatroom
      // Tests can override by setting window.__test_location before app loads.
      // Real (production) builds resolve real geolocation instead — see the else-branch below.
      const USE_TEST_LOCATION = process.env.NODE_ENV !== 'production';

      let location: GPSCoordinate;
      let locationConfirmed = true;
      if (USE_TEST_LOCATION) {
        // Check if test has set a custom location
        const customLocation = (window as any).__test_location;
        if (customLocation) {
          location = {
            latitude: customLocation.latitude,
            longitude: customLocation.longitude,
            accuracy: customLocation.accuracy || 100,
            timestamp: new Date(),
          };
          console.log('🧪 Using custom TEST location:', location.latitude, location.longitude);
        } else {
          // Default test location: San Diego, so first-run home chatroom resolves to
          // Global → North America → United States → California → San Diego.
          location = {
            latitude: 32.7157,
            longitude: -117.1611,
            accuracy: 100,
            timestamp: new Date(),
          };
          console.log('🧪 Using default TEST location:', location.latitude, location.longitude);
        }
      } else {
        // Cache-first UI: never block first paint on geolocation — a permission prompt, a slow
        // GPS fix, or a device with no GPS at all would otherwise leave the user staring at the
        // loading screen (and, before this, would have failed boot entirely: getCurrentLocation()
        // rejects on denial/timeout, which an unhandled rejection here would have surfaced as the
        // full "Oops! Something went wrong" error screen instead of the app). A returning device
        // reuses its last real fix instantly; a first-ever open uses a neutral placeholder and
        // resolves the real fix in the background, updating once it lands (see
        // resolveRealLocationInBackground below) — matches every other view in this app already
        // reading its own local cache first and syncing live data in afterward.
        const cached = getCachedLocation();
        if (cached) {
          location = cached;
          console.log('📍 Using cached location for instant boot:', location.latitude.toFixed(3), location.longitude.toFixed(3));
        } else {
          location = LocationPrivacy.getMockLocation();
          locationConfirmed = false;
          console.log('📍 No cached location yet — booting with a placeholder while the real one resolves');
        }
        this.resolveRealLocationInBackground();
      }

      // Initialize the main app
      await this.app.initialize(location, { locationConfirmed });

      if (stageSeed) {
        console.log(`🧪 Applying dev stage seed: ${stageSeed}`);
        await applyDevStageSeed(this.app as any, stageSeed);
      }

      console.log('✅ IinPublic Web App initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize app:', error);
      const detail = error instanceof Error ? error.message : String(error);
      this.showError(
        `Failed to initialize the app. Please refresh and try again.${detail ? ` (${detail})` : ''}`,
      );
    }
  }

  /**
   * Fire-and-forget: resolves the real GPS fix without the caller ever awaiting it, so it can
   * never delay first paint. Caches a successful fix for next boot's instant reuse, and pushes it
   * into the already-running app (app.ts's updateCurrentLocation). Denial, timeout, or no GPS at
   * all is silently swallowed — the app keeps working off whatever location it already booted
   * with (cached, or the neutral placeholder), never blocking and never surfacing an error for
   * something this non-essential to using the app.
   */
  private resolveRealLocationInBackground(): void {
    void LocationPrivacy.getCurrentLocation()
      .then((location) => {
        setCachedLocation(location);
        console.log('📍 Real location resolved:', location.latitude.toFixed(3), location.longitude.toFixed(3));
        this.app.updateCurrentLocation(location);
      })
      .catch((error) => {
        console.warn('📍 Could not resolve real location (keeping cached/placeholder):', error);
      });
  }

  private async clearBrowserStageState(): Promise<void> {
    // Gun.js browser graph (chatrooms/global/users, etc.) — survives reboot unless removed.
    localStorage.removeItem('gun/');
    localStorage.clear();
    // `deleteDatabase` never settles — not even `onblocked` — if this same page already holds
    // an open connection to the database being deleted, which stalls boot forever behind a
    // loading spinner with no error. The comment below promises this clear "should never block
    // stage-zero startup", but a `try/catch` alone only guards a synchronous throw, not a
    // promise that simply never resolves — race it against a bounded timeout so that promise
    // is actually kept.
    await Promise.race([
      this.clearStageZeroIndexedDb(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]).catch(() => {
      /* A stale browser cache should never block stage-zero startup. */
    });
  }

  private async clearStageZeroIndexedDb(): Promise<void> {
    const dbs = await indexedDB.databases?.();
    if (dbs) {
      await Promise.all(
        dbs
          .map((db) => db.name || '')
          .filter(
            (name) =>
              name.startsWith('gun') ||
              name === 'gun-idb' ||
              name === IDENTITY_CUSTODY_DATABASE_NAME,
          )
          .map((name) => new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })),
      );
    }
    indexedDB.deleteDatabase('gun-idb');
  }

  private showError(message: string): void {
    const appElement = document.getElementById('app');
    if (appElement) {
      appElement.innerHTML = `
        <div class="error-container">
          <h1>Oops! Something went wrong</h1>
          <p>${message}</p>
          <button onclick="window.location.reload()">Retry</button>
        </div>
      `;
    }
  }
}

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const webApp = new WebApp();
  await webApp.initialize();
});
