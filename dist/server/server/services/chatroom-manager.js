"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatroomManager = void 0;
class ChatroomManager {
    gunService;
    constructor(gunService) {
        this.gunService = gunService;
    }
    async getAllChatrooms() {
        return await this.gunService.getSet('chatrooms');
    }
    async joinChatroom(chatroomId, userId) {
        await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
            joinedAt: new Date(),
            isActive: true
        });
        const headcount = await this.gunService.get(`chatrooms/${chatroomId}/headcount`) || 0;
        await this.gunService.put(`chatrooms/${chatroomId}/headcount`, headcount + 1);
    }
    async leaveChatroom(chatroomId, userId) {
        await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
            leftAt: new Date(),
            isActive: false
        });
        const headcount = await this.gunService.get(`chatrooms/${chatroomId}/headcount`) || 0;
        await this.gunService.put(`chatrooms/${chatroomId}/headcount`, Math.max(0, headcount - 1));
    }
    async moveChatroom(userId, oldChatroomId, newChatroomId) {
        await this.leaveChatroom(oldChatroomId, userId);
        await this.joinChatroom(newChatroomId, userId);
    }
    async findOptimalChatroom(_location) {
        // Server-side optimal chatroom logic
        return 'global';
    }
}
exports.ChatroomManager = ChatroomManager;
//# sourceMappingURL=chatroom-manager.js.map