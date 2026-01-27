import Gun from 'gun';
// The default relay URL for local development
export const RELAY_URL = 'http://localhost:8765/gun';
/**
 * Creates a configured Gun instance.
 * @param peers List of relay peers to connect to.
 */
export const createGunInstance = (peers = [RELAY_URL]) => {
    return Gun({
        peers,
        localStorage: true, // Enable local storage for offline support
        radisk: true // Enable RAD storage
    });
};
