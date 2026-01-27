import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useChatroom } from '../hooks/useChatroom';
import { useUser } from '../contexts/UserContext';
import { useGun } from '../contexts/GunContext';
import { subscribeToUserTalks, sendDirectMessage } from '@iinpublic/shared';
import { User, ArrowLeft, Send } from 'lucide-react';

export const ChatroomPage = () => {
    const gun = useGun();
    const { userPub } = useUser();
    const { roomId = 'global' } = useParams();
    const { users } = useChatroom(roomId);

    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [myTalks, setMyTalks] = useState<any[]>([]);

    const handleUserClick = (targetPub: string) => {
        if (targetPub === userPub) return;
        setSelectedUser(targetPub);

        if (userPub) {
            subscribeToUserTalks(gun, userPub, (talks) => {
                setMyTalks(talks);
            });
        }
    };

    const handleSendTalk = async (talk: any) => {
        if (!userPub || !selectedUser) return;

        try {
            await sendDirectMessage(gun, userPub, selectedUser, {
                type: 'talk_invite',
                talkId: talk.id,
                talkTitle: talk.title
            });
            alert('Talk sent!');
            setSelectedUser(null);
        } catch (e) {
            console.error(e);
            alert('Failed to send talk');
        }
    };

    const userList = Object.entries(users);

    return (
        <div className="container">
            <header className="header-row">
                <div className="header-left">
                    <Link to="/" className="btn btn-ghost btn-icon"><ArrowLeft size={24} /></Link>
                    <h1>{roomId}</h1>
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                    {userList.length} Online
                </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
                {userList.length === 0 ? (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                        <p>No one else is here...</p>
                    </div>
                ) : (
                    userList.map(([pub, data]) => (
                        <div
                            key={pub}
                            onClick={() => handleUserClick(pub)}
                            className="card"
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                cursor: pub === userPub ? 'default' : 'pointer',
                                borderColor: pub === selectedUser ? 'var(--primary)' : undefined,
                                background: pub === selectedUser ? 'rgba(37,99,235,0.1)' : undefined
                            }}
                        >
                            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.5rem', border: '1px solid #333' }}>
                                <User size={24} color="#888" />
                            </div>
                            <strong style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '0.2rem' }}>
                                {data.displayName || 'Anon'}
                            </strong>
                            <span style={{ fontSize: '0.7rem', color: 'var(--accent)' }}>● Active</span>
                            {pub === userPub && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>(You)</span>}
                        </div>
                    ))
                )}
            </div>

            {selectedUser && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)', zIndex: 100 }}>
                    <div className="card" style={{ width: '100%', maxWidth: '400px', margin: '1rem' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Send a Talk</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                            Select a talk to send to this user. They will be invited to answer naturally.
                        </p>

                        <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'grid', gap: '0.5rem', marginBottom: '1.5rem' }}>
                            {myTalks.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)' }}>You have no talks. <Link to="/talks/new" style={{ color: 'var(--primary)' }}>Create one</Link>.</p>
                            ) : (
                                myTalks.map(talk => (
                                    <div
                                        key={talk.id}
                                        onClick={() => handleSendTalk(talk)}
                                        style={{
                                            padding: '1rem',
                                            background: '#222',
                                            borderRadius: 'var(--radius-sm)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            transition: 'background 0.2s',
                                            border: '1px solid transparent'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                                        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <Send size={16} style={{ marginRight: '0.8rem', color: 'var(--primary)' }} />
                                        {talk.title}
                                    </div>
                                ))
                            )}
                        </div>

                        <button onClick={() => setSelectedUser(null)} className="btn btn-ghost" style={{ width: '100%' }}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
};
