"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TalkService = void 0;
const talk_engine_1 = require("../../shared/talk-engine");
const uuid_1 = require("uuid");
class TalkService {
    gunService;
    reputationService;
    constructor(gunService, reputationService) {
        this.gunService = gunService;
        this.reputationService = reputationService;
    }
    async createTalk(talkData) {
        const talk = {
            id: talkData.id || (0, uuid_1.v4)(),
            title: talkData.title || '',
            authorId: talkData.authorId || '',
            type: talkData.type || 'matching',
            isAdult: talkData.isAdult || false,
            language: talkData.language || 'en',
            tags: talkData.tags || [],
            questions: talkData.questions || [],
            createdAt: new Date(),
            isTemplate: talkData.isTemplate || false,
            usageCount: 0
        };
        // Validate talk structure
        talk_engine_1.TalkValidator.validateTalk(talk);
        await this.gunService.put(`talks/${talk.id}`, talk);
        return talk;
    }
    async sendBulkTalk(talkId, senderId, targetScope, maxRecipients) {
        const job = {
            id: (0, uuid_1.v4)(),
            talkId,
            senderId,
            targetScope,
            maxRecipients,
            sentCount: 0,
            inProgressCount: 0,
            matchedCount: 0,
            ignoredCount: 0,
            expiredCount: 0,
            status: 'pending',
            createdAt: new Date()
        };
        await this.gunService.put(`bulkJobs/${job.id}`, job);
        // Update reputation
        await this.reputationService.updateUserReputation(senderId, 'talk_sent');
        return job;
    }
    async getSurveyResults(surveyId) {
        return await this.gunService.get(`surveys/${surveyId}`);
    }
    async processMessage(conversationId, senderId, messageText) {
        const message = {
            id: (0, uuid_1.v4)(),
            senderId,
            text: messageText,
            isFromChatbot: false,
            timestamp: new Date(),
            readBy: []
        };
        await this.gunService.put(`conversations/${conversationId}/messages/${message.id}`, message);
        return message;
    }
    async processAnswer(conversationId, questionId, answerId, userId) {
        const result = {
            conversationId,
            questionId,
            answerId,
            userId,
            isComplete: false,
            outcome: 'continue'
        };
        await this.gunService.put(`conversations/${conversationId}/answers/${questionId}`, {
            answerId,
            userId,
            timestamp: new Date()
        });
        // Update reputation
        await this.reputationService.updateUserReputation(userId, 'question_answered');
        return result;
    }
}
exports.TalkService = TalkService;
//# sourceMappingURL=talk-service.js.map