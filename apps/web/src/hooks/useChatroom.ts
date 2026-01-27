import { useState, useEffect } from 'react';
import { useGun } from '../contexts/GunContext';
import { useUser } from '../contexts/UserContext';
import { joinChatroom, leaveChatroom, subscribeToRoomUsers } from '@iinpublic/shared';

export const useChatroom = (roomId: string) => {
    const gun = useGun();
    const { userPub, userProfile, isProfileLoaded } = useUser();
    const [users, setUsers] = useState<Record<string, any>>({});

    useEffect(() => {
        if (!userPub || !roomId || !isProfileLoaded) return;

        // Join the room
        console.log(`[useChatroom] Joining room ${roomId} as ${userPub}`);

        // Ensure we pass valid strings or nulls, though client now sanitizes.
        joinChatroom(gun, roomId, userPub, {
            displayName: userProfile?.displayName || 'Anon',
            avatarUrl: userProfile?.avatarUrl || ''
        });

        // Subscribe to users
        subscribeToRoomUsers(gun, roomId, (updatedUsers) => {
            console.log(`[useChatroom] Updated users:`, Object.keys(updatedUsers));
            setUsers(updatedUsers);
        });

        return () => {
            console.log(`[useChatroom] Unmounting/Leaving (DISABLED for debugging)`);
            // leaveChatroom(gun, roomId, userPub);
        };
    }, [gun, userPub, roomId, userProfile, isProfileLoaded]);

    return { users };
};
