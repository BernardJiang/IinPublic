import { useEffect, useState } from 'react';
import { useGun } from '../contexts/GunContext';
import { useUser } from '../contexts/UserContext';
import { subscribeToInbox } from '@iinpublic/shared';
import type { Message } from '@iinpublic/shared';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle, User } from 'lucide-react';

export const MatchesPage = () => {
    const gun = useGun();
    const { userPub } = useUser();
    const [matches, setMatches] = useState<Message[]>([]);

    useEffect(() => {
        if (!userPub) return;
        subscribeToInbox(gun, userPub, (msgs) => {
            const foundMatches = msgs.filter(m => m.content.type === 'talk_result' && m.content.result === 'match');
            setMatches(foundMatches);
        });
    }, [gun, userPub]);

    return (
        <div className="container">
            <header className="header-row">
                <div className="header-left">
                    <Link to="/" className="btn btn-ghost btn-icon"><ArrowLeft size={24} /></Link>
                    <h1>Matches</h1>
                </div>
            </header>

            <div className="list-grid">
                {matches.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                        <p>No matches yet. Keep sending talks!</p>
                    </div>
                ) : (
                    matches.map(msg => (
                        <div key={msg.id} className="card" style={{
                            background: 'rgba(16,185,129,0.05)',
                            borderColor: 'rgba(16,185,129,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem'
                        }}>
                            <div style={{ background: 'rgba(16,185,129,0.1)', padding: '0.8rem', borderRadius: '50%', color: 'var(--accent)' }}>
                                <CheckCircle size={24} />
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                    <strong>IT'S A MATCH!</strong>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        {new Date(msg.timestamp).toLocaleDateString()}
                                    </span>
                                </div>

                                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                                    You matched on <strong style={{ color: 'var(--text-main)' }}>{msg.content.talkTitle}</strong>
                                </p>

                                <div style={{ display: 'flex', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.9rem', color: '#888' }}>
                                    <User size={14} style={{ marginRight: 4 }} />
                                    {msg.sender.substring(0, 8)}...
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
