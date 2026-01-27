import Gun from 'gun';
import { UserProfileSchema, UserProfile } from './types';

// We'll use a simple structure for now:
// chatrooms/{roomId}/users/{userPub} = { ...userMetadata, timestamp }

export const joinChatroom = (gun: any, roomId: string, userPub: string, userData?: any) => {
    // We can store a heartbeat or just presence
    const roomNode = gun.get('chatrooms').get(roomId);

    // Sanitize userData to remove undefined values (Gun doesn't like them)
    const safeData: any = {
        status: 'active',
        lastSeen: Date.now()
    };
    if (userData) {
        Object.entries(userData).forEach(([k, v]) => {
            if (v !== undefined) safeData[k] = v;
        });
    }

    // announce presence
    roomNode.get('users').get(userPub).put(safeData);
};

export const leaveChatroom = (gun: any, roomId: string, userPub: string) => {
    gun.get('chatrooms').get(roomId).get('users').get(userPub).put(null);
};

export const subscribeToRoomUsers = (gun: any, roomId: string, callback: (users: Record<string, any>) => void) => {
    // This is a simple implementation. In a real large room, this would be heavy.
    // We assume small rooms for now or just "Global" for testing.

    const users: Record<string, any> = {};

    gun.get('chatrooms').get(roomId).get('users').map().on((data: any, pub: string) => {
        if (data === null) {
            delete users[pub];
        } else {
            // We might want to fetch the full profile if we only have presence data
            // For now, let's assume we just get the presence entry
            users[pub] = data;
        }
        callback({ ...users });
    });
};
