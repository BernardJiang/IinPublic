import type { ConnectivitySettings } from '../ui/connectivity-settings';
import type { UIManager } from '../ui/ui-manager';

export interface ConnectivityEventHandlerPorts {
  ui: UIManager;
  pruneContacts(): void;
  applySettings(settings: ConnectivitySettings): Promise<void> | void;
  setMatchCollection(enabled: boolean): void;
}

export function registerConnectivityEventHandlers(ports: ConnectivityEventHandlerPorts): void {
  ports.ui.on('contactsCapChanged', () => ports.pruneContacts());
  ports.ui.on('connectivitySettingsChanged', (settings: ConnectivitySettings) => {
    void Promise.resolve(ports.applySettings(settings)).catch((error) => {
      ports.ui.showNotification(`Could not change nearby audience: ${(error as Error).message}`, 'error');
    });
  });
  ports.ui.on('matchCollectionSettingChanged', ({ enabled }: { enabled?: boolean }) => {
    ports.setMatchCollection(enabled === true);
  });
}
