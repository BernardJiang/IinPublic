import { Talk, BulkSendJob, TargetScope, Survey, Message } from '../../shared/types';
import { GunService } from './gun-service';
import { ReputationService } from './reputation-service';
export declare class TalkService {
    private gunService;
    private reputationService;
    constructor(gunService: GunService, reputationService: ReputationService);
    createTalk(talkData: Partial<Talk>): Promise<Talk>;
    sendBulkTalk(talkId: string, senderId: string, targetScope: TargetScope, maxRecipients: number): Promise<BulkSendJob>;
    getSurveyResults(surveyId: string): Promise<Survey>;
    processMessage(conversationId: string, senderId: string, messageText: string): Promise<Message>;
    processAnswer(conversationId: string, questionId: string, answerId: string, userId: string): Promise<any>;
}
//# sourceMappingURL=talk-service.d.ts.map