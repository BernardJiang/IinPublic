import { UserProfile } from './types';
/**
 * Saves the user's profile to their public graph.
 * @param user The authenticated Gun user instance.
 * @param profile The profile data to save.
 */
export declare const saveUserProfile: (user: any, profile: UserProfile) => Promise<void>;
/**
 * Subscribes to a user's profile updates.
 * @param gun The Gun instance.
 * @param pubKey The public key of the user to watch.
 * @param callback Function called with the updated profile.
 */
export declare const subscribeToUserProfile: (gun: any, pubKey: string, callback: (profile: UserProfile | null) => void) => void;
