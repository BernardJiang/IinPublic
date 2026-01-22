import { User } from '../../shared/types';
import { EventEmitter } from 'events';
export declare class UIManager extends EventEmitter {
    private appContainer?;
    initialize(): void;
    private setupBaseUI;
    private setupEventListeners;
    showMainInterface(user: User): void;
    showUserCreationDialog(): Promise<any>;
    displayNewMessage(message: any): void;
    displayIncomingTalk(_conversation: any): void;
    updateConversation(_conversationId: string, result: any): void;
    updateChatroomInfo(update: any): void;
    updateUserInfo(user: User): void;
    showNotification(message: string, type?: 'success' | 'error' | 'info' | 'warning'): void;
    showTalkCompletion(_conversationId: string, outcome: string): void;
    showLinearCaptureInterface(_conversationId: string, _capture: any): void;
    refreshTalksList(): void;
}
//# sourceMappingURL=ui-manager.d.ts.map