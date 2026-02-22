import './styles/main.css';
import { IinPublicApp } from './app/app';
import { LocationPrivacy } from '../shared/location';
import { GPSCoordinate } from '../shared/types';

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

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing IinPublic Web App');

      // FOR TESTING: Use a fixed location so all users end up in same chatroom
      // TODO: Remove this and use real location in production
      const USE_TEST_LOCATION = true;

      let location: GPSCoordinate;
      if (USE_TEST_LOCATION) {
        location = {
          latitude: 37.7749, // San Francisco coordinates
          longitude: -122.4194,
          accuracy: 100,
          timestamp: new Date(),
        };
        console.log(
          '🧪 Using TEST location (all users in same chatroom):',
          location.latitude,
          location.longitude,
        );
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

      console.log('✅ IinPublic Web App initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize app:', error);
      this.showError('Failed to initialize the app. Please refresh and try again.');
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
