import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useUser } from './contexts/UserContext';
import { Welcome } from './pages/Welcome';
import { Home } from './pages/Home';
import { ChatroomPage } from './pages/ChatroomPage';
import { MyTalksPage } from './pages/MyTalksPage';
import { TalkEditor } from './pages/TalkEditor';
import { InboxPage } from './pages/InboxPage';
import { MatchesPage } from './pages/MatchesPage';

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

    // Since we are using React Router, we need to wrap our routes.
    // However, usually the Router is at the root in main.tsx or App.tsx.
    // Let's assume App.tsx wraps this component in BrowserRouter?
    // Checking App.tsx, it wraps Providers around AppRouter.
    // So AppRouter needs to provide the Router or be inside one.
    // Let's make AppRouter provide the Router for now or check if we added it.
    // We didn't add BrowserRouter in App.tsx yet.

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/welcome" element={<Navigate to="/" replace />} />
                <Route path="/chatrooms/:roomId" element={<ChatroomPage />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/matches" element={<MatchesPage />} />
                <Route path="/talks" element={<MyTalksPage />} />
                <Route path="/talks/new" element={<TalkEditor />} />
                <Route path="/talks/:talkId/edit" element={<TalkEditor />} />
            </Routes>
        </BrowserRouter>
    );
};
