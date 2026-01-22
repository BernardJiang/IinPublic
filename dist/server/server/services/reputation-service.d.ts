import { User } from '../../shared/types';
import { GunService } from './gun-service';
export declare class ReputationService {
    private gunService;
    constructor(gunService: GunService);
    updateUserReputation(userId: string, action: string, value?: number): Promise<void>;
    getUserReputationScore(userId: string): Promise<number>;
    getBulkSendCapacity(user: User): Promise<number>;
}
//# sourceMappingURL=reputation-service.d.ts.map