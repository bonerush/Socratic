import React from 'react';
import { useSocratic } from '../SocraticContext';

interface SessionResumeProps {
  onChoice: (choice: 'resume' | 'restart') => void;
  disabled: boolean;
}

export function SessionResume({ onChoice, disabled }: SessionResumeProps) {
  const { t } = useSocratic();

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onChoice('restart');
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onChoice]);

  return (
    <div className="socratic-message socratic-message-tutor">
      <div className="socratic-message-bubble socratic-resume-dialog">
        <div className="socratic-message-content">
          <p>{t.resumeDialogTitle}</p>
        </div>
        <div className="socratic-resume-actions">
          <button
            className="socratic-btn socratic-btn-primary"
            onClick={() => onChoice('resume')}
            disabled={disabled}
          >
            {t.resumeResume}
          </button>
          <button
            className="socratic-btn"
            onClick={() => onChoice('restart')}
            disabled={disabled}
          >
            {t.resumeRestart}
          </button>
        </div>
      </div>
    </div>
  );
}
