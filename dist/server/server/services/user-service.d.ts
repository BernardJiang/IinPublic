import { User, GPSCoordinate } from '../../shared/types';
import { GunService } from './gun-service';
export declare class UserService {
    private gunService;
    constructor(gunService: GunService);
    createUser(userData: Partial<User>): Promise<User>;
    getUser(userId: string): Promise<User>;
    updateUserLocation(userId: string, location: GPSCoordinate): Promise<void>;
    setUserOffline(userId: string): Promise<void>;
}
//# sourceMappingURL=user-service.d.ts.map