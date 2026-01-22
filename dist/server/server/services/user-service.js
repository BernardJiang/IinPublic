"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
class UserService {
    gunService;
    constructor(gunService) {
        this.gunService = gunService;
    }
    async createUser(userData) {
        // Server-side user creation logic
        const user = {
            id: userData.id || '',
            stageName: userData.stageName || '',
            ...(userData.headshot && { headshot: userData.headshot }),
            profile: userData.profile || [],
            reputation: userData.reputation || {
                questionsAnswered: 0,
                talksSent: 0,
                matchesFound: 0,
                friendsCount: 0,
                mutualFriendsCount: 0,
                starRating: 3.0,
                reviewCount: 0,
                ageVerified: false,
                ageVerificationVotes: 0,
                blockCount: 0,
                isHidden: false
            },
            location: userData.location || { region: '', chatrooms: [] },
            languages: userData.languages || ['en'],
            interests: userData.interests || [],
            createdAt: new Date(),
            lastActive: new Date()
        };
        await this.gunService.put(`users/${user.id}`, user);
        return user;
    }
    async getUser(userId) {
        return await this.gunService.get(`users/${userId}`);
    }
    async updateUserLocation(userId, location) {
        await this.gunService.put(`users/${userId}/location`, location);
    }
    async setUserOffline(userId) {
        await this.gunService.put(`users/${userId}/status`, 'offline');
    }
}
exports.UserService = UserService;
//# sourceMappingURL=user-service.js.map