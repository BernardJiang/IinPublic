import { useUser } from '../contexts/UserContext';
import { Link } from 'react-router-dom';
import { MessageSquare, Users, MapPin, CheckCircle, ArrowRight } from 'lucide-react';

export const Home = () => {
    const { userProfile } = useUser();

    return (
        <div className="container">
            <header className="header-row">
                <div className="header-left">
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #2563eb, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                        {userProfile?.displayName?.[0]?.toUpperCase()}
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>Hello, {userProfile?.displayName}</h2>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Ready to connect?</div>
                    </div>
                </div>
            </header>

            <div className="dashboard-grid">
                <Link to="/chatrooms/global">
                    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ background: 'rgba(37,99,235,0.1)', padding: '0.8rem', borderRadius: '50%', marginBottom: '1rem', color: 'var(--primary)' }}>
                            <Users size={24} />
                        </div>
                        <h3>Nearby</h3>
                        <p style={{ color: 'var(--text-muted)', flex: 1 }}>
                            Join the global chatroom to find people around you.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: '1rem', color: 'var(--primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                            Join Room <ArrowRight size={16} style={{ marginLeft: 4 }} />
                        </div>
                    </div>
                </Link>

                <Link to="/inbox">
                    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ background: 'rgba(236,72,153,0.1)', padding: '0.8rem', borderRadius: '50%', marginBottom: '1rem', color: '#ec4899' }}>
                            <MessageSquare size={24} />
                        </div>
                        <h3>Inbox</h3>
                        <p style={{ color: 'var(--text-muted)', flex: 1 }}>
                            Check your messages and talk invitations.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: '1rem', color: '#ec4899', fontWeight: 600, fontSize: '0.9rem' }}>
                            View Inbox <ArrowRight size={16} style={{ marginLeft: 4 }} />
                        </div>
                    </div>
                </Link>

                <Link to="/talks">
                    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ background: 'rgba(16,185,129,0.1)', padding: '0.8rem', borderRadius: '50%', marginBottom: '1rem', color: 'var(--accent)' }}>
                            <MapPin size={24} />
                        </div>
                        <h3>My Talks</h3>
                        <p style={{ color: 'var(--text-muted)', flex: 1 }}>
                            Create and manage your interaction flows.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: '1rem', color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
                            Manage <ArrowRight size={16} style={{ marginLeft: 4 }} />
                        </div>
                    </div>
                </Link>

                <Link to="/matches">
                    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.8rem', borderRadius: '50%', marginBottom: '1rem', color: 'white' }}>
                            <CheckCircle size={24} />
                        </div>
                        <h3>Matches</h3>
                        <p style={{ color: 'var(--text-muted)', flex: 1 }}>
                            Review your successful connections.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: '1rem', color: 'white', fontWeight: 600, fontSize: '0.9rem' }}>
                            View Matches <ArrowRight size={16} style={{ marginLeft: 4 }} />
                        </div>
                    </div>
                </Link>
            </div>
        </div>
    );
};
