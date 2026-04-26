import React from 'react';
import { SocraticProvider, useSocratic } from './SocraticContext';
import { Thread } from './components/Thread';
import { ProgressPanel } from './components/ProgressPanel';
import { SelfAssessment } from './components/SelfAssessment';
import { SessionResume } from './components/SessionResume';
import { SessionHistory } from './components/SessionHistory';
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
  const { t, isSessionActive, isProcessing, dialogState, resolveSelfAssessment, resolveSessionResume, showHistory, setShowHistory } = useSocratic();

  return (
    <div className="socratic-view">
      <div className="socratic-header">
        <h3>{t.viewTitle}</h3>
        <div className="socratic-header-actions">
          <span className="socratic-status">
            {isSessionActive ? t.viewStatusReady : t.noActiveSession}
          </span>
          <button
            className="socratic-btn socratic-btn-ghost"
            onClick={() => setShowHistory(true)}
            disabled={isProcessing}
            title={t.sessionHistoryTitle}
          >
            {t.sessionHistoryTitle}
          </button>
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
    </div>
  );
}
