import React from 'react';
import { SocraticProvider, useSocratic } from './SocraticContext';
import { Thread } from './components/Thread';
import { ProgressPanel } from './components/ProgressPanel';
import { SelfAssessment } from './components/SelfAssessment';
import { SessionResume } from './components/SessionResume';
import { SessionHistory } from './components/SessionHistory';
import { NoteSwitchResume } from './components/NoteSwitchResume';
import { EnergyRing } from './components/EnergyRing';
import { QuizGenerator } from './components/QuizGenerator';
import type { ReactSocraticView } from '../ReactSocraticView';

interface SocraticAppProps {
  view: ReactSocraticView;
}

export function SocraticApp({ view }: SocraticAppProps) {
  return (
    <SocraticProvider view={view}>
      <SocraticAppInner />
    </SocraticProvider>
  );
}

function SocraticAppInner() {
  const { t, isSessionActive, isProcessing, dialogState, resolveSelfAssessment, resolveSessionResume, showHistory, setShowHistory, showQuizGenerator, setShowQuizGenerator, onExitToMain } = useSocratic();

  return (
    <div className="socratic-view">
      <div className="socratic-header">
        <div className="socratic-header__brand">
          <h3>{t.viewTitle}</h3>
          <EnergyRing isActive={isSessionActive} />
        </div>
        <div className="socratic-header-actions">
          <span
            className={`socratic-status ${isSessionActive ? 'socratic-status--visible' : 'socratic-status--hidden'}`}
          >
            {t.viewStatusReady}
          </span>
          <button
            className={`socratic-btn socratic-btn-ghost ${isSessionActive ? 'socratic-header-btn--visible' : 'socratic-header-btn--hidden'}`}
            onClick={() => void onExitToMain()}
            disabled={isProcessing}
            title={t.exitToMain}
          >
            {t.exitToMain}
          </button>
          <span
            className="socratic-link"
            onClick={() => setShowQuizGenerator(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowQuizGenerator(true);
              }
            }}
            title={t.generateQuizTitle}
          >
            {t.generateQuizTitle}
          </span>
          <span
            className="socratic-link"
            onClick={() => setShowHistory(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowHistory(true);
              }
            }}
            title={t.sessionHistoryTitle}
          >
            {t.sessionHistoryTitle}
          </span>
        </div>
      </div>
      {isSessionActive && <ProgressPanel />}
      <Thread />

      {dialogState.sessionResume && (
        <div className="socratic-dialog-overlay">
          <SessionResume
            onChoice={resolveSessionResume}
            disabled={false}
          />
        </div>
      )}

      {dialogState.noteSwitchResume && (
        <div className="socratic-dialog-overlay">
          <NoteSwitchResume />
        </div>
      )}

      {dialogState.selfAssessment && (
        <div className="socratic-dialog-overlay">
          <SelfAssessment
            onSelect={resolveSelfAssessment}
            disabled={false}
          />
        </div>
      )}

      {showHistory && (
        <div className="socratic-dialog-overlay">
          <SessionHistory />
        </div>
      )}

      {showQuizGenerator && (
        <div className="socratic-dialog-overlay">
          <QuizGenerator />
        </div>
      )}
    </div>
  );
}
