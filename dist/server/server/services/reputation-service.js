"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReputationService = void 0;
const reputation_1 = require("../../shared/reputation");
class ReputationService {
    gunService;
    constructor(gunService) {
        this.gunService = gunService;
    }
    async updateUserReputation(userId, action, value = 1) {
        const user = await this.gunService.get(`users/${userId}`);
        const updatedReputation = reputation_1.ReputationManager.updateReputation(user.reputation, action, value);
        await this.gunService.put(`users/${userId}/reputation`, updatedReputation);
    }
    async getUserReputationScore(userId) {
        const user = await this.gunService.get(`users/${userId}`);
        return reputation_1.ReputationManager.calculateReputationScore(user.reputation);
    }
    async getBulkSendCapacity(user) {
        return reputation_1.ReputationManager.getBulkSendCapacity(user);
    }
}
exports.ReputationService = ReputationService;
//# sourceMappingURL=reputation-service.js.map