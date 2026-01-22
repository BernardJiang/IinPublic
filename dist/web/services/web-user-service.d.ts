import { User, GPSCoordinate } from '../../shared/types';
import { WebGunService } from './web-gun-service';
export declare class WebUserService {
    private gunService;
    constructor(gunService: WebGunService);
    createUser(userData: Partial<User>): Promise<User>;
    getUser(userId: string): Promise<User>;
    updateUserLocation(userId: string, location: GPSCoordinate): Promise<void>;
    setUserStatus(userId: string, status: 'online' | 'away' | 'offline'): Promise<void>;
}
//# sourceMappingURL=web-user-service.d.ts.map