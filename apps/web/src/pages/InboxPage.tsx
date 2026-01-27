import { useEffect, useState } from 'react';
import { useGun } from '../contexts/GunContext';
import { useUser } from '../contexts/UserContext';
import { subscribeToInbox, getTalk, sendDirectMessage } from '@iinpublic/shared';
import type { Message, Talk } from '@iinpublic/shared';
import { TalkRunner } from '../components/TalkRunner';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, ChevronRight } from 'lucide-react';

export const InboxPage = () => {
    const gun = useGun();
    const { userPub } = useUser();
    const [messages, setMessages] = useState<Message[]>([]);

    const [activeTalk, setActiveTalk] = useState<Talk | null>(null);
    const [activeMessage, setActiveMessage] = useState<Message | null>(null);

    useEffect(() => {
        if (!userPub) return;
        subscribeToInbox(gun, userPub, (msgs) => {
            setMessages(msgs);
        });
    }, [gun, userPub]);

    const handleOpenMessage = (msg: Message) => {
        if (msg.content.type === 'talk_invite' && msg.content.talkId) {
            getTalk(gun, msg.content.talkId, (talk) => {
                if (talk) {
                    setActiveTalk(talk);
                    setActiveMessage(msg);
                } else {
                    alert('Talk not found');
                }
            });
        }
    };

    const handleTalkComplete = async (result: { status: 'match' | 'ignore', answers: Record<string, string> }) => {
        if (!activeMessage || !userPub) return;

        const reply = {
            type: 'talk_result',
            talkId: activeMessage.content.talkId,
            talkTitle: activeTalk?.title,
            result: result.status,
            answers: result.answers
        };

        try {
            await sendDirectMessage(gun, userPub, activeMessage.sender, reply);
            alert(`You ${result.status === 'match' ? 'matched with' : 'passed on'} this talk. Result sent.`);
        } catch (e) {
            console.error(e);
            alert('Failed to send result');
        }

        setActiveTalk(null);
        setActiveMessage(null);
    };

    if (activeTalk) {
        return <TalkRunner talk={activeTalk} onComplete={handleTalkComplete} onCancel={() => setActiveTalk(null)} />;
    }

    return (
        <div className="container">
            <header className="header-row">
                <div className="header-left">
                    <Link to="/" className="btn btn-ghost btn-icon"><ArrowLeft size={24} /></Link>
                    <h1>Inbox</h1>
                </div>
            </header>

            <div className="list-grid">
                {messages.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                        <Mail size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                        <p>No messages yet.</p>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} onClick={() => handleOpenMessage(msg)} className="card" style={{
                            cursor: 'pointer',
                            background: msg.content.type === 'talk_invite' ? 'rgba(37,99,235,0.05)' : undefined,
                            borderColor: msg.content.type === 'talk_invite' ? 'rgba(37,99,235,0.2)' : undefined,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem'
                        }}>
                            <div style={{ background: '#222', padding: '0.8rem', borderRadius: '50%' }}>
                                <Mail size={20} color={msg.content.type === 'talk_invite' ? 'var(--primary)' : 'var(--text-muted)'} />
                            </div>

                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                    <strong>
                                        {msg.content.type === 'talk_invite' ? 'Talk Invitation' :
                                            msg.content.type === 'talk_result' ? 'Talk Result' : 'Message'}
                                    </strong>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>

                                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                    {msg.content.type === 'talk_invite' && (
                                        <span>Invited to: <strong style={{ color: 'var(--text-main)' }}>{msg.content.talkTitle || 'Unknown Talk'}</strong></span>
                                    )}
                                    {msg.content.type === 'talk_result' && (
                                        <span>Result for <strong>{msg.content.talkTitle}</strong>: <span style={{ color: msg.content.result === 'match' ? 'var(--accent)' : 'red' }}>{msg.content.result?.toUpperCase()}</span></span>
                                    )}
                                    {msg.content.text && <span>{msg.content.text}</span>}
                                </div>
                            </div>

                            <ChevronRight size={16} color="#444" />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
