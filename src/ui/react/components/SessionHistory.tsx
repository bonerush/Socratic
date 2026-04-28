import React, { useEffect, useState, useMemo } from 'react';
import { useSocratic } from '../SocraticContext';
import type { SessionSummary } from '../../../types';

interface GroupedSessions {
  noteSlug: string;
  noteTitle: string;
  sessions: SessionSummary[];
}

function groupByNote(sessions: SessionSummary[]): GroupedSessions[] {
  const map = new Map<string, GroupedSessions>();
  for (const session of sessions) {
    const existing = map.get(session.noteSlug);
    if (existing) {
      existing.sessions.push(session);
    } else {
      map.set(session.noteSlug, {
        noteSlug: session.noteSlug,
        noteTitle: session.noteTitle,
        sessions: [session],
      });
    }
  }
  return Array.from(map.values());
}

export function SessionHistory() {
  const { t, setShowHistory, listSessionHistory, loadSessionFromHistory, deleteSessionFromHistory, isProcessing } = useSocratic();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    listSessionHistory()
      .then((items) => {
        if (mounted) {
          setSessions(items);
          setLoading(false);
          // Auto-expand notes that have a current session
          const hasCurrent = new Set<string>();
          for (const item of items) {
            if (item.sessionId === 'current') {
              hasCurrent.add(item.noteSlug);
            }
          }
          setExpandedNotes(hasCurrent);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [listSessionHistory]);

  const grouped = useMemo(() => groupByNote(sessions), [sessions]);

  const toggleNote = (noteSlug: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteSlug)) {
        next.delete(noteSlug);
      } else {
        next.add(noteSlug);
      }
      return next;
    });
  };

  const handleDelete = async (slug: string, sessionId?: string) => {
    try {
      await deleteSessionFromHistory(slug, sessionId);
      setSessions((prev) => prev.filter((s) => !(s.noteSlug === slug && s.sessionId === (sessionId || 'current'))));
    } catch {
      // Error is already shown by the plugin via view.showError
    }
  };

  const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
          {grouped.map((group) => {
            const isExpanded = expandedNotes.has(group.noteSlug);
            return (
              <li key={group.noteSlug} className="socratic-history-group">
                <button
                  className="socratic-history-group__title"
                  onClick={() => toggleNote(group.noteSlug)}
                  type="button"
                >
                  <span className="socratic-history-group__arrow">{isExpanded ? '▼' : '▶'}</span>
                  <span className="socratic-history-group__name">{group.noteTitle}</span>
                  <span className="socratic-history-group__count">{group.sessions.length}</span>
                </button>
                {isExpanded && (
                  <ul className="socratic-history-sublist">
                    {group.sessions.map((session) => (
                      <li key={`${session.noteSlug}-${session.sessionId}`} className="socratic-history-item">
                        <div className="socratic-history-info">
                          <span className="socratic-history-title">
                            {session.sessionId === 'current' && (
                              <span className="socratic-history-badge">{t.currentSessionLabel}</span>
                            )}
                            {formatDate(session.updatedAt)}
                          </span>
                          <span className="socratic-history-meta">
                            {session.conceptCount} {t.conceptsLabel} · {session.messageCount} {t.messagesLabel} · {session.completed ? t.completedLabel : t.inProgressLabel}
                          </span>
                        </div>
                        <div className="socratic-history-actions">
                          <button
                            className="socratic-btn socratic-btn-primary"
                            onClick={() => loadSessionFromHistory(session.noteSlug, session.sessionId === 'current' ? undefined : session.sessionId)}
                            disabled={isProcessing}
                          >
                            {t.continueLabel}
                          </button>
                          <button
                            className="socratic-btn socratic-btn-danger"
                            onClick={() => handleDelete(session.noteSlug, session.sessionId === 'current' ? undefined : session.sessionId)}
                            disabled={isProcessing}
                          >
                            {t.deleteLabel}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
