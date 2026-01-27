import React from 'react';
import { useUser } from '../contexts/UserContext';
import { MessageSquare, Users, MapPin } from 'lucide-react';

export const Home = () => {
    const { userProfile, userPub } = useUser();

    return (
        <div style={{ padding: '2rem' }}>
            <header style={{ marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                <h1>Hello, {userProfile?.displayName}</h1>
                <small style={{ color: '#666' }}>ID: {userPub?.substring(0, 8)}...</small>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div style={cardStyle}>
                    <Users size={32} />
                    <h3>Nearby Users</h3>
                    <p>0 online</p>
                </div>
                <div style={cardStyle}>
                    <MessageSquare size={32} />
                    <h3>My Talks</h3>
                    <p>0 active</p>
                </div>
                <div style={cardStyle}>
                    <MapPin size={32} />
                    <h3>Location</h3>
                    <p>Unknown</p>
                </div>
            </div>
        </div>
    );
};

const cardStyle = {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1.5rem',
    textAlign: 'center' as const,
    cursor: 'pointer',
};
