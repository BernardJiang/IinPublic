import React, { createContext, useContext, useEffect, useState } from 'react';
import Gun from 'gun';
import 'gun/sea';
import { useGun } from './GunContext';
import { saveUserProfile, subscribeToUserProfile } from '@iinpublic/shared';
import type { UserProfile } from '@iinpublic/shared';

interface UserContextType {
    userPub: string | null;
    userProfile: UserProfile | null;
    isAuthenticated: boolean;
    isProfileLoaded: boolean;
    updateProfile: (profile: UserProfile) => Promise<void>;
}

const UserContext = createContext<UserContextType | null>(null);

const STORAGE_KEY_PAIR = 'iinpublic_user_pair';

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const gun = useGun();
    const [userPub, setUserPub] = useState<string | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isProfileLoaded, setIsProfileLoaded] = useState(false);

    useEffect(() => {
        const initUser = async () => {
            const user = gun.user();

            // Check if already authenticated (e.g. HMR)
            if (user.is) {
                const pub = user.is.pub;
                setUserPub(pub);
                setIsAuthenticated(true);
                return;
            }

            // Try to load keys from storage
            let pair: any = null;
            const storedPair = localStorage.getItem(STORAGE_KEY_PAIR);

            if (storedPair) {
                try {
                    pair = JSON.parse(storedPair);
                } catch (e) {
                    console.error('Failed to parse stored keys', e);
                }
            }

            if (!pair) {
                console.log('Generating new user keys...');
                pair = await Gun.SEA.pair();
                localStorage.setItem(STORAGE_KEY_PAIR, JSON.stringify(pair));
            }

            // Authenticate
            user.auth(pair, (ack: any) => {
                if (ack.err) {
                    console.error('Authentication failed:', ack.err);
                } else {
                    console.log('Authenticated as:', pair.pub);
                    setUserPub(pair.pub);
                    setIsAuthenticated(true);
                }
            });
        };

        const timer = setTimeout(initUser, 100);
        return () => clearTimeout(timer);
    }, [gun]);

    // Subscribe to profile when authenticated
    useEffect(() => {
        if (!isAuthenticated || !userPub) {
            return;
        }

        console.log('Subscribing to profile for:', userPub);

        let hasloaded = false;

        subscribeToUserProfile(gun, userPub, (profile) => {
            if (profile) {
                setUserProfile(profile);
            }
            if (!hasloaded) {
                hasloaded = true;
                setIsProfileLoaded(true);
            }
        });

        // If no data comes in within a short time, we assume empty.
        // We use .once to check emptiness if .on doesn't fire immediately (it should fire with null if empty? depends on our helper)
        gun.user().get('profile').once((data: any) => {
            // If data is undefined/null and we haven't loaded yet, mark as loaded (empty)
            if ((data === undefined || data === null) && !hasloaded) {
                hasloaded = true;
                setIsProfileLoaded(true);
            }
        });

    }, [gun, isAuthenticated, userPub]);

    const updateProfile = async (profile: UserProfile) => {
        if (!isAuthenticated) throw new Error('Not authenticated');
        const user = gun.user();
        await saveUserProfile(user, profile);
        // Optimistic update
        setUserProfile(profile);
    };

    return (
        <UserContext.Provider value={{ userPub, userProfile, isAuthenticated, isProfileLoaded, updateProfile }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
};
