import { useState } from 'react';
import type { Talk, AnswerOption } from '@iinpublic/shared';
import { ArrowLeft, Check, X } from 'lucide-react';

interface TalkRunnerProps {
    talk: Talk;
    onComplete: (result: { status: 'match' | 'ignore', answers: Record<string, string> }) => void;
    onCancel: () => void;
}

export const TalkRunner = ({ talk, onComplete, onCancel }: TalkRunnerProps) => {
    const [currentQId, setCurrentQId] = useState<string>(talk.rootQuestionId);
    const [answers, setAnswers] = useState<Record<string, string>>({});

    const currentQuestion = talk.nodes[currentQId];

    const handleAnswer = (option: AnswerOption) => {
        const newAnswers = { ...answers, [currentQId]: option.id };
        setAnswers(newAnswers);

        if (option.action === 'ignore') {
            onComplete({ status: 'ignore', answers: newAnswers });
        } else if (option.action === 'match') {
            onComplete({ status: 'match', answers: newAnswers });
        } else if (option.action === 'next') {
            if (option.nextQuestionId && talk.nodes[option.nextQuestionId]) {
                setCurrentQId(option.nextQuestionId);
            } else {
                onComplete({ status: 'match', answers: newAnswers });
            }
        }
    };

    if (!currentQuestion) {
        return <div className="container">Error: Question not found.</div>;
    }

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-app)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
            <div className="container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <header className="header-row" style={{ border: 'none' }}>
                    <button onClick={onCancel} className="btn btn-ghost btn-icon">
                        <ArrowLeft size={24} />
                    </button>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Running: <span style={{ color: 'var(--primary)' }}>{talk.title}</span>
                    </div>
                </header>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
                    <h2 style={{ fontSize: '2.5rem', marginBottom: '3rem', lineHeight: 1.2 }}>{currentQuestion.text}</h2>

                    <div style={{ display: 'grid', gap: '1rem' }}>
                        {currentQuestion.options.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => handleAnswer(opt)}
                                className="card"
                                style={{
                                    padding: '1.5rem',
                                    fontSize: '1.2rem',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    border: '1px solid var(--border)',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--primary)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                {opt.text}
                                {opt.action === 'match' && <Check size={20} color="var(--accent)" />}
                                {opt.action === 'ignore' && <X size={20} color="#fe2851" />}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
