import { User, GPSCoordinate } from '../../shared/types';
import { GunService } from './gun-service';

export class UserService {
  constructor(private gunService: GunService) {}

  async createUser(userData: Partial<User>): Promise<User> {
    // Server-side user creation logic
    const user: User = {
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

  async getUser(userId: string): Promise<User> {
    return await this.gunService.get(`users/${userId}`);
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    await this.gunService.put(`users/${userId}/location`, location);
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.gunService.put(`users/${userId}/status`, 'offline');
  }
}