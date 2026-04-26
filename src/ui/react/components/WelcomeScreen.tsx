import React from 'react';
import { useSocratic } from '../SocraticContext';

export function WelcomeScreen() {
  const { t, onStartTutoring, isProcessing, setShowHistory } = useSocratic();

  return (
    <div className="socratic-welcome">
      <div className="socratic-welcome-content">
        <div className="socratic-welcome-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 className="socratic-welcome-title">{t.welcomeMessage}</h2>
        <p className="socratic-welcome-hint">{t.inputPlaceholder}</p>
        <div className="socratic-actions">
          <button
            className="socratic-btn socratic-btn-primary"
            onClick={onStartTutoring}
            disabled={isProcessing}
          >
            {t.startTutoring}
          </button>
          <button
            className="socratic-btn"
            onClick={() => setShowHistory(true)}
            disabled={isProcessing}
          >
            {t.sessionHistoryTitle}
          </button>
        </div>
      </div>
    </div>
  );
}
