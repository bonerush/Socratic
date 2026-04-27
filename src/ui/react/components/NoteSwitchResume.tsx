import React, { useEffect } from 'react';
import { useSocratic } from '../SocraticContext';

export function NoteSwitchResume() {
  const { t, resolveNoteSwitchResume } = useSocratic();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resolveNoteSwitchResume('cancel');
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [resolveNoteSwitchResume]);

  return (
    <div className="socratic-dialog socratic-dialog-note-switch">
      <h3>{t.noteSwitchResumeTitle}</h3>
      <div className="socratic-dialog-actions">
        <button
          className="socratic-btn socratic-btn-primary"
          onClick={() => resolveNoteSwitchResume('resume')}
        >
          {t.noteSwitchResumeContinue}
        </button>
        <button
          className="socratic-btn"
          onClick={() => resolveNoteSwitchResume('restart')}
        >
          {t.noteSwitchResumeRestart}
        </button>
        <button
          className="socratic-btn"
          onClick={() => resolveNoteSwitchResume('cancel')}
        >
          {t.noteSwitchResumeCancel}
        </button>
      </div>
    </div>
  );
}
