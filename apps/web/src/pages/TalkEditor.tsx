import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useGun } from '../contexts/GunContext';
import { useUser } from '../contexts/UserContext';
import { createTalk } from '@iinpublic/shared';
import { ArrowLeft, Plus, Trash, Save } from 'lucide-react';

export const TalkEditor = () => {
    const gun = useGun();
    const { userPub } = useUser();
    const navigate = useNavigate();

    // Linear flow MVP
    const [title, setTitle] = useState('');
    const [questions, setQuestions] = useState<any[]>([
        { id: 'root', text: '', type: 'binary', options: [] }
    ]);
    const [isSaving, setIsSaving] = useState(false);

    const addQuestion = () => {
        const id = Math.random().toString(36).substring(7);
        setQuestions([...questions, { id, text: '', type: 'binary', options: [] }]);
    };

    const removeQuestion = (index: number) => {
        if (questions.length <= 1) return;
        const newQs = [...questions];
        newQs.splice(index, 1);
        setQuestions(newQs);
    };

    const updateQuestion = (index: number, field: string, value: any) => {
        const newQs = [...questions];
        newQs[index] = { ...newQs[index], [field]: value };
        setQuestions(newQs);
    };

    const handleSave = async () => {
        if (!title.trim()) return alert('Please enter a title');
        if (!userPub) return;

        setIsSaving(true);

        try {
            const nodes: Record<string, any> = {};

            questions.forEach((q, idx) => {
                const nextQ = questions[idx + 1];
                let options = q.options;

                // Auto-generate options
                if (q.type === 'binary' && options.length === 0) {
                    options = [
                        { id: 'yes', text: 'Yes', nextQuestionId: nextQ ? nextQ.id : null, action: nextQ ? 'next' : 'match' },
                        { id: 'no', text: 'No', nextQuestionId: null, action: 'ignore' }
                    ];
                } else if (q.type === 'text' && options.length === 0) {
                    options = [
                        { id: 'next', text: 'Next', nextQuestionId: nextQ ? nextQ.id : null, action: nextQ ? 'next' : 'match' }
                    ];
                }

                nodes[q.id] = {
                    id: q.id,
                    text: q.text,
                    type: q.type,
                    options
                };
            });

            const talkData: any = {
                title,
                rootQuestionId: questions[0].id,
                nodes,
                isSurvey: false,
                tags: []
            };

            await createTalk(gun, talkData, userPub);
            navigate('/talks');

        } catch (e: any) {
            console.error(e);
            alert('Failed to save talk: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="container" style={{ paddingBottom: '6rem' }}>
            <header className="header-row">
                <div className="header-left">
                    <Link to="/talks" className="btn btn-ghost btn-icon"><ArrowLeft size={24} /></Link>
                    <h1>New Talk</h1>
                </div>
            </header>

            <div className="card" style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-muted)' }}>Talk Title</label>
                <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Tennis Partner Search"
                    style={{ fontSize: '1.2rem', padding: '1rem' }}
                />
            </div>

            <div className="list-grid">
                {questions.map((q, idx) => (
                    <div key={q.id} className="card" style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <h4 style={{ margin: 0, color: 'var(--primary)' }}>Question {idx + 1}</h4>
                            {questions.length > 1 && (
                                <button onClick={() => removeQuestion(idx)} className="btn btn-ghost btn-icon" style={{ color: '#ef4444' }}>
                                    <Trash size={18} />
                                </button>
                            )}
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <input
                                className="input"
                                type="text"
                                value={q.text}
                                onChange={e => updateQuestion(idx, 'text', e.target.value)}
                                placeholder="What is your question?"
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <label style={{ color: 'var(--text-muted)' }}>Type:</label>
                            <select
                                className="input"
                                style={{ width: 'auto' }}
                                value={q.type}
                                onChange={e => updateQuestion(idx, 'type', e.target.value)}
                            >
                                <option value="binary">Yes/No</option>
                                <option value="text">Free Text</option>
                            </select>
                        </div>
                    </div>
                ))}
            </div>

            <button onClick={addQuestion} className="btn btn-ghost" style={{ width: '100%', marginTop: '1rem', border: '1px dashed var(--border)', padding: '1.5rem' }}>
                <Plus size={20} /> Add Another Question
            </button>

            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '1.5rem', background: 'rgba(5,5,5,0.9)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(5px)', display: 'flex', justifyContent: 'center' }}>
                <button onClick={handleSave} disabled={isSaving} className="btn btn-primary" style={{ minWidth: '200px' }}>
                    <Save size={18} />
                    {isSaving ? 'Saving...' : 'Save Talk'}
                </button>
            </div>
        </div>
    );
};
