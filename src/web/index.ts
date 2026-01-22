import './styles/main.css';
import { IinPublicApp } from './app/app';
import { LocationPrivacy } from '../shared/location';

class WebApp {
  private app: IinPublicApp;

  constructor() {
    this.app = new IinPublicApp();
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing IinPublic Web App');
      
      // Initialize location services
      const location = await LocationPrivacy.getCurrentLocation();
      console.log('📍 Location obtained:', location.latitude.toFixed(3), location.longitude.toFixed(3));
      
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