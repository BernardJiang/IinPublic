import { User, GPSCoordinate } from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';

export class WebUserService {
  constructor(private gunService: WebGunService) {}

  async createUser(userData: Partial<User>): Promise<User> {
    const userId = uuidv4();
    const now = new Date();
    
    const userBase = {
      id: userId,
      stageName: userData.stageName || '',
      profile: userData.profile || [],
      reputation: {
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
      createdAt: now,
      lastActive: now
    };
    
    const user: User = userData.headshot ? 
      { ...userBase, headshot: userData.headshot } : 
      userBase;

    await this.gunService.put(`users/${userId}`, user);
    return user;
  }

  async getUser(userId: string): Promise<User> {
    return await this.gunService.get(`users/${userId}`);
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    const blurredLocation = LocationPrivacy.blurLocation(location);
    await this.gunService.put(`users/${userId}/location`, blurredLocation);
  }

  async setUserStatus(userId: string, status: 'online' | 'away' | 'offline'): Promise<void> {
    await this.gunService.put(`users/${userId}/status`, {
      status,
      timestamp: new Date() // Gun service will serialize this properly
    });
  }
}