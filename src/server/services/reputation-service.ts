import { User } from '../../shared/types';
import { ReputationManager } from '../../shared/reputation';
import { GunService } from './gun-service';

export class ReputationService {
  constructor(private gunService: GunService) {}

  async updateUserReputation(userId: string, action: string, value: number = 1): Promise<void> {
    const user = await this.gunService.get(`users/${userId}`);
    const updatedReputation = ReputationManager.updateReputation(
      user.reputation,
      action as any,
      value
    );
    await this.gunService.put(`users/${userId}/reputation`, updatedReputation);
  }

  async getUserReputationScore(userId: string): Promise<number> {
    const user = await this.gunService.get(`users/${userId}`);
    return ReputationManager.calculateReputationScore(user.reputation);
  }

  async getBulkSendCapacity(user: User): Promise<number> {
    return ReputationManager.getBulkSendCapacity(user);
  }
}