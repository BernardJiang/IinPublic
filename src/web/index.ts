import './styles/main.css';
import { IinPublicApp } from './app/app';
import { applyDevStageSeed } from './dev-stage-seeds';
import { isDevStageZeroResolved, resolveDevStageSeed } from './dev-stage-env';
import { LocationPrivacy } from '../shared/location';
import { GPSCoordinate } from '../shared/types';

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
        // Server was just restarted by dev:stage-zero (empty graph). Skip clear-database here —
        // wiping gun._.graph immediately before the browser connects causes Gun puts to hang
        // without ack ("Gun.js put operation timed out").
        console.warn(
          '🧪 stage-zero: close other localhost:3001 tabs or they will re-sync old Gun data into this server',
        );
      }

      // FOR TESTING: Use a fixed location so all users end up in same chatroom
      // Tests can override by setting window.__test_location before app loads
      const USE_TEST_LOCATION = true;

      let location: GPSCoordinate;
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
        location = await LocationPrivacy.getCurrentLocation();
        console.log(
          '📍 Location obtained:',
          location.latitude.toFixed(3),
          location.longitude.toFixed(3),
        );
      }

      // Initialize the main app
      await this.app.initialize(location);

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

  private async clearBrowserStageState(): Promise<void> {
    // Gun.js browser graph (chatrooms/global/users, etc.) — survives reboot unless removed.
    localStorage.removeItem('gun/');
    localStorage.clear();
    try {
      const dbs = await indexedDB.databases?.();
      if (dbs) {
        await Promise.all(
          dbs
            .map((db) => db.name || '')
            .filter((name) => name.startsWith('gun') || name === 'gun-idb')
            .map((name) => new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            })),
        );
      }
      indexedDB.deleteDatabase('gun-idb');
    } catch {
      /* A stale browser cache should never block stage-zero startup. */
    }
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
