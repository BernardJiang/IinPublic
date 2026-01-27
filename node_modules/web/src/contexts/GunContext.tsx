import React, { createContext, useContext, useEffect, useState } from 'react';
import Gun from 'gun';
import 'gun/sea';
import 'gun/lib/radix';
import 'gun/lib/radisk';
import 'gun/lib/store';
import 'gun/lib/rindexed';
import { createGunInstance } from '@iinpublic/shared';

// Define the shape of our context
interface GunContextType {
    gun: ReturnType<typeof Gun>;
}

// Create the context
const GunContext = createContext<GunContextType | null>(null);

// Provider component
export const GunProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [gun, setGun] = useState<ReturnType<typeof Gun> | null>(null);

    useEffect(() => {
        // Initialize Gun instance
        const instance = createGunInstance();
        setGun(instance);

        return () => {
            // Cleanup if necessary (Gun handles its own cleanup mostly, but we can't really "destroy" it easily)
        };
    }, []);

    if (!gun) {
        return <div>Initializing Gun...</div>;
    }

    return (
        <GunContext.Provider value={{ gun }}>
            {children}
        </GunContext.Provider>
    );
};

// Hook to use the Gun instance
export const useGun = () => {
    const context = useContext(GunContext);
    if (!context) {
        throw new Error('useGun must be used within a GunProvider');
    }
    return context.gun;
};
