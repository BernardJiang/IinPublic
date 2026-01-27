import Gun from 'gun';
import { Talk, TalkSchema } from './types';
import { serializeForGun, deserializeFromGun } from './gun-utils';

// Helpers
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

export const createTalk = async (gun: any, talk: Omit<Talk, 'id' | 'createdAt' | 'authorPubKey'>, userPub: string): Promise<string> => {
    const talkId = generateId();
    const newTalk: Talk = {
        ...talk,
        id: talkId,
        authorPubKey: userPub,
        createdAt: Date.now(),
    };

    // Validate
    const parsed = TalkSchema.parse(newTalk);

    // Serialize for Gun (handles arrays like nodes[id].options, tags)
    const gunData = serializeForGun(parsed);

    return new Promise((resolve, reject) => {
        // 1. Save talk to global talks graph (addressable by ID)
        // In Gun, we often treat data as immutable or append-only, but here we allow edits for now.
        gun.get('talks').get(talkId).put(gunData, (ack: any) => {
            if (ack.err) {
                reject(new Error(ack.err));
                return;
            }

            // 2. Link talk to user's talk list
            gun.user(userPub).get('my_talks').get(talkId).put({
                id: talkId,
                title: parsed.title,
                timestamp: parsed.createdAt
            }, (ack2: any) => {
                if (ack2.err) reject(new Error(ack2.err));
                else resolve(talkId);
            });
        });
    });
};

export const subscribeToUserTalks = (gun: any, userPub: string, callback: (talks: any[]) => void) => {
    const talks: Record<string, any> = {};

    gun.user(userPub).get('my_talks').map().on((data: any, id: string) => {
        if (!data) { // deleted
            delete talks[id];
        } else {
            talks[id] = data;
        }
        callback(Object.values(talks));
    });
};

export const getTalk = (gun: any, talkId: string, callback: (talk: Talk | null) => void) => {
    gun.get('talks').get(talkId).on((data: any) => {
        if (!data) {
            callback(null);
            return;
        }
        try {
            // Restore arrays
            const deserialized = deserializeFromGun(data);
            const parsed = TalkSchema.parse(deserialized);
            callback(parsed);
        } catch (e) {
            console.error('Error parsing talk', e);
            callback(null);
        }
    });
};
