import { GPSCoordinate } from '../../shared/types';
import { GunService } from './gun-service';
export declare class ChatroomManager {
    private gunService;
    constructor(gunService: GunService);
    getAllChatrooms(): Promise<any[]>;
    joinChatroom(chatroomId: string, userId: string): Promise<void>;
    leaveChatroom(chatroomId: string, userId: string): Promise<void>;
    findOptimalChatroom(_location: GPSCoordinate): Promise<string>;
}
//# sourceMappingURL=chatroom-manager.d.ts.map