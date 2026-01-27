import React from 'react';
import { useUser } from './contexts/UserContext';
import { Welcome } from './pages/Welcome';
import { Home } from './pages/Home';

export const AppRouter = () => {
    const { isAuthenticated, userProfile, isProfileLoaded } = useUser();

    if (!isAuthenticated) {
        return <div className="loading-screen">Authenticating user...</div>;
    }

    if (!isProfileLoaded) {
        return <div className="loading-screen">Loading profile...</div>;
    }

    // If we have no profile (or specifically no displayName), show Welcome
    if (!userProfile?.displayName) {
        return <Welcome />;
    }

    return <Home />;
};
