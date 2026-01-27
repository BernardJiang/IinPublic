import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGun } from '../contexts/GunContext';
import { useUser } from '../contexts/UserContext';
import { subscribeToUserTalks } from '@iinpublic/shared';
import { ArrowLeft, Plus, Edit2 } from 'lucide-react';

export const MyTalksPage = () => {
    const gun = useGun();
    const { userPub } = useUser();
    const [talks, setTalks] = useState<any[]>([]);

    useEffect(() => {
        if (!userPub) return;
        subscribeToUserTalks(gun, userPub, (data) => {
            setTalks(data);
        });
    }, [gun, userPub]);

    return (
        <div className="container">
            <header className="header-row">
                <div className="header-left">
                    <Link to="/" className="btn btn-ghost btn-icon"><ArrowLeft size={24} /></Link>
                    <h1>My Talks</h1>
                </div>
                <Link to="/talks/new" className="btn btn-primary">
                    <Plus size={18} /> Create
                </Link>
            </header>

            <div className="list-grid">
                {talks.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                        <p>You haven't created any talks yet.</p>
                    </div>
                ) : (
                    talks.map(talk => (
                        <div key={talk.id} className="card" style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <h3 style={{ margin: '0 0 0.3rem 0' }}>{talk.title || 'Untitled'}</h3>
                                <code style={{ color: 'var(--text-muted)', fontSize: '0.8rem', background: '#222', padding: '2px 6px', borderRadius: 4 }}>ID: {talk.id}</code>
                            </div>
                            <Link to={`/talks/${talk.id}/edit`} className="btn btn-ghost" style={{ color: 'var(--primary)' }}>
                                <Edit2 size={18} /> Edit
                            </Link>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
