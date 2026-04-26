import React, { useEffect, useState } from 'react';
import { useSocratic } from '../SocraticContext';
import type { SessionSummary } from '../../../types';

export function SessionHistory() {
  const { t, setShowHistory, listSessionHistory, loadSessionFromHistory, deleteSessionFromHistory, isProcessing } = useSocratic();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    listSessionHistory()
      .then((items) => {
        if (mounted) {
          setSessions(items);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [listSessionHistory]);

  const handleDelete = async (slug: string) => {
    try {
      await deleteSessionFromHistory(slug);
      setSessions((prev) => prev.filter((s) => s.noteSlug !== slug));
    } catch {
      // Error is already shown by the plugin via view.showError
    }
  };

  return (
    <div className="socratic-history-panel">
      <div className="socratic-history-header">
        <h4>{t.sessionHistoryTitle}</h4>
        <button className="socratic-btn-icon" onClick={() => setShowHistory(false)} aria-label={t.closeLabel}>✕</button>
      </div>
      {loading ? (
        <p>{t.loading}...</p>
      ) : sessions.length === 0 ? (
        <p className="socratic-history-empty">{t.sessionHistoryEmpty}</p>
      ) : (
        <ul className="socratic-history-list">
          {sessions.map((session) => (
            <li key={session.noteSlug} className="socratic-history-item">
              <div className="socratic-history-info">
                <span className="socratic-history-title">{session.noteTitle}</span>
                <span className="socratic-history-meta">
                  {new Date(session.updatedAt).toLocaleDateString()} · {session.conceptCount} {t.conceptsLabel} · {session.messageCount} {t.messagesLabel} · {session.completed ? t.completedLabel : t.inProgressLabel}
                </span>
              </div>
              <div className="socratic-history-actions">
                <button
                  className="socratic-btn socratic-btn-primary"
                  onClick={() => loadSessionFromHistory(session.noteSlug)}
                  disabled={isProcessing}
                >
                  {t.continueLabel}
                </button>
                <button
                  className="socratic-btn socratic-btn-danger"
                  onClick={() => handleDelete(session.noteSlug)}
                  disabled={isProcessing}
                >
                  {t.deleteLabel}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
