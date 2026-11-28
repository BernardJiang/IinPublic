import type { WebGunService } from '../services/web-gun-service';
import type { UIManager } from '../ui/ui-manager';

export function registerGunUiForwarding(gun: WebGunService, ui: UIManager): void {
  gun.on('newMessage', (message: any) => ui.displayNewMessage(message));
  gun.on('newTalk', (conversation: any) => ui.displayIncomingTalk(conversation));
  gun.on('chatroomUpdate', (update: any) => ui.updateChatroomInfo(update));
}

export interface HostLifecyclePorts {
  hasSession(): boolean;
  recoverForeground(): void;
  enterBackground(): void;
  beforeUnload(): void;
  now?(): number;
  window?: Window;
  document?: Document;
}

/** Browser/native-shell lifecycle registration with bounded, single-flight foreground recovery. */
export class HostLifecycleHandlers {
  private lastRecoveryAt = 0;
  private recoveryRunning = false;
  private recoveryQueued = false;
  private recoveryScheduled = false;

  constructor(private readonly ports: HostLifecyclePorts) {}

  register(): void {
    const hostWindow = this.ports.window ?? window;
    const hostDocument = this.ports.document ?? document;
    hostWindow.addEventListener('iinpublic-native-resume', () => this.schedule());
    hostDocument.addEventListener('visibilitychange', () => {
      if (hostDocument.hidden) this.ports.enterBackground();
      else this.schedule();
    });
    hostWindow.addEventListener('beforeunload', () => this.ports.beforeUnload());
  }

  private recover(): void {
    if (!this.ports.hasSession()) return;
    if (this.recoveryRunning) {
      this.recoveryQueued = true;
      return;
    }
    const now = this.ports.now?.() ?? Date.now();
    if (now - this.lastRecoveryAt < 500) return;
    this.lastRecoveryAt = now;
    this.recoveryRunning = true;
    try { this.ports.recoverForeground(); }
    finally {
      this.recoveryRunning = false;
      if (this.recoveryQueued) {
        this.recoveryQueued = false;
        queueMicrotask(() => this.recover());
      }
    }
  }

  private schedule(): void {
    if (this.recoveryScheduled) return;
    this.recoveryScheduled = true;
    const hostWindow = this.ports.window ?? window;
    const run = () => {
      this.recoveryScheduled = false;
      this.recover();
    };
    if (typeof hostWindow.requestAnimationFrame === 'function') {
      hostWindow.requestAnimationFrame(() => hostWindow.setTimeout(run, 0));
    } else {
      hostWindow.setTimeout(run, 0);
    }
  }
}
