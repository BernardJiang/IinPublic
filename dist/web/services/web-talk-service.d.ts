import { Talk, BulkSendJob, TargetScope } from '../../shared/types';
import { WebGunService } from './web-gun-service';
export declare class WebTalkService {
    private gunService;
    constructor(gunService: WebGunService);
    createTalk(talkData: Partial<Talk>): Promise<Talk>;
    sendBulkTalk(talkId: string, senderId: string, targetScope: TargetScope, maxRecipients: number): Promise<BulkSendJob>;
    processAnswer(conversationId: string, questionId: string, answerId: string, userId: string): Promise<any>;
    sendMessage(conversationId: string, senderId: string, message: string): Promise<void>;
    checkForLinearCapture(message: string): any | null;
}
//# sourceMappingURL=web-talk-service.d.ts.map