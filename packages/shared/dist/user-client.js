import { UserProfileSchema } from './types';
// We need to define some types effectively if not available from gun/types
// But assuming @types/gun gives us basic types.
/**
 * Saves the user's profile to their public graph.
 * @param user The authenticated Gun user instance.
 * @param profile The profile data to save.
 */
export const saveUserProfile = async (user, profile) => {
    // Validate schema before saving
    const parsed = UserProfileSchema.parse(profile);
    return new Promise((resolve, reject) => {
        // user.get('profile') is a node
        user.get('profile').put(parsed, (ack) => {
            if (ack.err)
                reject(new Error(ack.err));
            else
                resolve();
        });
    });
};
/**
 * Subscribes to a user's profile updates.
 * @param gun The Gun instance.
 * @param pubKey The public key of the user to watch.
 * @param callback Function called with the updated profile.
 */
export const subscribeToUserProfile = (gun, pubKey, callback) => {
    gun.user(pubKey).get('profile').on((data) => {
        if (!data) {
            callback(null);
            return;
        }
        // Data usually comes with meta properties from Gun (_), we should clean or Zod might strip them if we use strict.
        // Zod defaults to strip() for unknown keys so it's fine.
        try {
            const parsed = UserProfileSchema.parse(data);
            callback(parsed);
        }
        catch (e) {
            console.warn('Invalid profile data received', e);
            // Optionally callback null or partial?
            callback(null);
        }
    });
};
