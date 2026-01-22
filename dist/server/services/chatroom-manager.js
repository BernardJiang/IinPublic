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
    }
    async leaveChatroom(chatroomId, userId) {
        await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
            leftAt: new Date(),
            isActive: false
        });
    }
    async findOptimalChatroom(_location) {
        // Server-side optimal chatroom logic
        return 'global';
    }
}
exports.ChatroomManager = ChatroomManager;
//# sourceMappingURL=chatroom-manager.js.map