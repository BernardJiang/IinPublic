import { useState, useEffect } from 'react';
import { useGun } from '../contexts/GunContext';
import { useUser } from '../contexts/UserContext';
import { joinChatroom, leaveChatroom, subscribeToRoomUsers } from '@iinpublic/shared';

export const useChatroom = (roomId: string) => {
    const gun = useGun();
    const { userPub, userProfile, isProfileLoaded } = useUser();
    const [rawUsers, setRawUsers] = useState<Record<string, any>>({});
    const [users, setUsers] = useState<Record<string, any>>({});
    const [tick, setTick] = useState(0);

    // Heartbeat & Pruning constants
    // Heartbeat & Pruning constants
    const HEARTBEAT_INTERVAL = 5000;
    const PRUNE_INTERVAL = 2000;
    const USER_TIMEOUT = 60000; // Increased to 60s to handle clock skew

    // 1. Subscription & Cleanup (Session Lifecycle)
    // Only re-run if room or user changes, NOT if profile changes.
    useEffect(() => {
        if (!userPub || !roomId || !isProfileLoaded) return;

        console.log(`[useChatroom] Subscribing to room ${roomId}`);

        // Subscribe
        subscribeToRoomUsers(gun, roomId, (updatedUsers) => {
            setRawUsers(updatedUsers);
        });

        return () => {
            console.log(`[useChatroom] Leaving room ${roomId} (Cleanup)`);
            leaveChatroom(gun, roomId, userPub);
        };
    }, [gun, userPub, roomId, isProfileLoaded]);

    // 2. Heartbeat & Data (Data Lifecycle)
    // Re-run if profile changes to send updated data immediately.
    useEffect(() => {
        if (!userPub || !roomId || !isProfileLoaded) return;

        const join = () => {
            // console.log(`[useChatroom] Heartbeat...`);
            joinChatroom(gun, roomId, userPub, {
                displayName: userProfile?.displayName || 'Anon',
                avatarUrl: userProfile?.avatarUrl || ''
            });
        };

        // Immediate join with current data
        join();

        // Periodic heartbeat
        const timer = setInterval(join, HEARTBEAT_INTERVAL);

        return () => clearInterval(timer);
    }, [gun, userPub, roomId, isProfileLoaded, userProfile]);

    // Pruning effect
    useEffect(() => {
        const now = Date.now();
        const active: Record<string, any> = {};

        // Debugging counters
        let rawCount = 0;
        let activeCount = 0;

        Object.entries(rawUsers).forEach(([pub, data]) => {
            rawCount++;
            // Check if user has lastSeen and is within timeout
            const lastSeen = Number(data?.lastSeen);
            const isRecent = !isNaN(lastSeen) && (now - lastSeen < USER_TIMEOUT);

            if (data && isRecent) {
                active[pub] = data;
                activeCount++;
            }
        });

        // Debug log to help verify visibility
        if (rawCount !== activeCount) {
            console.log(`[useChatroom] Pruning: ${activeCount}/${rawCount} users active. (Timeout: ${USER_TIMEOUT}ms)`);
        }

        setUsers(active);
    }, [rawUsers, tick]);

    // Timer to force prune check
    useEffect(() => {
        const timer = setInterval(() => {
            setTick(t => t + 1);
        }, PRUNE_INTERVAL);
        return () => clearInterval(timer);
    }, []);

    return { users };
};
