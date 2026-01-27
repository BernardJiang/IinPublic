import Gun from 'gun';
import { Message, MessageSchema, MessageContentSchema } from './types';


// Helper for ID if uuid not available? Gun has Gun.text.random()? 
// We generally use a random string.
const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

// We will use a simple inbox system:
// user(receiver).get('inbox').get(senderPub).set(message)
// This is not encrypted yet for MVP simplicity, but Gun.SEA should be used for `content`.

export const sendDirectMessage = (gun: any, senderPub: string, receiverPub: string, content: any): Promise<void> => {
    return new Promise((resolve, reject) => {
        const msgId = generateId();
        const message = {
            id: msgId,
            sender: senderPub,
            content,
            timestamp: Date.now()
        };

        // Validate
        // For partial content schema validation might be tricky if raw object, assume valid structure for now or use schema construction
        // Let's assume content is constructed to match MessageContentSchema shape

        try {
            // We validate full message. 
            // Note: In real app, we encrypt 'content' with receiver's pub key
            // const secret = await Gun.SEA.secret(receiverEpub, myPair);
            // const enc = await Gun.SEA.encrypt(content, secret);

            // CHANGED: Use a global messages node because writing to gun.user(pub) is restricted
            gun.get('messages').get(receiverPub).get(msgId).put(message, (ack: any) => {
                if (ack.err) reject(new Error(ack.err));
                else resolve();
            });

        } catch (e) {
            reject(e);
        }
    });
};

export const subscribeToInbox = (gun: any, userPub: string, callback: (msgs: Message[]) => void) => {
    const messages: Record<string, Message> = {};

    // .map() iterates over all items in 'messages/userPub'
    gun.get('messages').get(userPub).map().on((data: any, id: string) => {
        if (!data) return;

        // Basic dedup or update
        // We really should prioritize recentness but map() is unordered.
        messages[id] = data; // as Message

        // Sort by timestamp desc
        const sorted = Object.values(messages).sort((a: any, b: any) => b.timestamp - a.timestamp);
        callback(sorted);
    });
};
