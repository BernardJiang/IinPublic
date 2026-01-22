import { GPSCoordinate } from '../../shared/types';
import { WebGunService } from './web-gun-service';
export declare class WebChatroomService {
    private gunService;
    private currentChatroomId?;
    constructor(gunService: WebGunService);
    findOptimalChatroom(location: GPSCoordinate): Promise<string>;
    joinChatroom(chatroomId: string, userId: string): Promise<void>;
    leaveChatroom(chatroomId: string, userId: string): Promise<void>;
    switchChatroom(userId: string, newChatroomId: string): Promise<void>;
    getCurrentChatroomId(): string | undefined;
}
//# sourceMappingURL=web-chatroom-service.d.ts.map