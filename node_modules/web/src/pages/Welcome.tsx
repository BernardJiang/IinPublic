import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';

export const Welcome = () => {
    const { updateProfile, userPub } = useUser();
    const [stageName, setStageName] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Basic validation
        if (!stageName.trim()) {
            setError('Stage Name is required');
            return;
        }

        setIsSubmitting(true);
        try {
            // Create initial profile
            await updateProfile({
                displayName: stageName,
                languages: ['en'], // Default
            });
            // The UserContext will update and triggering parent check to redirect/show content
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to create profile');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="welcome-container" style={{ padding: '2rem', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
            <h1>Welcome to IinPublic</h1>
            <p>You have been assigned the ID:</p>
            <code style={{ display: 'block', margin: '1rem 0', wordBreak: 'break-all', fontSize: '0.8rem' }}>
                {userPub}
            </code>
            <p>Please choose a Stage Name to continue.</p>

            <form onSubmit={handleSubmit} style={{ marginTop: '2rem' }}>
                <div style={{ marginBottom: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Stage Name"
                        value={stageName}
                        onChange={(e) => setStageName(e.target.value)}
                        style={{ padding: '0.5rem', width: '100%', fontSize: '1rem' }}
                        disabled={isSubmitting}
                    />
                </div>
                {error && <p style={{ color: 'red' }}>{error}</p>}
                <button type="submit" disabled={isSubmitting} style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}>
                    {isSubmitting ? 'Creating...' : 'Start Chating'}
                </button>
            </form>
        </div>
    );
};
